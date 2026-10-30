import { narrativeBlockKind } from '../../contracts/narrative-operations.js';
/** Editor-only rows. Semantic blocks and their IDs remain the document boundary. */
export function storyBookRow(block) {
  return block?.closest?.('.story-book-row') || block;
}

export function storyBookHeading(group) {
  return group?.querySelector(
    ':scope > .story-book-row > h2, :scope > .story-book-row > h3, :scope > h2, :scope > h3',
  );
}

export function storyBookBlockFromTarget(target) {
  const row = target?.closest?.('.story-book-row');
  return (
    row?.querySelector(':scope > .story-book-row__text') ||
    target?.closest?.('p, blockquote, pre, ul, ol, h4') ||
    null
  );
}

/** Idempotently separate controls from text without recreating text or selections. */
export function ensureStoryBookRows(container, { editable = true } = {}) {
  if (!container) return;
  const selector = 'h1, h2, h3, h4, p, blockquote, pre, ul, ol';
  const blocks = [...container.querySelectorAll(selector)].filter(
    (block) => !block.parentElement.closest(selector),
  );
  for (const block of blocks) {
    let row = block.parentElement;
    if (!row.classList.contains('story-book-row')) {
      row = block.ownerDocument.createElement('div');
      row.className = 'story-book-row';
      block.before(row);
      row.append(block);
    }
    row.contentEditable = 'false';
    const kind =
      block.tagName === 'H1'
        ? 'title'
        : block.tagName === 'H2'
          ? 'chapter'
          : block.tagName === 'H3'
            ? 'theme'
            : 'paragraph';
    row.dataset.storyRowKind = kind;
    block.classList.add('story-book-row__text');
    block.contentEditable = String(editable);
    if (kind === 'title' || !editable) {
      row
        .querySelectorAll(':scope > .story-book-row__ports, :scope > .story-book-row__drag')
        .forEach((slot) => slot.remove());
      continue;
    }
    for (const slot of ['ports', 'drag']) {
      let host = row.querySelector(`:scope > .story-book-row__${slot}`);
      if (!host) {
        host = block.ownerDocument.createElement('div');
        host.className = `story-book-row__${slot}`;
        host.contentEditable = 'false';
        if (slot === 'ports') row.prepend(host);
        else row.append(host);
      }
      const control =
        slot === 'ports' ? '.story-book-node-port, .story-book-tree-toggle' : '.story-book-tree-drag-handle';
      block.querySelectorAll(control).forEach((element) => host.append(element));
    }
  }
  // Removing a block must not leave an empty row or a stale interactive port.
  container.querySelectorAll('.story-book-row').forEach((row) => {
    if (!row.querySelector(':scope > .story-book-row__text')) row.remove();
  });
  // A moved/deleted orphan must not leave an empty implicit container to be parsed as a new paragraph.
  [...container.querySelectorAll('[data-story-implicit="true"]')].reverse().forEach((group) => {
    if (
      !group.querySelector(selector) &&
      !group.textContent.trim() &&
      !group.querySelector('img,video,audio,canvas,svg')
    )
      group.remove();
  });
}

/** Remove the whole row, not just its editing host, and retain a sensible caret destination. */
export function deleteStoryBookParagraph(container, id) {
  const blocks = [...container.querySelectorAll('.story-book-row__text')];
  const index = blocks.findIndex((block) => block.dataset.kaiId === id);
  const block = blocks[index];
  if (narrativeBlockKind(block?.tagName) !== 'paragraph' || block.closest('[hidden], [inert]')) return null;
  const visible = (element) => element && !element.closest('[hidden], [inert]');
  const previous = blocks.slice(0, index).reverse().find(visible);
  const next = blocks.slice(index + 1).find(visible);
  storyBookRow(block).remove();
  ensureStoryBookRows(container);
  return { focusId: (previous || next)?.dataset.kaiId, atEnd: Boolean(previous) };
}

export function storyBookRowsNeedRebuild(container) {
  if (
    [...container.querySelectorAll('.story-book-tree-chapter, .story-book-tree-theme')].some(
      (group) => !storyBookHeading(group) && group.dataset.storyImplicit !== 'true',
    )
  )
    return true;
  return [...container.querySelectorAll('.story-book-row')].some((row) => {
    const text = row.querySelector(':scope > .story-book-row__text');
    const parent = row.parentElement;
    if (!text) return true;
    if (text.tagName === 'H1') return parent !== container;
    if (text.tagName === 'H2')
      return !parent.classList.contains('story-book-tree-chapter') || storyBookHeading(parent) !== text;
    if (text.tagName === 'H3')
      return !parent.classList.contains('story-book-tree-theme') || storyBookHeading(parent) !== text;
    return (
      !parent.classList.contains('story-book-tree-content') ||
      !parent.parentElement.classList.contains('story-book-tree-theme') ||
      (text.tagName === 'P' && Boolean(text.querySelector('div,p,h1,h2,h3,blockquote,pre,ul,ol')))
    );
  });
}

/** Native editing only replaces the first host in a cross-row selection. */
export function replaceStoryBookCrossRowSelection(container, range, text = '') {
  const blockOf = (node) =>
    (node.nodeType === 1 ? node : node.parentElement)?.closest('.story-book-row__text');
  const first = blockOf(range.startContainer),
    last = blockOf(range.endContainer);
  if (!first || !last || first === last || !container.contains(first) || !container.contains(last))
    return null;
  const doc = container.ownerDocument;
  const prefix = doc.createRange();
  prefix.selectNodeContents(first);
  prefix.setEnd(range.startContainer, range.startOffset);
  const suffix = doc.createRange();
  suffix.selectNodeContents(last);
  suffix.setStart(range.endContainer, range.endOffset);
  const before = prefix.cloneContents(),
    after = suffix.cloneContents();
  const blocks = [...container.querySelectorAll('.story-book-row__text')];
  blocks
    .slice(blocks.indexOf(first) + 1, blocks.indexOf(last) + 1)
    .forEach((block) => storyBookRow(block).remove());
  const insertion = doc.createTextNode(text);
  first.replaceChildren(before, insertion, after);
  const caret = doc.createRange();
  caret.setStart(insertion, insertion.length);
  caret.collapse(true);
  return caret;
}

export function captureStoryBookSelection(container) {
  const selection = container.ownerDocument.defaultView.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const position = (node, offset) => {
    const element = node.nodeType === 1 ? node : node.parentElement;
    const block = element?.closest('.story-book-row__text');
    if (!block || !container.contains(block)) return null;
    const prefix = container.ownerDocument.createRange();
    prefix.selectNodeContents(block);
    prefix.setEnd(node, offset);
    const content = prefix.cloneContents();
    content.querySelectorAll('button').forEach((button) => button.remove());
    return { id: block.dataset.kaiId, offset: content.textContent.length };
  };
  const start = position(range.startContainer, range.startOffset);
  const end = position(range.endContainer, range.endOffset);
  return start && end ? { start, end } : null;
}

export function restoreStoryBookSelection(container, saved) {
  if (!saved) return;
  const position = ({ id, offset }) => {
    const block = [...container.querySelectorAll('.story-book-row__text')].find(
      (item) => item.dataset.kaiId === id,
    );
    if (!block) return null;
    const walker = container.ownerDocument.createTreeWalker(block, 4);
    let remaining = offset;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement.closest('button')) continue;
      if (remaining <= node.length) return { block, node, offset: remaining };
      remaining -= node.length;
    }
    return { block, node: block, offset: block.childNodes.length };
  };
  const start = position(saved.start),
    end = position(saved.end);
  if (!start || !end) return;
  start.block.focus({ preventScroll: true });
  const range = container.ownerDocument.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  const selection = container.ownerDocument.defaultView.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Cross editing-host boundaries only at the edge of a line/block. */
export function navigateStoryBookSelection(container, block, range, key) {
  const doc = container.ownerDocument;
  const nodes = [];
  const walker = doc.createTreeWalker(block, 4);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.length && !node.parentElement.closest('button')) nodes.push(node);
  }
  const backwards = key === 'ArrowLeft' || key === 'ArrowUp';
  const vertical = key === 'ArrowUp' || key === 'ArrowDown';
  const boundary = range.cloneRange();
  boundary.selectNodeContents(block);
  if (backwards) boundary.setEnd(range.startContainer, range.startOffset);
  else boundary.setStart(range.startContainer, range.startOffset);
  let caretRect = range.getBoundingClientRect();
  if (!caretRect.height && nodes.length) {
    const prefix = range.cloneRange();
    prefix.selectNodeContents(block);
    prefix.setEnd(range.startContainer, range.startOffset);
    let offset = prefix.toString().length;
    for (const node of nodes) {
      if (offset > node.length) {
        offset -= node.length;
        continue;
      }
      const character = doc.createRange();
      character.setStart(node, Math.min(offset, node.length - 1));
      character.setEnd(node, Math.min(offset + 1, node.length));
      const rect = character.getBoundingClientRect();
      caretRect = {
        top: rect.top,
        height: rect.height,
        left: offset === node.length ? rect.right : rect.left,
      };
      break;
    }
  }
  if (vertical && nodes.length) {
    const edge = doc.createRange();
    const node = backwards ? nodes[0] : nodes.at(-1);
    edge.setStart(node, backwards ? 0 : node.length - 1);
    edge.setEnd(node, backwards ? 1 : node.length);
    const edgeRect = edge.getBoundingClientRect();
    if (Math.abs(caretRect.top - edgeRect.top) > edgeRect.height / 2) return false;
  } else if (boundary.toString().length) return false;
  const blocks = [...container.querySelectorAll('.story-book-row__text')].filter(
    (text) => !text.closest('[hidden], [inert]'),
  );
  const target = blocks[blocks.indexOf(block) + (backwards ? -1 : 1)];
  if (!target) return false;
  target.scrollIntoView({ block: 'nearest' });
  target.focus({ preventScroll: true });
  const next = doc.createRange();
  next.selectNodeContents(target);
  next.collapse(!backwards);
  const selection = doc.defaultView.getSelection();
  selection.removeAllRanges();
  selection.addRange(next);
  return true;
}
