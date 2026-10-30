/**
 * @module canvas
 * @description Dotted-grid canvas surface with zoom (scroll-wheel, 0.1×–3.0×)
 * and pan (left-mouse-drag on the empty canvas or selected visual surfaces,
 * or Space+left-mouse-drag).
 * Content nodes are added to the inner transform container.
 */

import { EventBus } from './event-bus.js';

/** Zoom constraints */
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 3.0;
// Wheel zoom is relative to the current scale. A 5% multiplicative step feels
// gradual at every size, unlike the old fixed 0.1 step that jumped too far at
// low zoom levels and too little at high zoom levels.
const ZOOM_FACTOR = 1.05;
const GRID_SIZE = 24; // px at 1× zoom

/**
 * Clamps `value` between `min` and `max`, retaining enough precision for
 * multiplicative (5%) wheel steps. The badge still presents a rounded percent.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clampZoom(value, min = ZOOM_MIN, max = ZOOM_MAX) {
  const bounded = Math.min(max, Math.max(min, Number(value) || min));
  return Math.round(bounded * 10000) / 10000;
}

/**
 * Canvas provides a pannable / zoomable dot-grid surface.
 *
 * @example
 * const c = new Canvas();
 * c.init(document.getElementById('canvas-root'));
 * c.getContainer().appendChild(myNode);
 */
export class Canvas {
  /** @type {HTMLElement|null} wrapper (overflow-hidden, shows the grid) */
  #wrapper = null;
  /** @type {HTMLElement|null} inner transform container */
  #transform = null;
  /** @type {HTMLElement|null} zoom indicator badge */
  #zoomBadge = null;

  /** @type {number} current zoom level */
  #zoom = 1.0;
  /** @type {number} current pan X */
  #panX = 0;
  /** @type {number} current pan Y */
  #panY = 0;

  /** @type {boolean} is Space key held? */
  #spaceDown = false;
  /** @type {boolean} are we currently panning? */
  #panning = false;
  /** @type {number} last pointer X during pan */
  #lastX = 0;
  /** @type {number} last pointer Y during pan */
  #lastY = 0;
  /** @type {number|null} active pointer during pan */
  #pointerId = null;
  /** @type {{pointerId:number,startX:number,startY:number}|null} delayed pan candidate */
  #panCandidate = null;
  #suppressClick = false;
  #suppressClickTimer = null;

  /** Bound handler refs for cleanup */
  #bound = {};

  /**
   * Initialise the canvas inside `container`.
   * @param {HTMLElement} container
   */
  init(container) {
    // ── Wrapper ──────────────────────────────────────────────────────────
    this.#wrapper = document.createElement('div');
    this.#wrapper.className = 'canvas-wrapper';
    this.#applyGrid();

    // ── Transform container ─────────────────────────────────────────────
    this.#transform = document.createElement('div');
    this.#transform.className = 'canvas-transform';
    this.#applyTransform();

    this.#wrapper.appendChild(this.#transform);

    // ── Zoom indicator badge ────────────────────────────────────────────
    this.#zoomBadge = document.createElement('div');
    this.#zoomBadge.className = 'canvas-zoom-badge';
    this.#updateZoomBadge();
    this.#wrapper.appendChild(this.#zoomBadge);

    container.appendChild(this.#wrapper);

    // ── Bind events ─────────────────────────────────────────────────────
    this.#bound.wheel = this.#onWheel.bind(this);
    this.#bound.pointerdown = this.#onPointerDown.bind(this);
    this.#bound.pointermove = this.#onPointerMove.bind(this);
    this.#bound.pointerup = this.#onPointerUp.bind(this);
    this.#bound.click = this.#onClick.bind(this);
    this.#bound.keydown = this.#onKeyDown.bind(this);
    this.#bound.keyup = this.#onKeyUp.bind(this);
    this.#bound.contextmenu = (e) => {
      if (this.#panning) e.preventDefault();
    };
    this.#bound.auxclick = (e) => {
      if (e.button === 1) e.preventDefault();
    };
    this.#bound.dragstart = (e) => {
      // Images and links have native drag behaviour. A canvas gesture owns it;
      // explicitly draggable controls never become a pan candidate.
      if (this.#panCandidate || this.#panning) e.preventDefault();
    };

    this.#wrapper.addEventListener('wheel', this.#bound.wheel, { passive: false });
    // Pointer capture keeps panning active across editor elements and prevents
    // browsers from interpreting a middle click as autoscroll.
    this.#wrapper.addEventListener('pointerdown', this.#bound.pointerdown, true);
    window.addEventListener('pointermove', this.#bound.pointermove, true);
    window.addEventListener('pointerup', this.#bound.pointerup, true);
    window.addEventListener('pointercancel', this.#bound.pointerup, true);
    window.addEventListener('click', this.#bound.click, true);
    window.addEventListener('keydown', this.#bound.keydown);
    window.addEventListener('keyup', this.#bound.keyup);
    this.#wrapper.addEventListener('contextmenu', this.#bound.contextmenu);
    this.#wrapper.addEventListener('auxclick', this.#bound.auxclick);
    this.#wrapper.addEventListener('dragstart', this.#bound.dragstart, true);
  }

  /** @returns {HTMLElement} the inner transform container for content nodes */
  getContainer() {
    return this.#transform;
  }

  /** @returns {HTMLElement} the outer wrapper element */
  getWrapper() {
    return this.#wrapper;
  }

  /** @returns {number} current zoom level */
  getZoom() {
    return this.#zoom;
  }

  /** @returns {{ x: number, y: number }} current pan offset */
  getPan() {
    return { x: this.#panX, y: this.#panY };
  }

  /** Reset zoom to 1.0× and center the viewport. */
  reset() {
    this.#zoom = 1.0;
    this.#panX = 0;
    this.#panY = 0;
    this.#applyTransform();
    this.#applyGrid();
    this.#updateZoomBadge();
    EventBus.emit('canvas:zoom', this.#zoom);
  }

  /** Fit the canvas contents inside the viewport and center them. */
  fitToViewport() {
    if (!this.#wrapper || !this.#transform) return;

    // Wait for the DOM/layout to stabilize
    setTimeout(() => {
      if (!this.#wrapper || !this.#transform) return;
      const wrapperRect = this.#wrapper.getBoundingClientRect();
      // Video projects use a scene board outside the legacy editor layout.
      // Prefer that visible board so fitting does not measure the hidden notes
      // editor and zoom the production view to an unusable scale.
      const videoBoard = this.#transform.querySelector('.video-board-node:not([hidden])');
      const content = videoBoard || this.#transform.querySelector('.editor-layout-wrapper');
      if (!content) return;

      // Temporarily reset transform to get natural bounds
      const oldTransform = this.#transform.style.transform;
      const oldTransition = this.#transform.style.getPropertyValue('transition');
      const transitionPriority = this.#transform.style.getPropertyPriority('transition');
      // Reduced-motion CSS can turn even an otherwise static transform into a
      // tiny transition. Measurements must resolve the requested matrix now,
      // not the preceding animation frame, or repeated fitting drifts away.
      this.#transform.style.setProperty('transition', 'none', 'important');
      this.#transform.style.transform = 'none';
      const measureContentRects = () => {
        const contentNodes = videoBoard
          ? [videoBoard]
          : [...content.children].filter((node) => node instanceof HTMLElement && node.offsetParent !== null);
        const measured = (contentNodes.length ? contentNodes : [content]).map((node) =>
          node.getBoundingClientRect(),
        );

        // The story-book index is positioned absolutely above the editor. It
        // is intentionally outside the editor's normal flow, so it is not
        // included in `content.children` bounds. Include its visible rectangle
        // explicitly; otherwise focus mode centers the cover/editor while
        // leaving the index clipped or offset above the viewport.
        if (!videoBoard) {
          const indexRects = [...content.querySelectorAll('.editor-index-container')]
            .filter((element) => getComputedStyle(element).display !== 'none')
            .map((element) => element.getBoundingClientRect())
            .filter((rect) => rect.width > 0 && rect.height > 0);
          measured.push(...indexRects);
        }
        return measured;
      };
      const rects = measureContentRects();
      this.#transform.style.transform = oldTransform;

      // The layout wrapper spans the whole canvas, so measuring it would make
      // "fit" appear to do nothing. Measure the real editor, cover and
      // ingredient drawers instead.
      const left = Math.min(...rects.map((rect) => rect.left));
      const top = Math.min(...rects.map((rect) => rect.top));
      const right = Math.max(...rects.map((rect) => rect.right));
      const bottom = Math.max(...rects.map((rect) => rect.bottom));
      const contentWidth = right - left || 1800;
      const contentHeight = bottom - top || 1250;

      const padX = 60; // horizontal padding
      const padY = 60; // vertical padding

      // The canvas fills the workspace behind the fixed toolbar, navigator and
      // right-side chat. Reserve their actual visible area so a fitted document
      // is never centered beneath a glass overlay (especially in focus mode).
      const workspace = this.#wrapper.closest('.workspace');
      const blockers = workspace
        ? [
            ...workspace.querySelectorAll(
              ':scope > .workspace__toolbar, :scope > .workspace__navigator, :scope > .workspace__chat',
            ),
          ]
        : [];
      const visibleBlockers = blockers
        .filter((element) => getComputedStyle(element).display !== 'none')
        .map((element) => ({ element, rect: element.getBoundingClientRect() }));
      const topInset = Math.max(
        0,
        ...visibleBlockers
          .filter(
            ({ element }) =>
              !element.classList.contains('workspace__chat') &&
              !element.classList.contains('workspace__navigator'),
          )
          .map(({ rect }) => Math.max(0, rect.bottom - wrapperRect.top)),
      );
      const leftInset = Math.max(
        0,
        ...visibleBlockers
          .filter(({ element }) => element.classList.contains('workspace__navigator'))
          .map(({ rect }) => Math.max(0, rect.right - wrapperRect.left)),
      );
      const rightInset = Math.max(
        0,
        ...visibleBlockers
          .filter(({ element }) => element.classList.contains('workspace__chat'))
          .map(({ rect }) => Math.max(0, wrapperRect.right - rect.left)),
      );

      const availableWidth = Math.max(1, wrapperRect.width - leftInset - rightInset - padX * 2);
      const availableHeight = Math.max(1, wrapperRect.height - topInset - padY * 2);

      let zoom = Math.min(availableWidth / contentWidth, availableHeight / contentHeight);

      // Clamp zoom to reasonable limits (e.g. between 0.15 and 1.5)
      zoom = Math.max(ZOOM_MIN, Math.min(videoBoard ? 1 : ZOOM_MAX, zoom));
      // Round to 2 decimal places
      zoom = Math.round(zoom * 100) / 100;

      // Calculate natural positions of content relative to wrapper
      // since translate is 0,0 and scale is 1.0
      const naturalLeft = left - wrapperRect.left;
      const naturalTop = top - wrapperRect.top;

      // Center it
      const panX = leftInset + padX + (availableWidth - contentWidth * zoom) / 2 - naturalLeft * zoom;
      const panY = topInset + padY + (availableHeight - contentHeight * zoom) / 2 - naturalTop * zoom;

      this.#zoom = zoom;
      this.#panX = panX;
      this.#panY = panY;

      this.#applyTransform();

      // Correct from the rendered bounds as a final pass. This protects the
      // vertical centering from fractional device-pixel rounding, image/font
      // layout changes and browser zoom on very large displays. The target is
      // the actual usable viewport between the fixed chrome and the chat, so
      // the result stays centered at every screen size.
      const fittedRects = measureContentRects();
      if (fittedRects.length) {
        const fittedLeft = Math.min(...fittedRects.map((rect) => rect.left));
        const fittedTop = Math.min(...fittedRects.map((rect) => rect.top));
        const fittedRight = Math.max(...fittedRects.map((rect) => rect.right));
        const fittedBottom = Math.max(...fittedRects.map((rect) => rect.bottom));
        const targetCenterX = wrapperRect.left + leftInset + padX + availableWidth / 2;
        const targetCenterY = wrapperRect.top + topInset + padY + availableHeight / 2;
        const fittedCenterX = (fittedLeft + fittedRight) / 2;
        const fittedCenterY = (fittedTop + fittedBottom) / 2;
        if ([fittedCenterX, fittedCenterY].every(Number.isFinite)) {
          this.#panX += targetCenterX - fittedCenterX;
          this.#panY += targetCenterY - fittedCenterY;
          this.#applyTransform();
        }
      }
      this.#applyGrid();
      this.#updateZoomBadge();
      this.#transform.getBoundingClientRect();
      if (oldTransition) this.#transform.style.setProperty('transition', oldTransition, transitionPriority);
      else this.#transform.style.removeProperty('transition');
      EventBus.emit('canvas:zoom', this.#zoom);
    }, 150);
  }

  /** Enable decorative colors without altering document data or canvas geometry. */
  setEffects(enabled) {
    this.#wrapper?.classList.toggle('canvas-wrapper--fx', enabled === true);
  }

  /** Clean up all event listeners and DOM. */
  destroy() {
    if (this.#wrapper) {
      this.#wrapper.removeEventListener('wheel', this.#bound.wheel);
      this.#wrapper.removeEventListener('pointerdown', this.#bound.pointerdown, true);
      this.#wrapper.removeEventListener('contextmenu', this.#bound.contextmenu);
      this.#wrapper.removeEventListener('auxclick', this.#bound.auxclick);
      this.#wrapper.removeEventListener('dragstart', this.#bound.dragstart, true);
    }
    window.removeEventListener('pointermove', this.#bound.pointermove, true);
    window.removeEventListener('pointerup', this.#bound.pointerup, true);
    window.removeEventListener('pointercancel', this.#bound.pointerup, true);
    window.removeEventListener('click', this.#bound.click, true);
    window.removeEventListener('keydown', this.#bound.keydown);
    window.removeEventListener('keyup', this.#bound.keyup);
    if (this.#suppressClickTimer !== null) window.clearTimeout(this.#suppressClickTimer);
    this.#panCandidate = null;
    this.#suppressClick = false;

    this.#wrapper?.remove();
    this.#wrapper = null;
    this.#transform = null;
    this.#zoomBadge = null;
    this.#bound = {};
  }

  // ─── Rendering helpers ─────────────────────────────────────────────────

  /** Apply CSS transform combining zoom + pan. */
  #applyTransform() {
    if (!this.#transform) return;
    this.#transform.style.transform = `translate(${this.#panX}px, ${this.#panY}px) scale(${this.#zoom})`;
  }

  /** Apply the dot-grid background, scaled by zoom and offset by pan. */
  #applyGrid() {
    if (!this.#wrapper) return;
    const size = GRID_SIZE * this.#zoom;
    this.#wrapper.style.setProperty('--canvas-grid-size', `${size}px ${size}px`);
    this.#wrapper.style.setProperty('--canvas-grid-position', `${this.#panX}px ${this.#panY}px`);
  }

  /** Update the zoom badge label. */
  #updateZoomBadge() {
    if (!this.#zoomBadge) return;
    this.#zoomBadge.textContent = `${Math.round(this.#zoom * 100)}%`;
  }

  // ─── Event handlers ────────────────────────────────────────────────────

  /**
   * Mouse-wheel → zoom toward cursor position.
   * @param {WheelEvent} e
   */
  #onWheel(e) {
    if (e.defaultPrevented) return;
    // Only the area beneath the cursor and its ancestors can own this scroll.
    // Recheck actual overflow on every wheel event: editing, collapsing chapters
    // and changing views can make the same surface scrollable or fitting.
    for (let area = e.target; area && area !== this.#wrapper; area = area.parentElement) {
      const style = window.getComputedStyle(area);
      const vertical = /auto|scroll/.test(style.overflowY || style.overflow);
      const horizontal = /auto|scroll/.test(style.overflowX || style.overflow);
      if (
        (vertical && area.scrollHeight > area.clientHeight + 1) ||
        (horizontal && area.scrollWidth > area.clientWidth + 1)
      ) {
        // Preserve native scrolling even at its ends, without switching to zoom.
        return;
      }
    }
    e.preventDefault();

    const direction = e.deltaY < 0 ? 1 : -1;
    const newZoom = clampZoom(this.#zoom * (direction > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR));
    if (newZoom === this.#zoom) return;

    // Zoom toward cursor: adjust pan so the point under the cursor stays fixed
    const rect = this.#wrapper.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;

    const ratio = newZoom / this.#zoom;
    this.#panX = cursorX - ratio * (cursorX - this.#panX);
    this.#panY = cursorY - ratio * (cursorY - this.#panY);

    this.#zoom = newZoom;
    this.#applyTransform();
    this.#applyGrid();
    this.#updateZoomBadge();
    EventBus.emit('canvas:zoom', this.#zoom);
  }

  /**
   * Pointer-down starts immediately on empty canvas. Every other non-editable
   * surface waits for a short drag, preserving clicks and interactive controls.
   * Space+left-button remains an explicit shortcut for pan mode.
   * @param {PointerEvent} e
   */
  #onPointerDown(e) {
    const isLeft = e.button === 0;
    const target = e.target;
    const isCanvasBackground =
      target === this.#wrapper ||
      target === this.#transform ||
      target?.classList?.contains('editor-layout-wrapper');
    const isSpaceLeft = this.#spaceDown && isLeft;
    const isInteractive = target?.closest?.(
      'button, input, select, textarea, a[href], audio[controls], video[controls], [role="button"], [role="combobox"], [role="menuitem"], [role="option"], [role="checkbox"], [role="radio"], [role="slider"], [role="switch"], [role="tab"], [draggable="true"]',
    );
    // Honour inherited editability and explicit read-only islands inside it.
    const editableHost = target?.closest?.('[contenteditable]');
    const isEditable =
      target?.isContentEditable ||
      (editableHost && editableHost.getAttribute('contenteditable').toLowerCase() !== 'false');

    if (!isLeft || e.defaultPrevented) return;

    if (!isCanvasBackground && !isSpaceLeft) {
      if (isInteractive || isEditable) return;
      this.#panCandidate = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY };
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    this.#panning = true;
    this.#pointerId = e.pointerId;
    this.#lastX = e.clientX;
    this.#lastY = e.clientY;
    this.#wrapper.setPointerCapture?.(e.pointerId);
    this.#wrapper.classList.add('canvas-wrapper--panning');
    this.#wrapper.style.cursor = 'grabbing';
  }

  /**
   * Pointer-move: update pan when panning.
   * @param {PointerEvent} e
   */
  #onPointerMove(e) {
    if (!this.#panning) {
      const candidate = this.#panCandidate;
      if (!candidate || e.pointerId !== candidate.pointerId) return;
      const distanceX = e.clientX - candidate.startX;
      const distanceY = e.clientY - candidate.startY;
      if (Math.hypot(distanceX, distanceY) < 5) return;

      this.#panCandidate = null;
      this.#panning = true;
      this.#pointerId = e.pointerId;
      this.#lastX = candidate.startX;
      this.#lastY = candidate.startY;
      this.#wrapper.setPointerCapture?.(e.pointerId);
      this.#wrapper.classList.add('canvas-wrapper--panning');
      this.#wrapper.style.cursor = 'grabbing';
      // A pending drag may briefly select read-only text before reaching 5 px.
      window.getSelection()?.removeAllRanges();
      this.#suppressClick = true;
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
    }
    if (!this.#panning || e.pointerId !== this.#pointerId) return;

    const dx = e.clientX - this.#lastX;
    const dy = e.clientY - this.#lastY;
    this.#lastX = e.clientX;
    this.#lastY = e.clientY;
    this.#panX += dx;
    this.#panY += dy;
    this.#applyTransform();
    this.#applyGrid();
  }

  /**
   * Pointer-up: stop panning.
   * @param {PointerEvent} e
   */
  #onPointerUp(e) {
    if (this.#panCandidate?.pointerId === e.pointerId) this.#panCandidate = null;
    if (!this.#panning || e.pointerId !== this.#pointerId) return;
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
    this.#panning = false;
    this.#pointerId = null;
    this.#wrapper?.releasePointerCapture?.(e.pointerId);
    this.#wrapper?.classList.remove('canvas-wrapper--panning');
    this.#wrapper.style.cursor = this.#spaceDown ? 'grab' : '';
    if (this.#suppressClick) {
      if (this.#suppressClickTimer !== null) window.clearTimeout(this.#suppressClickTimer);
      this.#suppressClickTimer = window.setTimeout(() => {
        this.#suppressClick = false;
        this.#suppressClickTimer = null;
      }, 0);
    }
  }

  #onClick(e) {
    if (!this.#suppressClick) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this.#suppressClick = false;
    if (this.#suppressClickTimer !== null) window.clearTimeout(this.#suppressClickTimer);
    this.#suppressClickTimer = null;
  }

  /**
   * Key-down: track Space for pan mode.
   * @param {KeyboardEvent} e
   */
  #onKeyDown(e) {
    if (e.code === 'Space' && !this.#spaceDown) {
      // Native buttons and custom controls own Space while focused.
      if (
        document.activeElement?.closest(
          'button, input, textarea, select, a[href], [contenteditable]:not([contenteditable="false"]), [role=button], [role=combobox], [role=menuitem], [role=option], [role=checkbox], [role=radio], [role=slider], [role=switch], [role=tab]',
        )
      )
        return;
      e.preventDefault();
      this.#spaceDown = true;
      if (this.#wrapper) this.#wrapper.style.cursor = 'grab';
    }
  }

  /**
   * Key-up: release Space.
   * @param {KeyboardEvent} e
   */
  #onKeyUp(e) {
    if (e.code === 'Space') {
      this.#spaceDown = false;
      if (!this.#panning && this.#wrapper) {
        this.#wrapper.style.cursor = '';
      }
    }
  }
}
