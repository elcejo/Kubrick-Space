import { fail } from './common.js';
import { calendarDate, compareCalendarDates } from './calendar-date.js';
const STORY_BOOK_SCHEMA = 'code-kai.story-book';
const STORY_BOOK_VERSION = 1;
const STORY_BOOK_TIMELINE_VERSION = 2;
const STORY_BOOK_ID = /^[A-Za-z0-9_-]{1,140}$/;

function validateStoryBookProperties(properties, label) {
  if (properties === undefined) return {};
  if (
    !properties ||
    typeof properties !== 'object' ||
    Array.isArray(properties) ||
    Object.keys(properties).length > 40
  )
    throw fail(`Invalid ${label} properties`);
  if (
    JSON.stringify(properties).length > 10000 ||
    /"(?:__proto__|constructor|prototype)"\s*:/.test(JSON.stringify(properties))
  )
    throw fail(`Invalid ${label} properties`);
  return properties;
}

function validateStoryBookNode(node, expectedType, label, ids, limits = {}, cleanHTML = (value) => value) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) throw fail(`Invalid ${label}`);
  const allowed = new Set(['id', 'type', 'text', 'html', 'element', 'order', 'properties']);
  if (expectedType === 'chapter') (allowed.add('title'), allowed.add('themes'));
  if (expectedType === 'theme') (allowed.add('title'), allowed.add('paragraphs'));
  if (Object.keys(node).some((key) => !allowed.has(key))) throw fail(`Invalid ${label} field`);
  if (typeof node.id !== 'string' || !STORY_BOOK_ID.test(node.id) || ids.has(node.id))
    throw fail(`Invalid ${label} id`);
  ids.add(node.id);
  if (node.type !== expectedType) throw fail(`Invalid ${label} type`);
  if (!Number.isSafeInteger(node.order) || node.order < 0 || node.order > 100000)
    throw fail(`Invalid ${label} order`);
  if ('text' in node && (typeof node.text !== 'string' || node.text.length > (limits.text || 20000)))
    throw fail(`Invalid ${label} text`);
  if ('html' in node) {
    if (typeof node.html !== 'string' || node.html.length > (limits.html || 50000))
      throw fail(`Invalid ${label} HTML`);
    node.html = cleanHTML(node.html);
  }
  if ('element' in node && !['p', 'blockquote', 'h4', 'pre', 'ul', 'ol'].includes(node.element))
    throw fail(`Invalid ${label} element`);
  node.properties = validateStoryBookProperties(node.properties, label);
  if (Array.isArray(node.properties.timelineDates)) {
    if (node.properties.timelineDates.length > 100) throw fail(`Invalid ${label} timeline dates`);
    node.properties.timelineDates.forEach((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item))
        throw fail(`Invalid ${label} timeline date`);
      const allowedDate = new Set(['connectionId', 'targetId', 'type', 'date', 'start', 'end']);
      if (Object.keys(item).some((key) => !allowedDate.has(key)))
        throw fail(`Invalid ${label} timeline date field`);
      if (
        typeof item.connectionId !== 'string' ||
        !STORY_BOOK_ID.test(item.connectionId) ||
        typeof item.targetId !== 'string' ||
        !STORY_BOOK_ID.test(item.targetId)
      )
        throw fail(`Invalid ${label} timeline date reference`);
      if (!['date', 'range'].includes(item.type)) throw fail(`Invalid ${label} timeline date type`);
      if (
        item.type === 'date' &&
        (typeof item.date !== 'string' || !calendarDate(item.date) || 'start' in item || 'end' in item)
      )
        throw fail(`Invalid ${label} timeline date value`);
      if (
        item.type === 'range' &&
        (typeof item.start !== 'string' ||
          !calendarDate(item.start) ||
          typeof item.end !== 'string' ||
          !calendarDate(item.end) ||
          compareCalendarDates(item.end, item.start) < 0 ||
          'date' in item)
      )
        throw fail(`Invalid ${label} timeline range value`);
    });
  }
  return node;
}

function validateStoryBookTimeline(timeline, nodeRefs, archived = false) {
  const validDate = (value) =>
    archived ? typeof value === 'string' && value.length <= 40 : Boolean(calendarDate(value));
  if (timeline === undefined)
    return { version: STORY_BOOK_TIMELINE_VERSION, points: [], ranges: [], connections: [] };
  if (!timeline || typeof timeline !== 'object' || Array.isArray(timeline))
    throw fail('Invalid story-book timeline');
  // Accept the former event-card schema while an existing project is opened;
  // the editor migrates it to version 2 before the next save.
  if (timeline.version === 1) {
    const allowedLegacy = new Set(['version', 'entries', 'connections']);
    if (
      Object.keys(timeline).some((key) => !allowedLegacy.has(key)) ||
      !Array.isArray(timeline.entries) ||
      timeline.entries.length > 1000 ||
      !Array.isArray(timeline.connections) ||
      timeline.connections.length > 2000
    )
      throw fail('Invalid legacy story-book timeline');
    const entryIds = new Set();
    timeline.entries.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry))
        throw fail(`Invalid timeline entry ${index + 1}`);
      const entryAllowed = new Set(['id', 'type', 'label', 'start', 'end', 'order']);
      if (
        Object.keys(entry).some((key) => !entryAllowed.has(key)) ||
        typeof entry.id !== 'string' ||
        !STORY_BOOK_ID.test(entry.id) ||
        entryIds.has(entry.id) ||
        !['moment', 'range'].includes(entry.type) ||
        typeof entry.label !== 'string' ||
        entry.label.length > 300
      )
        throw fail('Invalid legacy story-book timeline entry');
      for (const key of ['start', 'end'])
        if (entry[key] !== null && entry[key] !== undefined && entry[key] !== '' && !calendarDate(entry[key]))
          throw fail('Invalid story-book timeline date');
      if (entry.start && entry.end && compareCalendarDates(entry.end, entry.start) < 0)
        throw fail('Invalid story-book timeline range');
      if (!Number.isSafeInteger(entry.order) || entry.order < 0 || entry.order > 100000)
        throw fail('Invalid story-book timeline order');
      entryIds.add(entry.id);
    });
    const legacyConnectionIds = new Set();
    timeline.connections.forEach((connection) => {
      if (
        !connection ||
        typeof connection !== 'object' ||
        Array.isArray(connection) ||
        Object.keys(connection).some(
          (key) => !new Set(['id', 'nodeId', 'nodeType', 'timelineEntryId', 'order']).has(key),
        ) ||
        typeof connection.id !== 'string' ||
        !STORY_BOOK_ID.test(connection.id) ||
        legacyConnectionIds.has(connection.id) ||
        !['chapter', 'theme', 'paragraph'].includes(connection.nodeType) ||
        !nodeRefs[connection.nodeType]?.has(connection.nodeId) ||
        typeof connection.timelineEntryId !== 'string' ||
        !entryIds.has(connection.timelineEntryId) ||
        !Number.isSafeInteger(connection.order) ||
        connection.order < 0 ||
        connection.order > 100000
      )
        throw fail('Invalid legacy story-book timeline connection');
      legacyConnectionIds.add(connection.id);
    });
    return timeline;
  }
  const allowed = new Set([
    'version',
    'points',
    'ranges',
    'connections',
    ...(!archived ? ['invalidDates'] : []),
  ]);
  if (
    Object.keys(timeline).some((key) => !allowed.has(key)) ||
    timeline.version !== STORY_BOOK_TIMELINE_VERSION
  )
    throw fail('Invalid story-book timeline version');
  if (
    !Array.isArray(timeline.points) ||
    timeline.points.length > 1000 ||
    !Array.isArray(timeline.ranges) ||
    timeline.ranges.length > 500 ||
    !Array.isArray(timeline.connections) ||
    timeline.connections.length > 4000
  )
    throw fail('Invalid story-book timeline collections');
  const pointIds = new Set();
  const pointDates = new Set();
  timeline.points.forEach((point) => {
    if (
      !point ||
      typeof point !== 'object' ||
      Array.isArray(point) ||
      Object.keys(point).some((key) => !new Set(['id', 'date', 'order']).has(key)) ||
      typeof point.id !== 'string' ||
      !STORY_BOOK_ID.test(point.id) ||
      pointIds.has(point.id) ||
      typeof point.date !== 'string' ||
      !validDate(point.date) ||
      (!archived && pointDates.has(point.date)) ||
      !Number.isSafeInteger(point.order) ||
      point.order < 0 ||
      point.order > 100000
    )
      throw fail('Invalid story-book timeline point');
    pointIds.add(point.id);
    pointDates.add(point.date);
  });
  const rangeIds = new Set();
  timeline.ranges.forEach((range) => {
    if (
      !range ||
      typeof range !== 'object' ||
      Array.isArray(range) ||
      Object.keys(range).some((key) => !new Set(['id', 'start', 'end', 'color', 'order']).has(key)) ||
      typeof range.id !== 'string' ||
      !STORY_BOOK_ID.test(range.id) ||
      rangeIds.has(range.id) ||
      typeof range.start !== 'string' ||
      !validDate(range.start) ||
      typeof range.end !== 'string' ||
      !validDate(range.end) ||
      (!archived && compareCalendarDates(range.end, range.start) < 0) ||
      !/^#[0-9a-f]{6}$/i.test(range.color) ||
      !Number.isSafeInteger(range.order) ||
      range.order < 0 ||
      range.order > 100000
    )
      throw fail('Invalid story-book timeline range');
    rangeIds.add(range.id);
  });
  const connectionIds = new Set();
  timeline.connections.forEach((connection) => {
    if (
      !connection ||
      typeof connection !== 'object' ||
      Array.isArray(connection) ||
      Object.keys(connection).some(
        (key) => !new Set(['id', 'nodeId', 'nodeType', 'targetType', 'targetId', 'order']).has(key),
      ) ||
      typeof connection.id !== 'string' ||
      !STORY_BOOK_ID.test(connection.id) ||
      connectionIds.has(connection.id) ||
      !['chapter', 'theme', 'paragraph'].includes(connection.nodeType) ||
      typeof connection.nodeId !== 'string' ||
      !nodeRefs[connection.nodeType]?.has(connection.nodeId) ||
      !['point', 'range'].includes(connection.targetType) ||
      typeof connection.targetId !== 'string' ||
      !(connection.targetType === 'point' ? pointIds : rangeIds).has(connection.targetId) ||
      !Number.isSafeInteger(connection.order) ||
      connection.order < 0 ||
      connection.order > 100000
    )
      throw fail('Invalid story-book timeline connection');
    connectionIds.add(connection.id);
  });
  if (!archived && timeline.invalidDates !== undefined) {
    const invalid = timeline.invalidDates;
    if (
      !invalid ||
      typeof invalid !== 'object' ||
      Array.isArray(invalid) ||
      Object.keys(invalid).some((key) => !['points', 'ranges', 'connections'].includes(key))
    )
      throw fail('Invalid story-book timeline date archive');
    validateStoryBookTimeline({ version: STORY_BOOK_TIMELINE_VERSION, ...invalid }, nodeRefs, true);
    if (
      [...invalid.points, ...invalid.ranges].some((item) => pointIds.has(item.id) || rangeIds.has(item.id)) ||
      invalid.connections.some((item) => connectionIds.has(item.id))
    )
      throw fail('Duplicate story-book timeline archive id');
  }
  return timeline;
}

/**
 * Validate and sanitize the serialized story-book document without treating
 * its inline HTML snippets as one giant HTML document. Returning null means
 * the caller should handle the value as legacy HTML.
 */
export function validateStoryBookContent(value, cleanHTML = (value) => value) {
  if (typeof value !== 'string' || !value.trim().startsWith('{')) return null;
  let document;
  try {
    document = JSON.parse(value);
  } catch (_) {
    return null;
  }
  if (!document || document.schema !== STORY_BOOK_SCHEMA) return null;
  if (document.version !== STORY_BOOK_VERSION || document.type !== 'story-book')
    throw fail('Invalid story-book document version');
  const rootAllowed = new Set([
    'schema',
    'version',
    'id',
    'type',
    'title',
    'chapters',
    'timeline',
    'properties',
  ]);
  if (Object.keys(document).some((key) => !rootAllowed.has(key)))
    throw fail('Invalid story-book document field');
  if (typeof document.id !== 'string' || !STORY_BOOK_ID.test(document.id))
    throw fail('Invalid story-book document id');
  if (!Array.isArray(document.chapters) || document.chapters.length > 200)
    throw fail('Invalid story-book chapters');
  document.properties = validateStoryBookProperties(document.properties, 'story-book');
  const ids = new Set([document.id]);
  const nodeRefs = { chapter: new Set(), theme: new Set(), paragraph: new Set() };
  validateStoryBookNode(
    document.title,
    'title',
    'story-book title',
    ids,
    { text: 300, html: 20000 },
    cleanHTML,
  );
  let paragraphCount = 0;
  document.chapters.forEach((chapter, chapterIndex) => {
    validateStoryBookNode(
      chapter,
      'chapter',
      `chapter ${chapterIndex + 1}`,
      ids,
      { text: 300, html: 20000 },
      cleanHTML,
    );
    const chapterAllowed = new Set(['id', 'type', 'order', 'title', 'themes', 'properties']);
    if (Object.keys(chapter).some((key) => !chapterAllowed.has(key)))
      throw fail('Invalid story-book chapter field');
    validateStoryBookNode(
      chapter.title,
      'chapter-title',
      `chapter ${chapterIndex + 1} title`,
      ids,
      {
        text: 300,
        html: 20000,
      },
      cleanHTML,
    );
    nodeRefs.chapter.add(chapter.id);
    if (!Array.isArray(chapter.themes) || chapter.themes.length > 300)
      throw fail('Invalid story-book themes');
    chapter.themes.forEach((theme, themeIndex) => {
      validateStoryBookNode(
        theme,
        'theme',
        `theme ${chapterIndex + 1}.${themeIndex + 1}`,
        ids,
        {
          text: 300,
          html: 20000,
        },
        cleanHTML,
      );
      const themeAllowed = new Set(['id', 'type', 'order', 'title', 'paragraphs', 'properties']);
      if (Object.keys(theme).some((key) => !themeAllowed.has(key)))
        throw fail('Invalid story-book theme field');
      validateStoryBookNode(
        theme.title,
        'theme-title',
        `theme ${chapterIndex + 1}.${themeIndex + 1} title`,
        ids,
        { text: 300, html: 20000 },
        cleanHTML,
      );
      nodeRefs.theme.add(theme.id);
      if (!Array.isArray(theme.paragraphs) || theme.paragraphs.length > 2000)
        throw fail('Invalid story-book paragraphs');
      theme.paragraphs.forEach((paragraph, paragraphIndex) => {
        paragraphCount += 1;
        if (paragraphCount > 20000) throw fail('Too many story-book paragraphs');
        validateStoryBookNode(
          paragraph,
          'paragraph',
          `paragraph ${chapterIndex + 1}.${themeIndex + 1}.${paragraphIndex + 1}`,
          ids,
          { text: 50000, html: 100000 },
          cleanHTML,
        );
        nodeRefs.paragraph.add(paragraph.id);
      });
    });
  });
  document.timeline = validateStoryBookTimeline(document.timeline, nodeRefs);
  return JSON.stringify(document, null, 2);
}
