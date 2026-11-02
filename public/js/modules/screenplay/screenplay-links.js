import { renderIcon } from '../../icons.js';
import { safeHTML } from '../../safe-html.js';
import { timelineCableGeometry, createTimelineFusion } from '../story-book/editing.js';
import { linkedProjects } from './screenplay-navigation.js';

const SVG = 'http://www.w3.org/2000/svg';
const PORT_SIZE = 14;

/**
 * Character rail (left) ↔ dialogue ports, stage rail (right) ↔ shot ports. The selectors in the
 * script stay the single source of truth: every cable is derived from them and every connection
 * writes through them, so nothing extra is persisted and the document contract is unchanged.
 */
const KINDS = {
  character: {
    owner: '.screenplay-dialogue',
    side: 'left',
    title: 'Personajes',
    empty: 'Vincula personajes como ingredientes del guión para conectarlos con los diálogos.',
    ownerName: 'diálogo',
    read: (owner) => owner.querySelector('[data-character-link]')?.value || '',
    control: (owner) => owner.querySelector('[data-character-link]'),
  },
  stage: {
    owner: '.screenplay-shot',
    side: 'right',
    title: 'Escenarios',
    empty: 'Vincula escenarios como ingredientes del guión para conectarlos con los planos.',
    ownerName: 'plano',
    read: (owner) => owner.closest('.screenplay-scene')?.querySelector('[data-scene-stage]')?.value || '',
    control: (owner) => owner.closest('.screenplay-scene')?.querySelector('[data-scene-stage]'),
  },
};

const svgElement = (tag, attributes = {}) => {
  const node = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
};

/** Connecting writes the same value the user would pick in the selector, so every listener reacts. */
function writeLink(kind, owner, id) {
  const select = KINDS[kind].control(owner);
  if (!select) return false;
  select.dispatchEvent(new select.ownerDocument.defaultView.CustomEvent('screenplay:refresh'));
  if (id && ![...select.options].some((option) => option.value === id)) return false;
  if (select.value === id) return true;
  select.value = id;
  select.dispatchEvent(new select.ownerDocument.defaultView.Event('change', { bubbles: true }));
  return true;
}

/** Owns the two link rails, the owner ports and the cable layer of an open screenplay. */
export class ScreenplayLinks {
  rails = {};
  ports = new Map();
  ownerByPort = new WeakMap();
  frame = null;
  drag = null;
  destroyed = false;

  constructor(wrapper) {
    this.wrapper = wrapper;
  }

  mount() {
    const node = this.wrapper.querySelector(':scope > .editor-node');
    if (!node) return;
    this.node = node;
    this.rails.character = this.createRail('character');
    this.rails.stage = this.createRail('stage');
    node.before(this.rails.character.root);
    node.after(this.rails.stage.root);
    this.layer = Object.assign(this.wrapper.ownerDocument.createElement('div'), {
      className: 'screenplay-link-layer',
    });
    this.svg = svgElement('svg', { class: 'story-book-timeline-links screenplay-link-cables' });
    this.svg.setAttribute('aria-hidden', 'true');
    this.defs = svgElement('defs');
    const gradient = svgElement('linearGradient', { id: 'story-book-timeline-gradient' });
    gradient.append(
      ...[
        ['0%', '#22d3ee'],
        ['50%', '#60a5fa'],
        ['100%', '#a855f7'],
      ].map(([offset, color]) => svgElement('stop', { offset, 'stop-color': color })),
    );
    this.defs.append(gradient);
    this.svg.append(this.defs);
    this.wrapper.append(this.svg, this.layer);

    this.request = this.request.bind(this);
    this.onPointerDown = (event) => this.startDrag(event);
    this.onPointerMove = (event) => this.moveDrag(event);
    this.onPointerUp = (event) => this.finishDrag(event);
    this.onKey = (event) => {
      if (event.key === 'Escape' && this.drag) this.finishDrag(this.drag.event, true);
    };
    this.wrapper.addEventListener('pointerdown', this.onPointerDown, true);
    this.wrapper.addEventListener('scroll', this.request, true);
    this.wrapper.addEventListener('change', this.request, true);
    this.wrapper.addEventListener('input', this.request, true);
    const view = this.wrapper.ownerDocument.defaultView;
    view.addEventListener('resize', this.request);
    view.addEventListener('pointermove', this.onPointerMove);
    view.addEventListener('pointerup', this.onPointerUp);
    view.addEventListener('pointercancel', this.onPointerUp);
    view.addEventListener('keydown', this.onKey);
    this.view = view;
    const { MutationObserver, ResizeObserver } = view;
    this.mutations = MutationObserver ? new MutationObserver(this.request) : null;
    this.mutations?.observe(node, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['hidden', 'class', 'style', 'data-key'],
    });
    const drawers = this.wrapper.querySelector('.editor-drawers-sidebar');
    if (drawers) this.mutations?.observe(drawers, { childList: true, subtree: true });
    this.resizes = ResizeObserver ? new ResizeObserver(this.request) : null;
    this.resizes?.observe(this.wrapper);
    this.resizes?.observe(node);
    this.request();
  }

  destroy() {
    this.destroyed = true;
    if (this.frame) this.view?.cancelAnimationFrame?.(this.frame);
    this.wrapper.removeEventListener('pointerdown', this.onPointerDown, true);
    this.wrapper.removeEventListener('scroll', this.request, true);
    this.wrapper.removeEventListener('change', this.request, true);
    this.wrapper.removeEventListener('input', this.request, true);
    for (const [type, handler] of [
      ['resize', this.request],
      ['pointermove', this.onPointerMove],
      ['pointerup', this.onPointerUp],
      ['pointercancel', this.onPointerUp],
      ['keydown', this.onKey],
    ])
      this.view?.removeEventListener(type, handler);
    this.mutations?.disconnect();
    this.resizes?.disconnect();
    for (const rail of Object.values(this.rails)) rail.root.remove();
    this.layer?.remove();
    this.svg?.remove();
    this.ports.clear();
    this.drag = null;
  }

  request() {
    if (this.destroyed || this.frame) return;
    const view = this.view || this.wrapper.ownerDocument.defaultView;
    this.frame = view.requestAnimationFrame(() => {
      this.frame = null;
      if (!this.destroyed) this.refresh();
    });
  }

  createRail(kind) {
    const doc = this.wrapper.ownerDocument;
    const root = doc.createElement('aside');
    root.className = `screenplay-link-rail screenplay-link-rail--${kind}`;
    root.dataset.linkKind = kind;
    root.setAttribute('aria-label', KINDS[kind].title + ' vinculados');
    const heading = doc.createElement('span');
    heading.className = 'screenplay-link-rail__title';
    heading.textContent = KINDS[kind].title;
    const track = doc.createElement('div');
    track.className = 'screenplay-link-rail__track';
    root.append(heading, track);
    return { root, track, key: null, nodes: new Map() };
  }

  /** Rebuilt only when the linked ingredients change; each node is the port of one project. */
  syncRail(kind) {
    const rail = this.rails[kind];
    const items = linkedProjects(kind);
    const key = items
      .map((item) => [item.id, item.name, item.color1, item.color2, item.portrait?.url].join('~'))
      .join('|');
    if (rail.key === key) return;
    rail.key = key;
    rail.nodes.clear();
    const doc = this.wrapper.ownerDocument;
    const nodes = items.map((item) => {
      const node = doc.createElement('div');
      node.className = 'screenplay-link-node';
      node.dataset.linkKind = kind;
      node.dataset.linkId = item.id;
      node.title = `${item.name}: arrastra su puerto hasta un ${KINDS[kind].ownerName} para conectarlo.`;
      if (item.color1 && item.color2) {
        node.style.setProperty('--link-color1', item.color1);
        node.style.setProperty('--link-color2', item.color2);
      }
      const disc = doc.createElement('span');
      disc.className = 'screenplay-link-node__disc';
      disc.textContent = (item.name.trim()[0] || '?').toLocaleUpperCase();
      if (item.portrait) {
        const image = doc.createElement('img');
        image.alt = '';
        image.loading = 'lazy';
        image.src = item.portrait.url;
        image.addEventListener(
          'error',
          () => {
            if (image.src !== item.portrait.source && item.portrait.face) image.src = item.portrait.source;
            else image.remove();
          },
          { once: true },
        );
        disc.append(image);
      }
      const name = doc.createElement('span');
      name.className = 'screenplay-link-node__name';
      name.textContent = item.name;
      const port = this.createPort(kind, 'rail', item.name);
      port.dataset.linkId = item.id;
      node.append(disc, name, port);
      rail.nodes.set(item.id, { node, port });
      return node;
    });
    if (!nodes.length) {
      const hint = doc.createElement('span');
      hint.className = 'screenplay-link-rail__empty';
      hint.title = KINDS[kind].empty;
      hint.setAttribute('role', 'note');
      hint.textContent = 'Sin vincular';
      rail.track.replaceChildren(hint);
    } else rail.track.replaceChildren(...nodes);
  }

  createPort(kind, role, name) {
    const port = this.wrapper.ownerDocument.createElement('button');
    port.type = 'button';
    port.className = `screenplay-link-port screenplay-link-port--${role}`;
    port.contentEditable = 'false';
    port.dataset.screenplayControls = '';
    port.dataset.linkKind = kind;
    port.dataset.linkRole = role;
    port.innerHTML = safeHTML(renderIcon('timeline-port', PORT_SIZE));
    const what = KINDS[kind];
    port.setAttribute(
      'aria-label',
      role === 'rail'
        ? `Puerto de ${name}`
        : `Puerto de ${what.ownerName}: conecta ${kind === 'character' ? 'su personaje' : 'el escenario de su escena'}`,
    );
    port.title =
      role === 'rail'
        ? `${name}: arrastra hasta un ${what.ownerName}.`
        : `Arrastra hasta ${kind === 'character' ? 'un personaje' : 'un escenario'} para conectarlo. También puedes elegirlo en su selector.`;
    return port;
  }

  syncPort(owner, kind) {
    let port = this.ports.get(owner);
    if (!port) {
      port = this.createPort(kind, 'owner', '');
      port.classList.add(`screenplay-link-port--${KINDS[kind].side}`);
      this.ownerByPort.set(port, owner);
      this.ports.set(owner, port);
      this.layer.append(port);
    }
    return port;
  }

  refresh() {
    const surface = this.node?.querySelector('.screenplay-wysiwyg');
    const live = Boolean(surface && !surface.hidden);
    for (const rail of Object.values(this.rails)) rail.root.hidden = !live;
    this.layer.hidden = !live;
    this.svg.replaceChildren(this.defs);
    this.defs.querySelectorAll('[id^="timeline-fusion-gradient-"]').forEach((item) => item.remove());
    if (!live) {
      for (const port of this.ports.values()) port.remove();
      this.ports.clear();
      return;
    }
    for (const kind of Object.keys(KINDS)) this.syncRail(kind);

    const wrapperRect = this.wrapper.getBoundingClientRect();
    const width = Math.max(1, this.wrapper.offsetWidth || Math.ceil(wrapperRect.width));
    const height = Math.max(1, this.wrapper.offsetHeight || Math.ceil(wrapperRect.height));
    const scaleX = wrapperRect.width / width || 1;
    const scaleY = wrapperRect.height / height || 1;
    const toLocal = (x, y) => ({ x: (x - wrapperRect.left) / scaleX, y: (y - wrapperRect.top) / scaleY });
    const toPoint = (rect) => toLocal(rect.left + rect.width / 2, rect.top + rect.height / 2);
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    this.svg.setAttribute('width', String(width));
    this.svg.setAttribute('height', String(height));

    const view = surface.getBoundingClientRect();
    const inside = (y) => y >= view.top + 4 && y <= view.bottom - 4;
    const visibleOwners = new Set();
    const connections = [];
    for (const [kind, spec] of Object.entries(KINDS)) {
      const rail = this.rails[kind];
      const railRect = rail.root.getBoundingClientRect();
      for (const owner of surface.querySelectorAll(spec.owner)) {
        const rect = owner.getBoundingClientRect();
        const y = rect.top + Math.min(26, rect.height / 2);
        if (!(rect.width > 0 && rect.height > 0) || owner.closest('[hidden]') || !inside(y)) continue;
        const port = this.syncPort(owner, kind);
        visibleOwners.add(owner);
        const point = toLocal(spec.side === 'left' ? rect.left : rect.right, y);
        port.style.left = `${(point.x - PORT_SIZE / 2).toFixed(1)}px`;
        port.style.top = `${(point.y - PORT_SIZE / 2).toFixed(1)}px`;
        const target = rail.nodes.get(spec.read(owner));
        if (!target) continue;
        const portRect = target.port.getBoundingClientRect();
        const centre = portRect.top + portRect.height / 2;
        if (centre < railRect.top || centre > railRect.bottom) continue;
        connections.push({ kind, owner, port, target });
      }
    }
    for (const [owner, port] of [...this.ports]) {
      if (visibleOwners.has(owner)) continue;
      port.remove();
      this.ports.delete(owner);
    }

    const fusion = createTimelineFusion({
      svg: this.svg,
      defs: this.defs,
      toPoint,
      scaleX,
      scaleY,
      spine: null,
      viewport: null,
    });
    for (const { kind, owner, port, target } of connections) {
      const [first, second] = KINDS[kind].side === 'left' ? [target.port, port] : [port, target.port];
      this.drawCable(fusion, { first, second, toPoint, scaleX, scaleY }, kind, target.node, () =>
        writeLink(kind, owner, ''),
      );
    }
    if (this.drag?.cursor) this.drawPreview(fusion, toLocal);
    this.syncFused(fusion.flush());
  }

  drawCable(fusion, { first, second, toPoint, scaleX, scaleY }, kind, node, remove) {
    const a = first.getBoundingClientRect();
    const b = second.getBoundingClientRect();
    if (!(a.width > 0 && b.width > 0)) return;
    const radius = (rect) => Math.min(rect.width / scaleX, rect.height / scaleY) / 2;
    const geometry = timelineCableGeometry(toPoint(a), toPoint(b), radius(a), radius(b));
    const group = svgElement('g', { class: 'story-book-timeline-connection', 'data-link-kind': kind });
    const path = svgElement('path', { class: 'story-book-timeline-link', d: geometry.pathData });
    path.style.stroke = fusion.cable(first, second, geometry);
    path.setAttribute('pointer-events', 'none');
    path.setAttribute('aria-hidden', 'true');
    const label = `Quitar la conexión con ${node.querySelector('.screenplay-link-node__name')?.textContent || ''}`;
    const point = svgElement('circle', {
      class: 'story-book-timeline-connection-remove',
      cx: geometry.midpoint.x.toFixed(2),
      cy: geometry.midpoint.y.toFixed(2),
      r: 4.5,
      tabindex: 0,
      role: 'button',
      'aria-label': label,
    });
    const title = svgElement('title');
    title.textContent = label;
    point.append(title);
    const mark = svgElement('g', {
      class: 'story-book-timeline-connection-remove-mark',
      transform: `translate(${(geometry.midpoint.x - 6).toFixed(2)} ${(geometry.midpoint.y - 6).toFixed(2)})`,
      'aria-hidden': 'true',
    });
    mark.innerHTML = safeHTML(renderIcon('close', 12));
    point.addEventListener('click', (event) => {
      event.stopPropagation();
      if (remove()) this.request();
    });
    point.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      if (remove()) this.request();
    });
    group.append(path, point, mark);
    this.svg.append(group);
  }

  drawPreview(fusion, toLocal) {
    const { source, cursor } = this.drag;
    if (!source.isConnected) return;
    const rect = source.getBoundingClientRect();
    const from = toLocal(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const to = toLocal(cursor.x, cursor.y);
    const geometry = timelineCableGeometry(from, to, rect.width / 2, 0);
    const group = svgElement('g', {
      class: 'story-book-timeline-connection story-book-timeline-connection--preview',
    });
    const path = svgElement('path', {
      class: 'story-book-timeline-link story-book-timeline-link--preview',
      d: geometry.pathData,
    });
    path.style.stroke = fusion.cable(source, null, geometry);
    path.setAttribute('pointer-events', 'none');
    group.append(path);
    this.svg.append(group);
  }

  syncFused(ports) {
    for (const port of this.fused || []) if (!ports.has(port)) port.removeAttribute('data-timeline-fused');
    for (const port of ports) if (!port.hasAttribute('data-timeline-fused')) port.dataset.timelineFused = '';
    this.fused = ports;
  }

  startDrag(event) {
    const port = event.target.closest?.('.screenplay-link-port');
    if (event.button !== 0 || this.drag || !port || !this.wrapper.contains(port)) return;
    event.preventDefault();
    event.stopPropagation();
    this.drag = {
      pointerId: event.pointerId,
      source: port,
      kind: port.dataset.linkKind,
      role: port.dataset.linkRole,
      cursor: { x: event.clientX, y: event.clientY },
      event,
    };
    port.classList.add('is-link-dragging');
    this.request();
  }

  moveDrag(event) {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    this.drag.cursor = { x: event.clientX, y: event.clientY };
    this.drag.event = event;
    this.request();
  }

  finishDrag(event, cancelled = false) {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.drag = null;
    drag.source.classList.remove('is-link-dragging');
    if (!cancelled) {
      const doc = this.wrapper.ownerDocument;
      this.connect(drag, doc.elementFromPoint(event.clientX, event.clientY));
    }
    this.request();
  }

  /** A rail port reaches a shot/dialogue and an owner port reaches a rail node, both of the same kind. */
  connect(drag, target) {
    const spec = KINDS[drag.kind];
    const surface = this.node?.querySelector('.screenplay-wysiwyg');
    if (!target || !surface) return false;
    if (drag.role === 'rail') {
      const owner =
        this.ownerByPort.get(target.closest?.('.screenplay-link-port')) || target.closest?.(spec.owner);
      if (!owner || !surface.contains(owner) || !owner.matches(spec.owner)) return false;
      return writeLink(drag.kind, owner, drag.source.dataset.linkId);
    }
    const node = target.closest?.(`.screenplay-link-node[data-link-kind="${drag.kind}"]`);
    const owner = this.ownerByPort.get(drag.source);
    if (!node || !owner || !surface.contains(owner)) return false;
    return writeLink(drag.kind, owner, node.dataset.linkId);
  }
}
