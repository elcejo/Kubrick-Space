import { renderIcon } from '../../icons.js';
import { safeHTML } from '../../safe-html.js';
import { EventBus } from '../../event-bus.js';
import { ensureStoryBookRows, storyBookRow } from './story-book-rows.js';
import { canInsertNarrativeParagraph } from '../../contracts/narrative-operations.js';

function visibleBlocks(surface) {
  return [...surface.querySelectorAll('.story-book-row__text')].filter(
    (block) => !block.closest('[hidden], [inert]'),
  );
}

/** The title and chapter boundaries are structural, never paragraph insertion targets. */
export function canInsertStoryBookParagraph(before, after) {
  return canInsertNarrativeParagraph(before?.tagName, after?.tagName);
}

/** Insert at a live semantic boundary; editor controls never enter document content. */
export function insertStoryBookParagraphBetween(surface, beforeId, afterId) {
  const blocks = visibleBlocks(surface);
  const index = blocks.findIndex((block) => block.dataset.kaiId === beforeId);
  const before = blocks[index];
  const after = blocks[index + 1];
  if (after?.dataset.kaiId !== afterId || !canInsertStoryBookParagraph(before, after)) return null;
  const doc = surface.ownerDocument;
  const paragraph = doc.createElement('p');
  paragraph.dataset.kaiId = `node-${doc.defaultView.crypto.randomUUID()}`;
  paragraph.append(doc.createElement('br'));
  const row = storyBookRow(before);
  if (before.matches('h3')) {
    const group = row.parentElement;
    // A new block after a collapsed heading must be visible immediately.
    if (group.classList.contains('is-collapsed')) row.querySelector('.story-book-tree-toggle')?.click();
    const content = group.querySelector(':scope > .story-book-tree-content');
    if (content) content.prepend(paragraph);
    else row.after(paragraph);
  } else row.after(paragraph);
  ensureStoryBookRows(surface);
  return paragraph;
}

function focusParagraph(paragraph) {
  if (!paragraph) return;
  const doc = paragraph.ownerDocument;
  paragraph.focus({ preventScroll: true });
  const range = doc.createRange();
  range.selectNodeContents(paragraph);
  range.collapse(true);
  const selection = doc.defaultView.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

/** One ephemeral overlay serves every visible gap, without changing layout or saved HTML. */
export function mountStoryBookInsertion(node, surface, changed) {
  const doc = surface.ownerDocument;
  const win = doc.defaultView;
  const overlay = doc.createElement('div');
  overlay.className = 'story-book-insertion';
  overlay.contentEditable = 'false';
  overlay.hidden = true;
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'story-book-insertion__button';
  button.setAttribute('aria-label', 'Insertar párrafo aquí');
  button.title = 'Insertar párrafo';
  button.innerHTML = safeHTML(renderIcon('insert-paragraph', 64));
  // Crop the registry's square viewport to its horizontal silhouette, keeping the drawing shared.
  const symbol = button.querySelector('svg');
  symbol.setAttribute('viewBox', '0 6 24 12');
  symbol.setAttribute('height', '32');
  overlay.append(button);
  node.append(overlay);
  let boundary = null;
  let frame = null;
  let disposed = false;
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
    const blocks = visibleBlocks(surface)
      .map((block) => ({ block, rect: storyBookRow(block).getBoundingClientRect() }))
      .filter(({ rect }) => rect.height > 0);
    for (let i = 0; i < blocks.length - 1; i++) {
      const before = blocks[i];
      const after = blocks[i + 1];
      const left = Math.min(before.rect.left, after.rect.left);
      const right = Math.max(before.rect.right, after.rect.right);
      if (
        !canInsertStoryBookParagraph(before.block, after.block) ||
        before.rect.bottom < clip.top ||
        after.rect.top > clip.bottom ||
        y < before.rect.bottom ||
        y > after.rect.top ||
        x < clip.left ||
        x > clip.right ||
        after.rect.top <= before.rect.bottom
      )
        continue;
      const parent = node.getBoundingClientRect();
      const scale = parent.width / node.offsetWidth || 1;
      overlay.style.left = `${(left - parent.left) / scale}px`;
      overlay.style.top = `${((before.rect.bottom + after.rect.top) / 2 - parent.top) / scale}px`;
      overlay.style.width = `${(right - left) / scale}px`;
      boundary = { before: before.block.dataset.kaiId, after: after.block.dataset.kaiId };
      overlay.hidden = false;
      return;
    }
    hide();
  };
  const pointer = (event) => {
    if (event.buttons || event.pointerType === 'touch') {
      hide();
      return;
    }
    if (frame !== null) win.cancelAnimationFrame(frame);
    frame = win.requestAnimationFrame(() => update(event.clientX, event.clientY));
  };
  const leave = (event) => {
    if (!overlay.contains(event.relatedTarget)) hide();
  };
  const leaveButton = (event) => {
    if (!surface.contains(event.relatedTarget)) hide();
  };
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const target = boundary;
    hide();
    if (!target || disposed) return;
    const paragraph = insertStoryBookParagraphBetween(surface, target.before, target.after);
    if (!paragraph) return;
    const id = paragraph.dataset.kaiId;
    focusParagraph(paragraph);
    changed();
    // Heading boundaries may rebuild the editor tree. Resolve the new live host by ID.
    focusParagraph(
      [...surface.querySelectorAll('.story-book-row__text')].find((block) => block.dataset.kaiId === id),
    );
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
  overlay.addEventListener('pointerleave', leaveButton);
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
