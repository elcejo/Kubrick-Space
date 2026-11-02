/** Presentation-only grouping. Canonical screenplay blocks and their IDs stay untouched. */
export function screenplayProjectionNodes(parent) {
  return [...parent.childNodes]
    .filter((node) => !(node.nodeType === 1 && node.matches('.screenplay-remove')))
    .flatMap((node) =>
      node.nodeType === 1 && node.matches('.screenplay-shot, .screenplay-dialogue')
        ? screenplayProjectionNodes(node)
        : [node],
    );
}

function syncChildren(parent, wanted) {
  wanted = [...parent.children].filter((node) => node.matches('.screenplay-remove')).concat(wanted);
  wanted.forEach((node, index) => {
    if (parent.childNodes[index] !== node) parent.insertBefore(node, parent.childNodes[index] || null);
  });
  while (parent.childNodes.length > wanted.length) parent.lastChild.remove();
}

/** Reconcile only changed boundaries; never recreate editable fields or their listeners. */
export function arrangeScreenplayBlocks(body) {
  const doc = body.ownerDocument;
  const selection = doc.defaultView.getSelection();
  const saved =
    selection?.rangeCount && body.contains(selection.anchorNode)
      ? [selection.anchorNode, selection.anchorOffset, selection.focusNode, selection.focusOffset]
      : null;
  const active = body.contains(doc.activeElement) ? doc.activeElement : null;
  const caret =
    active && typeof active.selectionStart === 'number'
      ? [active.selectionStart, active.selectionEnd, active.selectionDirection]
      : null;
  const shots = new Map(
    [...body.querySelectorAll('.screenplay-shot')].map((node) => [node.dataset.shotId, node]),
  );
  const dialogues = new Map(
    [...body.querySelectorAll('.screenplay-dialogue')].map((node) => [node.dataset.dialogueId, node]),
  );
  const box = (className, key, id, cache) => {
    const element = cache.get(id) || doc.createElement('div');
    element.className = className;
    element.dataset[key] = id;
    element.contentEditable = 'false';
    return element;
  };
  const runs = [];
  let shot = null;
  for (const node of screenplayProjectionNodes(body)) {
    if (node.nodeType === 1 && node.tagName === 'H6') {
      shot = { heading: node, nodes: [] };
      runs.push(shot);
    }
    if (shot) shot.nodes.push(node);
    else runs.push({ nodes: [node] });
  }
  const wanted = runs.flatMap((run) => {
    if (!run.heading) return run.nodes;
    const children = [];
    let speech = null;
    for (const node of run.nodes) {
      if (node.nodeType === 1 && node.tagName === 'H3') {
        speech = [];
        children.push(speech);
      } else if (node.nodeType === 1 && !['H4', 'BLOCKQUOTE'].includes(node.tagName)) {
        speech = null;
      }
      if (speech) speech.push(node);
      else children.push(node);
    }
    const grouped = children.map((item) => {
      if (!Array.isArray(item)) return item;
      const wrapper = box('screenplay-dialogue', 'dialogueId', item[0].dataset.kaiId, dialogues);
      syncChildren(wrapper, item);
      return wrapper;
    });
    const wrapper = box('screenplay-shot', 'shotId', run.heading.dataset.kaiId, shots);
    syncChildren(wrapper, grouped);
    return wrapper;
  });
  syncChildren(body, wanted);
  if (active?.isConnected && doc.activeElement !== active) {
    active.focus({ preventScroll: true });
    if (caret) active.setSelectionRange(...caret);
  }
  if (saved && body.contains(saved[0]) && body.contains(saved[2])) {
    // Moving existing nodes may clear the native range. Restoring the same range is harmless.
    try {
      selection.setBaseAndExtent(...saved);
    } catch {
      /* An explicit edit removed the range. */
    }
  }
}
