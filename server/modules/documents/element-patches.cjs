const { randomUUID } = require('node:crypto');
const sanitizeHTML = require('sanitize-html');
const { applyBookAgentPatch } = require('./book-patches.cjs');
const {
  validateScreenplayDocument,
  upgradeScreenplayDocument,
  screenplayShots,
  SCREENPLAY_SHOTS,
  SCREENPLAY_SHOT_SECONDS,
  SCREENPLAY_VOICES,
} = require('../../../public/js/contracts/screenplay.js');
const { validateScenarioDocument, SCENARIO_FIELDS } = require('../../../public/js/contracts/scenario.js');
const { validateFilmDocument, FILM_FRAME_OPTIONS } = require('../../../public/js/contracts/film.js');
const {
  filmRecomposePrompt,
  filmShotWithFraming,
  parseFilmShotNote,
} = require('../../../public/js/contracts/film-prompt.js');
const {
  FILM_OPTICS_KEYS,
  filmOpticsOf,
  isFilmOpticsChoice,
} = require('../../../public/js/contracts/film-optics.js');
const { isFilmPaletteChoice, filmPaletteColors } = require('../../../public/js/contracts/film-palettes.js');
const { isFilmMovement, FILM_MOVEMENT_NAMES } = require('../../../public/js/contracts/film-movements.js');
const { FILM_TRANSITION_NAMES } = require('../../../public/js/contracts/film-transitions.js');
const { shotBlockProblem } = require('../../../public/js/contracts/screenplay-shot-format.js');
const { calendarDate, compareCalendarDates } = require('../../../public/js/contracts/calendar-date.js');
const { applyInlineOperation, INLINE_OPERATIONS } = require('./inline-marks.cjs');
const {
  normalizeTimeline,
  syncStoryBookTimelineMetadata,
} = require('../../../public/js/contracts/story-book.js');
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
/** A scene holds one to this many shots; a longer action continues in another scene of the same place and time. */
const MAX_SHOTS_PER_SCENE = 24;
function shot(value = {}) {
  if (value.type && !SCREENPLAY_SHOTS.includes(value.type))
    fail('Tipo de plano inválido: usa exactamente uno de ' + SCREENPLAY_SHOTS.join(', ') + '.');
  const seconds = value.seconds ?? 8;
  if (!SCREENPLAY_SHOT_SECONDS.includes(seconds))
    fail(
      'La duración de un plano debe ser una de: ' +
        SCREENPLAY_SHOT_SECONDS.join(', ') +
        ' segundos (clips de H3).',
    );
  const camera = txt(value.camera || '', 1000).trim();
  if (camera && !FILM_MOVEMENT_NAMES.includes(camera))
    fail('El movimiento de cámara debe estar vacío o ser uno de: ' + FILM_MOVEMENT_NAMES.join(', ') + '.');
  if (value.transition && !FILM_TRANSITION_NAMES.includes(value.transition))
    fail('La transición debe estar vacía o ser una de: ' + FILM_TRANSITION_NAMES.join(', ') + '.');
  const marker = block(
    'shot',
    `PLANO 1 — ${value.type || 'Plano general'}; ${camera ? camera + '; ' : ''}${seconds}s`,
  );
  const dialogues = value.dialogues === undefined ? [{}] : value.dialogues;
  if (!Array.isArray(dialogues)) fail('dialogues debe ser una lista (vacía si el plano no tiene diálogo).');
  if (dialogues.length > 8) fail('Un plano admite hasta 8 intervenciones; reparte el diálogo en más planos.');
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
  if (!Array.isArray(shots) || !shots.length)
    fail('La escena necesita al menos un plano: shots debe ser una lista con uno o más planos.');
  if (shots.length > MAX_SHOTS_PER_SCENE)
    fail(
      'Una escena admite hasta ' +
        MAX_SHOTS_PER_SCENE +
        ' planos; continúa la acción en otra escena del mismo lugar y momento.',
    );
  return {
    id: 'scene-' + randomUUID(),
    heading: { text, html: escape(text), interiorExterior: ie, location, time },
    blocks: shots.flatMap(shot),
    ...(value.locationId ? { locationId: value.locationId } : {}),
  };
}
/** A name as people compare it: no accents, case, punctuation or trailing (V.O.). */
const plainName = (value) =>
  String(value || '')
    .replace(/\([^)]*\)\s*$/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
/** The one linked project a written name stands for: the full name, or a part of it nobody else shares. */
function linkedByName(name, candidates, { partial = true } = {}) {
  const wanted = plainName(name);
  if (!wanted) return null;
  const exact = candidates.filter((item) => plainName(item.name) === wanted);
  if (exact.length) return exact.length === 1 ? exact[0] : null;
  if (!partial) return null;
  const words = wanted.split(' ');
  const near = candidates.filter((item) => {
    const own = plainName(item.name).split(' ');
    return words.every((word) => own.includes(word)) || own.every((word) => words.includes(word));
  });
  return near.length === 1 ? near[0] : null;
}
/**
 * What the model writes as "Marta" or "Café Central" is the linked character or place of that name. Only what this
 * patch created is touched: a choice the author made by hand (a custom name, another link) is never rewritten.
 */
function linkNewByName(doc, ingredients, existing) {
  const linked = (type) =>
    (ingredients || [])
      .filter((item) => item.type === type && item.active !== false && item.importedProjectId)
      .map((item) => ({ id: item.importedProjectId, name: item.importedProjectName || item.label || '' }));
  const characters = linked('character');
  const places = linked('stage');
  for (const scene of doc.scenes) {
    if (!existing.has(scene.id) && !scene.locationId) {
      const place = linkedByName(scene.heading.location, places, { partial: false });
      if (place) scene.locationId = place.id;
    }
    for (const block of scene.blocks) {
      if (block.type !== 'character' || existing.has(block.id) || block.characterId) continue;
      const person = linkedByName(block.text, characters);
      if (!person) continue;
      block.characterId = person.id;
      block.text = person.name;
      block.html = escape(person.name);
    }
  }
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
/**
 * The timeline of a Story Book, edited as a person edits it: dates and ranges of their own, and links from a chapter, a
 * theme or a paragraph to them. Entries are named by their date (two entries never share one); the ids are the server's.
 * The dates each element shows are rebuilt from the links afterwards, so they cannot drift from them.
 */
function timelineOperation(next, op) {
  const timeline = (next.timeline = normalizeTimeline(next.timeline));
  const valid = (value) =>
    calendarDate(value) || fail('Fecha inválida: usa AAAA-MM-DD (año negativo para AC).');
  const pointOf = (value) => timeline.points.find((point) => point.date === valid(value));
  const rangeOf = (start, end) =>
    timeline.ranges.find((range) => range.start === valid(start) && range.end === valid(end));
  const ordered = (start, end) =>
    compareCalendarDates(end, start) >= 0 || fail('El fin del rango no puede ser anterior a su inicio.');
  const ensurePoint = (value) => {
    let point = pointOf(value);
    if (!point) {
      point = { id: 'timeline-point-' + randomUUID(), date: valid(value), order: timeline.points.length };
      timeline.points.push(point);
    }
    return point;
  };
  const ensureRange = (start, end, color) => {
    valid(start);
    valid(end);
    ordered(start, end);
    let range = rangeOf(start, end);
    if (!range) {
      range = {
        id: 'timeline-range-' + randomUUID(),
        start,
        end,
        ...(color ? { color } : {}),
        order: timeline.ranges.length,
      };
      timeline.ranges.push(range);
    } else if (color) range.color = color;
    return range;
  };
  const element = () => {
    const found = [
      ...next.chapters.map((node) => ['chapter', node]),
      ...next.chapters.flatMap((chapter) => chapter.themes.map((node) => ['theme', node])),
      ...next.chapters.flatMap((chapter) =>
        chapter.themes.flatMap((theme) => theme.paragraphs.map((node) => ['paragraph', node])),
      ),
    ].find(([, node]) => node.id === op.id);
    return (
      found ||
      fail('Elemento inexistente: solo un capítulo, un tema o un párrafo se vincula a la línea de tiempo.')
    );
  };
  const link = (entry, targetType) => {
    const [nodeType, node] = element();
    if (!timeline.connections.some((item) => item.nodeId === node.id && item.targetId === entry.id))
      timeline.connections.push({
        id: 'timeline-connection-' + randomUUID(),
        nodeId: node.id,
        nodeType,
        targetType,
        targetId: entry.id,
        order: timeline.connections.length,
      });
  };
  const unlink = (entry) => {
    const [, node] = element();
    const before = timeline.connections.length;
    timeline.connections = timeline.connections.filter(
      (item) => !(item.nodeId === node.id && item.targetId === entry.id),
    );
    if (timeline.connections.length === before) fail('El elemento no está vinculado a esa fecha.');
  };
  const existing = (entry) => entry || fail('No existe esa fecha o rango en la línea de tiempo.');
  const drop = (entry, list) => {
    timeline[list] = timeline[list].filter((item) => item.id !== entry.id);
    timeline.connections = timeline.connections.filter((item) => item.targetId !== entry.id);
  };
  if (op.op === 'add_date') ensurePoint(op.date);
  else if (op.op === 'add_range') ensureRange(op.start, op.end, op.color);
  else if (op.op === 'edit_date') existing(pointOf(op.date)).date = valid(op.newDate);
  else if (op.op === 'edit_range') {
    const range = existing(rangeOf(op.start, op.end));
    const start = op.newStart !== undefined ? valid(op.newStart) : range.start;
    const end = op.newEnd !== undefined ? valid(op.newEnd) : range.end;
    ordered(start, end);
    Object.assign(range, { start, end, ...(op.color ? { color: op.color } : {}) });
  } else if (op.op === 'remove_date') drop(existing(pointOf(op.date)), 'points');
  else if (op.op === 'remove_range') drop(existing(rangeOf(op.start, op.end)), 'ranges');
  else if (op.op === 'link_date') link(ensurePoint(op.date), 'point');
  else if (op.op === 'link_range') link(ensureRange(op.start, op.end, op.color), 'range');
  else if (op.op === 'unlink_date') unlink(existing(pointOf(op.date)));
  else if (op.op === 'unlink_range') unlink(existing(rangeOf(op.start, op.end)));
  else return false;
  // Dates that now coincide become one entry; each element's dates are rebuilt from the links.
  syncStoryBookTimelineMetadata(next);
  return true;
}
/** True when the film is built from a linked screenplay: the movement and the transition of a shot are then the screenplay's. */
const filmFromScreenplay = (project, film) =>
  Boolean(film?.source) ||
  (project?.ingredients || []).some(
    (item) => item.active !== false && item.type === 'book' && item.importedProjectId,
  );

function applyElementPatch(project, document, operations, { maxOperations = 8, maxCharacters = 24000 } = {}) {
  if (
    !Array.isArray(operations) ||
    operations.length > maxOperations ||
    JSON.stringify(operations).length > maxCharacters
  )
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
      if (op.op === 'remove_scene') {
        const gone = next.scenes.find((item) => item.id === op.id);
        if (!gone) fail('El clip indicado no existe en el metraje.');
        if (!gone.sourceRemoved) fail('Solo se descarta un clip que ya no está en el guión.');
        next.scenes = next.scenes.filter((item) => item.id !== op.id);
        continue;
      }
      if (op.op === 'set_scene_continuity') {
        const scene = next.scenes.find((item) => item.id === op.id);
        if (!scene || scene.sourceRemoved) fail('El plano indicado no existe en el metraje.');
        const continuity = { ...scene.continuity };
        if (op.mode !== undefined && op.mode !== continuity.mode && filmFromScreenplay(project, next))
          fail(
            'La transición viene del guión vinculado: cámbiala en el guión (el bloque transition del plano).',
          );
        if (op.mode !== undefined) continuity.mode = op.mode;
        if (op.frame !== undefined) continuity.frame = op.frame === true;
        if (op.note !== undefined) {
          continuity.note = txt(op.note, 900).trim();
          continuity.noteSource = continuity.note ? 'manual' : '';
          continuity.noteKey = '';
        }
        scene.continuity = continuity;
        // The prompt carries the note, so it is put together again; one the author wrote by hand is left as it is.
        scene.prompt = filmRecomposePrompt(next, scene);
        continue;
      }
      if (op.op === 'set_scene_framing') {
        const scene = next.scenes.find((item) => item.id === op.id);
        if (!scene || scene.sourceRemoved) fail('El plano indicado no existe en el metraje.');
        if (!['', ...SCREENPLAY_SHOTS].includes(op.framing)) fail('Encuadre inválido.');
        if (op.framing !== parseFilmShotNote(scene.shot).framing && filmFromScreenplay(project, next))
          fail('El encuadre viene del guión vinculado: cámbialo en el guión.');
        if (!filmFromScreenplay(project, next)) scene.shot = filmShotWithFraming(scene.shot, op.framing);
        scene.prompt = filmRecomposePrompt(next, scene);
        continue;
      }
      if (op.op === 'set_scene_movement') {
        const scene = next.scenes.find((item) => item.id === op.id);
        if (!scene || scene.sourceRemoved) fail('El plano indicado no existe en el metraje.');
        if (!isFilmMovement(op.movement)) fail('Movimiento de cámara inválido.');
        if (op.movement !== scene.movement && filmFromScreenplay(project, next))
          fail('El movimiento de cámara viene del guión vinculado: cámbialo en el guión (camera del plano).');
        scene.movement = op.movement;
        scene.prompt = filmRecomposePrompt(next, scene);
        continue;
      }
      if (op.op === 'set_scene_optics') {
        const clip = next.scenes.find((item) => item.id === op.id);
        if (!clip) fail('El clip indicado no existe en el metraje.');
        const sceneId = clip.sourceSceneId;
        const optics = { ...filmOpticsOf(next, sceneId) };
        for (const key of FILM_OPTICS_KEYS)
          if (op[key] !== undefined) {
            if (!isFilmOpticsChoice(key, op[key])) fail('Opción de óptica inválida.');
            optics[key] = op[key];
          }
        if (op.palette !== undefined) {
          if (!isFilmPaletteChoice(op.palette)) fail('Paleta inválida.');
          optics.palette = op.palette;
        }
        if (optics.palette === 'custom') {
          const colors = filmPaletteColors(op.colors ?? optics.colors);
          if (!colors) fail('Una paleta personalizada necesita de 1 a 12 colores #rrggbb.');
          optics.colors = colors;
        } else delete optics.colors;
        next.optics = { ...(next.optics || {}) };
        if ([...FILM_OPTICS_KEYS, 'palette'].every((key) => optics[key] === 'auto'))
          delete next.optics[sceneId];
        else next.optics[sceneId] = optics;
        for (const scene of next.scenes)
          if (scene.sourceSceneId === sceneId) scene.prompt = filmRecomposePrompt(next, scene);
        continue;
      }
      if (op.op === 'set_scene_prompt' || op.op === 'set_scene_frames') {
        const scene = next.scenes.find((item) => item.id === op.id);
        if (!scene || scene.sourceRemoved) fail('El plano indicado no existe en el metraje.');
        if (op.op === 'set_scene_frames') {
          if (!FILM_FRAME_OPTIONS.includes(op.frames))
            fail('La duración debe ser una de: ' + FILM_FRAME_OPTIONS.join(', ') + ' fotogramas.');
          if (op.frames !== scene.frames && filmFromScreenplay(project, next))
            fail('La duración viene del guión vinculado: cámbiala en el guión.');
          scene.frames = op.frames;
          scene.prompt = filmRecomposePrompt(next, scene);
        } else {
          // As writing the prompt by hand does: the prompt is the author's, and the clip has to be approved again.
          const prompt = txt(op.prompt, 6000).trim();
          scene.prompt = prompt;
          scene.promptSource = prompt ? 'manual' : '';
          scene.promptHash = prompt ? scene.scriptHash : '';
          scene.status = prompt ? 'ready' : 'pending';
          scene.error = '';
          scene.approved = false;
        }
        continue;
      }
      if (op.op !== 'set_field' || !['aspectRatio', 'megapixels', 'steps', 'finalMegapixels'].includes(op.id))
        fail(
          'Edita el guión fuente para cambiar los planos de un largometraje; aquí solo se cambian sus parámetros, el prompt y la duración de un plano.',
        );
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
      } else if (op.op === 'move_element') {
        const located = (() => {
          const chapter = next.chapters.find((c) => c.id === op.id);
          if (chapter) return { type: 'chapter', node: chapter, list: next.chapters };
          for (const c of next.chapters) {
            const theme = c.themes.find((t) => t.id === op.id);
            if (theme) return { type: 'theme', node: theme, list: c.themes };
            for (const t of c.themes) {
              const paragraph = t.paragraphs.find((p) => p.id === op.id);
              if (paragraph) return { type: 'paragraph', node: paragraph, list: t.paragraphs };
            }
          }
          return null;
        })();
        if (!located) fail('Elemento inexistente: se mueve un capítulo, un tema o un párrafo.');
        const { type, node, list } = located;
        if (type === 'chapter' && op.toId !== undefined)
          fail('Un capítulo no tiene destino: solo se reordena entre capítulos.');
        let target = list;
        if (op.toId !== undefined) {
          target =
            type === 'theme'
              ? next.chapters.find((c) => c.id === op.toId)?.themes
              : themes().find((t) => t.id === op.toId)?.paragraphs;
          if (!target)
            fail(type === 'theme' ? 'Capítulo de destino inexistente.' : 'Tema de destino inexistente.');
        }
        if (op.afterId === op.id) fail('Un elemento no se coloca tras sí mismo.');
        const moved = [
          node,
          node.title,
          ...(node.themes || []).flatMap((t) => [t, t.title, ...t.paragraphs]),
          ...(node.paragraphs || []),
        ].filter(Boolean);
        if (moved.some(protectedNode)) fail('No se puede mover un bloque protegido.');
        if (moved.some((n) => next.properties?.lockedIds?.includes(n.id))) fail('Elemento protegido.');
        if (type !== 'paragraph' && target !== list && list.length === 1)
          fail('Debe conservarse capítulo y tema.');
        list.splice(list.indexOf(node), 1);
        insert(target, node, op.afterId);
      } else if (INLINE_OPERATIONS.includes(op.op)) {
        const node = [...paragraphs(), ...titles()].find((n) => n.id === op.id);
        if (!node) fail('Elemento inexistente.');
        if (op.op !== 'unprotect_text' && protectedNode(node)) fail('Elemento protegido.');
        applyInlineOperation(node, op);
      } else if (!timelineOperation(next, op)) fail('Operación de libro desconocida.');
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
      if (node.type === 'transition') {
        const problem = shotBlockProblem('transition', node.text);
        if (problem) fail(problem);
      }
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
    } else if (INLINE_OPERATIONS.includes(op.op)) {
      if (!node || node.type === 'shot') fail('Elemento inexistente o técnico.');
      if (op.op !== 'unprotect_text' && protectedNode(node)) fail('Elemento protegido.');
      applyInlineOperation(node, op);
    } else if (op.op === 'move_scene') {
      if (op.id !== s.id) fail('Escena inexistente.');
      if (op.afterId === s.id) fail('Una escena no se coloca tras sí misma.');
      next.scenes.splice(next.scenes.indexOf(s), 1);
      insert(next.scenes, s, op.afterId);
    } else if (op.op === 'move_shot') {
      if (node?.type !== 'shot') fail('Plano inexistente.');
      let end = s.blocks.findIndex((b, i) => i > index && b.type === 'shot');
      if (end < 0) end = s.blocks.length;
      const segment = s.blocks.slice(index, end);
      if (segment.some(protectedNode)) fail('El plano contiene elementos protegidos.');
      const destination =
        op.toSceneId === undefined
          ? s
          : next.scenes.find((candidate) => candidate.id === op.toSceneId) ||
            fail('Escena de destino inexistente.');
      if (destination !== s && screenplayShots(s).length === 1) fail('Debe quedar un plano.');
      if (destination !== s && screenplayShots(destination).length >= MAX_SHOTS_PER_SCENE)
        fail('La escena de destino ya tiene el máximo de planos.');
      if (op.afterId === node.id) fail('Un plano no se coloca tras sí mismo.');
      s.blocks.splice(index, end - index);
      let at = destination.blocks.length;
      if (op.afterId === null) at = 0;
      else if (op.afterId !== undefined) {
        const start = destination.blocks.findIndex((b) => b.type === 'shot' && b.id === op.afterId);
        if (start < 0) fail('Plano de destino inexistente.');
        at = destination.blocks.findIndex((b, i) => i > start && b.type === 'shot');
        if (at < 0) at = destination.blocks.length;
      }
      destination.blocks.splice(at, 0, ...segment);
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
    linkNewByName(
      next,
      project.ingredients,
      new Set(document.scenes.flatMap((scene) => [scene.id, ...scene.blocks.map((block) => block.id)])),
    );
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
module.exports = {
  linkedByName,
  applyElementPatch,
};
