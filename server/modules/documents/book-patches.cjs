const { randomUUID } = require('node:crypto');
const escape = (s) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const text = (v, max = 20000) => {
  if (typeof v !== 'string' || !v.trim() || v.length > max)
    throw Error('El modelo devolvió texto incompleto.');
  return v.trim();
};
const node = (type, value, order, tag) => {
  const id = type + '_' + randomUUID();
  return {
    id,
    type,
    text: value,
    html: `<${tag} data-kai-id="${id}">${escape(value)}</${tag}>`,
    order,
    properties: {},
  };
};
function applyBookAgentPatch(book, patch) {
  const next = JSON.parse(JSON.stringify(book));
  if (patch.type === 'append') {
    const chapter = {
      id: 'chapter_' + randomUUID(),
      type: 'chapter',
      order: next.chapters.length,
      title: node('chapter-title', text(patch.title, 300), 0, 'h2'),
      properties: {},
      themes: [],
    };
    if (!Array.isArray(patch.themes) || !patch.themes.length || patch.themes.length > 12)
      throw Error('Faltan temas del capítulo.');
    chapter.themes = patch.themes.map((t, order) => {
      if (!Array.isArray(t.paragraphs) || !t.paragraphs.length || t.paragraphs.length > 150)
        throw Error('Faltan párrafos del tema.');
      return {
        id: 'theme_' + randomUUID(),
        type: 'theme',
        order,
        title: node('theme-title', text(t.title, 300), 0, 'h3'),
        properties: {},
        paragraphs: t.paragraphs.map((p, i) => ({ ...node('paragraph', text(p), i, 'p'), element: 'p' })),
      };
    });
    next.chapters.push(chapter);
  } else if (patch.type === 'extend') {
    const chapter = next.chapters.find((c) => c.id === patch.chapterId);
    if (
      !chapter ||
      !Array.isArray(patch.paragraphs) ||
      !patch.paragraphs.length ||
      patch.paragraphs.length > 150
    )
      throw Error('Ampliación inválida.');
    chapter.themes.push({
      id: 'theme_' + randomUUID(),
      type: 'theme',
      order: chapter.themes.length,
      title: node('theme-title', text(patch.title, 300), 0, 'h3'),
      properties: {},
      paragraphs: patch.paragraphs.map((p, i) => ({ ...node('paragraph', text(p), i, 'p'), element: 'p' })),
    });
  } else if (patch.type === 'revise') {
    if (!Array.isArray(patch.replacements) || patch.replacements.length > 100)
      throw Error('Revisión inválida.');
    if (patch.titles !== undefined) {
      if (!Array.isArray(patch.titles) || patch.titles.length > 100) throw Error('Títulos inválidos.');
      const titles = [
        next.title,
        ...next.chapters.flatMap((c) => [c.title, ...c.themes.map((t) => t.title)]),
      ];
      const seenTitles = new Set();
      for (const change of patch.titles) {
        const title = titles.find((t) => t.id === change.id);
        if (
          !title ||
          !(patch.allowedTitleIds || []).includes(change.id) ||
          seenTitles.has(change.id) ||
          /kai-block|data-block/i.test(title.html || '')
        )
          throw Error('El título está protegido o fuera del alcance.');
        seenTitles.add(change.id);
        title.text = text(change.text, 300);
        const tag = title === next.title ? 'h1' : title.type === 'chapter-title' ? 'h2' : 'h3';
        title.html = `<${tag} data-kai-id="${title.id}">${escape(title.text)}</${tag}>`;
      }
    }
    const allowed = new Set(patch.allowedIds || []);
    const seen = new Set();
    for (const r of patch.replacements) {
      if (seen.has(r.id) || !allowed.has(r.id)) throw Error('La revisión apunta fuera del capítulo.');
      seen.add(r.id);
      const p = next.chapters
        .flatMap((c) => c.themes.flatMap((t) => t.paragraphs))
        .find((p) => p.id === r.id);
      if (!p || /kai-block|data-block/i.test(p.html || ''))
        throw Error('La revisión modifica un fragmento protegido.');
      p.text = text(r.text);
      p.html = `<p data-kai-id="${p.id}">${escape(p.text)}</p>`;
    }
  } else throw Error('Operación de libro inválida.');
  return next;
}

module.exports = { applyBookAgentPatch };
