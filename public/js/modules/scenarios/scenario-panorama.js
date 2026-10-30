import { scenarioElement, scenarioAction } from './scenario-ui.js';

export const PANORAMA_FOV = Object.freeze({ min: 40, max: 100, initial: 80 });
const RENDER_WIDTH = 480;
const MIN_HEIGHT = 180;
const MAX_HEIGHT = 560;
const SOURCE_WIDTH = 2048;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const wrap = (value) => value - Math.floor(value);

/**
 * Where an output pixel of the rectilinear viewport lands in the equirectangular source.
 * Yaw turns right, pitch looks up; u/v are normalised to [0, 1).
 */
export function panoramaSample({ x, y, width, height, yaw, pitch, fov }) {
  const tan = Math.tan((fov * Math.PI) / 360);
  const dx = (((x + 0.5) / width) * 2 - 1) * tan * (width / height);
  const dy = (1 - ((y + 0.5) / height) * 2) * tan;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const ry = dy * cp + sp;
  const rz = -dy * sp + cp;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const rx = dx * cy + rz * sy;
  const rz2 = -dx * sy + rz * cy;
  const length = Math.hypot(rx, ry, rz2);
  return {
    u: wrap(Math.atan2(rx, rz2) / (2 * Math.PI) + 0.5),
    v: clamp(0.5 - Math.asin(clamp(ry / length, -1, 1)) / Math.PI, 0, 0.999999),
  };
}

/**
 * Drag-to-look viewer for an equirectangular image. Pure canvas 2D: no WebGL, no dependencies.
 * Wheel is deliberately not captured so the workspace canvas keeps its zoom gesture. The drag
 * surface is a native button: the workspace canvas never treats a press on a control as a pan.
 */
export class PanoramaViewer {
  constructor(container, { url, label = 'Panorama 360°' }) {
    this.container = container;
    this.yaw = 0;
    this.pitch = 0;
    this.fov = PANORAMA_FOV.initial;
    this.destroyed = false;
    this.flat = false;
    this.cleanups = [];
    this.element = scenarioElement('div', 'scenario-pano');
    this.stage = scenarioElement('div', 'scenario-pano__stage');
    this.surface = scenarioElement('button', 'scenario-pano__surface');
    this.surface.type = 'button';
    this.surface.setAttribute(
      'aria-label',
      `${label}. Arrastra o usa las flechas del teclado para mirar alrededor; más y menos para el zoom.`,
    );
    this.canvas = scenarioElement('canvas', 'scenario-pano__canvas');
    this.canvas.width = RENDER_WIDTH;
    this.canvas.height = 320;
    this.surface.append(this.canvas);
    this.status = scenarioElement('p', 'scenario-pano__status', 'Cargando panorama…');
    this.status.setAttribute('role', 'status');
    this.flatImage = scenarioElement('img', 'scenario-pano__flat');
    this.flatImage.alt = `${label} completo, proyección equirrectangular`;
    this.flatImage.hidden = true;
    this.flatImage.draggable = false;
    this.stage.append(this.surface, this.flatImage, this.status);
    const controls = scenarioElement('div', 'scenario-pano__controls');
    this.zoomIn = scenarioAction('Acercar', 'plus', () => this.zoom(-10));
    this.zoomOut = scenarioAction('Alejar', 'minus', () => this.zoom(10));
    this.toggle = scenarioAction('Vista completa', 'expand', () => this.setFlat(!this.flat));
    this.toggle.setAttribute('aria-pressed', 'false');
    controls.append(this.zoomIn, this.zoomOut, this.toggle);
    this.element.append(this.stage, controls);
    container.append(this.element);
    this.bind();
    this.observe();
    this.load(url);
  }
  bind() {
    let drag = null;
    const down = (event) => {
      if (this.flat || !this.ready || event.button !== 0) return;
      drag = { x: event.clientX, y: event.clientY, id: event.pointerId };
      try {
        this.surface.setPointerCapture(event.pointerId);
      } catch {
        /* A pointer that is already gone cannot be captured; the drag simply ends. */
      }
      this.surface.classList.add('is-dragging');
    };
    const move = (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      const scale = (this.fov * Math.PI) / 180 / Math.max(1, this.surface.clientWidth) || 0.003;
      this.yaw -= (event.clientX - drag.x) * scale;
      this.pitch = clamp(this.pitch + (event.clientY - drag.y) * scale, -1.45, 1.45);
      drag.x = event.clientX;
      drag.y = event.clientY;
      this.schedule();
    };
    const up = (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      drag = null;
      this.surface.releasePointerCapture?.(event.pointerId);
      this.surface.classList.remove('is-dragging');
    };
    const key = (event) => {
      if (this.flat || !this.ready) return;
      const step = ((this.fov * Math.PI) / 720) * 4;
      const actions = {
        ArrowLeft: () => (this.yaw -= step),
        ArrowRight: () => (this.yaw += step),
        ArrowUp: () => (this.pitch = clamp(this.pitch + step, -1.45, 1.45)),
        ArrowDown: () => (this.pitch = clamp(this.pitch - step, -1.45, 1.45)),
        '+': () => this.zoom(-10),
        '-': () => this.zoom(10),
      };
      if (!actions[event.key]) return;
      event.preventDefault();
      actions[event.key]();
      this.schedule();
    };
    for (const [name, handler] of [
      ['pointerdown', down],
      ['pointermove', move],
      ['pointerup', up],
      ['pointercancel', up],
      ['keydown', key],
    ]) {
      this.surface.addEventListener(name, handler);
      this.cleanups.push(() => this.surface.removeEventListener(name, handler));
    }
  }
  /** The render buffer follows the node's proportions so the picture is never letterboxed. */
  fit() {
    const { clientWidth, clientHeight } = this.surface;
    if (!clientWidth || !clientHeight) return;
    const height = Math.round(clamp((RENDER_WIDTH * clientHeight) / clientWidth, MIN_HEIGHT, MAX_HEIGHT));
    if (height !== this.canvas.height) {
      this.canvas.height = height;
      this.schedule();
    }
  }
  observe() {
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(() => this.fit());
    observer.observe(this.surface);
    this.cleanups.push(() => observer.disconnect());
  }
  async load(url) {
    try {
      const image = new Image();
      image.decoding = 'async';
      image.src = url;
      this.flatImage.src = url;
      await image.decode();
      if (this.destroyed) return;
      const scale = Math.min(1, SOURCE_WIDTH / image.naturalWidth);
      const source = document.createElement('canvas');
      source.width = Math.max(2, Math.round(image.naturalWidth * scale));
      source.height = Math.max(2, Math.round(image.naturalHeight * scale));
      const context = source.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0, source.width, source.height);
      this.source = context.getImageData(0, 0, source.width, source.height);
      this.ready = true;
      this.status.hidden = true;
      this.fit();
      this.render();
    } catch {
      if (this.destroyed) return;
      this.status.textContent = 'No se pudo cargar el panorama. Prueba la vista completa.';
      this.flatImage.hidden = false;
      this.surface.hidden = true;
    }
  }
  zoom(delta) {
    this.fov = clamp(this.fov + delta, PANORAMA_FOV.min, PANORAMA_FOV.max);
    this.schedule();
  }
  setFlat(flat) {
    this.flat = flat;
    this.flatImage.hidden = !flat;
    this.surface.hidden = flat;
    this.zoomIn.disabled = this.zoomOut.disabled = flat;
    this.toggle.setAttribute('aria-pressed', String(flat));
    this.toggle.lastChild.textContent = flat ? 'Volver a 360°' : 'Vista completa';
    this.toggle.setAttribute('aria-label', this.toggle.lastChild.textContent);
    if (!flat) {
      this.fit();
      this.schedule();
    }
  }
  schedule() {
    if (this.frame || this.destroyed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }
  render() {
    if (!this.ready || this.destroyed || this.flat) return;
    const { data, width: sw, height: sh } = this.source;
    const { width, height } = this.canvas;
    const context = this.canvas.getContext('2d');
    const output = context.createImageData(width, height);
    const target = output.data;
    let index = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const { u, v } = panoramaSample({
          x,
          y,
          width,
          height,
          yaw: this.yaw,
          pitch: this.pitch,
          fov: this.fov,
        });
        const from = ((v * sh) | 0) * sw * 4 + ((u * sw) | 0) * 4;
        target[index++] = data[from];
        target[index++] = data[from + 1];
        target[index++] = data[from + 2];
        target[index++] = 255;
      }
    }
    context.putImageData(output, 0, 0);
  }
  destroy() {
    this.destroyed = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.cleanups.splice(0).forEach((dispose) => dispose());
    this.source = null;
    this.element.remove();
  }
}
