import {
  identifier,
  reference,
  SCREENPLAY_SCHEMA,
  SCREENPLAY_TYPES,
  SCREENPLAY_LABELS,
  SCREENPLAY_SCENE_FIELDS,
  SCREENPLAY_SHOTS,
  SCREENPLAY_VOICES,
  screenplayCharacter,
  screenplayNarrative,
  screenplayId,
  validateScreenplayDocument,
  screenplayHeading,
  screenplaySceneDocument,
  screenplayContext,
} from '../../contracts/screenplay.js';
import { safeContent, escapeHTML } from '../../safe-html.js';

export function screenplayBlockType(element) {
  const tag = element?.tagName?.toLowerCase();
  return Object.keys(SCREENPLAY_TYPES).find((type) => SCREENPLAY_TYPES[type] === tag) || 'action';
}

export function screenplayInlineHTML(element) {
  const copy = element.cloneNode(true);
  copy
    .querySelectorAll('button, svg, .kai-remove-btn, [data-screenplay-controls]')
    .forEach((node) => node.remove());
  copy.querySelectorAll('[data-screenplay-name]').forEach((node) => node.replaceWith(...node.childNodes));
  const voice = element.matches('h3[data-screenplay-voice]') ? element.dataset.screenplayVoice : '';
  let html = safeContent(copy.innerHTML + (voice ? ' (' + escapeHTML(voice) + ')' : ''));
  if (copy.getAttribute('style'))
    html = safeContent('<span style="' + escapeHTML(copy.getAttribute('style')) + '">' + html + '</span>');
  const fragment = new DOMParser().parseFromString(html, 'text/html').body;
  fragment
    .querySelectorAll('div,p,h1,h2,h3,h4,h5,h6,blockquote,pre,ul,ol,li,table')
    .forEach((node) => node.replaceWith(...node.childNodes));
  fragment.querySelectorAll('*').forEach((node) => {
    node.removeAttribute('data-kai-id');
    node.removeAttribute('contenteditable');
    node.removeAttribute('spellcheck');
    node.removeAttribute('data-screenplay-name');
    node.removeAttribute('data-placeholder');
    node.removeAttribute('role');
  });
  return fragment.innerHTML;
}

function blockText(element) {
  const copy = element.cloneNode(true);
  copy
    .querySelectorAll('button,svg,.kai-remove-btn,[data-screenplay-controls]')
    .forEach((node) => node.remove());
  copy.querySelectorAll('br').forEach((node) => node.replaceWith('\n'));
  const voice = element.matches('h3[data-screenplay-voice]') ? element.dataset.screenplayVoice : '';
  return (copy.textContent + (voice ? ' (' + voice + ')' : ''))
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .trim();
}

/** Migrate legacy HTML on opening; never rewrite historical snapshots. */
export function screenplayFromHTML(html, previous = null, liveRoot = null) {
  const root = liveRoot || new DOMParser().parseFromString(safeContent(html), 'text/html').body;
  // Native paste and older documents may contain divs or bare text. Normalize
  // these runs without recreating their text nodes, so no written text vanishes.
  const blockSelector = 'h1,h2,h3,h4,h5,p,blockquote,pre,li';
  const selection = liveRoot?.ownerDocument.defaultView.getSelection();
  const cursor =
    selection?.rangeCount && root.contains(selection.anchorNode)
      ? {
          anchor: selection.anchorNode,
          anchorOffset: selection.anchorOffset,
          focus: selection.focusNode,
          focusOffset: selection.focusOffset,
        }
      : null;
  let normalized = false;
  const normalize = (parent) => {
    let run = null;
    for (const child of [...parent.childNodes]) {
      if (child.nodeType === 1 && child.matches('[data-scene-properties], [data-screenplay-controls]'))
        continue;
      if (child.nodeType === 1 && child.matches('.screenplay-scene, .screenplay-scene__body')) {
        normalize(child);
        continue;
      }
      if (child.nodeType === 1 && child.matches(blockSelector)) {
        run = null;
        continue;
      }
      if (child.nodeType === 1 && child.querySelector(blockSelector)) {
        run = null;
        normalize(child);
        continue;
      }
      if (child.nodeType !== 1 && (child.nodeType !== 3 || !child.textContent.trim())) continue;
      if (child.nodeType === 1 && ['BUTTON', 'SVG'].includes(child.tagName)) continue;
      if (!run) {
        run = root.ownerDocument.createElement('p');
        parent.insertBefore(run, child);
        normalized = true;
      }
      if (child.nodeType === 1 && child.tagName === 'DIV') {
        const span = root.ownerDocument.createElement('span');
        if (child.getAttribute('style')) span.setAttribute('style', child.getAttribute('style'));
        span.append(...child.childNodes);
        run.append(span);
        child.remove();
        run = null;
      } else run.append(child);
    }
  };
  normalize(root);
  if (normalized && cursor && root.contains(cursor.anchor) && root.contains(cursor.focus)) {
    try {
      selection.setBaseAndExtent(cursor.anchor, cursor.anchorOffset, cursor.focus, cursor.focusOffset);
    } catch {
      /* A removed container has no editable cursor. */
    }
  }
  const used = new Set();
  const old = previous
    ? [
        previous.title,
        ...previous.preamble,
        ...previous.scenes.flatMap((scene) => [
          { id: scene.id, type: 'scene', text: scene.heading.text },
          ...scene.blocks,
        ]),
      ]
    : [];
  const unique = (element) => {
    let id = element.dataset.kaiId;
    if (!id || !identifier.test(id) || used.has(id)) {
      const type =
        element.tagName === 'H1'
          ? 'title'
          : element.tagName === 'H2'
            ? 'scene'
            : screenplayBlockType(element);
      id =
        old.find((item) => !used.has(item.id) && item.type === type && item.text === blockText(element))
          ?.id || screenplayId();
    }
    used.add(id);
    element.dataset.kaiId = id;
    return id;
  };
  const doc = { schema: SCREENPLAY_SCHEMA, version: 1, title: null, preamble: [], scenes: [] };
  let target = doc.preamble,
    speaker = null;
  const elements = [...root.querySelectorAll('h1,h2,h3,h4,h5,p,blockquote,pre,li')].filter(
    (el) =>
      !el.closest('[data-scene-properties], [data-screenplay-controls]') &&
      !el.parentElement?.closest('h1,h2,h3,h4,h5,p,blockquote,pre,li'),
  );
  for (const el of elements) {
    const text = blockText(el);
    if (el.tagName === 'H1' && !doc.title) {
      doc.title = { id: unique(el), type: 'title', text, html: screenplayInlineHTML(el) };
      continue;
    }
    if (el.tagName === 'H2') {
      const scene = {
        id: unique(el),
        heading: screenplayHeading(text, screenplayInlineHTML(el)),
        blocks: [],
      };
      const original = previous?.scenes.find((item) => item.id === scene.id);
      if (original?.heading.text === text)
        scene.heading = { ...original.heading, html: screenplayInlineHTML(el) };
      if (original?.narrative) scene.narrative = screenplayNarrative(original.narrative);
      if (original?.origins) scene.origins = structuredClone(original.origins);
      if (original?.locationId) scene.locationId = original.locationId;
      doc.scenes.push(scene);
      target = scene.blocks;
      speaker = null;
      continue;
    }
    const type = screenplayBlockType(el),
      node = { id: unique(el), type, text, html: screenplayInlineHTML(el) };
    if (type === 'character') {
      node.voice = el.dataset.screenplayVoice ?? screenplayCharacter(text).voice;
      speaker = node.id;
      const tag = el.querySelector('[data-definition],tag[definition]');
      const char = (tag?.dataset.definition || tag?.getAttribute('definition') || '').replace(
        /^character:/,
        '',
      );
      if (reference.test(char)) node.characterId = char;
    }
    if (speaker && ['dialogue', 'parenthetical'].includes(type)) node.speakerId = speaker;
    if (['action', 'transition'].includes(type)) speaker = null;
    target.push(node);
  }
  if (!doc.title) doc.title = previous?.title || { id: screenplayId(), type: 'title', text: '', html: '' };
  return validateScreenplayDocument(doc, safeContent);
}

export function parseScreenplayContent(content) {
  if (typeof content === 'object') return validateScreenplayDocument(content, safeContent);
  if (
    String(content || '')
      .trim()
      .startsWith('{')
  )
    return validateScreenplayDocument(JSON.parse(content), safeContent);
  return screenplayFromHTML(content || '');
}

/** All ingredient adaptations enter the editor through its canonical document model. */
export function prepareScreenplayAdaptation(html, previousContent, scenarios = []) {
  const previous = parseScreenplayContent(previousContent);
  const doc = screenplayFromHTML(html, previous);
  if (doc.preamble.length)
    throw new Error('La propuesta contiene texto fuera de una escena. Se conservó el guión.');
  const catalog = scenarios.filter(
    (item) => item && reference.test(item.id) && typeof item.name === 'string',
  );
  const key = (value) =>
    String(value || '')
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase();
  for (const scene of doc.scenes) {
    scene.heading.shot ||= '';
    const matches = catalog.filter((item) => key(item.name) === key(scene.heading.location));
    const selected =
      matches.find((item) => item.id === scene.locationId) || (matches.length === 1 ? matches[0] : null);
    if (selected) scene.locationId = selected.id;
    else delete scene.locationId;
  }
  return validateScreenplayDocument(doc, safeContent);
}

/** Render the validated portable document as an editable HTML projection. */
export function screenplayToHTML(doc) {
  doc = validateScreenplayDocument(doc, safeContent);
  const block = (node) =>
    `<${node.type === 'title' ? 'h1' : SCREENPLAY_TYPES[node.type]} data-kai-id="${node.id}">${node.html || escapeHTML(node.text) || '<br>'}</${node.type === 'title' ? 'h1' : SCREENPLAY_TYPES[node.type]}>`;
  return (
    block(doc.title) +
    doc.preamble.map(block).join('') +
    doc.scenes
      .map(
        (scene) =>
          `<h2 data-kai-id="${scene.id}">${scene.heading.html || escapeHTML(scene.heading.text) || '<br>'}</h2>` +
          scene.blocks.map(block).join(''),
      )
      .join('')
  );
}

export {
  SCREENPLAY_SCHEMA,
  SCREENPLAY_TYPES,
  SCREENPLAY_LABELS,
  SCREENPLAY_SCENE_FIELDS,
  SCREENPLAY_SHOTS,
  SCREENPLAY_VOICES,
  screenplayCharacter,
  screenplayNarrative,
  screenplayId,
  validateScreenplayDocument,
  screenplayHeading,
  screenplaySceneDocument,
  screenplayContext,
};
