import { planNarrativeTextEdit } from '../../contracts/narrative-operations.js';

/** Browsers can represent a text selection with its start at the end of the
 * preceding heading. Move such empty boundaries into the selected prose so
 * replacing it doesn't collapse the range outside its paragraph. */
export function normalizeAITextRange(range, root) {
  if (range.collapsed || !root.contains(range.commonAncestorContainer)) return range;
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* SHOW_TEXT */);
  let first = null,
    last = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest('button, .kai-remove-btn') || !range.intersectsNode(node)) continue;
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : node.length;
    if (end <= start || !node.textContent.slice(start, end).trim()) continue;
    if (!first) first = { node, offset: start };
    last = { node, offset: end };
  }
  if (!first) return range;
  const normalized = range.cloneRange();
  normalized.setStart(first.node, first.offset);
  normalized.setEnd(last.node, last.offset);
  return normalized;
}

/** Split multi-paragraph output into sibling blocks, keeping the original
 * paragraph (and its ID/temporal links) as the first block. */
export function applyAITextInBlock(range, text, root, continuation = false) {
  const working = range.cloneRange();
  if (continuation) working.collapse(false);
  else if (working.collapsed) return null;
  const blockOf = (node) =>
    (node.nodeType === 1 ? node : node.parentElement)?.closest('p, h1, h2, h3, h4, h5, blockquote, li, pre');
  const block = blockOf(working.startContainer);
  if (!block || !root.contains(block) || blockOf(working.endContainer) !== block) return null;
  const paragraphs =
    root.classList.contains('story-book-tree') || block.closest('.story-book-row')
      ? planNarrativeTextEdit(block.tagName, text).paragraphs
      : String(text)
          .split(/\r?\n\r?\n+/)
          .filter((p) => p.trim());
  if (!paragraphs.length) return null;
  const doc = root.ownerDocument;
  working.deleteContents();
  const first = doc.createTextNode((continuation && !/^\s/.test(paragraphs[0]) ? ' ' : '') + paragraphs[0]);
  working.insertNode(first);
  let lastText = first;
  if (paragraphs.length > 1) {
    const tailRange = doc.createRange();
    tailRange.selectNodeContents(block);
    tailRange.setStartAfter(first);
    const tail = tailRange.extractContents();
    // Ports and drag handles belong to their existing block, not its suffix.
    tail.querySelectorAll('button').forEach((button) => block.appendChild(button));
    let previous = block.parentElement?.classList.contains('story-book-row') ? block.parentElement : block;
    for (const paragraph of paragraphs.slice(1)) {
      const next = doc.createElement(root.classList.contains('screenplay-wysiwyg') ? block.tagName : 'p');
      lastText = doc.createTextNode(paragraph);
      next.appendChild(lastText);
      previous.after(next);
      previous = next;
    }
    previous.appendChild(tail);
  }
  working.setStart(first, 0);
  working.setEnd(lastText, lastText.length);
  if (continuation) working.collapse(false);
  return working;
}
