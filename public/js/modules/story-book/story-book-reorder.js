import { storyBookRow, storyBookBlockFromTarget, storyBookHeading } from './story-book-rows.js';
import { canMoveNarrativeBlock } from '../../contracts/narrative-operations.js';

// The preview lives outside the persisted surface. Only a completed gesture emits a document edit.
export class StoryBookBlockDrag {
  constructor(surface, { enabled, changed, refresh, externalDrop = () => null }) {
    this.surface = surface;
    this.win = surface.ownerDocument.defaultView;
    this.enabled = enabled;
    this.changed = changed;
    this.refresh = refresh;
    this.externalDrop = externalDrop;
    this.animations = new Map();
    this.down = (event) => this.begin(event);
    surface.addEventListener('pointerdown', this.down);
  }
  begin(event) {
    // Template clones are adopted into the live document after editor setup.
    this.win = this.surface.ownerDocument.defaultView;
    if (!this.win) return;
    const handle = event.target.closest?.('.story-book-tree-drag-handle[data-story-drag-kind]');
    if (
      !handle ||
      !this.surface.contains(handle) ||
      event.button !== 0 ||
      event.isPrimary === false ||
      !this.enabled()
    )
      return;
    const kind = handle.dataset.storyDragKind;
    if (!['paragraph', 'theme', 'chapter'].includes(kind)) return;
    const block = storyBookBlockFromTarget(handle),
      row = kind === 'paragraph' ? storyBookRow(block) : handle.closest('.story-book-tree-' + kind);
    if (!block?.dataset.kaiId || !row?.isConnected) return;
    event.preventDefault();
    event.stopPropagation();
    this.cancel();
    this.state = {
      row,
      kind,
      originalHTML: this.surface.innerHTML,
      block,
      handle,
      parent: row.parentNode,
      next: row.nextSibling,
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      pointerId: event.pointerId,
      started: false,
      scrollElement: this.scrollParent(),
    };
    this.move = (e) => {
      if (e.pointerId !== this.state?.pointerId) return;
      e.preventDefault();
      this.state.x = e.clientX;
      this.state.y = e.clientY;
      this.schedule();
    };
    this.up = (e) => {
      if (e.pointerId !== this.state?.pointerId) return;
      e.preventDefault();
      e.stopPropagation();
      if (this.state.started) {
        this.state.x = e.clientX;
        this.state.y = e.clientY;
        this.update();
      }
      const receiver = this.externalDrop();
      if (this.state?.started && receiver?.over(e.clientX, e.clientY)) {
        const id = this.state.block.dataset.kaiId;
        this.finish(false);
        receiver.drop(id, e.clientX, e.clientY);
      } else this.finish(this.validPoint(e.clientX, e.clientY));
    };
    this.abort = () => this.cancel();
    this.key = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.cancel();
      }
    };
    this.win.addEventListener('pointermove', this.move, { passive: false });
    this.win.addEventListener('pointerup', this.up, true);
    this.win.addEventListener('pointercancel', this.abort);
    this.win.addEventListener('blur', this.abort);
    this.win.addEventListener('keydown', this.key, true);
    try {
      handle.setPointerCapture?.(event.pointerId);
    } catch {
      /* A detached control cannot capture. */
    }
  }
  schedule() {
    if (this.frame == null)
      this.frame = this.win.requestAnimationFrame(() => {
        this.frame = null;
        this.update();
      });
  }
  scrollParent() {
    for (let element = this.surface; element; element = element.parentElement) {
      const overflow = this.win.getComputedStyle(element).overflowY;
      if (/(auto|scroll)/.test(overflow) && element.scrollHeight > element.clientHeight) return element;
    }
    return null;
  }
  scrollNearEdge() {
    const state = this.state,
      element = state?.scrollElement;
    if (!element) return false;
    const rect = element.getBoundingClientRect(),
      top = Math.max(0, rect.top),
      bottom = Math.min(this.win.innerHeight, rect.top + rect.height),
      edge = Math.min(48, (bottom - top) / 4);
    if (state.x < rect.left || state.x > rect.left + rect.width || state.y < top || state.y > bottom)
      return false;
    const proximity =
      state.y < top + edge
        ? (state.y - top - edge) / edge
        : state.y > bottom - edge
          ? (state.y - bottom + edge) / edge
          : 0;
    if (!proximity) return false;
    const before = element.scrollTop;
    element.scrollTop = Math.max(
      0,
      Math.min(element.scrollHeight - element.clientHeight, before + (proximity * 10) / state.scale),
    );
    return element.scrollTop !== before;
  }
  preview(row) {
    const clone = row.cloneNode(true);
    const properties = [
      'display',
      'box-sizing',
      'margin',
      'padding',
      'border',
      'border-radius',
      'background',
      'color',
      'font-family',
      'font-size',
      'font-weight',
      'font-style',
      'line-height',
      'letter-spacing',
      'text-align',
      'text-transform',
      'white-space',
      'gap',
      'align-items',
      'justify-content',
      'flex',
      'flex-direction',
      'flex-wrap',
      'grid-template-columns',
      'grid-template-rows',
      'width',
      'min-width',
      'max-width',
      'height',
      'min-height',
      'max-height',
      'overflow',
      'position',
      'top',
      'right',
      'bottom',
      'left',
      'text-shadow',
      'background-clip',
      '-webkit-text-fill-color',
      'mask',
    ];
    const originals = [row, ...row.querySelectorAll('*')],
      copies = [clone, ...clone.querySelectorAll('*')];
    if (row.matches('.story-book-tree-chapter, .story-book-tree-theme')) {
      [...clone.querySelectorAll('.story-book-row')].slice(8).forEach((element) => element.remove());
      clone.querySelectorAll('.story-book-tree-content').forEach((element) => {
        element.style.height = 'auto';
      });
    }
    originals.forEach((element, index) => {
      if (index && !clone.contains(copies[index])) return;
      const target = copies[index],
        style = this.win.getComputedStyle(element);
      for (const property of properties) target.style.setProperty(property, style.getPropertyValue(property));
      // Sticky headings belong to the editor scroll container, never to the floating preview.
      if (style.position === 'sticky')
        Object.assign(target.style, { position: 'relative', top: 'auto', bottom: 'auto' });
      for (const attribute of [...target.attributes])
        if (
          attribute.name === 'id' ||
          attribute.name.startsWith('data-kai') ||
          attribute.name.startsWith('data-story-node')
        )
          target.removeAttribute(attribute.name);
      target.contentEditable = 'false';
      target.draggable = false;
      target.removeAttribute('tabindex');
    });
    clone.querySelectorAll('.story-book-insertion').forEach((element) => element.remove());
    clone.classList.remove('is-dragging', 'is-reordering');
    Object.assign(clone.style, {
      position: 'relative',
      top: 'auto',
      right: 'auto',
      bottom: 'auto',
      left: 'auto',
      margin: '0',
      width: `${row.offsetWidth}px`,
      height: 'auto',
      opacity: '1',
      background: 'var(--bg-elevated)',
    });
    const host = row.ownerDocument.createElement('div');
    host.className = 'story-book-reorder-preview';
    host.setAttribute('aria-hidden', 'true');
    host.inert = true;
    host.style.width = `${row.offsetWidth}px`;
    if (!row.matches('.story-book-row')) {
      host.style.maxHeight = '55vh';
      host.style.overflow = 'hidden';
    }
    host.append(clone);
    row.ownerDocument.body.append(host);
    return host;
  }
  targetAt(x, y) {
    const target = this.surface.ownerDocument.elementFromPoint(x, y);
    if (!target || !this.surface.contains(target)) return null;
    const kind = this.state?.kind || 'paragraph';
    if (kind !== 'paragraph') {
      const group = target.closest('.story-book-tree-' + kind);
      if (group && this.surface.contains(group)) return storyBookHeading(group);
      if (kind === 'theme') {
        const chapter = target.closest('.story-book-tree-chapter');
        const themes =
          chapter &&
          [...chapter.querySelector(':scope > .story-book-tree-content').children].filter((element) =>
            element.matches('.story-book-tree-theme'),
          );
        if (themes?.length) return storyBookHeading(themes.at(-1));
      }
      return null;
    }
    let block = storyBookBlockFromTarget(target);
    if (block && storyBookRow(block).dataset.storyRowKind === 'paragraph') return block;
    // Gaps within a theme are also drop targets; headings and the canvas are not.
    const content = target.matches('.story-book-tree-content') ? target : null;
    if (!content) return null;
    const rows = [...content.children].filter((row) =>
      row.matches('.story-book-row[data-story-row-kind="paragraph"]'),
    );
    let closest = null,
      distance = Infinity;
    for (const row of rows) {
      const rect = row.getBoundingClientRect(),
        d = Math.abs(y - (rect.top + rect.height / 2));
      if (d < distance) {
        distance = d;
        closest = row;
      }
    }
    return closest?.querySelector('.story-book-row__text') || null;
  }
  validPoint(x, y) {
    return !!this.state?.started && !!this.targetAt(x, y);
  }
  update() {
    const state = this.state;
    if (!state) return;
    if (!state.row.isConnected || !this.surface.contains(state.row) || !this.enabled()) {
      this.cancel();
      return;
    }
    if (!state.started) {
      if (Math.hypot(state.x - state.startX, state.y - state.startY) < 5) return;
      const rect = state.row.getBoundingClientRect();
      state.scale = rect.width / state.row.offsetWidth || 1;
      state.offsetX = state.startX - rect.left;
      state.offsetY = state.startY - rect.top;
      state.preview = this.preview(state.row);
      state.started = true;
      state.row.classList.add('is-reordering');
      this.surface.classList.add('is-reordering-paragraph');
      state.handle.setAttribute('aria-pressed', 'true');
      this.win.getSelection()?.removeAllRanges();
    }
    state.preview.style.transform = `translate3d(${state.x - state.offsetX}px,${state.y - state.offsetY}px,0) scale(${state.scale})`;
    if (this.externalDrop()?.over(state.x, state.y)) return;
    if (this.scrollNearEdge()) {
      this.refresh();
      this.schedule();
    }
    const block = this.targetAt(state.x, state.y),
      target =
        state.kind === 'paragraph' ? storyBookRow(block) : block?.closest('.story-book-tree-' + state.kind);
    if (!block || !canMoveNarrativeBlock(state.kind, state.block.dataset.kaiId, block.dataset.kaiId)) return;
    const rect = (state.kind === 'paragraph' ? target : storyBookRow(block)).getBoundingClientRect();
    const next = state.y > rect.top + rect.height / 2 ? target.nextSibling : target;
    if (next === state.row || (state.row.parentNode === target.parentNode && state.row.nextSibling === next))
      return;
    const before = new Map();
    // Bound layout reads even when a theme contains thousands of paragraphs.
    for (const center of [state.row, target]) {
      before.set(center, center.getBoundingClientRect());
      for (const direction of ['previousElementSibling', 'nextElementSibling']) {
        let sibling = center;
        for (let n = 0; n < 16; n++) {
          sibling = sibling[direction];
          if (!sibling) break;
          if (
            sibling.matches(state.kind === 'paragraph' ? '.story-book-row' : '.story-book-tree-' + state.kind)
          )
            before.set(sibling, sibling.getBoundingClientRect());
        }
      }
    }
    this.stopAnimations();
    target.parentNode.insertBefore(state.row, next);
    try {
      state.handle.setPointerCapture?.(state.pointerId);
    } catch {
      /* Global listeners still own the gesture. */
    }
    if (!this.win.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      for (const [row, old] of before) {
        if (row === state.row || !row.animate) continue;
        const now = row.getBoundingClientRect(),
          delta = (old.top - now.top) / state.scale;
        if (Math.abs(delta) < 0.5) continue;
        const animation = row.animate(
          [{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }],
          { duration: 170, easing: 'cubic-bezier(.2,.7,.3,1)' },
        );
        this.animations.set(row, animation);
      }
    }
    this.refresh();
  }
  stopAnimations() {
    for (const animation of this.animations.values()) animation.cancel();
    this.animations.clear();
  }
  finish(commit = false) {
    const state = this.state;
    if (!state) return;
    const moved = state.row.parentNode !== state.parent || state.row.nextSibling !== state.next;
    if (!commit && state.started && this.surface.contains(state.parent))
      state.parent.insertBefore(state.row, state.next?.parentNode === state.parent ? state.next : null);
    this.state = null;
    this.externalDrop()?.leave();
    if (this.frame != null) this.win.cancelAnimationFrame(this.frame);
    this.frame = null;
    this.stopAnimations();
    state.preview?.remove();
    state.row.classList.remove('is-reordering', 'is-dragging');
    state.block.classList.remove('is-dragging');
    state.handle.removeAttribute('aria-pressed');
    this.surface.classList.remove('is-reordering-paragraph');
    this.win.removeEventListener('pointermove', this.move);
    this.win.removeEventListener('pointerup', this.up, true);
    this.win.removeEventListener('pointercancel', this.abort);
    this.win.removeEventListener('blur', this.abort);
    this.win.removeEventListener('keydown', this.key, true);
    try {
      if (state.handle.hasPointerCapture?.(state.pointerId))
        state.handle.releasePointerCapture(state.pointerId);
    } catch {
      /* Already released by the browser. */
    }
    this.refresh();
    if (commit && moved) this.changed();
  }
  cancel() {
    this.finish(false);
  }
  destroy() {
    this.cancel();
    this.surface.removeEventListener('pointerdown', this.down);
  }
}

// Compatibility for existing editor integrations and test harnesses.
export const StoryBookParagraphDrag = StoryBookBlockDrag;
