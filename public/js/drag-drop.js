/**
 * @module drag-drop
 * @description Drag-and-drop system for the canvas. Sets up drop-zone behaviour
 * on the canvas wrapper, calculates drop position (accounting for zoom/pan),
 * and provides a `makeDraggable()` helper for drag-source elements.
 */

import { EventBus } from './event-bus.js';
import { Toast } from './ui-components.js';

/**
 * Inline styles for the drop-zone overlay indicator.
 * Now delegated to the workspace CSS modules.
 */

/**
 * Creates a visual content node at the given position.
 * @param {{ type:string, category?:string, name?:string, content?:string }} data
 * @param {number} x — left offset (px, in canvas coordinates)
 * @param {number} y — top offset (px, in canvas coordinates)
 * @returns {HTMLElement}
 */
function createContentNode(data, x, y) {
  const node = document.createElement('div');
  node.className = 'canvas-node';
  node.dataset.nodeType = data.type ?? 'unknown';
  node.draggable = true;
  node.style.left = `${x}px`;
  node.style.top = `${y}px`;

  // Display name / preview
  const title = document.createElement('div');
  title.className = 'canvas-node-title';
  title.textContent = data.name ?? data.type ?? 'Elemento';
  node.appendChild(title);

  if (data.content) {
    const preview = document.createElement('div');
    preview.className = 'canvas-node-preview';
    preview.textContent = data.content.length > 120 ? data.content.slice(0, 120) + '…' : data.content;
    node.appendChild(preview);
  }

  return node;
}

/**
 * Drag & Drop system for the canvas.
 *
 * @example
 * const dd = new DragDrop();
 * dd.init(canvasInstance);
 */
export class DragDrop {
  /** @type {import('./canvas.js').Canvas|null} */ #canvas = null;
  /** @type {HTMLElement|null} */ #wrapper = null;
  /** @type {HTMLElement|null} */ #indicator = null;
  /** @type {number} */ #dragCounter = 0;

  /** Bound handler refs. */
  #bound = {};

  /**
   * Initialise drag-and-drop on the given Canvas instance.
   * @param {import('./canvas.js').Canvas} canvas
   */
  init(canvas) {
    this.#canvas = canvas;
    this.#wrapper = canvas.getWrapper();

    if (!this.#wrapper) {
      console.error('[DragDrop] Canvas wrapper not available.');
      return;
    }

    // ── Drop indicator overlay ──────────────────────────────────────────
    this.#indicator = document.createElement('div');
    this.#indicator.className = 'drop-indicator';
    this.#wrapper.appendChild(this.#indicator);

    // ── Bind drop-zone events ───────────────────────────────────────────
    this.#bound.dragover = this.#onDragOver.bind(this);
    this.#bound.dragenter = this.#onDragEnter.bind(this);
    this.#bound.dragleave = this.#onDragLeave.bind(this);
    this.#bound.drop = this.#onDrop.bind(this);

    this.#wrapper.addEventListener('dragover', this.#bound.dragover);
    this.#wrapper.addEventListener('dragenter', this.#bound.dragenter);
    this.#wrapper.addEventListener('dragleave', this.#bound.dragleave);
    this.#wrapper.addEventListener('drop', this.#bound.drop);

    // ── Internal node reordering: make existing nodes draggable ──────
    this.#setupNodeDrag();
  }

  /**
   * Make an external element draggable with JSON data payload.
   * @param {HTMLElement} element — the DOM element to make draggable
   * @param {object} data — arbitrary data attached to the drag
   */
  static makeDraggable(element, data) {
    element.draggable = true;
    element.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/json', JSON.stringify(data));
      e.dataTransfer.effectAllowed = 'copyMove';

      // Semi-transparent ghost
      const ghost = element.cloneNode(true);
      ghost.classList.add('drag-image-ghost');
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 20, 20);
      requestAnimationFrame(() => ghost.remove());
    });
  }

  /** Clean up all listeners and DOM. */
  destroy() {
    if (this.#wrapper) {
      this.#wrapper.removeEventListener('dragover', this.#bound.dragover);
      this.#wrapper.removeEventListener('dragenter', this.#bound.dragenter);
      this.#wrapper.removeEventListener('dragleave', this.#bound.dragleave);
      this.#wrapper.removeEventListener('drop', this.#bound.drop);
    }
    this.#indicator?.remove();
    this.#indicator = null;
    this.#bound = {};
    this.#canvas = null;
    this.#wrapper = null;
  }

  // ─── Private: drop-zone handlers ───────────────────────────────────────

  /**
   * @param {DragEvent} e
   */
  #onDragOver(e) {
    // The story-book editor owns its internal reordering and timeline-link
    // gestures. Do not turn those drags into canvas-node drop overlays.
    if (
      e.dataTransfer?.types?.includes('application/x-kubrick-space-story-node') ||
      e.dataTransfer?.types?.includes('application/x-kubrick-space-timeline-link')
    )
      return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }

  /**
   * Show drop indicator.
   * @param {DragEvent} e
   */
  #onDragEnter(e) {
    if (
      e.dataTransfer?.types?.includes('application/x-kubrick-space-story-node') ||
      e.dataTransfer?.types?.includes('application/x-kubrick-space-timeline-link')
    )
      return;
    if (e.dataTransfer.types && e.dataTransfer.types.includes('kubrick-space-ingredient')) {
      return;
    }
    this.#dragCounter++;
    this.#indicator?.classList.add('is-visible');
  }

  /**
   * Hide drop indicator when leaving.
   * @param {DragEvent} e
   */
  #onDragLeave(e) {
    if (
      e.dataTransfer?.types?.includes('application/x-kubrick-space-story-node') ||
      e.dataTransfer?.types?.includes('application/x-kubrick-space-timeline-link')
    )
      return;
    if (e.dataTransfer.types && e.dataTransfer.types.includes('kubrick-space-ingredient')) {
      return;
    }
    this.#dragCounter--;
    if (this.#dragCounter <= 0) {
      this.#dragCounter = 0;
      this.#indicator?.classList.remove('is-visible');
    }
  }

  /**
   * Handle item drop.
   * @param {DragEvent} e
   */
  #onDrop(e) {
    if (
      e.dataTransfer?.types?.includes('application/x-kubrick-space-story-node') ||
      e.dataTransfer?.types?.includes('application/x-kubrick-space-timeline-link')
    )
      return;
    e.preventDefault();
    this.#dragCounter = 0;
    this.#indicator?.classList.remove('is-visible');

    if (e.dataTransfer.types && e.dataTransfer.types.includes('kubrick-space-ingredient')) {
      Toast.show('Los ingredientes solo se pueden agregar en los cajones junto al editor', 'warning');
      return;
    }

    // Parse payload
    let data;
    try {
      const raw = e.dataTransfer.getData('application/json');
      data = raw ? JSON.parse(raw) : null;
    } catch {
      console.warn('[DragDrop] Invalid drag data.');
      return;
    }
    if (!data) return;

    // Calculate drop position in canvas coordinates
    const { x, y } = this.#clientToCanvas(e.clientX, e.clientY);

    // Create visual node
    const transformContainer = this.#canvas?.getContainer();
    if (!transformContainer) return;

    const node = createContentNode(data, x, y);
    transformContainer.appendChild(node);

    // Make it re-draggable within the canvas
    this.#makeNodeReorderable(node);

    EventBus.emit('canvas:nodeAdded', { data, x, y, node });
  }

  // ─── Private: coordinate conversion ────────────────────────────────────

  /**
   * Convert client (mouse) coordinates to canvas-local coordinates,
   * accounting for zoom and pan.
   * @param {number} clientX
   * @param {number} clientY
   * @returns {{ x: number, y: number }}
   */
  #clientToCanvas(clientX, clientY) {
    if (!this.#canvas || !this.#wrapper) return { x: 0, y: 0 };

    const rect = this.#wrapper.getBoundingClientRect();
    const zoom = this.#canvas.getZoom();
    const pan = this.#canvas.getPan();

    const x = (clientX - rect.left - pan.x) / zoom;
    const y = (clientY - rect.top - pan.y) / zoom;

    return { x: Math.round(x), y: Math.round(y) };
  }

  // ─── Private: internal node dragging ───────────────────────────────────

  /**
   * Add drag-to-reorder behaviour to all existing canvas nodes.
   */
  #setupNodeDrag() {
    const container = this.#canvas?.getContainer();
    if (!container) return;

    container.querySelectorAll('.canvas-node').forEach((node) => {
      this.#makeNodeReorderable(/** @type {HTMLElement} */ (node));
    });
  }

  /**
   * Make a node repositionable via drag within the canvas.
   * @param {HTMLElement} node
   */
  #makeNodeReorderable(node) {
    let offsetX = 0;
    let offsetY = 0;
    let dragging = false;

    const onMouseDown = (e) => {
      if (e.button !== 0) return;
      // Don't start drag if user is interacting with editable content inside
      if (
        e.target.closest('[contenteditable="true"]') ||
        e.target.closest('textarea') ||
        e.target.closest('input')
      )
        return;

      e.preventDefault();
      dragging = true;
      const zoom = this.#canvas?.getZoom() ?? 1;
      offsetX = e.clientX / zoom - parseFloat(node.style.left || '0');
      offsetY = e.clientY / zoom - parseFloat(node.style.top || '0');
      node.classList.add('is-reordering');
    };

    const onMouseMove = (e) => {
      if (!dragging) return;
      const zoom = this.#canvas?.getZoom() ?? 1;
      node.style.left = `${e.clientX / zoom - offsetX}px`;
      node.style.top = `${e.clientY / zoom - offsetY}px`;
    };

    const onMouseUp = () => {
      if (!dragging) return;
      dragging = false;
      node.classList.remove('is-reordering');
    };

    node.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    // Store cleanup ref on the node for potential future removal
    node._dragCleanup = () => {
      node.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }
}
