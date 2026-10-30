import { calendarDate, compareCalendarDates } from './calendar-date.js';
const SCHEMA = 'code-kai.story-book';
const VERSION = 1;
const TIMELINE_VERSION = 2;
let fallbackId = 0;
const TIMELINE_COLORS = ['#22d3ee', '#60a5fa', '#a855f7', '#f472b6', '#f59e0b', '#34d399'];
function createId(prefix = 'node') {
  try {
    if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  } catch (_) {
    /* older browsers may expose crypto without randomUUID */
  }
  fallbackId += 1;
  return `${prefix}-${Date.now().toString(36)}-${fallbackId.toString(36)}`;
}

function textOf(value) {
  return (
    String(value ?? '')
      // A malformed migration repeatedly escaped quotation marks in prose.
      // The backslashes are serialization noise, not part of the manuscript.
      .replace(/\\+(?=\s*["“”])/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function repairLooseJSON(input) {
  const source = String(input ?? '');
  if (!source.trim().startsWith('{')) return source;
  let output = '';
  let inString = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (!inString) {
      output += char;
      if (char === '"') inString = true;
      continue;
    }
    if (char === '\\') {
      const next = source[index + 1];
      if ('"\\/bfnrtu'.includes(next || '')) {
        output += char + next;
        index += 1;
      } else {
        output += '\\\\';
      }
      continue;
    }
    if (char === '"') {
      let lookahead = index + 1;
      while (lookahead < source.length && /\s/.test(source[lookahead])) lookahead += 1;
      const next = source[lookahead];
      let closesString = next === '}' || next === ']' || next === ':';
      if (next === ',') {
        // A comma inside prose is common. It closes a JSON value only when
        // the next token looks like another JSON value/key.
        let afterComma = lookahead + 1;
        while (afterComma < source.length && /\s/.test(source[afterComma])) afterComma += 1;
        closesString = source[afterComma] === '"' || source[afterComma] === '}' || source[afterComma] === ']';
      }
      if (closesString) {
        output += char;
        inString = false;
      } else {
        output += '\\"';
      }
      continue;
    }
    output += char;
  }
  return output;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function emptyTimeline() {
  return { version: TIMELINE_VERSION, points: [], ranges: [], connections: [] };
}

function timelineDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = String(value).trim();
  return calendarDate(date);
}

function timelineColor(value, index = 0) {
  return /^#[0-9a-f]{6}$/i.test(String(value || ''))
    ? String(value)
    : TIMELINE_COLORS[index % TIMELINE_COLORS.length];
}

function normalizeTimeline(input) {
  const source = isObject(input) ? input : {};
  const legacyEntries = Array.isArray(source.entries) ? source.entries : [];
  const archived = isObject(source.invalidDates) ? source.invalidDates : {};
  const rawPoints = [
    ...(Array.isArray(source.points)
      ? source.points
      : legacyEntries.filter((item) => item?.type !== 'range')),
    ...(Array.isArray(archived.points) ? archived.points : []),
  ];
  const rawRanges = [
    ...(Array.isArray(source.ranges)
      ? source.ranges
      : legacyEntries.filter((item) => item?.type === 'range')),
    ...(Array.isArray(archived.ranges) ? archived.ranges : []),
  ];
  const invalidDates = { points: [], ranges: [], connections: [] };
  const storedDate = (value) =>
    String(value ?? '')
      .trim()
      .slice(0, 40);
  const pointIds = new Set();
  const rangeIds = new Set();
  const points = rawPoints
    .slice(0, 1000)
    .map((raw, index) => {
      const item = isObject(raw) ? raw : {};
      let id =
        typeof item.id === 'string' && item.id.trim() && !pointIds.has(item.id)
          ? item.id
          : createId('timeline-point');
      while (pointIds.has(id)) id = createId('timeline-point');
      pointIds.add(id);
      const point = {
        id,
        date: storedDate(item.date || item.start),
        order: Number.isSafeInteger(item.order) && item.order >= 0 ? item.order : index,
      };
      if (!timelineDate(point.date)) {
        invalidDates.points.push(point);
        return null;
      }
      return point;
    })
    .filter(Boolean);
  const ranges = rawRanges
    .slice(0, 500)
    .map((raw, index) => {
      const item = isObject(raw) ? raw : {};
      const start = storedDate(item.start);
      const end = storedDate(item.end);
      let id =
        typeof item.id === 'string' && item.id.trim() && !rangeIds.has(item.id)
          ? item.id
          : createId('timeline-range');
      while (rangeIds.has(id)) id = createId('timeline-range');
      rangeIds.add(id);
      const range = {
        id,
        start,
        end,
        color: timelineColor(item.color, index),
        order: Number.isSafeInteger(item.order) && item.order >= 0 ? item.order : index,
      };
      if (!timelineDate(start) || !timelineDate(end) || compareCalendarDates(end, start) < 0) {
        invalidDates.ranges.push(range);
        return null;
      }
      return range;
    })
    .filter(Boolean);
  points
    .sort((a, b) => compareCalendarDates(a.date, b.date) || a.order - b.order)
    .forEach((point, index) => {
      point.order = index;
    });
  ranges
    .sort(
      (a, b) =>
        compareCalendarDates(a.start, b.start) || compareCalendarDates(a.end, b.end) || a.order - b.order,
    )
    .forEach((range, index) => {
      range.order = index;
    });
  const pointByDate = new Map();
  const duplicatePointIds = new Map();
  const uniquePoints = [];
  points.forEach((point) => {
    const existing = pointByDate.get(point.date);
    if (existing) duplicatePointIds.set(point.id, existing.id);
    else {
      pointByDate.set(point.date, point);
      uniquePoints.push(point);
    }
  });
  points.splice(0, points.length, ...uniquePoints);
  const allRanges = [...ranges, ...invalidDates.ranges];
  const invalidIds = new Set([...invalidDates.points, ...invalidDates.ranges].map((item) => item.id));
  const targetIds = new Set([
    ...points.map((point) => point.id),
    ...allRanges.map((range) => range.id),
    ...invalidIds,
  ]);
  const legacyTargetMap = new Map(
    legacyEntries.map((entry) => {
      const match = [...points, ...allRanges, ...invalidDates.points].find((item) => item.id === entry?.id);
      return [entry?.id, match?.id || null];
    }),
  );
  const connections = [];
  const connectionIds = new Set();
  const rawConnections = [
    ...(Array.isArray(source.connections) ? source.connections : []),
    ...(Array.isArray(archived.connections) ? archived.connections : []),
  ];
  if (rawConnections.length) {
    rawConnections.slice(0, 4000).forEach((raw, index) => {
      const item = isObject(raw) ? raw : {};
      const nodeType = ['chapter', 'theme', 'paragraph'].includes(item.nodeType) ? item.nodeType : null;
      const nodeId = typeof item.nodeId === 'string' ? item.nodeId.trim() : '';
      const targetType =
        item.targetType === 'range' ||
        (item.timelineEntryId &&
          legacyTargetMap.get(item.timelineEntryId) &&
          allRanges.some((range) => range.id === legacyTargetMap.get(item.timelineEntryId)))
          ? 'range'
          : 'point';
      const candidateTargetId =
        typeof item.targetId === 'string'
          ? item.targetId.trim()
          : typeof item.timelineEntryId === 'string'
            ? legacyTargetMap.get(item.timelineEntryId)
            : '';
      const rawTargetId = duplicatePointIds.get(candidateTargetId) || candidateTargetId;
      if (!nodeType || !nodeId || !rawTargetId || !targetIds.has(rawTargetId)) return;
      const actualTargetType = allRanges.some((range) => range.id === rawTargetId) ? 'range' : targetType;
      let id =
        typeof item.id === 'string' && item.id.trim() && !connectionIds.has(item.id)
          ? item.id
          : createId('timeline-connection');
      while (connectionIds.has(id)) id = createId('timeline-connection');
      connectionIds.add(id);
      (invalidIds.has(rawTargetId) ? invalidDates.connections : connections).push({
        id,
        nodeId,
        nodeType,
        targetType: actualTargetType,
        targetId: rawTargetId,
        order: Number.isSafeInteger(item.order) && item.order >= 0 ? item.order : index,
      });
    });
  }
  return {
    version: TIMELINE_VERSION,
    points,
    ranges,
    connections,
    ...(invalidIds.size ? { invalidDates } : {}),
  };
}

function timelineNodeMetadata(timeline, nodeId, nodeType) {
  return timeline.connections
    .filter((connection) => connection.nodeId === nodeId && connection.nodeType === nodeType)
    .map((connection) => {
      if (connection.targetType === 'range') {
        const range = timeline.ranges.find((item) => item.id === connection.targetId);
        return range
          ? {
              connectionId: connection.id,
              targetId: range.id,
              type: 'range',
              start: range.start,
              end: range.end,
            }
          : null;
      }
      const point = timeline.points.find((item) => item.id === connection.targetId);
      return point
        ? { connectionId: connection.id, targetId: point.id, type: 'date', date: point.date }
        : null;
    })
    .filter(Boolean);
}

function syncStoryBookTimelineMetadata(documentNode) {
  if (!isObject(documentNode)) return documentNode;
  documentNode.timeline = normalizeTimeline(documentNode.timeline);
  const validNodes = new Map();
  documentNode.chapters?.forEach((chapter) => {
    validNodes.set(`chapter:${chapter.id}`, chapter);
    chapter.themes?.forEach((theme) => {
      validNodes.set(`theme:${theme.id}`, theme);
      theme.paragraphs?.forEach((paragraph) => validNodes.set(`paragraph:${paragraph.id}`, paragraph));
    });
  });
  documentNode.timeline.connections = documentNode.timeline.connections.filter((connection) =>
    validNodes.has(`${connection.nodeType}:${connection.nodeId}`),
  );
  if (documentNode.timeline.invalidDates) {
    documentNode.timeline.invalidDates.connections = documentNode.timeline.invalidDates.connections.filter(
      (connection) => validNodes.has(`${connection.nodeType}:${connection.nodeId}`),
    );
  }
  validNodes.forEach((node, key) => {
    node.properties = isObject(node.properties) ? node.properties : {};
    const [nodeType, nodeId] = key.split(':');
    node.properties.timelineDates = timelineNodeMetadata(documentNode.timeline, nodeId, nodeType);
  });
  return documentNode;
}

function isStoryBookDocument(value) {
  return isObject(value) && value.schema === SCHEMA && Number(value.version) === VERSION;
}
export function createStoryBookModel({
  normalizeNarrativeMarkup,
  plainTextFromMarkup,
  createStoryBookDocumentFromHTML,
  titleNode,
}) {
  function emptyChapter() {
    return {
      id: createId('chapter'),
      type: 'chapter',
      order: 0,
      title: titleNode(null, 'chapter', 'Capítulo'),
      themes: [],
    };
  }

  function emptyTheme() {
    return {
      id: createId('theme'),
      type: 'theme',
      order: 0,
      title: titleNode(null, 'theme', 'Tema'),
      paragraphs: [],
    };
  }

  function normalizeNode(node, type, order) {
    const normalized = isObject(node) ? clone(node) : {};
    normalized.id =
      typeof normalized.id === 'string' && normalized.id.trim() ? normalized.id : createId(type);
    normalized.type = type;
    normalized.order = Number.isFinite(normalized.order) ? normalized.order : order;
    normalized.properties = isObject(normalized.properties) ? normalized.properties : {};
    return normalized;
  }

  function normalizeStoryBookDocument(input) {
    const source = isStoryBookDocument(input)
      ? clone(input)
      : createStoryBookDocumentFromHTML(String(input || ''));
    source.schema = SCHEMA;
    source.version = VERSION;
    source.id = typeof source.id === 'string' && source.id.trim() ? source.id : createId('story-book');
    source.type = 'story-book';
    source.properties = isObject(source.properties) ? source.properties : {};
    source.timeline = normalizeTimeline(source.timeline);
    source.title = normalizeNode(source.title, 'title', 0);
    source.title.html = normalizeNarrativeMarkup(
      source.title.html || `<h1>${source.title.text || 'Título'}</h1>`,
      'h1',
      source.title.id,
    );
    source.title.text = textOf(source.title.text || plainTextFromMarkup(source.title.html) || 'Título');
    source.chapters = Array.isArray(source.chapters) ? source.chapters : [];

    source.chapters = source.chapters.map((rawChapter, chapterIndex) => {
      const chapter = normalizeNode(rawChapter, 'chapter', chapterIndex);
      chapter.title = normalizeNode(chapter.title, 'chapter-title', chapterIndex);
      chapter.title.html = normalizeNarrativeMarkup(
        chapter.title.html || `<h2>${chapter.title.text || 'Capítulo'}</h2>`,
        'h2',
        chapter.title.id,
      );
      chapter.title.text = textOf(
        chapter.title.text || plainTextFromMarkup(chapter.title.html) || 'Capítulo',
      );
      chapter.themes = Array.isArray(chapter.themes) ? chapter.themes : [];
      chapter.themes = chapter.themes.map((rawTheme, themeIndex) => {
        const theme = normalizeNode(rawTheme, 'theme', themeIndex);
        theme.title = normalizeNode(theme.title, 'theme-title', themeIndex);
        theme.title.html = normalizeNarrativeMarkup(
          theme.title.html || `<h3>${theme.title.text || 'Tema'}</h3>`,
          'h3',
          theme.title.id,
        );
        theme.title.text = textOf(theme.title.text || plainTextFromMarkup(theme.title.html) || 'Tema');
        theme.paragraphs = Array.isArray(theme.paragraphs) ? theme.paragraphs : [];
        theme.paragraphs = theme.paragraphs.map((rawParagraph, paragraphIndex) => {
          const paragraph = normalizeNode(rawParagraph, 'paragraph', paragraphIndex);
          paragraph.element = ['p', 'blockquote', 'h4', 'pre', 'ul', 'ol'].includes(paragraph.element)
            ? paragraph.element
            : 'p';
          paragraph.html = normalizeNarrativeMarkup(
            paragraph.html || `<${paragraph.element}>${paragraph.text || ''}</${paragraph.element}>`,
            paragraph.element,
            paragraph.id,
          );
          paragraph.text = textOf(paragraph.text || plainTextFromMarkup(paragraph.html));
          return paragraph;
        });
        return theme;
      });
      if (!chapter.themes.length) chapter.themes.push(emptyTheme());
      return chapter;
    });

    if (!source.chapters.length) source.chapters.push(emptyChapter());
    return syncStoryBookTimelineMetadata(source);
  }

  function serializeStoryBookDocument(input) {
    return JSON.stringify(normalizeStoryBookDocument(input), null, 2);
  }

  function parseStoryBookContent(content) {
    if (typeof content !== 'string' || !content.trim()) return createStoryBookDocumentFromHTML('');
    const source = content.trim();
    try {
      const parsed = JSON.parse(source);
      if (isStoryBookDocument(parsed)) return normalizeStoryBookDocument(parsed);
    } catch (_) {
      /* Legacy HTML is handled below. */
    }
    // Recover documents written by the early JSON migration where inline HTML
    // attributes were not escaped correctly. Keeping this fallback here means
    // existing projects can be opened and saved once into the canonical format.
    if (source.startsWith('{')) {
      try {
        const repaired = JSON.parse(repairLooseJSON(source));
        if (isStoryBookDocument(repaired)) return normalizeStoryBookDocument(repaired);
      } catch (_) {
        /* If this is not a recoverable document, treat it as HTML. */
      }
    }
    return createStoryBookDocumentFromHTML(content);
  }
  return {
    emptyChapter,
    emptyTheme,
    normalizeStoryBookDocument,
    serializeStoryBookDocument,
    parseStoryBookContent,
  };
}
export {
  createId,
  textOf,
  repairLooseJSON,
  clone,
  isObject,
  emptyTimeline,
  normalizeTimeline,
  syncStoryBookTimelineMetadata,
  isStoryBookDocument,
  SCHEMA as STORY_BOOK_SCHEMA,
  VERSION as STORY_BOOK_VERSION,
  TIMELINE_VERSION,
};
