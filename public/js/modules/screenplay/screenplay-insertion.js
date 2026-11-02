import { renderIcon } from '../../icons.js';
import { safeHTML } from '../../safe-html.js';
import { EventBus } from '../../event-bus.js';

/** Only adjacent siblings of the same cinematic level form a valid insertion boundary. */
export function screenplayInsertionBoundaries(surface) {
  const pairs = [];
  const collect = (parent, selector, kind) => {
    const boxes = [...parent.querySelectorAll(':scope > ' + selector)];
    for (let i = 0; i < boxes.length - 1; i++) {
      const before = boxes[i],
        after = boxes[i + 1];
      if (
        before.nextElementSibling === after &&
        !before.closest('[hidden], [inert]') &&
        !after.closest('[hidden], [inert]')
      )
        pairs.push({ kind, before, after });
    }
  };
  for (const shot of surface.querySelectorAll('.screenplay-shot'))
    collect(shot, '.screenplay-dialogue', 'dialogue');
  for (const body of surface.querySelectorAll('.screenplay-scene__body'))
    collect(body, '.screenplay-shot', 'shot');
  collect(surface, '.screenplay-scene', 'scene');
  return pairs;
}

/** One transient overlay, with the same shared fusion SVG/styles used by Story Book. */
export function mountScreenplayInsertion(node, surface, insert) {
  const doc = surface.ownerDocument,
    win = doc.defaultView;
  const overlay = doc.createElement('div');
  overlay.className = 'story-book-insertion screenplay-insertion';
  overlay.contentEditable = 'false';
  overlay.hidden = true;
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'story-book-insertion__button';
  button.innerHTML = safeHTML(renderIcon('insert-paragraph', 64));
  const symbol = button.querySelector('svg');
  symbol.setAttribute('viewBox', '0 6 24 12');
  symbol.setAttribute('height', '32');
  overlay.append(button);
  node.append(overlay);
  let boundary = null,
    frame = null,
    disposed = false;
  const hide = () => {
    boundary = null;
    overlay.hidden = true;
    if (frame !== null) win.cancelAnimationFrame(frame);
    frame = null;
  };
  const update = (x, y) => {
    frame = null;
    if (disposed) return;
    const clip = surface.getBoundingClientRect();
    if (x < clip.left || x > clip.right || y < clip.top || y > clip.bottom) return hide();
    for (const candidate of screenplayInsertionBoundaries(surface)) {
      const a = candidate.before.getBoundingClientRect(),
        b = candidate.after.getBoundingClientRect();
      const left = Math.min(a.left, b.left),
        right = Math.max(a.right, b.right);
      if (!a.height || !b.height || b.top <= a.bottom || y < a.bottom || y > b.top || x < left || x > right)
        continue;
      const parent = node.getBoundingClientRect(),
        scale = parent.width / node.offsetWidth || 1;
      overlay.style.left = (left - parent.left) / scale + 'px';
      overlay.style.top = ((a.bottom + b.top) / 2 - parent.top) / scale + 'px';
      overlay.style.width = (right - left) / scale + 'px';
      const name = { scene: 'escena', shot: 'plano', dialogue: 'diálogo' }[candidate.kind];
      button.setAttribute('aria-label', 'Insertar ' + name + ' aquí');
      button.title = 'Insertar ' + name;
      boundary = candidate;
      overlay.hidden = false;
      return;
    }
    hide();
  };
  const pointer = (event) => {
    if (event.buttons || event.pointerType === 'touch') return hide();
    if (frame !== null) win.cancelAnimationFrame(frame);
    frame = win.requestAnimationFrame(() => update(event.clientX, event.clientY));
  };
  const leave = (event) => {
    if (!overlay.contains(event.relatedTarget)) hide();
  };
  overlay.addEventListener('pointerleave', (event) => {
    if (!surface.contains(event.relatedTarget)) hide();
  });
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const target = boundary;
    hide();
    if (disposed || !target) return;
    // Resolve adjacency again: edits/collapse/reordering can invalidate a previously hovered gap.
    if (
      !screenplayInsertionBoundaries(surface).some(
        (entry) =>
          entry.kind === target.kind && entry.before === target.before && entry.after === target.after,
      )
    )
      return;
    insert(target.kind, target.before, target.after);
  });
  const observer = new win.MutationObserver(hide);
  observer.observe(surface, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['hidden', 'inert'],
  });
  surface.addEventListener('pointermove', pointer);
  surface.addEventListener('pointerleave', leave);
  surface.addEventListener('scroll', hide);
  surface.addEventListener('dragstart', hide);
  win.addEventListener('resize', hide);
  EventBus.on('canvas:zoom', hide);
  return () => {
    disposed = true;
    hide();
    observer.disconnect();
    surface.removeEventListener('pointermove', pointer);
    surface.removeEventListener('pointerleave', leave);
    surface.removeEventListener('scroll', hide);
    surface.removeEventListener('dragstart', hide);
    win.removeEventListener('resize', hide);
    EventBus.off('canvas:zoom', hide);
    overlay.remove();
  };
}
