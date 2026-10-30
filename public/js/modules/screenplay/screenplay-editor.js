import { safeContent } from '../../safe-html.js';
import {
  SCREENPLAY_TYPES,
  screenplayBlockType,
  screenplayId,
  screenplayInlineHTML,
} from './screenplay-document.js';

const blockSelector = 'h1,h2,h3,h4,h5,p,blockquote';
function blockAt(node) {
  return (node?.nodeType === 1 ? node : node?.parentElement)?.closest(blockSelector);
}
function caret(block, end = false) {
  const selection = block.ownerDocument.defaultView.getSelection(),
    range = block.ownerDocument.createRange();
  range.selectNodeContents(block);
  range.collapse(!end);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Block conversion moves content and identity, so versions and AI targets remain stable. */
export function formatScreenplayBlocks(root, type) {
  const tag = type === 'scene' ? 'h2' : SCREENPLAY_TYPES[type];
  if (!tag) throw new Error('Tipo de bloque de guión inválido.');
  const selection = root.ownerDocument.defaultView.getSelection();
  if (!selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return;
  const blocks = [...root.querySelectorAll(blockSelector)].filter(
    (block) =>
      block.tagName !== 'H1' &&
      (range.collapsed ? block === blockAt(range.startContainer) : range.intersectsNode(block)),
  );
  let first, last;
  for (const block of blocks) {
    const next = root.ownerDocument.createElement(tag);
    next.dataset.kaiId = block.dataset.kaiId || screenplayId();
    if (block.getAttribute('style')) next.setAttribute('style', block.getAttribute('style'));
    if (block.querySelector('[data-screenplay-controls]'))
      next.innerHTML = safeContent(screenplayInlineHTML(block));
    else next.append(...block.childNodes);
    block.replaceWith(next);
    first ||= next;
    last = next;
  }
  if (first) {
    const restored = root.ownerDocument.createRange();
    restored.selectNodeContents(first);
    if (!range.collapsed) restored.setEnd(last, last.childNodes.length);
    else restored.collapse(false);
    selection.removeAllRanges();
    selection.addRange(restored);
  }
}

/** Enter splits synchronously. Shift+Enter remains an internal line break. IME is untouched. */
export function handleScreenplayKey(event, root, changed) {
  if (
    !root ||
    event.isComposing ||
    event.key !== 'Enter' ||
    event.shiftKey ||
    event.ctrlKey ||
    event.altKey ||
    event.metaKey
  )
    return false;
  const selection = root.ownerDocument.defaultView.getSelection();
  if (!selection?.rangeCount) return false;
  const range = selection.getRangeAt(0),
    block = blockAt(range.startContainer);
  if (!block || !root.contains(block) || blockAt(range.endContainer) !== block) return false;
  event.preventDefault();
  range.deleteContents();
  const suffix = range.cloneRange();
  const editable = block.querySelector('[data-screenplay-name]') || block;
  suffix.setEnd(editable, editable.childNodes.length);
  const tail = suffix.extractContents(),
    type = screenplayBlockType(block);
  const nextType = ['character', 'parenthetical'].includes(type)
    ? 'dialogue'
    : type === 'dialogue' && block.textContent.trim()
      ? 'dialogue'
      : 'action';
  const next = root.ownerDocument.createElement(SCREENPLAY_TYPES[nextType]);
  next.dataset.kaiId = screenplayId();
  if (block.closest('.screenplay-scene')) next.contentEditable = 'true';
  next.append(tail);
  if (!next.childNodes.length) next.append(root.ownerDocument.createElement('br'));
  if (!block.childNodes.length) block.append(root.ownerDocument.createElement('br'));
  // An empty dialogue ends the dialogue run and becomes the next action.
  if (type === 'dialogue' && !block.textContent.trim()) {
    block.replaceWith(next);
  } else block.after(next);
  caret(next);
  changed();
  return true;
}
