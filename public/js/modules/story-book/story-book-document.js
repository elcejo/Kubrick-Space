import {
  createStoryBookModel,
  createId,
  textOf,
  clone,
  isObject,
  emptyTimeline,
  normalizeTimeline,
  syncStoryBookTimelineMetadata,
  isStoryBookDocument,
  STORY_BOOK_SCHEMA,
  STORY_BOOK_SCHEMA as SCHEMA,
  STORY_BOOK_VERSION,
  STORY_BOOK_VERSION as VERSION,
  TIMELINE_VERSION,
} from '../../contracts/story-book.js';
/**
 * Browser HTML adapter for the portable story-book contract.
 *
 * Story-books are stored as JSON while the visual editor continues to work
 * with a small, safe HTML projection. Screenplays use their own cinematic
 * model in screenplay-document.js; other types retain their existing flow.
 */

function repairMarkupAttributeEscapes(markup) {
  // JSON escaping must not become literal HTML attribute delimiters. Repair
  // legacy opening tags only; leave prose and valid attribute values alone.
  return String(markup || '').replace(/<[a-z][^>]*>/gi, (tag) =>
    tag.replace(
      /(\s[\w:-]+\s*=\s*)\\+(["'])(.*?)\\+\2(?=\s+[\w:-]+\s*=|\s*\/?>)/g,
      (_, prefix, quote, value) =>
        prefix +
        quote +
        value.replace(/\\+(?=["'])/g, '').replaceAll(quote, quote === '"' ? '&quot;' : '&#39;') +
        quote,
    ),
  );
}

function decodeTagValue(value) {
  let text = String(value ?? '');
  // Attribute entities can be present before or after a legacy save was
  // parsed by DOMParser. Remove only serialization noise; punctuation and
  // accents in the actual definition are preserved.
  text = text.replace(/&quot;|&#34;|&#x22;/gi, '"');
  // Only unwrap legacy escaped delimiters; real quotes/apostrophes belong
  // to the definition and must survive repeated saves.
  if (/^\s*\\+["']/.test(text) && /\\+["']\s*$/.test(text))
    text = text.trim().replace(/^(?:\\+["'])+|(?:\\+["'])+$/g, '');
  return text.replace(/\s+/g, ' ').trim();
}

function tagMetadata(element) {
  const candidates = [];
  if (element?.getAttribute) {
    candidates.push(element.getAttribute('definition'));
    candidates.push(element.getAttribute('data-definition'));
  }
  element?.querySelectorAll?.('[data-definition], tag[definition]').forEach((child) => {
    candidates.push(child.getAttribute('data-definition') || child.getAttribute('definition'));
  });
  const values = candidates.map(decodeTagValue).filter(Boolean);
  if (!values.length) values.push(decodeTagValue(element?.getAttribute?.('title')));
  const character = values.find((value) => /^character:[0-9a-f-]{8,}$/i.test(value));
  return character || values.at(-1) || '';
}

/** Remove editor controls and layout wrappers from persisted markup. */
function removeEditorAffordances(root) {
  root
    .querySelectorAll(
      '.story-book-tree-toggle, .story-book-tree-drag-handle, .story-book-node-port, .story-book-row__ports, .story-book-row__drag',
    )
    .forEach((node) => node.remove());
  [...root.querySelectorAll('.story-book-row')]
    .reverse()
    .forEach((row) => row.replaceWith(...row.childNodes));
  root.querySelectorAll('.story-book-row__text').forEach((block) => {
    block.classList.remove('story-book-row__text');
    if (!block.classList.length) block.removeAttribute('class');
    block.removeAttribute('contenteditable');
  });
  // These wrappers are editor layout only. An empty theme/chapter body must not become legacy <div> prose.
  [...root.querySelectorAll('.story-book-tree-content, .story-book-tree-theme, .story-book-tree-chapter')]
    .reverse()
    .forEach((wrapper) => wrapper.replaceWith(...wrapper.childNodes));
}

function normalizeNarrativeMarkup(markup, fallbackTag = 'p', id = '') {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(repairMarkupAttributeEscapes(markup), 'text/html');
  const root = parsed.body;
  removeEditorAffordances(root);

  const createTagSpan = (element) => {
    const span = parsed.createElement('span');
    const definition = tagMetadata(element);
    const text = textOf(element?.textContent);
    const isCharacter = /^character:/i.test(definition);
    span.className = isCharacter ? 'kai-tag kai-character-tag' : 'kai-tag';
    span.setAttribute('spellcheck', 'false');
    if (text) span.dataset.tag = text;
    if (definition) span.dataset.definition = definition;
    span.textContent = text;
    return span;
  };

  // Convert semantic tags first. Their contents may contain several nested
  // spans from earlier saves; replacing the whole group removes the nesting.
  [...root.querySelectorAll('tag')].forEach((element) => element.replaceWith(createTagSpan(element)));

  // Collapse any nested rich tags left by a previous malformed projection.
  const mentionSelector = '.kai-tag, span[data-definition], span[data-tag][title]';
  [...root.querySelectorAll(mentionSelector)]
    .filter((element) => !element.parentElement?.closest(mentionSelector))
    .forEach((element) => {
      if (element.querySelector(mentionSelector)) {
        element.replaceWith(createTagSpan(element));
        return;
      }
      const definition = tagMetadata(element);
      if (definition) element.dataset.definition = definition;
      element.classList.add('kai-tag');
      element.classList.toggle('kai-character-tag', /^character:/i.test(definition));
      element.dataset.tag = decodeTagValue(element.dataset.tag) || textOf(element.textContent);
      element.removeAttribute('title');
      element.setAttribute('spellcheck', 'false');
    });

  // Repair literal escaped quotes in prose text nodes as well as in tag
  // attributes. This is deliberately limited to slashes immediately before
  // quotation marks so ordinary paths or escape sequences remain intact.
  const cleanTextNodes = (node) => {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === 3) child.nodeValue = child.nodeValue.replace(/\\+(?=\s*["“”])/g, '');
      else cleanTextNodes(child);
    });
  };
  cleanTextNodes(root);

  const first = root.firstElementChild;
  if (!first) return `<${fallbackTag} data-kai-id="${id}"></${fallbackTag}>`;
  if (id) first.setAttribute('data-kai-id', id);
  return first.outerHTML;
}

function plainTextFromMarkup(markup) {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(String(markup || ''), 'text/html');
  return textOf(parsed.body.textContent);
}

/** Keep the temporal graph bounded and portable while migrating the original event-card model. */

/** Keep per-node dates in sync so an AI receiving a paragraph also receives its chronology. */

function elementWithId(element, id) {
  const copy = element.cloneNode(true);
  // Tree controls are editor-only affordances. Never persist them in the
  // portable document or in the HTML projection stored inside each node.
  copy
    .querySelectorAll?.('.story-book-tree-toggle, .story-book-tree-drag-handle, .story-book-node-port')
    .forEach((node) => node.remove());
  return normalizeNarrativeMarkup(copy.outerHTML, String(copy.tagName || 'p').toLowerCase(), id);
}

function titleNode(element, type, fallback) {
  const id = element?.getAttribute?.('data-kai-id') || createId(type);
  const text = textOf(element?.textContent || fallback);
  const tagName = type === 'title' ? 'h1' : type === 'chapter' ? 'h2' : 'h3';
  const html = element ? elementWithId(element, id) : `<${tagName} data-kai-id="${id}">${text}</${tagName}>`;
  return { id, type, text, html, properties: {} };
}

function paragraphNode(element, order = 0) {
  const id = element?.getAttribute?.('data-kai-id') || createId('paragraph');
  const elementName = String(element?.tagName || 'P').toLowerCase();
  return {
    id,
    type: 'paragraph',
    element: ['p', 'blockquote', 'h4', 'pre', 'ul', 'ol'].includes(elementName) ? elementName : 'p',
    order,
    text: textOf(element?.textContent),
    html: element ? elementWithId(element, id) : `<p data-kai-id="${id}"></p>`,
    properties: {},
  };
}

/** Create a document from the legacy HTML representation. */
export function createStoryBookDocumentFromHTML(html = '') {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(repairMarkupAttributeEscapes(html), 'text/html');
  removeEditorAffordances(parsed.body);
  const blockTags = new Set(['H1', 'H2', 'H3', 'H4', 'P', 'BLOCKQUOTE', 'PRE', 'UL', 'OL']);
  const elements = [];
  const collect = (parent) => {
    [...parent.children].forEach((element) => {
      if (element.tagName === 'DIV') {
        // Editor tree wrappers can be nested several levels deep (chapter ->
        // content -> theme -> content). Recurse whenever any descendant is a
        // narrative block instead of flattening the wrapper into one paragraph.
        const hasNestedBlock = [...element.querySelectorAll('*')].some((child) =>
          blockTags.has(child.tagName),
        );
        if (hasNestedBlock) collect(element);
        else {
          const paragraph = parsed.createElement('p');
          [...element.childNodes].forEach((child) => paragraph.appendChild(child.cloneNode(true)));
          elements.push(paragraph);
        }
      } else if (blockTags.has(element.tagName)) {
        elements.push(element);
      } else if (element.textContent.trim()) {
        const paragraph = parsed.createElement('p');
        [...element.childNodes].forEach((child) => paragraph.appendChild(child.cloneNode(true)));
        elements.push(paragraph);
      }
    });
  };
  collect(parsed.body);
  const documentNode = {
    schema: SCHEMA,
    version: VERSION,
    id: createId('story-book'),
    type: 'story-book',
    title: titleNode(null, 'title', 'Título'),
    chapters: [],
    timeline: emptyTimeline(),
    properties: { source: 'legacy-html' },
  };

  let chapter = null;
  let theme = null;
  let chapterOrder = 0;
  let themeOrder = 0;
  let paragraphOrder = 0;

  const ensureChapter = () => {
    if (!chapter) {
      chapter = emptyChapter();
      chapter.properties = { implicit: true };
      chapter.order = chapterOrder++;
      documentNode.chapters.push(chapter);
      theme = null;
      themeOrder = 0;
    }
    return chapter;
  };
  const ensureTheme = () => {
    ensureChapter();
    if (!theme) {
      theme = emptyTheme();
      theme.properties = { implicit: true };
      theme.order = themeOrder++;
      chapter.themes.push(theme);
    }
    return theme;
  };

  for (const element of elements) {
    const tag = element.tagName.toLowerCase();
    if (tag === 'h1') {
      documentNode.title = titleNode(element, 'title', 'Título');
      continue;
    }
    if (tag === 'h2') {
      chapter = {
        // The heading ID identifies the title element. The chapter itself has
        // a separate stable structural ID so timeline links never collide
        // with title IDs.
        id: createId('chapter'),
        type: 'chapter',
        order: chapterOrder++,
        title: titleNode(element, 'chapter', 'Capítulo'),
        themes: [],
      };
      documentNode.chapters.push(chapter);
      theme = null;
      themeOrder = 0;
      paragraphOrder = 0;
      continue;
    }
    if (tag === 'h3') {
      ensureChapter();
      theme = {
        id: createId('theme'),
        type: 'theme',
        order: themeOrder++,
        title: titleNode(element, 'theme', 'Tema'),
        paragraphs: [],
      };
      chapter.themes.push(theme);
      paragraphOrder = 0;
      continue;
    }
    // Untitled containers preserve the JSON hierarchy without recreating a
    // heading after the user explicitly converts it to a paragraph.
    if (element.textContent.trim() || ['p', 'blockquote', 'pre', 'ul', 'ol'].includes(tag)) {
      ensureTheme().paragraphs.push(paragraphNode(element, paragraphOrder++));
    }
  }

  // A completely empty legacy book still receives a usable writing target.
  if (!documentNode.chapters.length) {
    chapter = emptyChapter();
    chapter.title = titleNode(null, 'chapter', 'Capítulo');
    theme = emptyTheme();
    theme.title = titleNode(null, 'theme', 'Tema');
    theme.paragraphs.push(paragraphNode(null, 0));
    chapter.themes.push(theme);
    documentNode.chapters.push(chapter);
  } else if (documentNode.chapters.every((item) => item.themes.length === 0)) {
    const first = documentNode.chapters[0];
    first.themes.push(emptyTheme());
  }

  return normalizeStoryBookDocument(documentNode);
}

/** Repair IDs, ordering and missing containers in a parsed document. */

function withTopLevelId(html, id, tagName) {
  return normalizeNarrativeMarkup(html || `<${tagName}></${tagName}>`, tagName, id);
}

/** Convert the JSON document to the HTML projection used by the editor. */
export function storyBookDocumentToHTML(input) {
  const documentNode = normalizeStoryBookDocument(input);
  const parts = [withTopLevelId(documentNode.title.html, documentNode.title.id, 'h1')];
  for (const chapter of documentNode.chapters) {
    if (!chapter.properties.implicit) parts.push(withTopLevelId(chapter.title.html, chapter.title.id, 'h2'));
    for (const theme of chapter.themes) {
      if (!theme.properties.implicit) parts.push(withTopLevelId(theme.title.html, theme.title.id, 'h3'));
      for (const paragraph of theme.paragraphs) {
        parts.push(withTopLevelId(paragraph.html, paragraph.id, paragraph.element || 'p'));
      }
    }
  }
  return parts.join('\n');
}

/** Read the current editor projection back into the portable JSON document. */
export function storyBookDocumentFromHTML(html, previous = null) {
  const documentNode = createStoryBookDocumentFromHTML(html);
  if (isStoryBookDocument(previous)) {
    documentNode.id = previous.id;
    documentNode.properties = isObject(previous.properties) ? clone(previous.properties) : {};
    documentNode.timeline = normalizeTimeline(previous.timeline);

    const previousChapters = new Map(
      (previous.chapters || []).map((chapter) => [chapter.title?.id, chapter]),
    );
    // Moving a theme or paragraph between parents must preserve its identity
    // and custom properties as well as the temporal links that use its ID.
    const previousThemes = new Map(
      (previous.chapters || []).flatMap((chapter) =>
        (chapter.themes || []).map((theme) => [theme.title?.id, theme]),
      ),
    );
    const previousParagraphs = new Map(
      [...previousThemes.values()].flatMap((theme) =>
        (theme.paragraphs || []).map((paragraph) => [paragraph.id, paragraph]),
      ),
    );
    const implicitChapters = new Map();
    const implicitThemes = new Map();
    for (const chapter of previous.chapters || []) {
      for (const theme of chapter.themes || []) {
        const textIds = [theme.title?.id, ...(theme.paragraphs || []).map((paragraph) => paragraph.id)];
        for (const id of textIds) {
          if (chapter.properties?.implicit) implicitChapters.set(id, chapter);
          if (theme.properties?.implicit) implicitThemes.set(id, theme);
        }
      }
    }
    documentNode.chapters.forEach((chapter) => {
      const previousChapter = chapter.properties?.implicit
        ? chapter.themes
            .flatMap((theme) => [theme.title.id, ...theme.paragraphs.map((paragraph) => paragraph.id)])
            .map((id) => implicitChapters.get(id))
            .find(Boolean)
        : previousChapters.get(chapter.title?.id);
      if (previousChapter) {
        chapter.id = previousChapter.id;
        if (chapter.properties?.implicit) chapter.title.id = previousChapter.title.id;
        chapter.properties = isObject(previousChapter.properties) ? clone(previousChapter.properties) : {};
      }
      chapter.themes.forEach((theme) => {
        const previousTheme = theme.properties?.implicit
          ? theme.paragraphs.map((paragraph) => implicitThemes.get(paragraph.id)).find(Boolean)
          : previousThemes.get(theme.title?.id);
        if (previousTheme) {
          theme.id = previousTheme.id;
          if (theme.properties?.implicit) theme.title.id = previousTheme.title.id;
          theme.properties = isObject(previousTheme.properties) ? clone(previousTheme.properties) : {};
        }
        theme.paragraphs.forEach((paragraph) => {
          const previousParagraph = previousParagraphs.get(paragraph.id);
          if (previousParagraph)
            paragraph.properties = isObject(previousParagraph.properties)
              ? clone(previousParagraph.properties)
              : {};
        });
      });
    });
    // Formatting a semantic block as a chapter/theme changes its structural
    // type, but retains the text ID. Rebind its existing dates to that node.
    const indexNodes = (book) => {
      const index = new Map();
      book.chapters.forEach((chapter) => {
        index.set(chapter.title.id, { id: chapter.id, type: 'chapter', node: chapter });
        chapter.themes.forEach((theme) => {
          index.set(theme.title.id, { id: theme.id, type: 'theme', node: theme });
          theme.paragraphs.forEach((paragraph) =>
            index.set(paragraph.id, { id: paragraph.id, type: 'paragraph', node: paragraph }),
          );
        });
      });
      return index;
    };
    const currentNodes = indexNodes(documentNode);
    const replacements = new Map();
    indexNodes(previous).forEach((oldNode, textId) => {
      const current = currentNodes.get(textId);
      if (current) {
        replacements.set(`${oldNode.type}:${oldNode.id}`, current);
        current.node.properties = { ...clone(oldNode.node.properties || {}), ...current.node.properties };
      }
    });
    for (const connection of [
      ...documentNode.timeline.connections,
      ...(documentNode.timeline.invalidDates?.connections || []),
    ]) {
      const current = replacements.get(`${connection.nodeType}:${connection.nodeId}`);
      if (current) {
        connection.nodeId = current.id;
        connection.nodeType = current.type;
      }
    }
  }
  return syncStoryBookTimelineMetadata(documentNode);
}

const model = createStoryBookModel({
  normalizeNarrativeMarkup,
  plainTextFromMarkup,
  createStoryBookDocumentFromHTML,
  titleNode,
});
const emptyChapter = () => model.emptyChapter();
const emptyTheme = () => model.emptyTheme();
export function normalizeStoryBookDocument(input) {
  return model.normalizeStoryBookDocument(input);
}
export function serializeStoryBookDocument(input) {
  return model.serializeStoryBookDocument(input);
}
export function parseStoryBookContent(content) {
  return model.parseStoryBookContent(content);
}

/** Agent imports always expose the complete narrative hierarchy, including empty books. */
export function prepareAssistantStoryBook(content, previous = null) {
  if (typeof content !== 'string' || content.length > 2_000_000)
    throw new Error('El contenido del libro no es válido.');
  const parsed = new DOMParser().parseFromString(content, 'text/html');
  if (!parsed.body.querySelector('h1') && previous?.title?.html)
    parsed.body.insertAdjacentHTML('afterbegin', previous.title.html);
  if (!parsed.body.children.length && content.trim()) {
    const paragraph = parsed.createElement('p');
    paragraph.textContent = content;
    parsed.body.replaceChildren(paragraph);
  }
  const book = storyBookDocumentFromHTML(parsed.body.innerHTML, previous);
  if (!book.chapters.length) book.chapters.push(emptyChapter());
  for (const chapter of book.chapters) {
    delete chapter.properties?.implicit;
    if (!chapter.themes.length) chapter.themes.push(emptyTheme());
    for (const theme of chapter.themes) delete theme.properties?.implicit;
  }
  return serializeStoryBookDocument(book);
}

export {
  STORY_BOOK_SCHEMA,
  STORY_BOOK_VERSION,
  TIMELINE_VERSION,
  emptyTimeline,
  normalizeTimeline,
  syncStoryBookTimelineMetadata,
  isStoryBookDocument,
};
