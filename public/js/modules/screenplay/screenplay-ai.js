import {
  SCREENPLAY_TYPES,
  screenplayBlockType,
  screenplayId,
  screenplayHeading,
  validateScreenplayDocument,
} from './screenplay-document.js';
import { escapeHTML } from '../../safe-html.js';

/** A scene proposal is data. It cannot contain HTML or mutate another scene. */
export function screenplaySceneProposal(text, document, targetId) {
  const raw = String(text)
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const value = JSON.parse(raw);
  const original = document.scenes.find((scene) => scene.id === targetId);
  if (
    !original ||
    !value ||
    value.schema !== 'code-kai.screenplay-scene-edit' ||
    value.version !== 1 ||
    value.targetId !== targetId ||
    Object.keys(value).some((key) => !['schema', 'version', 'targetId', 'heading', 'blocks'].includes(key)) ||
    typeof value.heading !== 'string' ||
    !value.heading.trim() ||
    value.heading.length > 10000 ||
    !Array.isArray(value.blocks) ||
    value.blocks.length > 1000
  )
    throw new Error('La IA devolvió una escena inválida. Se conservó el guión.');
  let speaker = null;
  const used = new Set();
  const scene = {
    ...original,
    id: targetId,
    heading: value.heading === original.heading.text ? original.heading : screenplayHeading(value.heading),
    blocks: value.blocks.map((block) => {
      if (
        !block ||
        Object.keys(block).some((key) => !['type', 'text'].includes(key)) ||
        !Object.hasOwn(SCREENPLAY_TYPES, block.type) ||
        typeof block.text !== 'string' ||
        block.text.length > 100000
      )
        throw new Error('La propuesta contiene un bloque inválido.');
      const same = original.blocks.find(
        (old) => !used.has(old.id) && old.type === block.type && old.text === block.text,
      );
      if (same) used.add(same.id);
      const result = same
        ? { ...same }
        : { id: screenplayId(), type: block.type, text: block.text, html: escapeHTML(block.text) };
      delete result.speakerId;
      if (block.type === 'character') speaker = result.id;
      else if (speaker && ['dialogue', 'parenthetical'].includes(block.type)) result.speakerId = speaker;
      else if (block.type === 'action' || block.type === 'transition') speaker = null;
      return result;
    }),
  };
  return validateScreenplayDocument({
    ...document,
    scenes: document.scenes.map((old) => (old.id === targetId ? scene : old)),
  });
}

/** Typed responses may introduce new block types; malformed output never deletes the selection. */
export function parseScreenplayEdit(text, targetId) {
  const raw = String(text)
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  if (!raw.startsWith('{')) return null;
  const value = JSON.parse(raw);
  if (
    !value ||
    value.schema !== 'code-kai.screenplay-edit' ||
    value.version !== 1 ||
    value.targetId !== targetId ||
    Object.keys(value).some((key) => !['schema', 'version', 'targetId', 'blocks'].includes(key)) ||
    !Array.isArray(value.blocks) ||
    !value.blocks.length ||
    value.blocks.length > 100
  )
    throw new Error('La IA devolvió un cambio de guión inválido. No se aplicó.');
  for (const block of value.blocks)
    if (
      !block ||
      Object.keys(block).some((key) => !['type', 'text'].includes(key)) ||
      !Object.hasOwn(SCREENPLAY_TYPES, block.type) ||
      typeof block.text !== 'string' ||
      block.text.length > 100000
    )
      throw new Error('La IA devolvió un tipo o texto de bloque inválido.');
  return value.blocks;
}

export function applyScreenplayEdit(range, text, root, continuation = false) {
  const of = (node) =>
    (node.nodeType === 1 ? node : node.parentElement)?.closest('p,h1,h2,h3,h4,h5,blockquote');
  const block = of(range.startContainer);
  if (!block || !root.contains(block) || of(range.endContainer) !== block)
    throw new Error('Selecciona un único bloque, o utiliza la actualización por escena.');
  const editable = block.querySelector('[data-screenplay-name]') || block;
  const blocks = parseScreenplayEdit(text, block.dataset.kaiId);
  if (!blocks) return null;
  if (
    blocks[0].type !== screenplayBlockType(block) &&
    (continuation || range.toString() !== editable.textContent)
  )
    throw new Error('Para cambiar de tipo selecciona el bloque completo.');
  const doc = root.ownerDocument,
    working = range.cloneRange();
  if (continuation) working.collapse(false);
  working.deleteContents();
  const first = doc.createTextNode((continuation ? ' ' : '') + blocks[0].text);
  working.insertNode(first);
  const tailRange = doc.createRange();
  tailRange.selectNodeContents(editable);
  tailRange.setStartAfter(first);
  const tail = tailRange.extractContents();
  let current = block;
  if (blocks[0].type !== screenplayBlockType(block)) {
    current = doc.createElement(SCREENPLAY_TYPES[blocks[0].type]);
    current.dataset.kaiId = block.dataset.kaiId;
    current.append(...editable.childNodes);
    block.replaceWith(current);
  }
  let last = first;
  for (const item of blocks.slice(1)) {
    const next = doc.createElement(SCREENPLAY_TYPES[item.type]);
    next.dataset.kaiId = screenplayId();
    last = doc.createTextNode(item.text);
    next.append(last);
    current.after(next);
    current = next;
  }
  (current === block ? editable : current).append(tail);
  working.setStart(first, 0);
  working.setEnd(last, last.length);
  if (continuation) working.collapse(false);
  return working;
}
