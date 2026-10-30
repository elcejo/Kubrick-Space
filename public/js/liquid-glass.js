/** Shared, low-resolution optical surfaces. Decorations never enter editable content. */
let sequence = 0;
const svgNS = 'http://www.w3.org/2000/svg';
const opticalScale = 1 / 8;
const maxOpticalSide = 256;
const instances = new WeakMap();

// Surfaces, not individual inputs or photographs. New shared dialogs and menus inherit coverage.
export const LIQUID_GLASS_SURFACES = [
  '.glass',
  '.glass-heavy',
  '.glass-card',
  '.modal-content',
  '.toast',
  '.studio-nav',
  '#home-resume',
  '.studio-card',
  '.studio-settings',
  '.settings-model-popover',
  '.workspace-nav',
  '.workspace-inspector',
  '.workspace-tasks',
  '.toolbar-dropdown',
  '.floating-tab-card',
  '.chat-panel',
  '.chat-menu',
  '.chat-library-dialog',
  '.document-versions',
  '.editor-node',
  '.character-node',
  '.editor-index-container',
  '.video-board-node',
  '.story-book-timeline-date-popover',
  '.generation-card',
  '.format-toolbar',
  '.format-toolbar-floating',
  '.kai-context-menu',
  '.kai-context-submenu',
  '.kai-mention-popup',
  '.kai-character-tooltip',
  '.kai-select__menu',
  '.kai-color-disc',
  '.kai-color-controls',
  '.image-model-picker',
  '.cover-loading-overlay',
  '.zoom-indicator',
  '.canvas-zoom-badge',
  '.wizard-bubble-circle',
  '.wizard-bubble-label',
  '.docs-topbar',
  '.icons-guidelines',
  '.icon-specimen',
  '.roadmap-sidebar',
  '.roadmap-summary',
  '.roadmap-controls',
  '.roadmap-card',
  '.roadmap-agent-card',
  '.roadmap-infra-card',
  '.roadmap-vision',
  '#bubble-context-menu',
  '.liquid-tooltip',
].join(',');
const mediaSurfaces = [
  '.character-portrait-section',
  '.book-cover-section',
  '.ingredient-card',
  '.ingredient-drawer',
  '.studio-card-art',
  '.studio-resume-art',
  '.bubble-circle',
  '.scene-card',
  '.scene-image',
  '.video-scene-card',
  '.cover-reference-option',
  '[data-liquid-glass="off"]',
].join(',');
const decoration = '.liquid-glass-layer, .liquid-glass-definitions';

function displacementMap(width, height, radius, scale) {
  const inset = Math.min(24, Math.min(width, height) * 0.055);
  const softness = Math.max(6, inset * 0.8);
  // Neutral grey in the centre keeps the backdrop still; red/green edges refract it.
  return `<svg xmlns="${svgNS}" width="${width * scale}" height="${height * scale}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="x"><stop stop-color="#ff0000"/><stop offset="1" stop-color="#000000"/></linearGradient>
      <linearGradient id="y" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#00ff00"/><stop offset="1" stop-color="#000000"/></linearGradient>
      <filter id="soft"><feGaussianBlur stdDeviation="${softness}"/></filter>
    </defs>
    <rect width="${width}" height="${height}" fill="#000080"/>
    <rect width="${width}" height="${height}" fill="url(#x)" style="mix-blend-mode:screen"/>
    <rect width="${width}" height="${height}" fill="url(#y)" style="mix-blend-mode:screen"/>
    <rect x="${inset}" y="${inset}" width="${width - inset * 2}" height="${height - inset * 2}" rx="${Math.max(0, radius - inset / 2)}" fill="#808080" filter="url(#soft)"/>
  </svg>`;
}

function eligible(element, doc) {
  return (
    element instanceof doc.defaultView.HTMLElement &&
    !element.closest(mediaSurfaces) &&
    !element.closest(
      '[contenteditable]:not([contenteditable="false"]), .editor-surface, .code-editor-container',
    ) &&
    !element.matches('input, textarea, select, img, video, canvas, option') &&
    !element.closest(decoration)
  );
}

/** One definition container and shared observers per page, including surfaces created later. */
export function createLiquidGlass(doc, selector = LIQUID_GLASS_SURFACES) {
  const win = doc.defaultView;
  if (!win.CSS?.supports?.('backdrop-filter', 'url("#liquid-glass")')) return () => {};
  const svg = doc.createElementNS(svgNS, 'svg');
  for (const [key, value] of Object.entries({
    width: '0',
    height: '0',
    'aria-hidden': 'true',
    focusable: 'false',
  }))
    svg.setAttribute(key, value);
  svg.classList.add('liquid-glass-definitions');
  const defs = doc.createElementNS(svgNS, 'defs');
  svg.append(defs);
  doc.body.append(svg);
  const records = new Map();
  let disposed = false,
    pending = null;
  const update = (element, size) => {
    const record = records.get(element);
    if (!record) return;
    const width = Math.round(size?.inlineSize || element.offsetWidth);
    const height = Math.round(size?.blockSize || element.offsetHeight);
    if (width <= 0 || height <= 0) return;
    const style = win.getComputedStyle(element);
    const rawRadius = style.borderTopLeftRadius || '0';
    const radius = Math.min(
      Math.min(width, height) / 2,
      Math.max(0, parseFloat(rawRadius) || 0) * (rawRadius.includes('%') ? Math.min(width, height) / 100 : 1),
    );
    // Position/z-index are only supplied when absent; fixed, sticky and top-layer surfaces keep theirs.
    element.classList.toggle(
      'liquid-glass--positioned',
      style.position === 'static' || element.classList.contains('liquid-glass--positioned'),
    );
    element.classList.toggle(
      'liquid-glass--stacked',
      style.zIndex === 'auto' || element.classList.contains('liquid-glass--stacked'),
    );
    const signature = width + ':' + height + ':' + radius;
    if (signature !== record.size) {
      record.size = signature;
      const resolution = Math.min(opticalScale, maxOpticalSide / Math.max(width, height));
      for (const target of [record.filter, record.image]) {
        target.setAttribute('width', String(width * resolution));
        target.setAttribute('height', String(height * resolution));
      }
      record.image.setAttribute(
        'href',
        'data:image/svg+xml;charset=utf-8,' +
          encodeURIComponent(displacementMap(width, height, radius, resolution)),
      );
      const scale = Math.min(280, Math.min(width, height) * 0.6);
      record.displacements.forEach((d, index) =>
        d.setAttribute('scale', String(Math.max(0, scale - index * 2) * resolution)),
      );
      const variables = {
        filter: 'url("#' + record.filter.id + '")',
        width: width * resolution + 'px',
        height: height * resolution + 'px',
        radius: radius * resolution + 'px',
        resolution: String(resolution),
      };
      for (const [key, value] of Object.entries(variables))
        record.layer.style.setProperty('--_liquid-glass-' + key, value);
    }
    element.classList.add('liquid-glass');
    // Some components replace their UI children. Restore decoration without altering their data.
    if (record.layer.parentElement !== element) element.append(record.layer);
  };
  const resize = win.ResizeObserver
    ? new win.ResizeObserver((entries) =>
        entries.forEach((entry) => update(entry.target, entry.borderBoxSize?.[0])),
      )
    : null;
  const visibility = win.IntersectionObserver
    ? new win.IntersectionObserver(
        (entries) =>
          entries.forEach((entry) => {
            const record = records.get(entry.target);
            if (record) record.layer.hidden = !entry.isIntersecting;
          }),
        { rootMargin: '64px' },
      )
    : null;
  const release = (element) => {
    const record = records.get(element);
    resize?.unobserve(element);
    visibility?.unobserve(element);
    record.layer.remove();
    record.filter.remove();
    element.classList.remove('liquid-glass', 'liquid-glass--positioned', 'liquid-glass--stacked');
    records.delete(element);
  };
  const add = (element) => {
    const filter = doc.createElementNS(svgNS, 'filter');
    for (const [key, value] of Object.entries({
      id: 'liquid-glass-' + ++sequence,
      x: '0',
      y: '0',
      filterUnits: 'userSpaceOnUse',
      primitiveUnits: 'userSpaceOnUse',
      'color-interpolation-filters': 'sRGB',
    }))
      filter.setAttribute(key, value);
    const image = doc.createElementNS(svgNS, 'feImage');
    image.setAttribute('result', 'displacementMap');
    image.setAttribute('preserveAspectRatio', 'none');
    filter.append(image);
    const displacements = [];
    const matrices = [
      '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0',
      '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0',
      '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0',
    ];
    for (const [index, channel] of ['R', 'G', 'B'].entries()) {
      const d = doc.createElementNS(svgNS, 'feDisplacementMap');
      for (const [key, value] of Object.entries({
        in: 'SourceGraphic',
        in2: 'displacementMap',
        xChannelSelector: 'R',
        yChannelSelector: 'G',
      }))
        d.setAttribute(key, value);
      filter.append(d);
      displacements.push(d);
      const matrix = doc.createElementNS(svgNS, 'feColorMatrix');
      for (const [key, value] of Object.entries({
        type: 'matrix',
        result: 'displaced' + channel,
        values: matrices[index],
      }))
        matrix.setAttribute(key, value);
      filter.append(matrix);
    }
    for (const attributes of [
      { in: 'displacedR', in2: 'displacedG', mode: 'screen', result: 'rg' },
      { in: 'rg', in2: 'displacedB', mode: 'screen' },
    ]) {
      const blend = doc.createElementNS(svgNS, 'feBlend');
      for (const [key, value] of Object.entries(attributes)) blend.setAttribute(key, value);
      filter.append(blend);
    }
    defs.append(filter);
    const layer = doc.createElement('span');
    layer.className = 'liquid-glass-layer';
    layer.setAttribute('aria-hidden', 'true');
    records.set(element, { filter, image, displacements, layer, size: '' });
    update(element);
    resize?.observe(element, { box: 'border-box' });
    visibility?.observe(element);
  };
  const reconcile = () => {
    pending = null;
    if (disposed) return;
    const candidates = new Set([...doc.querySelectorAll(selector)].filter((el) => eligible(el, doc)));
    for (const element of records.keys())
      if (!element.isConnected || !candidates.has(element)) release(element);
    for (const element of candidates)
      if (!records.has(element)) add(element);
      else update(element);
  };
  const schedule = () => {
    if (!disposed && pending === null) pending = win.requestAnimationFrame(reconcile);
  };
  const cleanClass = (value) =>
    String(value || '')
      .split(/\s+/)
      .filter((x) => !x.startsWith('liquid-glass'))
      .join(' ');
  const mutations = new win.MutationObserver((entries) => {
    if (
      entries.some((entry) => {
        if (entry.target.closest?.(decoration)) return false;
        if (
          entry.type !== 'attributes' &&
          entry.target.closest?.('[contenteditable]:not([contenteditable="false"]), .editor-surface')
        )
          return false;
        if (entry.type === 'attributes')
          return (
            entry.attributeName !== 'class' ||
            cleanClass(entry.oldValue) !== cleanClass(entry.target.className)
          );
        return [...entry.addedNodes, ...entry.removedNodes].some(
          (node) => node.nodeType !== 1 || !node.matches(decoration),
        );
      })
    )
      schedule();
  });
  reconcile();
  mutations.observe(doc.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'hidden', 'open', 'contenteditable', 'data-liquid-glass'],
    attributeOldValue: true,
  });
  return () => {
    if (disposed) return;
    disposed = true;
    mutations.disconnect();
    resize?.disconnect();
    visibility?.disconnect();
    if (pending !== null) win.cancelAnimationFrame(pending);
    for (const element of [...records.keys()]) release(element);
    svg.remove();
  };
}

export function initLiquidGlass(doc = globalThis.document) {
  if (!doc?.body) return () => {};
  if (!instances.has(doc)) {
    const dispose = createLiquidGlass(doc);
    instances.set(doc, () => {
      dispose();
      instances.delete(doc);
    });
  }
  return instances.get(doc);
}
