const { randomUUID } = require('node:crypto');
const sanitizeHTML = require('sanitize-html');
const { applyBookAgentPatch } = require('./book-patches.cjs');
const {
  validateScreenplayDocument,
  upgradeScreenplayDocument,
  screenplayShots,
  SCREENPLAY_SHOTS,
  SCREENPLAY_VOICES,
} = require('../../../public/js/contracts/screenplay.js');
const { validateScenarioDocument, SCENARIO_FIELDS } = require('../../../public/js/contracts/scenario.js');
const { validateFilmDocument } = require('../../../public/js/contracts/film.js');
const escape = (value) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const fail = (message) => {
  throw Object.assign(Error(message), { status: 422 });
};
const txt = (value, max = 12000) =>
  typeof value === 'string' && value.length <= max ? value : fail('Texto de edición inválido.');
function markedText(node, value) {
  const annotations =
    (node.html || '').match(
      /<(?:span\b[^>]*(?:kai-tag|data-definition|data-tag)[^>]*>[\s\S]*?<\/span|tag\b[^>]*>[\s\S]*?<\/tag)>/gi,
    ) || [];
  let html = escape(value);
  const markers = [];
  for (const annotation of annotations) {
    const label = sanitizeHTML(annotation, { allowedTags: [], allowedAttributes: {} });
    if (!label) continue;
    const token = '\u0000annotation' + markers.length + '\u0000';
    markers.push([token, annotation]);
    html = html.split(escape(label)).join(token);
  }
  for (const [token, annotation] of markers) html = html.split(token).join(annotation);
  return html;
}
const protectedNode = (node) =>
  /kai-block|data-block/i.test(node.html || '') || node.properties?.locked === true;
const block = (type, text = '') => ({
  id: 'edit-' + randomUUID(),
  type,
  text: txt(text),
  html: escape(txt(text)),
  ...(type === 'character' ? { voice: '' } : {}),
});
function insert(list, item, afterId) {
  const index =
    afterId === null ? -1 : afterId === undefined ? list.length - 1 : list.findIndex((n) => n.id === afterId);
  if (afterId != null && index < 0) fail('El destino de inserción ya no existe.');
  list.splice(index + 1, 0, item);
}
function speech(value = {}) {
  const speaker = block('character', value.character || '');
  if (value.voice !== undefined) {
    if (!Object.hasOwn(SCREENPLAY_VOICES, value.voice)) fail('Tipo de voz inválido.');
    speaker.voice = value.voice;
  }
  if (value.characterId) speaker.characterId = value.characterId;
  return [
    speaker,
    { ...block('parenthetical', value.parenthetical || ''), speakerId: speaker.id },
    { ...block('dialogue', value.text || ''), speakerId: speaker.id },
  ];
}
function shot(value = {}) {
  if (value.type && !SCREENPLAY_SHOTS.includes(value.type)) fail('Tipo de plano inválido.');
  const seconds = value.seconds ?? 8;
  if (typeof seconds !== 'number' || seconds < 1 || seconds > 10 || (seconds * 2) % 1)
    fail('La duración debe estar entre 1 y 10 segundos en pasos de 0,5.');
  const marker = block(
    'shot',
    `PLANO 1 — ${value.type || 'Plano general'}; ${txt(value.camera || '', 1000)}; ${seconds}s`,
  );
  const dialogues = value.dialogues === undefined ? [{}] : value.dialogues;
  if (!Array.isArray(dialogues) || dialogues.length > 8) fail('Diálogos inválidos.');
  return [
    marker,
    block('action', value.action || ''),
    ...dialogues.flatMap(speech),
    block('transition', value.transition || ''),
  ];
}
function scene(value = {}) {
  const ie = value.interiorExterior || 'EXT',
    location = txt(value.location || '', 1000),
    time = txt(value.time || '', 1000);
  const text = `${ie}. ${location} - ${time}`;
  const shots = value.shots || [{}];
  if (!Array.isArray(shots) || !shots.length || shots.length > 6)
    fail('La escena necesita al menos un plano.');
  return {
    id: 'scene-' + randomUUID(),
    heading: { text, html: escape(text), interiorExterior: ie, location, time },
    blocks: shots.flatMap(shot),
    ...(value.locationId ? { locationId: value.locationId } : {}),
  };
}
function assertLinks(doc, ingredients) {
  const links = new Set(
    (ingredients || []).filter((i) => i.active !== false).map((i) => i.importedProjectId),
  );
  for (const s of doc.scenes) {
    if (s.locationId && !links.has(s.locationId))
      fail('Vincula el escenario como ingrediente antes de asignarlo.');
    for (const b of s.blocks)
      if (b.characterId && !links.has(b.characterId))
        fail('Vincula el personaje como ingrediente antes de asignarlo.');
  }
}
function applyElementPatch(project, document, operations) {
  if (!Array.isArray(operations) || operations.length > 8 || JSON.stringify(operations).length > 24000)
    fail('Lote de edición demasiado grande.');
  let next = structuredClone(document);
  const screenplay = project.category === 'screenplay';
  for (const op of operations) {
    if (
      !op ||
      typeof op !== 'object' ||
      typeof op.op !== 'string' ||
      Object.keys(op).some((k) => ['__proto__', 'constructor', 'prototype'].includes(k))
    )
      fail('Operación inválida.');
    if (project.type === 'stage') {
      if (op.op !== 'set_field' || !['description', ...SCENARIO_FIELDS.map((f) => f.key)].includes(op.id))
        fail('Este campo de escenario no se puede modificar.');
      if (op.id === 'description') next.description = txt(op.text, 4000);
      else next.fields[op.id] = txt(op.text);
      continue;
    }
    if (project.type === 'video') {
      if (op.op !== 'set_field' || !['aspectRatio', 'megapixels', 'steps'].includes(op.id))
        fail('Edita el guión fuente para cambiar planos de un largometraje.');
      next.params[op.id] = op.value;
      continue;
    }
    if (!screenplay) {
      const chapters = () => next.chapters,
        themes = () => next.chapters.flatMap((c) => c.themes);
      const paragraphs = () => themes().flatMap((t) => t.paragraphs);
      const titles = () => [
        next.title,
        ...chapters().flatMap((c) => [c.title, ...c.themes.map((t) => t.title)]),
      ];
      if (op.op === 'replace_text') {
        const node = [...paragraphs(), ...titles()].find((n) => n.id === op.id);
        if (!node || protectedNode(node)) fail('Elemento inexistente o protegido.');
        const value = txt(op.text);
        const html = markedText(node, value);
        node.text = value;
        const tag = paragraphs().includes(node)
          ? node.element || 'p'
          : node === next.title
            ? 'h1'
            : node.type === 'chapter-title'
              ? 'h2'
              : 'h3';
        node.html = `<${tag} data-kai-id="${node.id}">${html}</${tag}>`;
      } else if (op.op === 'insert_chapter') {
        const before = next.chapters.length;
        next = applyBookAgentPatch(next, { type: 'append', title: op.title, themes: op.themes });
        const added = next.chapters.splice(before, 1)[0];
        insert(next.chapters, added, op.afterId);
      } else if (op.op === 'insert_theme') {
        next = applyBookAgentPatch(next, {
          type: 'extend',
          chapterId: op.chapterId,
          title: op.title,
          paragraphs: op.paragraphs,
        });
        const c = next.chapters.find((c) => c.id === op.chapterId);
        const added = c.themes.pop();
        insert(c.themes, added, op.afterId);
      } else if (op.op === 'insert_paragraph') {
        const t = themes().find((t) => t.id === op.themeId);
        if (!t) fail('Tema inexistente.');
        const id = 'paragraph_' + randomUUID();
        insert(
          t.paragraphs,
          {
            id,
            type: 'paragraph',
            element: 'p',
            text: txt(op.text),
            html: `<p data-kai-id="${id}">${escape(txt(op.text))}</p>`,
            properties: {},
            order: 0,
          },
          op.afterId,
        );
      } else if (op.op === 'remove_element') {
        const list = [
          next.chapters,
          ...chapters().map((c) => c.themes),
          ...themes().map((t) => t.paragraphs),
        ].find((list) => list.some((n) => n.id === op.id));
        if (!list) fail('Elemento inexistente.');
        const node = list.find((n) => n.id === op.id);
        const descendants = [
          node,
          node.title,
          ...(node.themes || []).flatMap((t) => [t, t.title, ...t.paragraphs]),
          ...(node.paragraphs || []),
        ].filter(Boolean);
        if (descendants.some(protectedNode)) fail('No se puede eliminar un bloque protegido.');
        if ((list === next.chapters || chapters().some((c) => c.themes === list)) && list.length === 1)
          fail('Debe conservarse capítulo y tema.');
        const ids = new Set(descendants.map((n) => n.id));
        if ([...ids].some((id) => JSON.stringify(next.timeline).includes('"' + id + '"')))
          fail('Retira primero los vínculos temporales del elemento.');
        if ([...ids].some((id) => next.properties?.lockedIds?.includes(id))) fail('Elemento protegido.');
        list.splice(list.indexOf(node), 1);
      } else fail('Operación de libro desconocida.');
      next.chapters.forEach((c, i) => {
        c.order = i;
        c.themes.forEach((t, j) => {
          t.order = j;
          t.paragraphs.forEach((p, k) => (p.order = k));
        });
      });
      continue;
    }
    if (
      op.op === 'remove_element' &&
      next.scenes.some((scene) => scene.id === op.id && scene.blocks.some(protectedNode))
    )
      fail('La escena contiene elementos protegidos.');
    if (op.op === 'insert_scene') {
      insert(next.scenes, scene(op), op.afterId);
      continue;
    }
    const s = next.scenes.find(
      (s) => s.id === op.sceneId || s.id === op.id || s.blocks.some((b) => b.id === op.id),
    );
    if (!s) fail('Escena o elemento inexistente.');
    const index = s.blocks.findIndex((b) => b.id === op.id),
      node = s.blocks[index];
    if (op.op === 'set_scene') {
      const text = `${op.interiorExterior ?? s.heading.interiorExterior}. ${op.location ?? s.heading.location} - ${op.time ?? s.heading.time}`;
      s.heading = {
        ...s.heading,
        ...Object.fromEntries(
          ['interiorExterior', 'location', 'time']
            .filter((k) => op[k] !== undefined)
            .map((k) => [k, txt(op[k], 1000)]),
        ),
        text,
        html: escape(text),
      };
      if (op.locationId !== undefined) {
        if (op.locationId === null) delete s.locationId;
        else s.locationId = op.locationId;
      }
    } else if (op.op === 'replace_text') {
      if (!node || protectedNode(node) || node.type === 'shot')
        fail('Elemento inexistente, técnico o protegido.');
      node.text = txt(op.text);
      node.html = markedText(node, node.text);
    } else if (op.op === 'set_shot') {
      if (node?.type !== 'shot') fail('Plano inexistente.');
      if (!op.type || op.seconds === undefined || op.camera === undefined)
        fail('set_shot necesita encuadre, duración y cámara completos.');
      const updated = shot(op)[0];
      node.text = updated.text;
      node.html = updated.html;
    } else if (op.op === 'insert_shot') {
      let at = s.blocks.length;
      if (op.afterId === null) at = 0;
      else if (op.afterId !== undefined) {
        const start = s.blocks.findIndex((b) => b.type === 'shot' && b.id === op.afterId);
        if (start < 0) fail('Plano de destino inexistente.');
        at = s.blocks.findIndex((b, i) => i > start && b.type === 'shot');
        if (at < 0) at = s.blocks.length;
      }
      s.blocks.splice(at, 0, ...shot(op));
    } else if (op.op === 'insert_dialogue') {
      const start = s.blocks.findIndex((b) => b.type === 'shot' && b.id === op.shotId);
      if (start < 0) fail('Plano inexistente.');
      let end = s.blocks.findIndex((b, i) => i > start && b.type === 'shot');
      if (end < 0) end = s.blocks.length;
      let at = s.blocks.findIndex((b, i) => i > start && i < end && b.type === 'transition');
      if (at < 0) at = end;
      if (op.afterId) {
        const speaker = s.blocks.findIndex(
          (b, i) => i > start && i < end && b.type === 'character' && b.id === op.afterId,
        );
        if (speaker < 0) fail('Diálogo de destino inexistente.');
        at = speaker + 1;
        while (at < end && ['dialogue', 'parenthetical'].includes(s.blocks[at].type)) at++;
      }
      s.blocks.splice(at, 0, ...speech(op));
    } else if (op.op === 'remove_element') {
      if (op.id === s.id) {
        if (next.scenes.length === 1) fail('Debe quedar una escena.');
        next.scenes.splice(next.scenes.indexOf(s), 1);
      } else if (node?.type === 'shot') {
        if (
          screenplayShots(s)
            .find((sh) => sh.id === node.id || sh.markerId === node.id)
            ?.blocks.some(protectedNode)
        )
          fail('El plano contiene elementos protegidos.');
        if (screenplayShots(s).length === 1) fail('Debe quedar un plano.');
        let end = s.blocks.findIndex((b, i) => i > index && b.type === 'shot');
        if (end < 0) end = s.blocks.length;
        s.blocks.splice(index, end - index);
      } else if (node?.type === 'character') {
        let end = index + 1;
        while (end < s.blocks.length && ['parenthetical', 'dialogue'].includes(s.blocks[end].type)) end++;
        if (s.blocks.slice(index, end).some(protectedNode)) fail('Diálogo protegido.');
        s.blocks.splice(index, end - index);
      } else if (node?.type === 'dialogue') {
        const speaker =
          s.blocks.find((b) => b.id === node.speakerId) ||
          s.blocks
            .slice(0, index)
            .reverse()
            .find((b) => ['character', 'shot'].includes(b.type));
        if (speaker?.type !== 'character') fail('El diálogo no tiene hablante.');
        const start = s.blocks.indexOf(speaker);
        let end = start + 1;
        while (end < s.blocks.length && ['parenthetical', 'dialogue'].includes(s.blocks[end].type)) end++;
        if (s.blocks.slice(start, end).some(protectedNode)) fail('Diálogo protegido.');
        s.blocks.splice(start, end - start);
      } else fail('Los campos de acción y transición se vacían, no se eliminan.');
    } else fail('Operación de guión desconocida.');
  }
  if (screenplay) {
    if (!next.scenes.length) fail('Debe conservarse una escena.');
    next.scenes.forEach((s) => {
      let n = 0;
      for (const b of s.blocks)
        if (b.type === 'shot') {
          b.text = b.text.replace(/^PLANO\s+\d+/i, 'PLANO ' + ++n);
          b.html = escape(b.text);
        }
    });
    // Preserve existing links; validate only newly assigned project references.
    const oldLinks = new Set(
      document.scenes.flatMap((s) => [s.locationId, ...s.blocks.map((b) => b.characterId)]).filter(Boolean),
    );
    assertLinks(next, [
      ...(project.ingredients || []),
      ...[...oldLinks].map((importedProjectId) => ({ importedProjectId })),
    ]);
    return upgradeScreenplayDocument(validateScreenplayDocument(next));
  }
  if (project.type === 'stage') return validateScenarioDocument(next);
  if (project.type === 'video') return validateFilmDocument(next);
  return next;
}
module.exports = { applyElementPatch };
