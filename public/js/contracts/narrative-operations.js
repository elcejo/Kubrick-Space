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

/** Resolve a paragraph by stable ID; headings and other assets are never paragraph targets. */
export function narrativeParagraph(document, id) {
  if (document?.schema !== 'code-kai.story-book' || typeof id !== 'string') return null;
  return (
    document.chapters
      ?.flatMap((chapter) => chapter.themes?.flatMap((theme) => theme.paragraphs || []) || [])
      .find((paragraph) => paragraph.id === id) || null
  );
}

/** A stable narrative scope. The book title is not an attachable chapter/theme. */
export function narrativeSelection(document, id) {
  if (document?.schema !== 'code-kai.story-book' || typeof id !== 'string') return null;
  const themeIds = (themes) => themes.map((theme) => theme.id);
  const textIds = (themes) =>
    themes
      .flatMap((theme) => [theme.title?.id, ...(theme.paragraphs || []).map((p) => p.id)])
      .filter(Boolean);
  for (const chapter of document.chapters || []) {
    if (id === chapter.id || id === chapter.title?.id)
      return {
        id,
        kind: 'chapter',
        text: chapter.title?.text || '',
        chapterId: chapter.id,
        editableIds: [chapter.title?.id, ...textIds(chapter.themes || [])].filter(Boolean),
        themeIds: themeIds(chapter.themes || []),
      };
    for (const theme of chapter.themes || []) {
      if (id === theme.id || id === theme.title?.id)
        return {
          id,
          kind: 'theme',
          text: theme.title?.text || '',
          chapterId: chapter.id,
          editableIds: textIds([theme]),
          themeIds: [theme.id],
        };
      const paragraph = (theme.paragraphs || []).find((p) => p.id === id);
      if (paragraph) return { id, kind: 'paragraph', text: paragraph.text, editableIds: [id], themeIds: [] };
    }
  }
  return null;
}

/** Narrow existing operations to the selected subtree before any writes or resources. */
export function narrativeScopeAllows(scope, operation) {
  if (!scope || !operation) return false;
  if (scope.kind === 'paragraph') return operation.op === 'replace_text' && operation.id === scope.id;
  if (
    ['replace_text', 'format_text', 'tag_term', 'untag_term', 'protect_text', 'unprotect_text'].includes(
      operation.op,
    )
  )
    return scope.editableIds.includes(operation.id);
  if (operation.op === 'insert_paragraph')
    return (
      scope.themeIds.includes(operation.themeId) &&
      (operation.afterId == null || scope.editableIds.includes(operation.afterId))
    );
  if (operation.op === 'insert_theme')
    return (
      scope.kind === 'chapter' &&
      operation.chapterId === scope.chapterId &&
      (operation.afterId == null || scope.themeIds.includes(operation.afterId))
    );
  return false;
}
