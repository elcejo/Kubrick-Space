/**
 * The inline marks of a paragraph, edited as a person edits them with the editor's toolbar: bold, italic, underline,
 * strikethrough, text color and highlight, the author's terms with their definition (tags) and protected text (blocks).
 *
 * The paragraph's HTML is read into runs of text with their marks, the marks of the chosen text are changed, and the
 * runs are written back as HTML again. Nothing here accepts HTML from a model: it names a piece of the text and what to
 * do to it. A paragraph that holds anything the engine cannot keep exactly (links, line breaks, unknown tags) is
 * refused, so that no formatting is ever lost silently.
 */
const fail = (message) => {
  throw Object.assign(Error(message), { status: 422 });
};
const escape = (value) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const decode = (value) =>
  value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&#x27;', "'")
    .replaceAll('&nbsp;', '\u00a0')
    .replaceAll('&amp;', '&');
const COLOR = /^(?:#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]+)$/i;
const HEX = /^#[0-9a-f]{6}$/i;
const UNKEPT =
  'El párrafo tiene un formato que el asistente no puede conservar (enlaces, saltos de línea u otros).';
const attribute = (source, name) => {
  const match = new RegExp('\\b' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', 'i').exec(source);
  return match ? decode(match[1] ?? match[2] ?? '') : undefined;
};

/** The marks a tag opens, or null when the engine does not know the tag. */
function marksOf(name, source) {
  const marks = {};
  if (name === 'b' || name === 'strong') marks.bold = true;
  else if (name === 'i' || name === 'em') marks.italic = true;
  else if (name === 'u') marks.underline = true;
  else if (name === 's' || name === 'strike') marks.strike = true;
  else if (name === 'font') {
    const color = attribute(source, 'color');
    if (color && COLOR.test(color)) marks.color = color;
  } else if (name === 'tag') marks.tag = { term: '', definition: attribute(source, 'definition') || '' };
  else if (name === 'span') {
    const classes = (attribute(source, 'class') || '').split(/\s+/);
    if (classes.includes('kai-tag'))
      marks.tag = {
        term: attribute(source, 'data-tag') || '',
        definition: attribute(source, 'data-definition') || '',
      };
    if (classes.includes('kai-block')) marks.block = true;
    for (const declaration of (attribute(source, 'style') || '').split(';')) {
      const [property, value = ''] = declaration.split(':').map((part) => part.trim());
      if (property === 'font-weight' && /^(bold|[6-9]00)$/.test(value)) marks.bold = true;
      else if (property === 'font-style' && /^(italic|oblique)$/.test(value)) marks.italic = true;
      else if (property === 'text-decoration' && /underline/.test(value)) marks.underline = true;
      else if (property === 'text-decoration' && /line-through/.test(value)) marks.strike = true;
      else if (property === 'color' && COLOR.test(value)) marks.color = value;
      else if (property === 'background-color' && COLOR.test(value)) marks.highlight = value;
    }
  } else return null;
  return marks;
}

/** [{text, marks}] for the inline HTML of a paragraph; fails for what it cannot keep exactly. */
function readRuns(inner) {
  const runs = [];
  const stack = [];
  const current = () => Object.assign({}, ...stack.map((item) => item.marks));
  for (const token of inner.match(/<\/?[a-zA-Z][^>]*>|[^<]+/g) || []) {
    if (token[0] !== '<') {
      const text = decode(token);
      if (text) runs.push({ text, marks: current() });
      continue;
    }
    const name = /^<\/?([a-zA-Z0-9]+)/.exec(token)[1].toLowerCase();
    if (token[1] === '/') {
      if (stack.pop()?.name !== name) fail(UNKEPT);
      continue;
    }
    const marks = marksOf(name, token);
    if (!marks || /\/>$/.test(token)) fail(UNKEPT);
    stack.push({ name, marks });
  }
  if (stack.length) fail(UNKEPT);
  return runs;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const merged = (runs) => {
  const out = [];
  for (const run of runs) {
    if (!run.text) continue;
    const last = out.at(-1);
    if (last && same(last.marks, run.marks)) last.text += run.text;
    else out.push({ text: run.text, marks: { ...run.marks } });
  }
  return out;
};

/** The runs as HTML: terms and protected text outermost, then color and highlight, then the weights. */
function writeRuns(runs) {
  return merged(runs)
    .map(({ text, marks }) => {
      let html = escape(text);
      if (marks.strike) html = `<s>${html}</s>`;
      if (marks.underline) html = `<u>${html}</u>`;
      if (marks.italic) html = `<i>${html}</i>`;
      if (marks.bold) html = `<b>${html}</b>`;
      const style = [
        marks.color ? `color:${marks.color}` : '',
        marks.highlight ? `background-color:${marks.highlight}` : '',
      ].filter(Boolean);
      if (style.length) html = `<span style="${style.join(';')}">${html}</span>`;
      if (marks.block) html = `<span class="kai-block">${html}</span>`;
      if (marks.tag) {
        const term = marks.tag.term || text;
        html = `<span class="kai-tag" spellcheck="false" data-tag="${escape(term)}" data-definition="${escape(marks.tag.definition)}">${html}</span>`;
      }
      return html;
    })
    .join('');
}

/** The runs cut at both ends of [from, to), so that the text between them is made of whole runs. */
function cut(runs, from, to) {
  const out = [];
  let offset = 0;
  for (const run of runs) {
    const start = offset;
    offset += run.text.length;
    let piece = start;
    for (const point of [...[from, to].filter((at) => at > start && at < offset), offset]) {
      const text = run.text.slice(piece - start, point - start);
      if (text) out.push({ text, marks: { ...run.marks } });
      piece = point;
    }
  }
  return out;
}

/** The positions of `text` in the paragraph: the first, or every one, never overlapping. */
function occurrences(plain, text, all) {
  const found = [];
  for (let at = plain.indexOf(text); at >= 0; at = plain.indexOf(text, at + text.length)) {
    found.push(at);
    if (!all) break;
  }
  if (!found.length) fail('No se encuentra ese texto en el párrafo: debe coincidir exactamente.');
  return found;
}

/** The indexes of the runs that lie inside any of the ranges. */
function insideRanges(runs, ranges) {
  const indexes = [];
  let offset = 0;
  runs.forEach((run, index) => {
    const start = offset;
    offset += run.text.length;
    if (ranges.some(([from, to]) => start >= from && offset <= to)) indexes.push(index);
  });
  return indexes;
}

/** The groups of consecutive runs that share one mark (one tag, one protected block), as lists of indexes. */
function groupsOf(runs, key) {
  const groups = [];
  runs.forEach((run, index) => {
    if (!run.marks[key]) return;
    const last = groups.at(-1);
    if (last && same(runs[last.at(-1)].marks[key], run.marks[key]) && last.at(-1) === index - 1)
      last.push(index);
    else groups.push([index]);
  });
  return groups;
}

const OPERATIONS = ['format_text', 'tag_term', 'untag_term', 'protect_text', 'unprotect_text'];

/**
 * Applies one inline operation to a node ({html}) in place and says whether `op` was one. A paragraph keeps its own
 * element (<p>, <h2>…) when it has one.
 */
function applyInlineOperation(node, op) {
  if (!OPERATIONS.includes(op.op)) return false;
  const html = node.html || '';
  const match = /^(<([a-z][a-z0-9]*)\b[^>]*>)([\s\S]*)(<\/\2>)$/i.exec(html);
  const outer = match && /^(p|h[1-6]|blockquote|div)$/i.test(match[2]) ? match : null;
  let runs = readRuns(outer ? outer[3] : html);
  const plain = runs.map((run) => run.text).join('');
  if (typeof op.text !== 'string' || !op.text) fail('Indica el texto exacto sobre el que actuar.');
  if (op.op === 'untag_term' || op.op === 'unprotect_text') {
    // As the editor does: the whole term or block that holds the text is unwrapped, not a piece of it.
    const key = op.op === 'untag_term' ? 'tag' : 'block';
    const groups = groupsOf(runs, key).filter((group) => {
      const label = group.map((index) => runs[index].text).join('');
      return (
        label === op.text ||
        runs[group[0]].marks.tag?.term === op.text ||
        (key === 'block' && label.includes(op.text))
      );
    });
    if (!groups.length) fail(key === 'tag' ? 'Ese texto no es un término.' : 'Ese texto no está protegido.');
    for (const group of groups) for (const index of group) delete runs[index].marks[key];
  } else {
    const ranges = occurrences(plain, op.text, op.occurrence === 'all').map((at) => [
      at,
      at + op.text.length,
    ]);
    for (const [from, to] of ranges) runs = cut(runs, from, to);
    const touched = insideRanges(runs, ranges);
    if (op.op === 'format_text') {
      const keys = ['bold', 'italic', 'underline', 'strike'].filter((key) => typeof op[key] === 'boolean');
      for (const key of ['color', 'highlight'])
        if (op[key] !== undefined) {
          if (op[key] !== null && !HEX.test(op[key])) fail('El color debe ser hexadecimal: #22d3ee.');
          keys.push(key);
        }
      if (!keys.length) fail('Indica qué formato aplicar o quitar.');
      for (const index of touched)
        for (const key of keys)
          if (op[key] === false || op[key] === null) delete runs[index].marks[key];
          else runs[index].marks[key] = op[key];
    } else if (op.op === 'tag_term') {
      if (typeof op.definition !== 'string' || !op.definition.trim() || op.definition.length > 1000)
        fail('La definición del término es obligatoria (hasta 1000 caracteres).');
      for (const index of touched)
        runs[index].marks.tag = { term: op.text, definition: op.definition.trim() };
    } else for (const index of touched) runs[index].marks.block = true;
  }
  if (runs.map((run) => run.text).join('') !== plain) fail('El formato alteró el texto; no se aplicó.');
  const body = writeRuns(runs);
  node.html = outer ? outer[1] + body + outer[4] : body;
  return true;
}

module.exports = { applyInlineOperation, INLINE_OPERATIONS: OPERATIONS, readRuns, writeRuns };
