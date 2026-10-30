/** Semantic editing rules shared by manual controls and AI text adapters. */
export function narrativeBlockKind(tag) {
  const value = String(tag || '').toLowerCase();
  if (value === 'h1') return 'title';
  if (value === 'h2') return 'chapter';
  if (value === 'h3') return 'theme';
  return ['p', 'blockquote', 'pre', 'ul', 'ol', 'h4'].includes(value) ? 'paragraph' : null;
}

export function canInsertNarrativeParagraph(beforeTag, afterTag) {
  const before = narrativeBlockKind(beforeTag),
    after = narrativeBlockKind(afterTag);
  if (!beforeTag || !afterTag || ['title', 'chapter'].includes(before) || after === 'title') return false;
  return before === 'theme' || before === 'paragraph' || after === 'paragraph';
}

export function canMoveNarrativeBlock(kind, sourceId, targetId) {
  return (
    ['chapter', 'theme', 'paragraph'].includes(kind) && Boolean(sourceId && targetId && sourceId !== targetId)
  );
}

export function planNarrativeTextEdit(tag, text) {
  let paragraphs = String(text)
    .split(/\r?\n\r?\n+/)
    .filter((value) => value.trim());
  // A text edit of a title/chapter cannot create orphan paragraphs before a theme.
  if (['title', 'chapter'].includes(narrativeBlockKind(tag)) && paragraphs.length > 1)
    paragraphs = [paragraphs.join('\n')];
  return { paragraphs, siblingTag: 'p' };
}
