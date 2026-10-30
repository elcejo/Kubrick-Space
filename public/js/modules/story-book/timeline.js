import { renderIcon } from '../../icons.js';
import { safeHTML } from '../../safe-html.js';
import { emptyTimeline, normalizeTimeline, syncStoryBookTimelineMetadata } from './story-book-document.js';
import { Modal } from '../../ui-components.js';
import { enhanceSelect } from '../../custom-select.js';
import { Mode } from '../../contracts/editor-mode.js';
import { ensureStoryBookRows, storyBookRow, storyBookHeading } from './story-book-rows.js';
import { createTimelineFusion, timelineCableGeometry } from './timeline-fusion.js';
import {
  calendarDate,
  calendarDateToDate,
  calendarDateFromDate,
  compareCalendarDates,
} from './calendar-date.js';

const STORY_BOOK_TIMELINE_NODE_COLORS = Object.freeze({
  chapter: '#f59e0b',
  theme: '#a855f7',
  paragraph: '#ffffff',
});

/** Owns timeline DOM and lifecycle; context is the explicit editor integration contract. */
export class EditorTimeline {
  timelineNode = null;
  timelineTooltip = null;
  timelineLinksSvg = null;
  timelinePopover = null;
  timelineDragPreview = null;
  geometryFrame = null;
  renderKey = null;
  destroyed = false;
  constructor(context) {
    this.context = context;
  }

  mountLinks(container) {
    this.destroyed = false;
    this.timelineLinksSvg = this.createStoryBookTimelineLinksLayer();
    container.appendChild(this.timelineLinksSvg);
    this.onResize = () => this.requestGeometryRefresh();
    this.onScroll = () => {
      this.syncKeyboardAccess();
      this.requestGeometryRefresh();
    };
    container.addEventListener('scroll', this.onScroll, true);
    this.onDragOver = (event) => this.updateStoryBookTimelineDragPreview(event);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('dragover', this.onDragOver, true);
    this.dragContainer = container;
    this.onPointerDown = (event) => this.startPortPointerDrag(event);
    this.onPointerMove = (event) => {
      if (event.pointerId === this.pointerDrag?.pointerId) {
        if (Math.hypot(event.clientX - this.pointerDrag.startX, event.clientY - this.pointerDrag.startY) > 5)
          this.pointerDrag.moved = true;
        this.updateStoryBookTimelineDragPreview(event);
      }
    };
    this.onPointerUp = (event) => this.finishPortPointerDrag(event);
    this.onPointerCancel = (event) => this.finishPortPointerDrag(event, true);
    this.onDragKey = (event) => {
      if (event.key === 'Escape' && this.pointerDrag) this.finishPortPointerDrag(this.pointerDrag, true);
    };
    container.addEventListener('pointerdown', this.onPointerDown, true);
    this.onTimelineKey = (event) => this.handleTimelineKey(event);
    this.onTimelineFocus = (event) => {
      const key = this.timelineFocusKey(event.target);
      if (key?.startsWith('entry:') || key?.startsWith('slot:')) this.railFocusKey = key;
      if (key?.startsWith('connection:')) this.connectionFocusKey = key;
      this.syncKeyboardAccess();
    };
    container.addEventListener('keydown', this.onTimelineKey, true);
    container.addEventListener('focusin', this.onTimelineFocus);
    this.onPortHover = (event) => {
      if (
        event.target.closest?.(
          '.story-book-node-port, .story-book-timeline-port, .story-book-timeline-anchor--virgin',
        )
      )
        this.requestGeometryRefresh();
    };
    container.addEventListener('pointerover', this.onPortHover);
    container.addEventListener('pointerout', this.onPortHover);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerCancel);
    window.addEventListener('keydown', this.onDragKey);
    this.resizeObserver = globalThis.ResizeObserver
      ? new globalThis.ResizeObserver(() => this.requestGeometryRefresh())
      : null;
    this.surfaceObserver = globalThis.MutationObserver
      ? new globalThis.MutationObserver(() => this.requestGeometryRefresh())
      : null;
    this.layoutObserver = globalThis.MutationObserver
      ? new globalThis.MutationObserver(() => this.requestGeometryRefresh())
      : null;
    this.layoutObserver?.observe(container, { attributes: true, attributeFilter: ['style', 'class'] });
    const canvasTransform = container.closest('.canvas-transform');
    if (canvasTransform)
      this.layoutObserver?.observe(canvasTransform, { attributes: true, attributeFilter: ['style'] });
    this.resizeObserver?.observe(container);
    if (this.timelineNode) this.resizeObserver?.observe(this.timelineNode);
    this.observeSurface();
    this.requestGeometryRefresh();
  }

  observeSurface() {
    if (this.observedSurface !== this.context.surface) {
      if (this.observedSurface) this.resizeObserver?.unobserve(this.observedSurface);
      this.surfaceObserver?.disconnect();
      this.observedSurface = this.context.surface;
      if (this.observedSurface) {
        this.resizeObserver?.observe(this.observedSurface);
        this.surfaceObserver?.observe(this.observedSurface, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: ['hidden', 'class', 'style', 'data-story-node-id', 'data-story-node-type'],
        });
      }
    }
    const blocks = new Set(this.observedSurface?.querySelectorAll('[data-story-node-id], h1, h2, h3') || []);
    this.observedBlocks?.forEach((block) => {
      if (!blocks.has(block)) this.resizeObserver?.unobserve(block);
    });
    blocks.forEach((block) => {
      if (!this.observedBlocks?.has(block)) this.resizeObserver?.observe(block);
    });
    this.observedBlocks = blocks;
  }

  requestGeometryRefresh() {
    if (this.destroyed || this.geometryFrame !== null) return;
    const refresh = () => {
      this.geometryFrame = null;
      if (this.destroyed) return;
      this.observeSurface();
      this.renderStoryBookTimeline();
      this.positionStoryBookTimelinePopover();
    };
    this.geometryFrame =
      typeof globalThis.requestAnimationFrame === 'function'
        ? globalThis.requestAnimationFrame(refresh)
        : setTimeout(refresh, 0);
  }

  destroy() {
    this.destroyed = true;
    if (this.geometryFrame !== null) {
      if (typeof globalThis.cancelAnimationFrame === 'function')
        globalThis.cancelAnimationFrame(this.geometryFrame);
      else clearTimeout(this.geometryFrame);
      this.geometryFrame = null;
    }
    this.resizeObserver?.disconnect();
    this.surfaceObserver?.disconnect();
    this.layoutObserver?.disconnect();
    this.observedSurface = null;
    this.observedBlocks = null;
    this.dragContainer?.removeEventListener('scroll', this.onScroll, true);
    if (this.pointerDrag) this.finishPortPointerDrag(this.pointerDrag, true);
    this.dragContainer?.removeEventListener('pointerdown', this.onPointerDown, true);
    this.dragContainer?.removeEventListener('keydown', this.onTimelineKey, true);
    this.dragContainer?.removeEventListener('focusin', this.onTimelineFocus);
    this.dragContainer?.removeEventListener('pointerover', this.onPortHover);
    this.dragContainer?.removeEventListener('pointerout', this.onPortHover);
    this.syncFusedPorts(new Set());
    this.closeKeyboardPicker({ restoreFocus: false });
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerCancel);
    window.removeEventListener('keydown', this.onDragKey);
    this.dragContainer = null;
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('dragover', this.onDragOver, true);
    this.closeStoryBookTimelinePopover({ restoreFocus: false });
    this.timelineLinksSvg?.remove();
    this.timelineNode?.remove();
    this.timelineNode = null;
    this.timelineTooltip = null;
    this.timelineLinksSvg = null;
    this.timelineDragPreview = null;
  }

  isEditorPortVisible(port) {
    const surface = this.context.surface;
    if (!surface?.isConnected || !port?.isConnected || port.closest('[hidden], [inert]')) return false;
    const rect = port.getBoundingClientRect();
    if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top) || rect.width <= 0 || rect.height <= 0)
      return false;
    const viewport = surface.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    if (x < viewport.left || x >= viewport.right || y < viewport.top || y >= viewport.bottom) return false;
    const canvas = surface.closest('.canvas-wrapper')?.getBoundingClientRect();
    if (canvas && (x < canvas.left || x >= canvas.right || y < canvas.top || y >= canvas.bottom))
      return false;
    // Sticky headings can cover a paragraph which is geometrically inside the
    // scroller. Covered paragraph anchors must not keep temporal ports alive.
    return ![...surface.querySelectorAll('h1, h2, h3')].some((text) => {
      const heading = storyBookRow(text);
      if (heading.contains(port) || globalThis.getComputedStyle?.(heading).position !== 'sticky')
        return false;
      const headingRect = heading.getBoundingClientRect();
      return x >= headingRect.left && x < headingRect.right && y >= headingRect.top && y < headingRect.bottom;
    });
  }

  visibleConnections(timeline) {
    if (this.context.mode !== Mode.WYSIWYG) return [];
    return timeline.connections.filter((connection) => {
      const node = this.findStoryNode(connection.nodeId, connection.nodeType);
      return this.isEditorPortVisible(node?.querySelector('.story-book-node-port--in'));
    });
  }

  timelineFocusKey(element) {
    if (element?.matches?.('.story-book-node-port, .story-book-node-port--in')) {
      const node = element.closest('[data-story-node-id]');
      return node ? `node:${node.dataset.storyNodeType}:${node.dataset.storyNodeId}` : null;
    }
    if (element?.matches?.('.story-book-timeline-port'))
      return `entry:${element.closest('[data-timeline-entry-id]').dataset.timelineEntryId}`;
    if (element?.matches?.('.story-book-timeline-anchor--virgin'))
      return `slot:${element.dataset.timelineRangeId || ''}:${element.dataset.timelineRangeSlot ?? element.dataset.timelineSlot}`;
    if (element?.matches?.('.story-book-timeline-connection-remove'))
      return `connection:${element.closest('[data-connection-id]').dataset.connectionId}`;
    return null;
  }

  visibleTimelineControls() {
    if (this.context.mode !== Mode.WYSIWYG || !this.timelineNode?.isConnected) return [];
    const targets = new Set(this.visibleConnections(this.getStoryBookTimeline()).map((c) => c.targetId));
    const track = this.timelineNode.querySelector('.story-book-timeline__track');
    const viewport = track?.getBoundingClientRect();
    const canvas = this.timelineNode.closest('.canvas-wrapper')?.getBoundingClientRect();
    return [
      ...this.timelineNode.querySelectorAll('.story-book-timeline-port, .story-book-timeline-anchor--virgin'),
    ]
      .filter((control) => {
        if (control.closest('[hidden], [inert]')) return false;
        const id = control.closest('[data-timeline-entry-id]')?.dataset.timelineEntryId;
        if (id && !targets.has(id)) return false;
        const rect = control.getBoundingClientRect();
        const x = rect.left + rect.width / 2,
          y = rect.top + rect.height / 2;
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          [viewport, canvas].every(
            (bounds) =>
              !bounds || (x >= bounds.left && x < bounds.right && y >= bounds.top && y < bounds.bottom),
          )
        );
      })
      .sort(
        (a, b) => Number(a.dataset.timelineKeyboardOrder || 0) - Number(b.dataset.timelineKeyboardOrder || 0),
      );
  }

  focusTimelineKey(key) {
    const editorPorts = [
      ...(this.context.surface?.querySelectorAll('.story-book-node-port, .story-book-node-port--in') || []),
    ].filter((port) => this.context.mode === Mode.WYSIWYG && this.isEditorPortVisible(port));
    const controls = this.visibleTimelineControls();
    const removers = [
      ...(this.timelineLinksSvg?.querySelectorAll('.story-book-timeline-connection-remove') || []),
    ].filter((port) => this.context.mode === Mode.WYSIWYG && port.getAttribute('aria-hidden') !== 'true');
    const target =
      [...editorPorts, ...controls, ...removers].find((port) => this.timelineFocusKey(port) === key) ||
      controls[0];
    if (target) target.focus({ preventScroll: true });
    else if (this.context.surface?.isConnected) {
      const surface = this.context.surface;
      const input = surface.matches('textarea, input, [contenteditable="true"]')
        ? surface
        : surface.querySelector('textarea, input, [contenteditable="true"]');
      if (input) input.focus({ preventScroll: true });
      else {
        surface.tabIndex = -1;
        surface.focus({ preventScroll: true });
      }
    }
  }

  syncKeyboardAccess() {
    const editing = this.context.mode === Mode.WYSIWYG;
    const active = document.activeElement;
    for (const port of this.context.surface?.querySelectorAll(
      '.story-book-node-port, .story-book-node-port--in',
    ) || []) {
      const visible = editing && this.isEditorPortVisible(port);
      port.tabIndex = visible ? 0 : -1;
      if (visible) port.removeAttribute('aria-hidden');
      else port.setAttribute('aria-hidden', 'true');
    }
    const controls = this.visibleTimelineControls();
    const selected =
      controls.find((port) => this.timelineFocusKey(port) === this.railFocusKey) || controls[0];
    for (const control of this.timelineNode?.querySelectorAll(
      '.story-book-timeline-port, .story-book-timeline-anchor--virgin',
    ) || []) {
      control.tabIndex = control === selected ? 0 : -1;
      if (controls.includes(control)) control.removeAttribute('aria-hidden');
      else control.setAttribute('aria-hidden', 'true');
    }
    const visibleIds = new Set(
      editing
        ? this.visibleConnections(this.getStoryBookTimeline())
            .filter((connection) =>
              controls.some(
                (port) =>
                  port.closest('[data-timeline-entry-id]')?.dataset.timelineEntryId === connection.targetId,
              ),
            )
            .map((connection) => connection.id)
        : [],
    );
    const removers = [
      ...(this.timelineLinksSvg?.querySelectorAll('.story-book-timeline-connection-remove') || []),
    ];
    const available = removers.filter((port) =>
      visibleIds.has(port.closest('[data-connection-id]').dataset.connectionId),
    );
    const selectedRemove =
      available.find((port) => this.timelineFocusKey(port) === this.connectionFocusKey) || available[0];
    removers.forEach((port) => {
      port.tabIndex = port === selectedRemove ? 0 : -1;
      if (available.includes(port)) port.removeAttribute('aria-hidden');
      else port.setAttribute('aria-hidden', 'true');
    });
    if (
      this.timelineFocusKey(active) &&
      active.getAttribute('aria-hidden') === 'true' &&
      !this.timelinePopover &&
      !this.keyboardPicker
    )
      this.focusTimelineKey(this.railFocusKey);
    this.refreshKeyboardPicker();
  }

  handleTimelineKey(event) {
    // Refresh before native Tab so a just-hidden port never remains a tab stop until the next frame.
    if (event.key === 'Tab') {
      this.renderStoryBookTimeline();
      return;
    }
    const key = this.timelineFocusKey(event.target);
    if (!key || this.context.mode !== Mode.WYSIWYG || event.altKey || event.ctrlKey || event.metaKey) return;
    this.syncKeyboardAccess();
    if (event.target.getAttribute('aria-hidden') === 'true') {
      event.preventDefault();
      event.stopPropagation();
      this.focusTimelineKey(this.railFocusKey);
      return;
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      const controls = key.startsWith('connection:')
        ? [...this.timelineLinksSvg.querySelectorAll('.story-book-timeline-connection-remove')].filter(
            (port) => port.getAttribute('aria-hidden') !== 'true',
          )
        : key.startsWith('node:')
          ? []
          : this.visibleTimelineControls();
      if (!controls.length) return;
      event.preventDefault();
      event.stopPropagation();
      const index = controls.indexOf(event.target);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? controls.length - 1
            : Math.max(
                0,
                Math.min(
                  controls.length - 1,
                  index + (['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1),
                ),
              );
      controls[next].focus({ preventScroll: true });
    } else if ((event.key === 'Enter' || event.key === ' ') && !key.startsWith('connection:')) {
      event.preventDefault();
      event.stopPropagation();
      if (key.startsWith('node:')) {
        if (!this.isEditorPortVisible(event.target)) return;
        const node = event.target.closest('[data-story-node-id]');
        this.openKeyboardPicker(
          { side: 'editor', nodeId: node.dataset.storyNodeId, nodeType: node.dataset.storyNodeType },
          event.target,
        );
      } else if (key.startsWith('slot:')) this.openKeyboardPicker({ side: 'timeline' }, event.target);
      else {
        const entryId = event.target.closest('[data-timeline-entry-id]').dataset.timelineEntryId;
        if (event.shiftKey) this.openKeyboardPicker({ side: 'timeline', entryId }, event.target);
        else this.openStoryBookTimelineDatePopover({ entryId }, event.target);
      }
    }
  }

  storyNodeLabel(node) {
    const text = (node.querySelector(':scope > h2, :scope > h3') || node).cloneNode(true);
    text
      .querySelectorAll('button, .story-book-tree-drag-handle, .kai-remove-btn')
      .forEach((control) => control.remove());
    const kind = { chapter: 'Capítulo', theme: 'Tema', paragraph: 'Párrafo' }[node.dataset.storyNodeType];
    return `${kind}: ${text.textContent.replace(/\s+/g, ' ').trim().slice(0, 90) || 'Sin texto'}`;
  }

  keyboardPickerOptions(source) {
    if (source.side === 'editor')
      return [
        { value: 'new', label: 'Nueva fecha o rango' },
        ...this.visibleTimelineControls()
          .filter((port) => port.matches('.story-book-timeline-port'))
          .map((port) => {
            const entry = port.closest('[data-timeline-entry-id]');
            return { value: entry.dataset.timelineEntryId, label: entry.dataset.timelineDate };
          }),
      ];
    return [
      ...(this.context.surface?.querySelectorAll('.story-book-node-port, .story-book-node-port--in') || []),
    ]
      .filter((port) => this.isEditorPortVisible(port))
      .map((port) => {
        const node = port.closest('[data-story-node-id]');
        return {
          value: JSON.stringify([node.dataset.storyNodeType, node.dataset.storyNodeId]),
          label: this.storyNodeLabel(node),
        };
      });
  }

  openKeyboardPicker(source, origin) {
    this.closeKeyboardPicker({ restoreFocus: false });
    this.closeStoryBookTimelinePopover({ restoreFocus: false });
    if (this.context.mode !== Mode.WYSIWYG) return;
    const content = document.createElement('div');
    const label = document.createElement('label');
    label.className = 'story-book-timeline-picker__field';
    label.textContent = source.side === 'editor' ? 'Fecha o rango' : 'Fragmento visible';
    const select = document.createElement('select');
    label.append(select);
    select.setAttribute('aria-label', label.textContent);
    const selectControl = enhanceSelect(select);
    const actions = document.createElement('div');
    actions.className = 'story-book-timeline-picker__actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-ghost';
    cancel.textContent = 'Cancelar';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'btn btn-primary';
    confirm.textContent = 'Conectar';
    actions.append(cancel, confirm);
    content.append(label, actions);
    const picker = {
      source,
      originKey: this.timelineFocusKey(origin),
      origin,
      content,
      select,
      selectControl,
      confirm,
      optionsKey: null,
    };
    this.keyboardPicker = picker;
    cancel.addEventListener('click', () => this.closeKeyboardPicker());
    select.addEventListener('change', () => {
      confirm.disabled = !select.value;
    });
    select.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        this.commitKeyboardPicker();
      }
    });
    confirm.addEventListener('click', () => this.commitKeyboardPicker());
    picker.dialog = Modal.show({
      title: 'Conectar en la línea de tiempo',
      content,
      initialFocus: selectControl.trigger,
      onDismiss: () => {
        if (this.keyboardPicker === picker) {
          this.keyboardPicker = null;
          picker.selectControl.destroy({ restore: false });
          this.focusTimelineKey(picker.originKey);
        }
      },
    });
    this.refreshKeyboardPicker();
  }

  refreshKeyboardPicker() {
    const picker = this.keyboardPicker;
    if (!picker) return;
    const source = picker.source;
    const validSource =
      this.context.mode === Mode.WYSIWYG &&
      (source.side === 'editor'
        ? this.isEditorPortVisible(
            this.findStoryNode(source.nodeId, source.nodeType)?.querySelector('.story-book-node-port--in'),
          )
        : this.visibleTimelineControls().some((port) =>
            source.entryId
              ? port.closest('[data-timeline-entry-id]')?.dataset.timelineEntryId === source.entryId
              : this.timelineFocusKey(port) === picker.originKey,
          ));
    if (!validSource) {
      this.closeKeyboardPicker();
      return;
    }
    const options = this.keyboardPickerOptions(source);
    const optionsKey = JSON.stringify(options);
    if (picker.optionsKey === optionsKey) return;
    const oldValue = picker.select.value;
    picker.select.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = options.length ? 'Selecciona un destino' : 'No hay destinos visibles';
    picker.select.append(placeholder);
    options.forEach((item) => {
      const option = document.createElement('option');
      option.value = item.value;
      option.textContent = item.label;
      picker.select.append(option);
    });
    picker.select.value = options.some((item) => item.value === oldValue) ? oldValue : '';
    picker.confirm.disabled = !picker.select.value;
    picker.optionsKey = optionsKey;
    picker.selectControl.refresh();
  }

  closeKeyboardPicker({ restoreFocus = true } = {}) {
    const picker = this.keyboardPicker;
    if (!picker) return;
    this.keyboardPicker = null;
    picker.selectControl.destroy({ restore: false });
    Modal.hide();
    if (restoreFocus && !this.destroyed) this.focusTimelineKey(picker.originKey);
  }

  commitKeyboardPicker() {
    this.refreshKeyboardPicker();
    const picker = this.keyboardPicker;
    if (!picker || !picker.select.value) return;
    const { source } = picker;
    const value = picker.select.value;
    if (!this.keyboardPickerOptions(source).some((option) => option.value === value)) return;
    const origin =
      [
        ...(this.timelineNode?.querySelectorAll(
          '.story-book-timeline-port, .story-book-timeline-anchor--virgin',
        ) || []),
        ...(this.context.surface?.querySelectorAll('.story-book-node-port, .story-book-node-port--in') || []),
      ].find((port) => this.timelineFocusKey(port) === picker.originKey) || this.timelineNode;
    this.closeKeyboardPicker({ restoreFocus: false });
    if (source.side === 'editor') {
      if (value === 'new') this.openStoryBookTimelineDatePopover(source, origin);
      else {
        this.connectStoryBookTimeline(source.nodeId, source.nodeType, value);
        this.focusTimelineKey(picker.originKey);
      }
    } else {
      const [nodeType, nodeId] = JSON.parse(value);
      if (source.entryId) {
        this.connectStoryBookTimeline(nodeId, nodeType, source.entryId);
        this.focusTimelineKey(picker.originKey);
      } else this.openStoryBookTimelineDatePopover({ nodeId, nodeType }, origin);
    }
  }

  // Ports use a direct pointer gesture, independent of native HTML drag/drop
  // negotiation inside contenteditable and draggable ancestor elements.
  startPortPointerDrag(event) {
    if (event.button !== 0 || this.context.mode !== Mode.WYSIWYG || this.pointerDrag) return;
    const port = event.target.closest?.(
      '.story-book-node-port, .story-book-timeline-port, .story-book-timeline-anchor--virgin',
    );
    if (!port || !this.dragContainer?.contains(port)) return;
    const node = port.closest('[data-story-node-id]');
    const entry = port.closest('.story-book-timeline-entry');
    const virgin = port.classList.contains('story-book-timeline-anchor--virgin');
    const payload = virgin
      ? { side: 'timeline', anchor: port }
      : node
        ? {
            side: 'editor',
            nodeId: node.dataset.storyNodeId,
            nodeType: node.dataset.storyNodeType,
            port: 'in',
          }
        : entry
          ? { side: 'timeline', entryId: entry.dataset.timelineEntryId }
          : null;
    if (!payload) return;
    event.preventDefault();
    event.stopPropagation();
    this.pointerDrag = {
      pointerId: event.pointerId,
      port,
      payload,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    port.setPointerCapture?.(event.pointerId);
    this.beginStoryBookTimelineDrag(payload);
    this.updateStoryBookTimelineDragPreview(event);
  }

  finishPortPointerDrag(event, cancelled = false) {
    const drag = this.pointerDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.pointerDrag = null;
    if (drag.port.hasPointerCapture?.(drag.pointerId)) drag.port.releasePointerCapture(drag.pointerId);
    this.clearStoryBookTimelineDragPreview();
    if (cancelled || this.context.mode !== Mode.WYSIWYG) return;
    // Capture keeps event.target on the source, so hit-test the actual release.
    const target = document.elementFromPoint(event.clientX, event.clientY);
    if (
      drag.payload.entryId &&
      !drag.moved &&
      (target === drag.port || drag.port.contains(target)) &&
      Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) <= 5
    ) {
      this.openStoryBookTimelineDatePopover({ entryId: drag.payload.entryId }, drag.port);
      return;
    }
    // Pointer capture keeps movement reliable, but its event.target is still
    // the source: hit-test the release position to find the actual destination.
    if (!target || !this.dragContainer?.contains(target)) return;
    const drop = {
      target,
      clientX: event.clientX,
      clientY: event.clientY,
      dataTransfer: { getData: () => JSON.stringify(drag.payload) },
    };
    if (drag.payload.side === 'editor' && this.timelineNode?.contains(target)) {
      this.handleStoryBookTimelineDrop(drop);
    } else if (drag.payload.side === 'timeline' && this.context.surface?.contains(target)) {
      if (drag.payload.anchor) {
        const node = this.storyNodeForDrop(target);
        if (node) {
          this.openStoryBookTimelineDatePopover(
            {
              side: 'editor',
              nodeId: node.dataset.storyNodeId,
              nodeType: node.dataset.storyNodeType,
              port: 'in',
            },
            drag.payload.anchor,
          );
        }
      } else this.handleStoryBookTimelineLinkDrop(drop);
    }
  }

  ensureStoryBookTimelinePorts(container = this.context.surface) {
    if (!container || !this.context.isStoryBook() || this.context.mode !== Mode.WYSIWYG) return;
    this.context.ensureStoryBookElementIds();
    ensureStoryBookRows(container);
    const addPorts = (node, nodeId, nodeType, portHost = node) => {
      if (!node || !nodeId) return;
      node.dataset.storyNodeId = nodeId;
      node.dataset.storyNodeType = nodeType;
      // Keep one consistent temporal port for every story-book node.
      const allowedPorts = ['in'];
      node.querySelectorAll(':scope > .story-book-node-port').forEach((existing) => {
        if (!allowedPorts.includes(existing.dataset.port)) {
          existing.remove();
        } else if (portHost !== node) {
          const hostPort = portHost.querySelector(`:scope > .story-book-node-port--${existing.dataset.port}`);
          if (hostPort) existing.remove();
          else portHost.appendChild(existing);
        }
      });
      if (portHost !== node) {
        portHost.querySelectorAll(':scope > .story-book-node-port').forEach((existing) => {
          if (!allowedPorts.includes(existing.dataset.port)) existing.remove();
        });
      }
      for (const port of allowedPorts) {
        if (portHost.querySelector(`:scope > .story-book-node-port--${port}`)) continue;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `story-book-node-port story-book-node-port--${port}`;
        button.contentEditable = 'false';
        button.draggable = true;
        button.dataset.port = port;
        button.setAttribute('aria-label', `${port === 'in' ? 'Entrada' : 'Salida'} temporal de ${nodeType}`);
        button.setAttribute('aria-keyshortcuts', 'Enter Space');
        button.title = `${port === 'in' ? 'Entrada' : 'Salida'} temporal`;
        button.innerHTML = safeHTML(renderIcon('timeline-port', 16));
        portHost.appendChild(button);
      }
    };

    container.querySelectorAll('.story-book-tree-chapter').forEach((chapter) => {
      const heading = storyBookHeading(chapter);
      const headingId = heading?.dataset.kaiId;
      const id = this.context.storyBookStructuralId(headingId, 'chapter');
      addPorts(
        chapter,
        id,
        'chapter',
        storyBookRow(heading)?.querySelector('.story-book-row__ports') || heading || chapter,
      );
    });
    container.querySelectorAll('.story-book-tree-theme').forEach((theme) => {
      const heading = storyBookHeading(theme);
      const headingId = heading?.dataset.kaiId;
      const id = this.context.storyBookStructuralId(headingId, 'theme');
      addPorts(
        theme,
        id,
        'theme',
        storyBookRow(heading)?.querySelector('.story-book-row__ports') || heading || theme,
      );
    });
    container
      .querySelectorAll('.story-book-row[data-story-row-kind="paragraph"] > .story-book-row__text')
      .forEach((block) => {
        const row = storyBookRow(block);
        addPorts(row, block.dataset.kaiId, 'paragraph', row.querySelector('.story-book-row__ports') || row);
      });
  }

  getStoryBookTimeline() {
    if (!this.context.storyBookDocument) return emptyTimeline();
    const timeline = normalizeTimeline(this.context.storyBookDocument.timeline);
    // Legacy ranges used a rotating palette. Once a range has a narrative
    // connection, derive its color from the first connected node so older
    // documents converge on the same chapter/theme/paragraph visual language
    // as newly created ranges.
    timeline.ranges.forEach((range) => {
      const firstConnection = timeline.connections
        .filter((connection) => connection.targetId === range.id)
        .sort((a, b) => a.order - b.order)[0];
      const nodeColor = STORY_BOOK_TIMELINE_NODE_COLORS[firstConnection?.nodeType];
      if (nodeColor) range.color = nodeColor;
    });
    this.context.storyBookDocument.timeline = timeline;
    return timeline;
  }

  createStoryBookTimeline() {
    const rail = document.createElement('aside');
    rail.className = 'story-book-timeline';
    rail.setAttribute('aria-label', 'Línea de tiempo narrativa');
    rail.setAttribute(
      'aria-description',
      'Usa las flechas para recorrer los puntos visibles y Enter para operar.',
    );

    const track = document.createElement('div');
    track.className = 'story-book-timeline__track';
    track.addEventListener(
      'scroll',
      () => {
        this.hideStoryBookTimelineTooltip();
        this.requestGeometryRefresh();
      },
      { passive: true },
    );
    const spine = document.createElement('div');
    spine.className = 'story-book-timeline__spine';
    track.appendChild(spine);
    rail.appendChild(track);

    // Tooltips live on the rail instead of inside the scrollable track. This
    // lets the track clip horizontal overflow (and avoid accidental scrollbars)
    // while the date label can still float over the editor beside the rail.
    const tooltip = document.createElement('span');
    tooltip.className = 'story-book-timeline-date-tooltip story-book-timeline-date-tooltip--portal';
    tooltip.hidden = true;
    tooltip.setAttribute('role', 'tooltip');
    rail.appendChild(tooltip);
    this.timelineTooltip = tooltip;

    const tooltipEntryForEvent = (event) => {
      const entry = event.target.closest?.('.story-book-timeline-entry');
      if (!entry || !track.contains(entry)) return null;
      const trigger = entry.classList.contains('story-book-timeline-entry--range')
        ? '.story-book-timeline-port--range'
        : '.story-book-timeline-port--in';
      const port = event.target.closest?.(trigger);
      return port && entry.contains(port) ? { entry, port } : null;
    };
    track.addEventListener('pointerover', (event) => {
      const hit = tooltipEntryForEvent(event);
      if (hit) this.showStoryBookTimelineTooltip(hit.entry, hit.port);
      else this.hideStoryBookTimelineTooltip();
    });
    track.addEventListener('pointerout', (event) => {
      if (tooltipEntryForEvent(event)) this.hideStoryBookTimelineTooltip();
    });
    track.addEventListener('focusin', (event) => {
      const hit = tooltipEntryForEvent(event);
      if (hit) this.showStoryBookTimelineTooltip(hit.entry, hit.port);
    });
    track.addEventListener('focusout', (event) => {
      if (tooltipEntryForEvent(event)) this.hideStoryBookTimelineTooltip();
    });

    rail.addEventListener('dragstart', (event) => {
      // Virgin slots have no saved date yet. Pointer dragging owns their
      // calendar flow; never let a native selection drag reach the canvas.
      if (event.target.closest?.('.story-book-timeline-anchor--virgin')) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const port = event.target.closest?.('.story-book-timeline-port');
      if (!port || !rail.contains(port)) return;
      const entry = port.closest('.story-book-timeline-entry');
      if (!entry?.dataset.timelineEntryId) return;
      const payload = JSON.stringify({
        side: 'timeline',
        entryId: entry.dataset.timelineEntryId,
        port: port.dataset.port || 'out',
      });
      event.dataTransfer?.setData('application/x-kubrick-space-timeline-link', payload);
      event.dataTransfer?.setData('text/plain', payload);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'link';
      entry.classList.add('is-link-dragging');
      this.beginStoryBookTimelineDrag({ side: 'timeline', entryId: entry.dataset.timelineEntryId });
    });
    rail.addEventListener('drag', (event) => this.updateStoryBookTimelineDragPreview(event));
    rail.addEventListener('dragend', (event) => {
      event.target.closest?.('.is-link-dragging')?.classList.remove('is-link-dragging');
      this.clearStoryBookTimelineDragPreview();
    });
    rail.addEventListener('dragover', (event) => {
      if (!event.dataTransfer?.types?.includes('application/x-kubrick-space-timeline-link')) return;
      this.updateStoryBookTimelineDragPreview(event);
      event.stopPropagation();
      event.preventDefault();
    });
    rail.addEventListener('drop', (event) => {
      if (!event.dataTransfer?.types?.includes('application/x-kubrick-space-timeline-link')) return;
      event.stopPropagation();
      event.preventDefault();
      this.clearStoryBookTimelineDragPreview();
      this.handleStoryBookTimelineDrop(event);
    });

    return rail;
  }

  showStoryBookTimelineTooltip(entry, port = null) {
    const tooltip = this.timelineTooltip;
    const rail = this.timelineNode;
    if (!tooltip || !rail || !entry) return;
    tooltip.textContent = [entry.dataset.timelineDate, entry.dataset.timelineMembershipLabel]
      .filter(Boolean)
      .join(' · ');
    if (!tooltip.textContent) return;
    const railRect = rail.getBoundingClientRect();
    // Anchor the date label to the actual port. This matters for ranges,
    // whose port lives in the upper-right corner rather than at the card
    // center; using the card rect would make the tooltip appear detached.
    const triggerRect = (port || entry).getBoundingClientRect();
    const layoutWidth = rail.offsetWidth || railRect.width || 1;
    const layoutHeight = rail.offsetHeight || railRect.height || 1;
    const scaleX = railRect.width / layoutWidth || 1;
    const scaleY = railRect.height / layoutHeight || 1;
    tooltip.style.left = `${(triggerRect.right - railRect.left) / scaleX + 8}px`;
    tooltip.style.top = `${(triggerRect.top + triggerRect.height / 2 - railRect.top) / scaleY}px`;
    tooltip.hidden = false;
    tooltip.classList.add('is-visible');
  }

  hideStoryBookTimelineTooltip() {
    const tooltip = this.timelineTooltip;
    if (!tooltip) return;
    tooltip.hidden = true;
    tooltip.classList.remove('is-visible');
  }

  beginStoryBookTimelineDrag(preview) {
    this.timelineDragPreview = preview;
    this.drawStoryBookTimelineConnections();
  }

  updateStoryBookTimelineDragPreview(event) {
    if (!this.timelineDragPreview || !this.timelineLinksSvg) return;
    const clientX = Number(event?.clientX);
    const clientY = Number(event?.clientY);
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY) || (clientX === 0 && clientY === 0)) return;
    this.dragCursor = { clientX, clientY };
    this.drawStoryBookTimelineConnections({ clientX, clientY });
  }

  clearStoryBookTimelineDragPreview() {
    if (!this.timelineDragPreview) return;
    this.timelineDragPreview = null;
    this.dragCursor = null;
    this.drawStoryBookTimelineConnections();
  }

  createStoryBookTimelineLinksLayer() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('story-book-timeline-links');
    svg.setAttribute('role', 'group');
    svg.setAttribute('aria-label', 'Conexiones de la línea de tiempo');
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.setAttribute('aria-hidden', 'true');
    const gradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
    gradient.id = 'story-book-timeline-gradient';
    gradient.setAttribute('x1', '0%');
    gradient.setAttribute('y1', '0%');
    gradient.setAttribute('x2', '100%');
    gradient.setAttribute('y2', '0%');
    [
      ['0%', '#22d3ee'],
      ['50%', '#60a5fa'],
      ['100%', '#a855f7'],
    ].forEach(([offset, color]) => {
      const stop = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
      stop.setAttribute('offset', offset);
      stop.setAttribute('stop-color', color);
      gradient.appendChild(stop);
    });
    defs.appendChild(gradient);
    svg.appendChild(defs);
    return svg;
  }

  clearStoryBookTimelineLinks({ hide = false } = {}) {
    const svg = this.timelineLinksSvg;
    if (!svg) return;
    const focused = svg.contains(document.activeElement)
      ? this.timelineFocusKey(document.activeElement)
      : null;
    const defs = svg.querySelector('defs');
    defs?.querySelectorAll('[id^="timeline-fusion-gradient-"]').forEach((gradient) => gradient.remove());
    svg.replaceChildren();
    if (defs) svg.appendChild(defs);
    svg.classList.toggle('is-hidden', hide);
    this.syncFusedPorts(new Set());
    if (focused) this.pendingKeyboardFocus = focused;
  }

  syncFusedPorts(ports) {
    for (const port of this.fusedPorts || [])
      if (!ports.has(port)) port.removeAttribute('data-timeline-fused');
    for (const port of ports)
      if (!port.hasAttribute('data-timeline-fused')) port.setAttribute('data-timeline-fused', '');
    this.fusedPorts = ports;
  }

  drawStoryBookTimelineConnections(previewCursor = this.dragCursor || null) {
    const svg = this.timelineLinksSvg;
    const wrapper = this.context.layoutWrapper;
    if (!svg || !wrapper || !this.context.isStoryBook()) return;

    // Preview and JSON surfaces deliberately have no editor ports. The SVG
    // layer is outside those surfaces, so explicitly clear and hide it rather
    // than retaining paths from the previous WYSIWYG DOM. During a mode
    // switch the new surface is prepared before it is attached; defer drawing
    // until it is connected to avoid zero-sized rects at (0, 0).
    const surfaceDetached = this.context.surface?.isConnected === false;
    if (this.context.mode !== Mode.WYSIWYG || !this.context.surface || surfaceDetached) {
      this.clearStoryBookTimelineLinks({ hide: this.context.mode !== Mode.WYSIWYG });
      return;
    }
    svg.classList.remove('is-hidden');

    const focused = svg.contains(document.activeElement)
      ? this.timelineFocusKey(document.activeElement)
      : null;
    const defs = svg.querySelector('defs');
    defs?.querySelectorAll('[id^="timeline-fusion-gradient-"]').forEach((gradient) => gradient.remove());
    svg.replaceChildren();
    if (defs) svg.appendChild(defs);

    const wrapperRect = wrapper.getBoundingClientRect();
    // The canvas is zoomed with a CSS transform. Use layout dimensions for
    // the SVG viewBox and convert screen-space rectangles back into that
    // coordinate system so cables remain aligned at every zoom level.
    const width = Math.max(1, wrapper.offsetWidth || Math.ceil(wrapperRect.width));
    const height = Math.max(1, wrapper.offsetHeight || Math.ceil(wrapperRect.height));
    const scaleX = wrapperRect.width / width || 1;
    const scaleY = wrapperRect.height / height || 1;
    const toWrapperPoint = (rect) => ({
      x: (rect.left + rect.width / 2 - wrapperRect.left) / scaleX,
      y: (rect.top + rect.height / 2 - wrapperRect.top) / scaleY,
    });
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));

    const timeline = this.getStoryBookTimeline();
    const trackViewport = this.timelineNode
      ?.querySelector('.story-book-timeline__track')
      ?.getBoundingClientRect();
    const fusion = createTimelineFusion({
      svg,
      defs,
      toPoint: toWrapperPoint,
      scaleX,
      scaleY,
      spine: this.timelineNode?.querySelector('.story-book-timeline__spine'),
      viewport: trackViewport,
    });
    for (const control of this.visibleTimelineControls())
      fusion.rail(control.querySelector('.story-book-timeline-virgin-point') || control);
    // Compare screen coordinates so clipping works at every canvas zoom.
    // A cable needs a visible anchor, even when part of its paragraph remains
    // in view. Scrolling redraws these links without changing stored bindings.
    const visibleAnchor = (rect, viewport) => {
      if (!viewport) return true;
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      return x >= viewport.left && x < viewport.right && y >= viewport.top && y < viewport.bottom;
    };
    this.visibleConnections(timeline).forEach((connection) => {
      const sourceNode = this.findStoryNode(connection.nodeId, connection.nodeType);
      const targetEntry = [...(this.timelineNode?.querySelectorAll('.story-book-timeline-entry') || [])].find(
        (entry) => entry.dataset.timelineEntryId === connection.targetId,
      );
      if (!sourceNode || !targetEntry) return;

      const sourcePort = sourceNode.querySelector('.story-book-node-port--in');
      // Fixed dates expose the centered `--in` port, while range cards expose
      // their dedicated `--range` port on the right edge. Resolve the direct
      // port generically so a connection always terminates at the selected
      // temporal resource rather than at a fixed point inside a range.
      const targetPort = targetEntry.querySelector(':scope > .story-book-timeline-port');
      if (!sourcePort || !targetPort) return;

      const sourceRect = sourcePort.getBoundingClientRect();
      const targetRect = targetPort.getBoundingClientRect();
      // A detached or hidden source can report an all-zero rectangle while a
      // mode switch or tree rebuild is in progress. Skipping that connection
      // for this frame prevents a misleading cable from the canvas origin;
      // the post-render refresh resolves it once layout is stable.
      if (
        ![sourceRect, targetRect].every(
          (rect) =>
            Number.isFinite(rect.left) && Number.isFinite(rect.top) && (rect.width > 0 || rect.height > 0),
        )
      )
        return;
      if (!visibleAnchor(targetRect, trackViewport)) return;
      const sourceCenter = toWrapperPoint(sourceRect);
      const targetCenter = toWrapperPoint(targetRect);
      const geometry = timelineCableGeometry(
        sourceCenter,
        targetCenter,
        Math.min(sourceRect.width / scaleX, sourceRect.height / scaleY) / 2,
        Math.min(targetRect.width / scaleX, targetRect.height / scaleY) / 2,
      );
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.classList.add('story-book-timeline-connection');
      group.dataset.connectionId = connection.id;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.classList.add('story-book-timeline-link');
      path.setAttribute('d', geometry.pathData);
      path.style.stroke = fusion.cable(sourcePort, targetPort, geometry);
      path.setAttribute('pointer-events', 'none');
      path.setAttribute('aria-hidden', 'true');
      group.appendChild(path);

      const removePoint = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      removePoint.classList.add('story-book-timeline-connection-remove');
      removePoint.setAttribute('cx', geometry.midpoint.x.toFixed(2));
      removePoint.setAttribute('cy', geometry.midpoint.y.toFixed(2));
      removePoint.setAttribute('r', '4.5');
      removePoint.setAttribute('tabindex', '0');
      removePoint.setAttribute('role', 'button');
      removePoint.setAttribute(
        'aria-label',
        `Eliminar conexión temporal de ${this.storyNodeLabel(sourceNode)} con ${targetEntry.dataset.timelineDate}`,
      );
      const removeMark = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      removeMark.classList.add('story-book-timeline-connection-remove-mark');
      removeMark.setAttribute(
        'transform',
        `translate(${(geometry.midpoint.x - 6).toFixed(2)} ${(geometry.midpoint.y - 6).toFixed(2)})`,
      );
      removeMark.innerHTML = safeHTML(renderIcon('close', 12));
      removeMark.setAttribute('aria-hidden', 'true');
      const removeConnection = async () => {
        if (
          this.context.mode !== Mode.WYSIWYG ||
          !this.visibleConnections(this.getStoryBookTimeline()).some((item) => item.id === connection.id)
        )
          return;
        const confirmed = await Modal.confirm({
          title: 'Eliminar conexión temporal',
          message: '¿Quieres eliminar esta conexión de la línea de tiempo?',
          confirmLabel: 'Eliminar conexión',
          type: 'danger',
        });
        if (this.destroyed) return;
        if (confirmed) this.removeStoryBookTimelineConnection(connection.id);
        this.focusTimelineKey(`connection:${connection.id}`);
      };
      removePoint.addEventListener('click', removeConnection);
      removePoint.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          removeConnection();
        }
      });
      group.append(removePoint, removeMark);
      svg.appendChild(group);
    });

    if (previewCursor && this.timelineDragPreview) {
      const preview = this.timelineDragPreview;
      const cursor = toWrapperPoint({
        left: previewCursor.clientX,
        top: previewCursor.clientY,
        width: 0,
        height: 0,
      });
      let sourceCenter = null;
      let targetCenter = null;
      let sourceAnchor = null;
      let targetAnchor = null;
      if (preview.side === 'editor') {
        const sourceNode = this.findStoryNode(preview.nodeId, preview.nodeType);
        const sourcePort = sourceNode?.querySelector('.story-book-node-port--in');
        if (this.isEditorPortVisible(sourcePort)) {
          sourceCenter = toWrapperPoint(sourcePort.getBoundingClientRect());
          sourceAnchor = sourcePort;
          targetCenter = cursor;
        }
      } else if (preview.side === 'timeline') {
        const targetEntry = [
          ...(this.timelineNode?.querySelectorAll('.story-book-timeline-entry') || []),
        ].find((entry) => entry.dataset.timelineEntryId === preview.entryId);
        const targetPort =
          preview.anchor?.querySelector('.story-book-timeline-virgin-point') ||
          preview.anchor ||
          targetEntry?.querySelector(':scope > .story-book-timeline-port');
        if (targetPort) {
          sourceCenter = cursor;
          targetCenter = toWrapperPoint(targetPort.getBoundingClientRect());
          targetAnchor = targetPort;
        }
      }
      if (sourceCenter && targetCenter) {
        const previewGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        previewGroup.classList.add(
          'story-book-timeline-connection',
          'story-book-timeline-connection--preview',
        );
        const previewPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        previewPath.classList.add('story-book-timeline-link', 'story-book-timeline-link--preview');
        const radius = (anchor) => (anchor ? fusion.port(anchor)?.radius || 0 : 0);
        const geometry = timelineCableGeometry(
          sourceCenter,
          targetCenter,
          radius(sourceAnchor),
          radius(targetAnchor),
        );
        previewPath.setAttribute('d', geometry.pathData);
        previewPath.style.stroke = fusion.cable(sourceAnchor, targetAnchor, geometry);
        previewPath.setAttribute('pointer-events', 'none');
        previewGroup.appendChild(previewPath);
        svg.appendChild(previewGroup);
      }
    }
    this.syncFusedPorts(fusion.flush());
    this.syncKeyboardAccess();
    if (focused) this.focusTimelineKey(focused);
  }

  storyBookTimelinePayload(event) {
    const raw =
      event.dataTransfer?.getData('application/x-kubrick-space-timeline-link') ||
      event.dataTransfer?.getData('text/plain') ||
      '';
    try {
      const data = JSON.parse(raw);
      if (
        data?.side === 'editor' &&
        ['chapter', 'theme', 'paragraph'].includes(data.nodeType) &&
        typeof data.nodeId === 'string'
      )
        return data;
      if (data?.side === 'timeline' && typeof data.entryId === 'string') return data;
    } catch (_) {
      /* Invalid drag payloads are ignored. */
    }
    return null;
  }

  handleStoryBookTimelineLinkDrop(event) {
    const payload = this.storyBookTimelinePayload(event);
    const node = this.storyNodeForDrop(event.target);
    if (this.context.mode !== Mode.WYSIWYG || payload?.side !== 'timeline' || !node) return;
    this.clearStoryBookTimelineDragPreview();
    this.connectStoryBookTimeline(node.dataset.storyNodeId, node.dataset.storyNodeType, payload.entryId);
  }

  storyNodeForDrop(target) {
    const node = target.closest?.('[data-story-node-id]');
    return node &&
      this.context.surface?.contains(node) &&
      !node.closest('[hidden]') &&
      ['chapter', 'theme', 'paragraph'].includes(node.dataset.storyNodeType)
      ? node
      : null;
  }

  handleStoryBookTimelineDrop(event) {
    const payload = this.storyBookTimelinePayload(event);
    if (
      this.context.mode !== Mode.WYSIWYG ||
      payload?.side !== 'editor' ||
      payload.port !== 'in' ||
      !this.timelineNode?.contains(event.target) ||
      event.target.closest?.('.story-book-timeline-date-popover')
    )
      return;
    this.clearStoryBookTimelineDragPreview();
    // Anywhere on the rail opens the picker, even over an existing date.
    // Existing dates are reused only after the user confirms their selection.
    const anchor = Number.isFinite(event.clientY)
      ? {
          getBoundingClientRect: () => ({
            left: event.clientX,
            right: event.clientX,
            top: event.clientY,
            bottom: event.clientY,
            width: 0,
            height: 0,
          }),
        }
      : event.target;
    this.openStoryBookTimelineDatePopover(payload, anchor);
  }

  findStoryNode(nodeId, nodeType) {
    if (!this.context.surface || !nodeId) return null;
    return (
      [...this.context.surface.querySelectorAll('[data-story-node-id]')].find(
        (node) => node.dataset.storyNodeId === nodeId && node.dataset.storyNodeType === nodeType,
      ) || null
    );
  }

  connectStoryBookTimeline(nodeId, nodeType, timelineEntryId) {
    if (!nodeId || !timelineEntryId || !['chapter', 'theme', 'paragraph'].includes(nodeType)) return;
    const timeline = this.getStoryBookTimeline();
    const entry = [...timeline.points, ...timeline.ranges].find((item) => item.id === timelineEntryId);
    if (!entry) return;
    if (
      !timeline.connections.some(
        (connection) =>
          connection.nodeId === nodeId &&
          connection.nodeType === nodeType &&
          connection.targetId === timelineEntryId,
      )
    ) {
      let id = `timeline-connection-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
      while (timeline.connections.some((connection) => connection.id === id)) id += '-1';
      timeline.connections.push({
        id,
        nodeId,
        nodeType,
        targetType: timeline.ranges.some((item) => item.id === timelineEntryId) ? 'range' : 'point',
        targetId: timelineEntryId,
        order: timeline.connections.length,
      });
    }
    syncStoryBookTimelineMetadata(this.context.storyBookDocument);
    this.renderStoryBookTimeline();
    this.context.emitChange();
  }

  removeStoryBookTimelineConnection(connectionId) {
    const timeline = this.getStoryBookTimeline();
    const connection = timeline.connections.find((item) => item.id === connectionId);
    if (!connection) return;
    timeline.connections = timeline.connections.filter((item) => item.id !== connectionId);
    const stillConnected = timeline.connections.some((item) => item.targetId === connection.targetId);
    if (!stillConnected) {
      timeline.points = timeline.points.filter((item) => item.id !== connection.targetId);
      timeline.ranges = timeline.ranges.filter((item) => item.id !== connection.targetId);
    }
    syncStoryBookTimelineMetadata(this.context.storyBookDocument);
    this.renderStoryBookTimeline();
    this.context.emitChange();
  }

  renderStoryBookTimeline() {
    if (!this.timelineNode) return;
    const track = this.timelineNode.querySelector('.story-book-timeline__track');
    if (!track) return;
    this.hideStoryBookTimelineTooltip();
    const timeline = this.getStoryBookTimeline();
    this.renderInvalidTimelineDates(timeline);
    const activeTargets = new Set(this.visibleConnections(timeline).map((connection) => connection.targetId));
    const editing = this.context.mode === Mode.WYSIWYG;
    this.timelineNode.classList.toggle('is-hidden', !editing);
    const entries = [
      ...timeline.points
        .filter((item) => activeTargets.has(item.id))
        .map((item) => ({ ...item, type: 'moment', start: item.date, end: null })),
      ...timeline.ranges
        .filter((item) => activeTargets.has(item.id))
        .map((item) => ({ ...item, type: 'range' })),
    ].sort(
      (a, b) =>
        compareCalendarDates(a.start, b.start) ||
        compareCalendarDates(a.end || a.start, b.end || b.start) ||
        a.order - b.order,
    );
    const renderKey = JSON.stringify([
      editing,
      entries,
      this.timelineNode.offsetHeight,
      this.timelineNode.clientHeight,
      this.timelineNode.style.height,
      globalThis.getComputedStyle?.(track)?.paddingTop,
      globalThis.getComputedStyle?.(track)?.paddingBottom,
    ]);
    if (this.renderKey === renderKey && track.querySelector('.story-book-timeline__content')) {
      this.drawStoryBookTimelineConnections();
      this.syncKeyboardAccess();
      return;
    }
    this.renderKey = renderKey;
    if (this.pointerDrag?.payload.side === 'timeline') this.finishPortPointerDrag(this.pointerDrag, true);
    const scrollTop = track.scrollTop;
    const focusedPort = track.contains(document.activeElement) ? document.activeElement : null;
    const focusedKey = this.timelineFocusKey(focusedPort);
    const content = document.createElement('div');
    content.className = 'story-book-timeline__content';
    const spine = document.createElement('div');
    spine.className = 'story-book-timeline__spine';
    content.appendChild(spine);
    track.replaceChildren(content);
    const trackStyle = globalThis.getComputedStyle?.(track);
    const verticalPadding =
      (Number.parseFloat(trackStyle?.paddingTop || '0') || 0) +
      (Number.parseFloat(trackStyle?.paddingBottom || '0') || 0);
    // Layout dimensions exclude canvas zoom; screen rectangles are only a fallback.
    const railHeight =
      this.timelineNode.offsetHeight ||
      this.timelineNode.clientHeight ||
      Number.parseFloat(globalThis.getComputedStyle?.(this.timelineNode)?.height || '0') ||
      this.timelineNode.getBoundingClientRect?.().height ||
      1170;
    const contentHeight = Math.max(440, railHeight - verticalPadding);
    content.style.height = contentHeight + 'px';
    // Match the spine's 8px inset. Dates determine order, never spacing or height.
    const spineInset = 8;
    const spineHeight = contentHeight - spineInset * 2;
    const rangeEntries = entries.filter((entry) => entry.type === 'range');
    const parentRangeByEntry = new Map();
    const childrenByParent = new Map(rangeEntries.map((range) => [range.id, []]));
    const containsEntry = (range, candidate) => {
      if (
        !range ||
        !candidate ||
        range.id === candidate.id ||
        compareCalendarDates(candidate.start, range.start) < 0 ||
        compareCalendarDates(candidate.start, range.end) > 0
      )
        return false;
      if (candidate.type === 'moment') return true;
      return (
        compareCalendarDates(candidate.end, range.end) <= 0 &&
        (compareCalendarDates(candidate.start, range.start) > 0 ||
          compareCalendarDates(candidate.end, range.end) < 0)
      );
    };
    entries.forEach((entry) => {
      const parents = rangeEntries.filter((range) => containsEntry(range, entry));
      parents.sort(
        (a, b) =>
          this.parseStoryBookDate(a.end) -
            this.parseStoryBookDate(a.start) -
            (this.parseStoryBookDate(b.end) - this.parseStoryBookDate(b.start)) ||
          compareCalendarDates(a.start, b.start) ||
          compareCalendarDates(a.end, b.end),
      );
      if (parents.length) {
        parentRangeByEntry.set(entry.id, parents[0].id);
        childrenByParent.get(parents[0].id).push(entry);
      }
    });
    // Keep dedicated range ports separated even when a single nested range
    // shares its parent's vertical center. Every inner lane retains its width.
    const rangeDepth = (entry) => {
      let depth = 0;
      for (let id = parentRangeByEntry.get(entry.id); id; id = parentRangeByEntry.get(id)) depth++;
      return depth;
    };
    this.timelineNode.style.setProperty(
      '--timeline-range-depth',
      String(Math.max(0, ...rangeEntries.map(rangeDepth))),
    );
    // Each lane counts only its direct visible children. A range occupies one
    // slot in its parent, regardless of how many entries it contains.
    const keyboardControls = [];
    const renderLane = (parent, children, inset, height, globalTop) => {
      const units = this.groupStoryBookTimelineLane(children, childrenByParent, containsEntry);
      const step = height / (units.length * 2 + 2);
      const anchorHeight = Math.min(42, step);
      parent.style.setProperty('--timeline-anchor-height', anchorHeight + 'px');
      const position = (ordinal) => inset + step * ordinal;
      if (editing && parent === content) {
        for (let index = 0; index <= units.length; index++) {
          const center = position(index * 2 + 1);
          const anchor = this.createStoryBookTimelineAnchor(parent, index, center - anchorHeight / 2);
          keyboardControls.push({ control: anchor, center: globalTop + center });
        }
      }
      units.forEach((entry, index) => {
        const center = position(index * 2 + 2);
        // Leave a gap before the adjacent virgin markers in the parent lane.
        const entryHeight = entry.type === 'moment' ? Math.min(24, step) : step * 1.5;
        if (entry.type === 'group') {
          keyboardControls.push(
            ...this.renderOverlappingTimelineGroup(
              entry,
              parent,
              center,
              entryHeight,
              globalTop,
              containsEntry,
              editing,
            ),
          );
          return;
        }
        const top = center - entryHeight / 2;
        const innerHeight = Math.max(0, entryHeight - 2); // range border
        const directChildren = childrenByParent.get(entry.id) || [];
        const childCount = this.groupStoryBookTimelineLane(
          directChildren,
          childrenByParent,
          containsEntry,
        ).length;
        const innerStep = innerHeight / (childCount * 2 + 2);
        const card = this.createStoryBookTimelineEntry(
          entry,
          {
            height: innerHeight,
            slotCenters: Array.from({ length: childCount + 1 }, (_, i) => innerStep * (i * 2 + 1)),
          },
          { virginSlots: editing },
        );
        card.classList.add('story-book-timeline-entry--distributed');
        card.style.top = top + 'px';
        card.style.height = entryHeight + 'px';
        card.dataset.timelineLane = parent === content ? 'main' : parent.dataset.timelineEntryId;
        parent.appendChild(card);
        keyboardControls.push({
          control: card.querySelector(':scope > .story-book-timeline-port'),
          center: globalTop + center,
        });
        if (entry.type === 'range') {
          card.style.setProperty('--timeline-range-height', entryHeight + 'px');
          card.style.setProperty('--timeline-range-port-position', entryHeight / 2 + 'px');
          renderLane(card, directChildren, 0, innerHeight, globalTop + top + 1);
          for (const anchor of card.querySelectorAll(':scope > .story-book-timeline-anchor--virgin')) {
            const slot = Number(anchor.dataset.timelineRangeSlot);
            keyboardControls.push({
              control: anchor,
              center: globalTop + top + 1 + innerStep * (slot * 2 + 1),
            });
          }
        }
      });
    };
    renderLane(
      content,
      entries.filter((entry) => !parentRangeByEntry.has(entry.id)),
      spineInset,
      spineHeight,
      0,
    );
    keyboardControls
      .sort((a, b) => a.center - b.center)
      .forEach(({ control }, index) => {
        control.dataset.timelineKeyboardOrder = String(index);
      });
    track.scrollTop = Math.min(scrollTop, Math.max(0, track.scrollHeight - track.clientHeight));
    this.syncStoryBookTimelineVisualState({ schedule: false });
    this.drawStoryBookTimelineConnections();
    this.syncKeyboardAccess();
    if (focusedKey) this.focusTimelineKey(focusedKey);
    if (this.pendingKeyboardFocus) {
      const pending = this.pendingKeyboardFocus;
      this.pendingKeyboardFocus = null;
      if (document.activeElement === document.body) this.focusTimelineKey(pending);
    }
  }

  groupStoryBookTimelineLane(children, childrenByParent, contains) {
    const remaining = new Set(children.filter((entry) => entry.type === 'range'));
    const units = [];
    const groupedIds = new Set();
    while (remaining.size) {
      const roots = [remaining.values().next().value];
      remaining.delete(roots[0]);
      for (const range of roots) {
        for (const candidate of remaining) {
          if (
            compareCalendarDates(range.start, candidate.end) <= 0 &&
            compareCalendarDates(candidate.start, range.end) <= 0 &&
            !contains(range, candidate) &&
            !contains(candidate, range)
          ) {
            roots.push(candidate);
            remaining.delete(candidate);
          }
        }
      }
      if (roots.length < 2) continue;
      roots.forEach((range) => groupedIds.add(range.id));
      const members = [...roots];
      for (const entry of members) members.push(...(childrenByParent.get(entry.id) || []));
      units.push({
        type: 'group',
        id: roots
          .map((range) => range.id)
          .sort()
          .join('|'),
        start: roots.map((range) => range.start).sort(compareCalendarDates)[0],
        end: roots
          .map((range) => range.end)
          .sort(compareCalendarDates)
          .at(-1),
        order: Math.min(...roots.map((range) => range.order)),
        roots,
        members,
      });
    }
    // Overlap is one unit in its parent's formula. Pure containment still
    // uses a separate inner lane and never contributes extra main-lane slots.
    return [...children.filter((entry) => !groupedIds.has(entry.id)), ...units].sort(
      (a, b) =>
        compareCalendarDates(a.start, b.start) ||
        compareCalendarDates(a.end || a.start, b.end || b.start) ||
        a.order - b.order,
    );
  }

  renderOverlappingTimelineGroup(unit, parent, center, height, globalTop, contains, editing) {
    const group = document.createElement('div');
    group.className = 'story-book-timeline-group';
    group.dataset.timelineGroupId = unit.id;
    group.dataset.timelineGroupRanges = JSON.stringify(unit.roots.map((range) => range.id));
    group.style.top = center - height / 2 + 'px';
    group.style.height = height + 'px';
    parent.appendChild(group);
    const groupTop = globalTop + center - height / 2;
    const ranges = unit.members.filter((entry) => entry.type === 'range');
    const ancestors = [];
    for (
      let range = parent.closest('.story-book-timeline-entry--range');
      range;
      range = range.parentElement.closest('.story-book-timeline-entry--range')
    )
      ancestors.push(range);
    const dates = [
      ...new Set(unit.members.flatMap((entry) => [entry.start, ...(entry.end ? [entry.end] : [])])),
    ].sort(compareCalendarDates);
    // Start/end boundaries and visible dates occupy equally spaced stations.
    // One virgin station goes in each intervening gap, shared by every range
    // covering that gap. No independent root anchors distort this local axis.
    const gap = height / (dates.length - 1);
    const stations = new Map(dates.map((date, index) => [date, gap * index]));
    const anchorHeight = Math.min(42, gap / 2);
    group.style.setProperty('--timeline-anchor-height', anchorHeight + 'px');
    const controls = [];
    const depth =
      ancestors.length +
      Math.max(...ranges.map((entry) => ranges.filter((range) => contains(range, entry)).length));
    this.timelineNode.style.setProperty(
      '--timeline-range-depth',
      String(
        Math.max(Number(this.timelineNode.style.getPropertyValue('--timeline-range-depth')) || 0, depth),
      ),
    );
    const labels = new Map(
      ancestors.map((card) => [card.dataset.timelineEntryId, card.dataset.timelineDate]),
    );
    for (const entry of unit.members) {
      const localMemberships = ranges.filter((range) => contains(range, entry)).map((range) => range.id);
      const memberships = [...localMemberships, ...ancestors.map((card) => card.dataset.timelineEntryId)];
      const card = this.createStoryBookTimelineEntry(entry, null, { virginSlots: false });
      card.classList.add('story-book-timeline-entry--distributed', 'story-book-timeline-entry--shared');
      card.dataset.timelineRangeIds = JSON.stringify(memberships);
      const y = stations.get(entry.start);
      const entryHeight = entry.type === 'moment' ? Math.min(24, gap / 2) : stations.get(entry.end) - y;
      // Zero-duration ranges retain an editable box around their single station.
      const cardHeight = entryHeight || Math.min(24, gap / 2);
      const top = entry.type === 'moment' || entryHeight === 0 ? y - cardHeight / 2 : y;
      card.style.top = top + 'px';
      card.style.height = cardHeight + 'px';
      const port = card.querySelector(':scope > .story-book-timeline-port');
      if (entry.type === 'range') {
        card.style.setProperty('--timeline-range-height', cardHeight + 'px');
        card.style.setProperty('--timeline-range-port-position', y - top + 'px');
        card.style.setProperty('--timeline-shared-inset', localMemberships.length * 18 + 'px');
        labels.set(entry.id, card.dataset.timelineDate);
      }
      group.appendChild(card);
      controls.push({ control: port, center: groupTop + y });
    }
    for (const card of group.querySelectorAll('.story-book-timeline-entry--moment')) {
      const rangeLabels = JSON.parse(card.dataset.timelineRangeIds).map((id) => labels.get(id));
      card.dataset.timelineMembershipLabel = rangeLabels.join(' · ');
      if (rangeLabels.length) {
        const port = card.querySelector('.story-book-timeline-port');
        port.setAttribute(
          'aria-label',
          port.getAttribute('aria-label') + '. Dentro de: ' + rangeLabels.join('; '),
        );
      }
    }
    if (editing) {
      for (let index = 0; index < dates.length - 1; index++) {
        const owners = ranges.filter(
          (range) =>
            compareCalendarDates(range.start, dates[index]) <= 0 &&
            compareCalendarDates(range.end, dates[index + 1]) >= 0,
        );
        if (!owners.length) continue;
        const y = gap * (index + 0.5);
        const anchor = this.createStoryBookTimelineAnchor(group, index, y - anchorHeight / 2);
        anchor.classList.add('story-book-timeline-anchor--range');
        delete anchor.dataset.timelineSlot;
        anchor.dataset.timelineRangeId = owners[0].id;
        anchor.dataset.timelineRangeIds = JSON.stringify([
          ...owners.map((range) => range.id),
          ...ancestors.map((card) => card.dataset.timelineEntryId),
        ]);
        anchor.dataset.timelineRangeSlot = String(index);
        anchor.setAttribute(
          'aria-label',
          owners.length === 1
            ? 'Punto temporal disponible dentro del rango'
            : 'Punto temporal disponible dentro de ' + owners.length + ' rangos',
        );
        controls.push({ control: anchor, center: groupTop + y });
      }
    }
    return controls;
  }

  createStoryBookTimelineAnchor(track, index, top = 0) {
    const anchor = document.createElement('button');
    anchor.type = 'button';
    anchor.tabIndex = -1;
    anchor.className = 'story-book-timeline-anchor story-book-timeline-anchor--virgin';
    anchor.style.top = `${top}px`;
    anchor.dataset.timelineSlot = String(index);
    anchor.dataset.timelineKeyboardOrder = String(index * 2 + 1);
    anchor.setAttribute('aria-label', 'Punto temporal disponible');
    anchor.setAttribute('aria-keyshortcuts', 'Enter Space');
    const point = document.createElement('span');
    point.className = 'story-book-timeline-virgin-point';
    point.setAttribute('aria-hidden', 'true');
    point.innerHTML = safeHTML(renderIcon('timeline-port', 16));
    anchor.appendChild(point);
    track.appendChild(anchor);
    return anchor;
  }

  createStoryBookTimelineEntry(entry, rangeLayout = null, { virginSlots = true } = {}) {
    const card = document.createElement('article');
    card.className = `story-book-timeline-entry story-book-timeline-entry--${entry.type}`;
    card.dataset.timelineEntryId = entry.id;
    card.dataset.timelineEntryType = entry.type;
    card.dataset.timelineDate =
      entry.type === 'range'
        ? `${this.formatStoryBookDate(entry.start)} – ${this.formatStoryBookDate(entry.end)}`
        : this.formatStoryBookDate(entry.start);
    const portType = entry.type === 'range' ? 'range' : 'in';
    const port = this.createTimelinePort(
      portType,
      entry.type === 'range'
        ? 'Editar rango; arrastrar para conectar'
        : 'Editar fecha; arrastrar para conectar',
    );
    port.title = 'Clic para editar · Arrastrar para conectar';
    port.setAttribute('aria-keyshortcuts', 'Enter Shift+Enter');
    port.setAttribute(
      'aria-label',
      `${port.getAttribute('aria-label')}. ${card.dataset.timelineDate}. Mayús+Enter para conectar`,
    );
    // Pointer release handles mouse/touch clicks; keyboard activation emits detail 0.
    // Ignore the synthetic click following a drag, which would otherwise open the picker.
    port.addEventListener('click', (event) => {
      event.stopPropagation();
      if (event.detail === 0) this.openStoryBookTimelineDatePopover({ entryId: entry.id }, port);
    });
    card.appendChild(port);
    if (entry.type === 'range') {
      card.style.setProperty('--timeline-range-color', entry.color || '#a855f7');
      // Local slots belong to this range, not the main lane. Its connection
      // port stays on the right so it never overlaps an interior date/slot.
      const height = Math.max(1, Number(rangeLayout?.height) || 96);
      const slotCenters =
        Array.isArray(rangeLayout?.slotCenters) && rangeLayout.slotCenters.length
          ? rangeLayout.slotCenters
          : [height / 2];
      (virginSlots ? slotCenters : []).forEach((center, index) => {
        const fraction = Math.min(1, Math.max(0, Number(center) / height));
        const rangeAnchor = document.createElement('button');
        rangeAnchor.type = 'button';
        rangeAnchor.tabIndex = -1;
        rangeAnchor.className =
          'story-book-timeline-anchor story-book-timeline-anchor--range story-book-timeline-anchor--virgin';
        rangeAnchor.dataset.timelineRangeId = entry.id;
        rangeAnchor.dataset.timelineRangeSlot = String(index);
        rangeAnchor.style.top = `${fraction * 100}%`;
        rangeAnchor.setAttribute('aria-keyshortcuts', 'Enter Space');
        rangeAnchor.setAttribute('aria-label', 'Punto temporal disponible dentro del rango');
        const rangePoint = document.createElement('span');
        rangePoint.className = 'story-book-timeline-virgin-point';
        rangePoint.setAttribute('aria-hidden', 'true');
        rangePoint.innerHTML = safeHTML(renderIcon('timeline-port', 16));
        rangeAnchor.appendChild(rangePoint);
        card.appendChild(rangeAnchor);
      });
      const rangeLabel = document.createElement('span');
      rangeLabel.className = 'story-book-timeline-range-label';
      rangeLabel.textContent = `${this.formatStoryBookDate(entry.start)} – ${this.formatStoryBookDate(entry.end)}`;
      card.appendChild(rangeLabel);
    }
    return card;
  }

  parseStoryBookDate(value) {
    return calendarDateToDate(value);
  }

  formatStoryBookDate(value) {
    if (!calendarDate(value)) return '';
    const date = this.parseStoryBookDate(value);
    return (
      new Intl.DateTimeFormat('es-MX', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(date) + (value.startsWith('-') ? ' AC' : ' DC')
    );
  }

  renderInvalidTimelineDates(timeline) {
    const invalid = timeline.invalidDates;
    const count = (invalid?.points.length || 0) + (invalid?.ranges.length || 0);
    const existing = this.timelineNode.querySelector('.story-book-timeline-date-warning');
    if (!count) {
      existing?.remove();
      return;
    }
    if (existing) return;
    const warning = document.createElement('button');
    warning.type = 'button';
    warning.className = 'story-book-timeline-date-warning';
    warning.innerHTML = safeHTML(renderIcon('warning', 16));
    warning.title = 'Hay fechas inválidas conservadas. Revisar';
    warning.setAttribute('aria-label', warning.title);
    warning.addEventListener('click', () => {
      this.closeStoryBookTimelinePopover({ restoreFocus: false });
      const archive = this.getStoryBookTimeline().invalidDates;
      const content = document.createElement('div');
      const explanation = document.createElement('p');
      explanation.textContent =
        'Estas entradas tienen fechas inválidas y no se dibujan. Se conservan con sus vínculos al guardar; el resto del libro sigue disponible.';
      const list = document.createElement('ul');
      for (const entry of [...(archive?.points || []), ...(archive?.ranges || [])]) {
        const item = document.createElement('li');
        item.className = 'story-book-timeline-invalid-date';
        const value = document.createElement('span');
        value.textContent = `${entry.id}: ${entry.date ?? `${entry.start} – ${entry.end}`}`;
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'btn btn-ghost';
        edit.textContent = 'Editar';
        edit.setAttribute('aria-label', `Editar fecha ${entry.id}`);
        edit.addEventListener('click', () => {
          Modal.hide();
          this.openStoryBookTimelineDatePopover({ entryId: entry.id }, warning);
        });
        item.append(value, edit);
        list.append(item);
      }
      content.append(explanation, list);
      Modal.show({ title: 'Fechas por revisar', content });
    });
    this.timelineNode.append(warning);
  }

  findTimelineEntry(timeline, entryId) {
    return [
      ...timeline.points,
      ...timeline.ranges,
      ...(timeline.invalidDates?.points || []),
      ...(timeline.invalidDates?.ranges || []),
    ].find((entry) => entry.id === entryId);
  }

  openStoryBookTimelineDatePopover(payload, anchor) {
    this.closeStoryBookTimelinePopover({ restoreFocus: false });
    if (!this.timelineNode?.isConnected || this.context.mode !== Mode.WYSIWYG) return;
    const entry = payload.entryId
      ? this.findTimelineEntry(this.getStoryBookTimeline(), payload.entryId)
      : null;
    if (payload.entryId && !entry) return;
    const state = {
      payload,
      start: entry?.date ?? entry?.start ?? null,
      end: entry?.end ?? null,
      era: 'DC',
      viewDate: this.parseStoryBookDate(new Date().toISOString().slice(0, 10)),
    };
    if (calendarDate(state.start)) state.viewDate = this.parseStoryBookDate(state.start);
    state.viewDate.setUTCDate(1);
    const popover = document.createElement('section');
    popover.className = 'story-book-timeline-date-popover';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', entry ? 'Editar fecha narrativa' : 'Seleccionar fecha narrativa');
    this.popoverReturnFocus =
      this.findStoryNode(payload.nodeId, payload.nodeType)?.querySelector('.story-book-node-port') ||
      (anchor instanceof HTMLElement ? anchor : null) ||
      (document.activeElement !== document.body ? document.activeElement : null);
    this.popoverReturnEntryId = payload.entryId || null;
    const heading = document.createElement('strong');
    heading.textContent = entry ? 'Editar fecha narrativa' : 'Fecha narrativa';
    const hint = document.createElement('p');
    hint.textContent = 'Selecciona una fecha o elige dos para crear un rango.';
    const calendar = document.createElement('div');
    calendar.className = 'story-book-timeline-calendar';
    const summary = document.createElement('div');
    summary.className = 'story-book-timeline-calendar__summary';
    summary.setAttribute('role', 'status');
    summary.setAttribute('aria-live', 'polite');
    summary.id = `timeline-calendar-status-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const fields = document.createElement('div');
    fields.className = 'story-book-timeline-calendar__fields';
    const inputs = {};
    for (const [key, text] of [
      ['start', 'Fecha inicial'],
      ['end', 'Fecha final'],
    ]) {
      const label = document.createElement('label');
      label.textContent = text;
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'AAAA-MM-DD';
      input.maxLength = 10;
      input.autocomplete = 'off';
      input.dataset.dateField = key;
      input.setAttribute('aria-describedby', summary.id);
      label.append(input);
      fields.append(label);
      inputs[key] = input;
    }
    const actions = document.createElement('div');
    actions.className = 'story-book-timeline-calendar__actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'story-book-timeline-calendar__cancel';
    cancel.textContent = 'Cancelar';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'story-book-timeline-calendar__confirm';
    confirm.textContent = entry ? 'Guardar cambios' : 'Conectar fecha';
    confirm.disabled = true;
    actions.append(cancel, confirm);
    popover.append(heading, hint, calendar, fields, summary, actions);
    // The calendar lives outside transformed/clipped canvas ancestors.
    document.body.appendChild(popover);
    this.timelinePopover = popover;
    const railRect = this.timelineNode.getBoundingClientRect();
    const anchorElement = anchor?.querySelector?.('.story-book-timeline-virgin-point') || anchor;
    const anchorRect = anchorElement?.getBoundingClientRect?.() || railRect;
    const railWidth = railRect.width || this.timelineNode.offsetWidth || 1;
    const railHeight = railRect.height || this.timelineNode.offsetHeight || 1;
    const anchorLeft = Number.isFinite(anchorRect.left) ? anchorRect.left : railRect.right;
    const anchorRight = Number.isFinite(anchorRect.right) ? anchorRect.right : anchorLeft;
    const anchorY = Number.isFinite(anchorRect.top)
      ? anchorRect.top + (anchorRect.height || 0) / 2
      : railRect.top + railHeight / 2;
    this.timelinePopoverAnchor = {
      element: anchorElement instanceof HTMLElement ? anchorElement : null,
      leftRatio: (anchorLeft - railRect.left) / railWidth,
      rightRatio: (anchorRight - railRect.left) / railWidth,
      yRatio: (anchorY - railRect.top) / railHeight,
    };
    this.onPopoverPositionChange = () => this.requestGeometryRefresh();
    window.addEventListener('scroll', this.onPopoverPositionChange, true);
    window.addEventListener('resize', this.onPopoverPositionChange);
    window.visualViewport?.addEventListener('resize', this.onPopoverPositionChange);
    window.visualViewport?.addEventListener('scroll', this.onPopoverPositionChange);
    this.popoverResizeObserver = globalThis.ResizeObserver
      ? new globalThis.ResizeObserver(this.onPopoverPositionChange)
      : null;
    const workspace = this.timelineNode.closest('.workspace');
    [
      popover,
      this.context.layoutWrapper?.closest('.canvas-wrapper'),
      ...(workspace?.querySelectorAll('.workspace__toolbar, .workspace__navigator, .workspace__chat') || []),
    ]
      .filter(Boolean)
      .forEach((element) => this.popoverResizeObserver?.observe(element));

    const render = () => {
      this.renderStoryBookTimelineCalendar(state, calendar, summary, confirm, render);
      for (const key of ['start', 'end']) {
        inputs[key].value = state[key]?.replace(/^-/, '') || '';
        inputs[key].setAttribute(
          'aria-invalid',
          String(
            Boolean(state[key] && !calendarDate(state[key])) ||
              (key === 'end' &&
                Boolean(state.end && state.start && compareCalendarDates(state.end, state.start) < 0)),
          ),
        );
      }
      this.positionStoryBookTimelinePopover();
    };
    for (const key of ['start', 'end']) {
      inputs[key].addEventListener('input', () => {
        const era = state[key] ? (state[key].startsWith('-') ? 'AC' : 'DC') : state.era;
        const value = inputs[key].value.trim();
        state[key] = value ? (era === 'AC' ? '-' + value.replace(/^-/, '') : value) : null;
        if (calendarDate(state[key])) {
          state.viewDate = this.parseStoryBookDate(state[key]);
          state.viewDate.setUTCDate(1);
          state.focusDate = state[key];
        }
        render();
      });
    }
    this.onPopoverKey = (event) => {
      // Keep canvas shortcuts (especially Space-to-pan) out of the calendar.
      // Native button/select behavior still runs unless explicitly handled below.
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.closeStoryBookTimelinePopover();
      } else if (event.key === 'Tab') {
        const targets = [...popover.querySelectorAll('button, input, select')].filter(
          (element) => !element.disabled && element.tabIndex >= 0 && !element.closest('[hidden], [inert]'),
        );
        const first = targets[0],
          last = targets.at(-1);
        if (
          (event.shiftKey && document.activeElement === first) ||
          (!event.shiftKey && document.activeElement === last)
        ) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        }
        event.stopPropagation();
      } else if (event.key === 'Enter' && event.target.matches('[data-date-field]')) {
        event.preventDefault();
        event.stopPropagation();
        if (!confirm.disabled) this.commitStoryBookTimelineDateSelection(state);
      }
    };
    popover.addEventListener('keydown', this.onPopoverKey);
    this.onPopoverOutside = (event) => {
      if (!popover.contains(event.target)) this.closeStoryBookTimelinePopover({ restoreFocus: false });
    };
    window.addEventListener('pointerdown', this.onPopoverOutside, true);
    cancel.addEventListener('click', () => this.closeStoryBookTimelinePopover());
    confirm.addEventListener('click', () => this.commitStoryBookTimelineDateSelection(state));
    render();
    calendar.querySelector('[data-day][tabindex="0"]')?.focus({ preventScroll: true });
  }

  positionStoryBookTimelinePopover() {
    const popover = this.timelinePopover;
    const anchor = this.timelinePopoverAnchor;
    if (!popover || !anchor) return;
    if (this.context.mode !== Mode.WYSIWYG || !this.timelineNode?.isConnected) {
      this.closeStoryBookTimelinePopover();
      return;
    }
    const margin = 12;
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft || 0;
    const viewportTop = viewport?.offsetTop || 0;
    const viewportWidth = viewport?.width || window.innerWidth;
    const viewportHeight = viewport?.height || window.innerHeight;
    const bounds = {
      left: viewportLeft + margin,
      right: viewportLeft + viewportWidth - margin,
      top: viewportTop + margin,
      bottom: viewportTop + viewportHeight - margin,
    };
    const workspace = this.timelineNode.closest('.workspace');
    const canvasRect = this.context.layoutWrapper?.closest('.canvas-wrapper')?.getBoundingClientRect();
    if (canvasRect?.width > 0 && canvasRect.height > 0) {
      bounds.left = Math.max(bounds.left, canvasRect.left + margin);
      bounds.right = Math.min(bounds.right, canvasRect.right - margin);
      bounds.top = Math.max(bounds.top, canvasRect.top + margin);
      bounds.bottom = Math.min(bounds.bottom, canvasRect.bottom - margin);
    }
    for (const [selector, edge, coordinate, direction] of [
      ['.workspace__navigator', 'left', 'right', 1],
      ['.workspace__chat', 'right', 'left', -1],
      ['.workspace__toolbar', 'top', 'bottom', 1],
    ]) {
      const rect = workspace?.querySelector(selector)?.getBoundingClientRect();
      if (rect?.width > 0 && rect.height > 0) {
        const candidate = rect[coordinate] + direction * margin;
        bounds[edge] =
          direction === 1 ? Math.max(bounds[edge], candidate) : Math.min(bounds[edge], candidate);
      }
    }
    // When the side panels leave too little room, use the window instead;
    // the calendar's layer stays above them and its content remains scrollable.
    if (bounds.right - bounds.left < Math.min(220, viewportWidth - margin * 2)) {
      bounds.left = viewportLeft + margin;
      bounds.right = viewportLeft + viewportWidth - margin;
    }
    if (bounds.bottom - bounds.top < Math.min(200, viewportHeight - margin * 2)) {
      bounds.top = viewportTop + margin;
      bounds.bottom = viewportTop + viewportHeight - margin;
    }
    popover.style.setProperty(
      '--timeline-calendar-max-width',
      Math.max(0, bounds.right - bounds.left) + 'px',
    );
    popover.style.setProperty(
      '--timeline-calendar-max-height',
      Math.max(0, bounds.bottom - bounds.top) + 'px',
    );
    const railRect = this.timelineNode.getBoundingClientRect();
    const rect = anchor.element?.isConnected ? anchor.element.getBoundingClientRect() : null;
    const anchorLeft = rect ? rect.left : railRect.left + anchor.leftRatio * railRect.width;
    const anchorRight = rect ? rect.right : railRect.left + anchor.rightRatio * railRect.width;
    const anchorY = rect ? rect.top + rect.height / 2 : railRect.top + anchor.yRatio * railRect.height;
    const popoverRect = popover.getBoundingClientRect();
    const width = popoverRect.width || popover.offsetWidth || Math.min(248, bounds.right - bounds.left);
    const height = popoverRect.height || popover.offsetHeight || 300;
    let left = anchorRight + margin;
    if (left + width > bounds.right) left = anchorLeft - margin - width;
    left = Math.max(bounds.left, Math.min(left, bounds.right - width));
    const top = Math.max(bounds.top, Math.min(anchorY - 24, bounds.bottom - height));
    popover.style.left = left + 'px';
    popover.style.top = top + 'px';
    this.calendarSelectControls?.forEach((control) => control.reposition());
  }

  renderStoryBookTimelineCalendar(state, calendar, summary, confirm, rerender) {
    const focused = calendar.contains(document.activeElement)
      ? { day: document.activeElement.dataset.day, control: document.activeElement.dataset.control }
      : null;
    this.calendarSelectControls?.forEach((control) => control.destroy({ restore: false }));
    this.calendarSelectControls = [];
    calendar.replaceChildren();
    const astronomicalYear = state.viewDate.getUTCFullYear();
    const era = astronomicalYear <= 0 ? 'AC' : 'DC';
    state.era = era;
    const year = astronomicalYear <= 0 ? 1 - astronomicalYear : astronomicalYear;
    const monthIndex = state.viewDate.getUTCMonth();
    const changeMonth = (offset) => {
      const nextDate = new Date(state.viewDate);
      nextDate.setUTCMonth(monthIndex + offset);
      if (!calendarDateFromDate(nextDate)) return;
      state.viewDate = nextDate;
      state.focusDate = calendarDateFromDate(nextDate);
      rerender();
    };
    const header = document.createElement('div');
    header.className = 'story-book-timeline-calendar__header';
    const previous = document.createElement('button');
    previous.type = 'button';
    previous.innerHTML = safeHTML(renderIcon('chevron-left'));
    previous.setAttribute('aria-label', 'Mes anterior');
    previous.dataset.control = 'previous';
    previous.disabled = era === 'AC' && year === 9999 && monthIndex === 0;
    previous.addEventListener('click', () => changeMonth(-1));
    const month = document.createElement('strong');
    month.textContent =
      new Intl.DateTimeFormat('es-MX', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(state.viewDate) +
      ' ' +
      era;
    const next = document.createElement('button');
    next.type = 'button';
    next.innerHTML = safeHTML(renderIcon('chevron-right'));
    next.setAttribute('aria-label', 'Mes siguiente');
    next.dataset.control = 'next';
    next.disabled = era === 'DC' && year === 9999 && monthIndex === 11;
    next.addEventListener('click', () => changeMonth(1));
    header.append(previous, month, next);
    calendar.appendChild(header);
    const navigation = document.createElement('div');
    navigation.className = 'story-book-timeline-calendar__navigation';
    const monthSelect = document.createElement('select');
    monthSelect.setAttribute('aria-label', 'Mes');
    monthSelect.dataset.control = 'month';
    for (let index = 0; index < 12; index++) {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = new Intl.DateTimeFormat('es-MX', { month: 'long', timeZone: 'UTC' }).format(
        new Date(Date.UTC(2000, index, 1)),
      );
      monthSelect.append(option);
    }
    monthSelect.value = String(monthIndex);
    monthSelect.addEventListener('change', () => changeMonth(Number(monthSelect.value) - monthIndex));
    const yearInput = document.createElement('input');
    yearInput.type = 'number';
    yearInput.min = '1';
    yearInput.max = '9999';
    yearInput.step = '1';
    yearInput.value = String(year);
    yearInput.setAttribute('aria-label', 'Año');
    yearInput.dataset.control = 'year';
    yearInput.addEventListener('change', () => {
      const value = Number(yearInput.value);
      if (!Number.isInteger(value) || value < 1 || value > 9999) {
        yearInput.value = String(year);
        return;
      }
      state.viewDate.setUTCFullYear(era === 'AC' ? 1 - value : value);
      state.focusDate = calendarDateFromDate(state.viewDate);
      rerender();
    });
    const eraSelect = document.createElement('select');
    eraSelect.setAttribute('aria-label', 'Era del calendario');
    eraSelect.dataset.control = 'era';
    for (const [value, text] of [
      ['DC', 'DC'],
      ['AC', 'AC'],
    ]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      eraSelect.append(option);
    }
    eraSelect.value = era;
    eraSelect.addEventListener('change', () => {
      state.era = eraSelect.value;
      state.viewDate.setUTCFullYear(state.era === 'AC' ? 1 - year : year);
      state.focusDate = calendarDateFromDate(state.viewDate);
      rerender();
    });
    navigation.append(monthSelect, yearInput, eraSelect);
    this.calendarSelectControls.push(
      enhanceSelect(monthSelect),
      enhanceSelect(eraSelect, { searchable: false }),
    );
    calendar.append(navigation);
    const weekdays = document.createElement('div');
    weekdays.className = 'story-book-timeline-calendar__weekdays';
    ['D', 'L', 'M', 'M', 'J', 'V', 'S'].forEach((day) => {
      const label = document.createElement('span');
      label.textContent = day;
      weekdays.appendChild(label);
    });
    calendar.appendChild(weekdays);
    const grid = document.createElement('div');
    grid.className = 'story-book-timeline-calendar__grid';
    const first = new Date(state.viewDate);
    first.setUTCDate(1);
    const last = new Date(first);
    last.setUTCMonth(monthIndex + 1, 0);
    const daysInMonth = last.getUTCDate();
    const monthPrefix = `${era === 'AC' ? '-' : ''}${String(year).padStart(4, '0')}-${String(monthIndex + 1).padStart(2, '0')}-`;
    if (!calendarDate(state.focusDate) || !state.focusDate.startsWith(monthPrefix)) {
      state.focusDate =
        calendarDate(state.start) && state.start.startsWith(monthPrefix) ? state.start : monthPrefix + '01';
    }
    for (let index = 0; index < first.getUTCDay(); index += 1)
      grid.appendChild(document.createElement('span'));
    for (let day = 1; day <= daysInMonth; day += 1) {
      const value = monthPrefix + String(day).padStart(2, '0');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = String(day);
      button.dataset.day = value;
      button.tabIndex = value === state.focusDate ? 0 : -1;
      button.setAttribute(
        'aria-label',
        new Intl.DateTimeFormat('es-MX', {
          dateStyle: 'full',
          timeZone: 'UTC',
        }).format(this.parseStoryBookDate(value)) +
          ' ' +
          era,
      );
      button.setAttribute(
        'aria-pressed',
        String(
          value === state.start ||
            value === state.end ||
            Boolean(
              state.start &&
              state.end &&
              compareCalendarDates(value, state.start) > 0 &&
              compareCalendarDates(value, state.end) < 0,
            ),
        ),
      );
      if (value === new Date().toISOString().slice(0, 10)) button.setAttribute('aria-current', 'date');
      button.classList.toggle('is-start', value === state.start);
      button.classList.toggle('is-end', value === state.end);
      button.classList.toggle(
        'is-between',
        Boolean(
          state.start &&
          state.end &&
          compareCalendarDates(value, state.start) > 0 &&
          compareCalendarDates(value, state.end) < 0,
        ),
      );
      button.addEventListener('click', () => {
        state.focusDate = value;
        if (!calendarDate(state.start) || state.end) {
          state.start = value;
          state.end = null;
        } else if (compareCalendarDates(value, state.start) < 0) {
          state.end = state.start;
          state.start = value;
        } else if (compareCalendarDates(value, state.start) > 0) state.end = value;
        rerender();
      });
      button.addEventListener('keydown', (event) => {
        const date = this.parseStoryBookDate(value);
        const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
        if (event.key in offsets) date.setUTCDate(date.getUTCDate() + offsets[event.key]);
        else if (event.key === 'Home') date.setUTCDate(date.getUTCDate() - date.getUTCDay());
        else if (event.key === 'End') date.setUTCDate(date.getUTCDate() + 6 - date.getUTCDay());
        else if (event.key === 'PageUp' || event.key === 'PageDown') {
          const offset = (event.key === 'PageUp' ? -1 : 1) * (event.shiftKey ? 12 : 1);
          date.setUTCDate(1);
          date.setUTCMonth(date.getUTCMonth() + offset);
          const monthEnd = new Date(date);
          monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1, 0);
          date.setUTCDate(Math.min(day, monthEnd.getUTCDate()));
        } else return;
        event.preventDefault();
        event.stopPropagation();
        if (!calendarDateFromDate(date)) return;
        state.focusDate = calendarDateFromDate(date);
        state.viewDate = new Date(date);
        state.viewDate.setUTCDate(1);
        rerender();
        calendar.querySelector(`[data-day="${state.focusDate}"]`)?.focus({ preventScroll: true });
      });
      grid.appendChild(button);
    }
    calendar.appendChild(grid);
    const invalidStart = Boolean(state.start && !calendarDate(state.start));
    const invalidEnd = Boolean(state.end && !calendarDate(state.end));
    const reversed = Boolean(
      state.start &&
      state.end &&
      !invalidStart &&
      !invalidEnd &&
      compareCalendarDates(state.end, state.start) < 0,
    );
    const invalidDates = invalidStart || invalidEnd || reversed || Boolean(state.end && !state.start);
    const editError =
      !invalidDates && state.start && state.payload.entryId
        ? this.timelineDateEditError(
            this.getStoryBookTimeline(),
            state.payload.entryId,
            state.start,
            state.end,
          )
        : '';
    const invalid = invalidDates || Boolean(editError);
    if (invalid) {
      summary.textContent =
        editError ||
        (reversed
          ? 'La fecha final debe ser igual o posterior a la inicial.'
          : 'Introduce fechas reales en formato AAAA-MM-DD y una fecha inicial.');
    } else if (state.start && state.end) {
      summary.textContent = `${this.formatStoryBookDate(state.start)} – ${this.formatStoryBookDate(state.end)}`;
      confirm.textContent = state.payload.entryId ? 'Guardar cambios' : 'Conectar rango';
    } else if (state.start) {
      summary.textContent = this.formatStoryBookDate(state.start);
      confirm.textContent = state.payload.entryId ? 'Guardar cambios' : 'Conectar fecha';
    } else {
      summary.textContent = '';
      confirm.textContent = state.payload.entryId ? 'Guardar cambios' : 'Conectar fecha';
    }
    summary.classList.toggle('is-invalid', invalid);
    confirm.disabled = !state.start || invalid;
    if (focused) {
      const target = focused.control
        ? calendar.querySelector(
            `button[data-control="${focused.control}"], input[data-control="${focused.control}"]`,
          )
        : calendar.querySelector(`[data-day="${state.focusDate}"]`);
      target?.focus({ preventScroll: true });
    }
  }

  commitStoryBookTimelineDateSelection(state) {
    if (
      !calendarDate(state.start) ||
      (state.end && (!calendarDate(state.end) || compareCalendarDates(state.end, state.start) < 0))
    )
      return;
    const timeline = this.getStoryBookTimeline();
    if (state.payload.entryId) {
      const targetId = this.editStoryBookTimelineDate(
        timeline,
        state.payload.entryId,
        state.start,
        state.end,
      );
      if (!targetId) return;
      this.popoverReturnEntryId = targetId;
      this.closeStoryBookTimelinePopover();
      return;
    }
    let targetId;
    if (state.end) {
      const existing = timeline.ranges.find(
        (range) => range.start === state.start && range.end === state.end,
      );
      if (existing) targetId = existing.id;
      else {
        targetId = `timeline-range-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
        timeline.ranges.push({
          id: targetId,
          start: state.start,
          end: state.end,
          color: STORY_BOOK_TIMELINE_NODE_COLORS[state.payload.nodeType] || '#a855f7',
          order: timeline.ranges.length,
        });
      }
    } else {
      const existing = timeline.points.find((point) => point.date === state.start);
      if (existing) targetId = existing.id;
      else {
        targetId = `timeline-point-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
        timeline.points.push({ id: targetId, date: state.start, order: timeline.points.length });
      }
    }
    this.closeStoryBookTimelinePopover();
    this.connectStoryBookTimeline(state.payload.nodeId, state.payload.nodeType, targetId);
  }

  timelineDateEditError(timeline, entryId, start, end) {
    if (!this.findTimelineEntry(timeline, entryId)) return 'Esta entrada ya no está disponible.';
    const collection = end ? 'ranges' : 'points';
    const existing = timeline[collection].some(
      (item) => item.id !== entryId && (end ? item.start === start && item.end === end : item.date === start),
    );
    const count = [...timeline[collection], ...(timeline.invalidDates?.[collection] || [])].filter(
      (item) => item.id !== entryId,
    ).length;
    return !existing && count >= (end ? 500 : 1000)
      ? 'La línea ha alcanzado el límite de entradas de este tipo.'
      : '';
  }

  editStoryBookTimelineDate(timeline, entryId, start, end) {
    if (
      !calendarDate(start) ||
      (end && (!calendarDate(end) || compareCalendarDates(start, end) > 0)) ||
      this.timelineDateEditError(timeline, entryId, start, end)
    )
      return null;
    const entry = this.findTimelineEntry(timeline, entryId);
    if (!entry) return null;
    const type = end ? 'range' : 'point';
    const collection = end ? 'ranges' : 'points';
    const existing = timeline[collection].find(
      (item) => item.id !== entryId && (end ? item.start === start && item.end === end : item.date === start),
    );
    const targetId = existing?.id || entryId;
    const archive = timeline.invalidDates;
    // Keep archived links when a repaired date becomes valid again.
    const connections = [...timeline.connections, ...(archive?.connections || [])];
    if (
      !archive &&
      !existing &&
      (end ? entry.start === start && entry.end === end : entry.date === start && !entry.end)
    )
      return targetId;
    timeline.points = timeline.points.filter((item) => item.id !== entryId);
    timeline.ranges = timeline.ranges.filter((item) => item.id !== entryId);
    if (archive) {
      archive.points = archive.points.filter((item) => item.id !== entryId);
      archive.ranges = archive.ranges.filter((item) => item.id !== entryId);
    }
    if (!existing)
      timeline[collection].push(
        end
          ? { id: entryId, start, end, color: entry.color || '#a855f7', order: entry.order }
          : { id: entryId, date: start, order: entry.order },
      );
    const update = (connection) =>
      connection.targetId === entryId ? { ...connection, targetId, targetType: type } : connection;
    const signatures = new Set();
    const updated = connections.map(update).filter((connection) => {
      if (!existing || connection.targetId !== targetId) return true;
      const signature = JSON.stringify([
        connection.nodeType,
        connection.nodeId,
        connection.targetType,
        connection.targetId,
      ]);
      if (signatures.has(signature)) return false;
      signatures.add(signature);
      return true;
    });
    const invalidIds = new Set(
      [...(archive?.points || []), ...(archive?.ranges || [])].map((item) => item.id),
    );
    timeline.connections = updated.filter((item) => !invalidIds.has(item.targetId));
    if (archive) archive.connections = updated.filter((item) => invalidIds.has(item.targetId));
    syncStoryBookTimelineMetadata(this.context.storyBookDocument);
    this.renderStoryBookTimeline();
    this.context.emitChange();
    return targetId;
  }

  closeStoryBookTimelinePopover({ restoreFocus = true } = {}) {
    this.calendarSelectControls?.forEach((control) => control.destroy({ restore: false }));
    this.calendarSelectControls = [];
    const returnFocus = this.popoverReturnFocus;
    const returnEntryId = this.popoverReturnEntryId;
    this.popoverReturnFocus = null;
    this.popoverReturnEntryId = null;
    if (this.onPopoverOutside) window.removeEventListener('pointerdown', this.onPopoverOutside, true);
    this.onPopoverOutside = null;
    this.timelinePopover?.removeEventListener('keydown', this.onPopoverKey);
    this.onPopoverKey = null;
    if (this.onPopoverPositionChange) {
      window.removeEventListener('scroll', this.onPopoverPositionChange, true);
      window.removeEventListener('resize', this.onPopoverPositionChange);
      window.visualViewport?.removeEventListener('resize', this.onPopoverPositionChange);
      window.visualViewport?.removeEventListener('scroll', this.onPopoverPositionChange);
      this.onPopoverPositionChange = null;
    }
    this.popoverResizeObserver?.disconnect();
    this.popoverResizeObserver = null;
    this.timelinePopoverAnchor = null;
    this.timelinePopover?.remove();
    this.timelinePopover = null;
    if (restoreFocus) {
      const entryPort = returnEntryId
        ? [...(this.timelineNode?.querySelectorAll('.story-book-timeline-entry') || [])]
            .find((entry) => entry.dataset.timelineEntryId === returnEntryId)
            ?.querySelector('.story-book-timeline-port')
        : null;
      const key = returnEntryId ? `entry:${returnEntryId}` : this.timelineFocusKey(returnFocus);
      if (key) this.focusTimelineKey(key);
      else (entryPort || (returnFocus?.isConnected ? returnFocus : null))?.focus({ preventScroll: true });
    }
  }

  createTimelinePort(port, label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `story-book-timeline-port story-book-timeline-port--${port}`;
    button.draggable = true;
    button.dataset.port = port;
    button.setAttribute('aria-label', label);
    button.innerHTML = safeHTML(renderIcon('timeline-port', 16));
    return button;
  }

  syncStoryBookTimelineVisualState({ schedule = true } = {}) {
    const timeline = this.getStoryBookTimeline();
    const linkedNodes = new Set(
      timeline.connections.map((connection) => `${connection.nodeType}:${connection.nodeId}`),
    );
    this.context.surface?.querySelectorAll('[data-story-node-id]').forEach((node) => {
      const linked = linkedNodes.has(`${node.dataset.storyNodeType}:${node.dataset.storyNodeId}`);
      if (node.classList.contains('has-timeline-link') !== linked)
        node.classList.toggle('has-timeline-link', linked);
    });
    this.timelineNode?.querySelectorAll('.story-book-timeline-entry').forEach((entry) => {
      const linked = timeline.connections.some(
        (connection) => connection.targetId === entry.dataset.timelineEntryId,
      );
      entry.classList.toggle('has-connections', linked);
    });
    if (schedule) this.requestGeometryRefresh();
  }
}
