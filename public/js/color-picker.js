import { renderIcon } from './icons.js';
import { safeHTML } from './safe-html.js';

export function normalizeColor(value) {
  const hex = String(value || '')
    .trim()
    .replace(/^#/, '');
  if (/^[\da-f]{3}$/i.test(hex))
    return (
      '#' +
      [...hex]
        .map((c) => c + c)
        .join('')
        .toLowerCase()
    );
  return /^[\da-f]{6}$/i.test(hex) ? '#' + hex.toLowerCase() : null;
}

export function colorToHSV(value) {
  const hex = normalizeColor(value) || '#6366f1';
  const rgb = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const max = Math.max(...rgb),
    min = Math.min(...rgb),
    delta = max - min;
  let h = 0;
  if (delta) {
    const [r, g, b] = rgb;
    h = (max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60;
  }
  return { h: (h + 360) % 360, s: max ? delta / max : 0, v: max };
}

export function HSVToColor({ h, s, v }) {
  const channel = (n) => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * v * (1 - s * Math.max(0, Math.min(k, 4 - k, 1))))
      .toString(16)
      .padStart(2, '0');
  };
  return '#' + channel(5) + channel(3) + channel(1);
}

let dismissActive = null;
let colorSequence = 0;

/** The draft lives only in the dialog. Cancel never changes the ingredient. */
export function createColorControl(value, label, onAccept) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'kai-color-picker';
  button.value = normalizeColor(value) || '#6366f1';
  button.title = label;
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  const updateButton = () => {
    button.style.setProperty('--swatch-color', button.value);
    button.setAttribute('aria-label', `${label}: ${button.value}`);
  };
  updateButton();
  let closeOwn = null;
  const open = () => {
    dismissActive?.();
    const doc = button.ownerDocument;
    const dialog = doc.createElement('dialog');
    const id = `kai-color-${++colorSequence}`;
    dialog.className = 'kai-color-dialog';
    dialog.setAttribute('aria-labelledby', `${id}-title`);
    dialog.innerHTML = safeHTML(`
      <h2 id="${id}-title" class="sr-only">${label}</h2>
      <div class="kai-color-disc">
        <button type="button" class="kai-color-close" aria-label="Cerrar paleta">${renderIcon('close', 18)}</button>
        <div class="kai-color-wheel" role="slider" tabindex="0" aria-label="Tono y saturación" aria-valuemin="0" aria-valuemax="359" aria-describedby="${id}-help"><span class="kai-color-handle"></span></div>
      </div>
      <p id="${id}-help" class="sr-only">Flechas izquierda y derecha: tono. Arriba y abajo: saturación. Inicio y Fin: saturación mínima y máxima.</p>
      <div class="kai-color-controls">
        <label class="kai-color-brightness">Brillo <input type="range" min="0" max="100" step="0.1" aria-label="Brillo"></label>
        <label class="kai-color-hex"><span class="kai-color-preview" aria-hidden="true"></span><span class="sr-only">Color HEX</span><input type="text" aria-label="Color HEX" maxlength="7" spellcheck="false" autocomplete="off"></label>
        <p class="kai-color-error" role="status" aria-live="polite"></p>
        <div class="kai-color-actions"><button type="button" class="btn btn-md btn-secondary" data-color-cancel>Cancelar</button><button type="button" class="btn btn-md btn-primary" data-color-accept>Aceptar</button></div>
      </div>`);
    const wheel = dialog.querySelector('.kai-color-wheel');
    const brightness = dialog.querySelector('[type=range]');
    const hex = dialog.querySelector('[type=text]');
    const accept = dialog.querySelector('[data-color-accept]');
    const error = dialog.querySelector('.kai-color-error');
    let hsv = colorToHSV(button.value);
    const paint = () => {
      const color = HSVToColor(hsv);
      hex.value = color;
      brightness.value = String(hsv.v * 100);
      wheel.style.setProperty('--color-darkness', String(1 - hsv.v));
      const angle = (hsv.h * Math.PI) / 180;
      wheel.style.setProperty('--color-x', `${50 + Math.sin(angle) * hsv.s * 50}%`);
      wheel.style.setProperty('--color-y', `${50 - Math.cos(angle) * hsv.s * 50}%`);
      dialog.style.setProperty('--chosen-color', color);
      wheel.setAttribute('aria-valuenow', String(Math.round(hsv.h) % 360));
      wheel.setAttribute(
        'aria-valuetext',
        `${color}, saturación ${Math.round(hsv.s * 100)}%, brillo ${Math.round(hsv.v * 100)}%`,
      );
      hex.removeAttribute('aria-invalid');
      accept.disabled = false;
      error.textContent = '';
    };
    const close = () => {
      if (closeOwn !== close) return;
      closeOwn = null;
      if (dismissActive === close) dismissActive = null;
      button.setAttribute('aria-expanded', 'false');
      dialog.close();
      dialog.remove();
      if (button.isConnected) button.focus();
    };
    closeOwn = dismissActive = close;
    dialog.querySelector('.kai-color-close').addEventListener('click', close);
    dialog.querySelector('[data-color-cancel]').addEventListener('click', close);
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      close();
    });
    accept.addEventListener('click', () => {
      const color = normalizeColor(hex.value);
      if (!color) return;
      button.value = color;
      updateButton();
      close();
      onAccept?.(color);
    });
    hex.addEventListener('input', () => {
      const color = normalizeColor(hex.value);
      accept.disabled = !color;
      hex.setAttribute('aria-invalid', String(!color));
      error.textContent = color ? '' : 'Usa un color HEX válido.';
      if (color) {
        hsv = colorToHSV(color);
        const text = hex.value;
        paint();
        hex.value = text;
      }
    });
    brightness.addEventListener('input', () => {
      hsv.v = Number(brightness.value) / 100;
      paint();
    });
    const choosePoint = (event) => {
      const rect = wheel.getBoundingClientRect();
      const x = event.clientX - rect.left - rect.width / 2;
      const y = event.clientY - rect.top - rect.height / 2;
      hsv.h = ((Math.atan2(y, x) * 180) / Math.PI + 450) % 360;
      hsv.s = Math.min(1, Math.hypot(x, y) / (Math.min(rect.width, rect.height) / 2));
      paint();
    };
    wheel.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      wheel.focus();
      wheel.setPointerCapture(event.pointerId);
      choosePoint(event);
    });
    wheel.addEventListener('pointermove', (event) => {
      if (wheel.hasPointerCapture(event.pointerId)) choosePoint(event);
    });
    wheel.addEventListener('pointerup', (event) => {
      if (wheel.hasPointerCapture(event.pointerId)) wheel.releasePointerCapture(event.pointerId);
    });
    wheel.addEventListener('keydown', (event) => {
      const step = event.shiftKey ? 10 : 2;
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
        hsv.h = (hsv.h + (event.key === 'ArrowRight' ? step : -step) + 360) % 360;
      else
        hsv.s =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? 1
              : Math.max(0, Math.min(1, hsv.s + (event.key === 'ArrowUp' ? step : -step) / 100));
      paint();
    });
    doc.body.append(dialog);
    paint();
    button.setAttribute('aria-expanded', 'true');
    dialog.showModal();
    wheel.focus();
  };
  button.addEventListener('click', open);
  return {
    element: button,
    destroy() {
      closeOwn?.();
      button.removeEventListener('click', open);
    },
  };
}
