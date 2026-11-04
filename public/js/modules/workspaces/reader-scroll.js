/**
 * Where the reader is: the scroll of the editor node, of what scrolls around it, and of every scrolling element
 * inside it (matched by class and position, since a redraw replaces them).
 */
export function captureScroll(node) {
  const positions = [];
  for (let el = node; el && el !== node.ownerDocument.documentElement; el = el.parentElement)
    if (el.scrollTop || el.scrollLeft) positions.push({ el, top: el.scrollTop, left: el.scrollLeft });
  const inner = [];
  const counts = new Map();
  for (const el of node?.querySelectorAll('*') || []) {
    const key = el.className?.toString() || el.localName;
    const index = counts.get(key) || 0;
    counts.set(key, index + 1);
    if (el.scrollTop || el.scrollLeft) inner.push({ key, index, top: el.scrollTop, left: el.scrollLeft });
  }
  return { node, positions, inner };
}
/** Puts the reader back after a redraw, and again once the new layout has settled. */
export function restoreScroll(reader) {
  if (!reader?.node) return;
  const apply = () => {
    for (const { el, top, left } of reader.positions) {
      if (el.scrollTop < top) el.scrollTop = top;
      if (el.scrollLeft < left) el.scrollLeft = left;
    }
    if (!reader.inner.length) return;
    const counts = new Map();
    const wanted = new Map(reader.inner.map((entry) => [entry.key + '\u0000' + entry.index, entry]));
    for (const el of reader.node.querySelectorAll('*')) {
      const key = el.className?.toString() || el.localName;
      const index = counts.get(key) || 0;
      counts.set(key, index + 1);
      const entry = wanted.get(key + '\u0000' + index);
      if (!entry) continue;
      if (el.scrollTop < entry.top) el.scrollTop = entry.top;
      if (el.scrollLeft < entry.left) el.scrollLeft = entry.left;
    }
  };
  apply();
  globalThis.requestAnimationFrame?.(apply);
}
