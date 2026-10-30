import { escapeHTML } from './common.js';
export { identifier, reference };
export const SCREENPLAY_SCHEMA = 'code-kai.screenplay';

export const SCREENPLAY_TYPES = Object.freeze({
  action: 'p',
  character: 'h3',
  dialogue: 'blockquote',
  parenthetical: 'h4',
  transition: 'h5',
});

export const SCREENPLAY_LABELS = Object.freeze({
  title: 'Título',
  scene: 'Escena',
  action: 'Acción',
  character: 'Personaje',
  dialogue: 'Diálogo',
  parenthetical: 'Acotación',
  transition: 'Transición',
});

/** Fixed scene sheet. Missing legacy keys are upgraded, never inferred from prose. */
export const SCREENPLAY_SCENE_FIELDS = Object.freeze({
  synopsis: 'Sinopsis',
  purpose: 'Propósito dramático',
  characters: 'Personajes',
  goal: 'Objetivo',
  conflict: 'Conflicto',
  stakes: 'Qué está en juego',
  emotionalShift: 'Cambio emocional',
  outcome: 'Resultado',
  continuity: 'Continuidad',
  tone: 'Tono',
  duration: 'Duración estimada',
});

export function screenplayNarrative(value = {}) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !Object.hasOwn(SCREENPLAY_SCENE_FIELDS, key))
  )
    throw Object.assign(new Error('Guión inválido: ficha narrativa'), { status: 400 });
  return Object.fromEntries(
    Object.keys(SCREENPLAY_SCENE_FIELDS).map((key) => {
      const text = value[key] === undefined ? '' : value[key];
      if (typeof text !== 'string' || text.length > 10000)
        throw Object.assign(new Error('Guión inválido: propiedad narrativa'), { status: 400 });
      return [key, text];
    }),
  );
}

export const SCREENPLAY_VOICES = Object.freeze({
  '': 'Normal',
  'V.O.': 'V.O.',
  'O.S.': 'O.S.',
  'O.C.': 'O.C.',
  OFF: 'OFF',
  'CONT.': 'CONT.',
});

export const SCREENPLAY_SHOTS = Object.freeze([
  'Gran plano general',
  'Plano general',
  'Plano entero',
  'Plano americano',
  'Plano medio largo',
  'Plano medio',
  'Primer plano',
  'Primerísimo primer plano',
  'Plano detalle',
]);

export function screenplayCharacter(text) {
  const match = String(text).match(/\s*\((V\.?O\.?|O\.?S\.?|O\.?C\.?|OFF|CONT\.?)\)\s*$/i);
  const raw = match?.[1]?.replaceAll('.', '').toUpperCase();
  const voice = { VO: 'V.O.', OS: 'O.S.', OC: 'O.C.', OFF: 'OFF', CONT: 'CONT.' }[raw] || '';
  return { name: match ? text.slice(0, match.index).trimEnd() : text, voice };
}

const identifier = /^[A-Za-z0-9_-]{1,140}$/;

const reference = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function screenplayId() {
  return 'script-' + globalThis.crypto.randomUUID();
}

export function validateScreenplayDocument(input, cleanInline = (html) => html) {
  const error = (message) => {
    throw Object.assign(new Error('Guión inválido: ' + message), { status: 400 });
  };
  const object = (value, keys) => {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).some((key) => !keys.includes(key))
    )
      error('campos desconocidos');
  };
  object(input, ['schema', 'version', 'title', 'preamble', 'scenes']);
  if (input.schema !== SCREENPLAY_SCHEMA || input.version !== 1) error('esquema o versión');
  if (JSON.stringify(input).length > 2000000) error('documento demasiado grande');
  const ids = new Set();
  const id = (value) => {
    if (typeof value !== 'string' || !identifier.test(value) || ids.has(value))
      error('identificador duplicado o inválido');
    ids.add(value);
  };
  let count = 0;
  const format = (html) => {
    if (/<\/?(?:div|p|h[1-6]|blockquote|pre|ul|ol|li|table|section|article)\b/i.test(html))
      error('el formato debe ser texto en línea');
    return cleanInline(html);
  };
  const block = (value, title = false) => {
    object(value, ['id', 'type', 'text', 'html', 'speakerId', 'characterId', 'voice']);
    id(value.id);
    if ((title ? value.type !== 'title' : !Object.hasOwn(SCREENPLAY_TYPES, value.type)) || ++count > 10000)
      error('tipo o número de bloques');
    if (
      typeof value.text !== 'string' ||
      value.text.length > 100000 ||
      typeof value.html !== 'string' ||
      value.html.length > 200000
    )
      error('texto o formato');
    if ('characterId' in value && (value.type !== 'character' || !reference.test(value.characterId)))
      error('referencia de personaje');
    if (
      'speakerId' in value &&
      (!['dialogue', 'parenthetical'].includes(value.type) || !identifier.test(value.speakerId))
    )
      error('referencia de hablante');
    if ('voice' in value && (value.type !== 'character' || !Object.hasOwn(SCREENPLAY_VOICES, value.voice)))
      error('tipo de voz');
    return {
      ...value,
      ...(value.type === 'character' ? { voice: value.voice ?? screenplayCharacter(value.text).voice } : {}),
      html: format(value.html),
    };
  };
  const blocks = (values) => {
    if (!Array.isArray(values)) error('lista de bloques');
    const result = values.map((value) => block(value));
    const speakers = new Set(result.filter((value) => value.type === 'character').map((value) => value.id));
    if (result.some((value) => value.speakerId && !speakers.has(value.speakerId)))
      error('hablante fuera de la escena');
    return result;
  };
  const title = block(input.title, true);
  const preamble = blocks(input.preamble);
  if (!Array.isArray(input.scenes) || input.scenes.length > 2000) error('lista de escenas');
  const scenes = input.scenes.map((scene) => {
    object(scene, ['id', 'heading', 'blocks', 'origins', 'locationId', 'narrative']);
    id(scene.id);
    if (scene.locationId !== undefined && !reference.test(scene.locationId)) error('referencia de locación');
    if (scene.origins !== undefined) {
      if (!Array.isArray(scene.origins) || scene.origins.length > 20) error('fuentes de escena');
      for (const origin of scene.origins) {
        object(origin, ['projectId', 'source', 'versionId', 'versionNumber', 'elementIds']);
        if (!reference.test(origin.projectId) || !['version', 'draft', 'legacy'].includes(origin.source))
          error('fuente de escena');
        if (
          origin.source === 'version' &&
          (!reference.test(origin.versionId) ||
            !Number.isInteger(origin.versionNumber) ||
            origin.versionNumber < 1)
        )
          error('versión de origen');
        if (
          origin.source !== 'version' &&
          (origin.versionId !== undefined || origin.versionNumber !== undefined)
        )
          error('versión de origen');
        if (
          !Array.isArray(origin.elementIds) ||
          origin.elementIds.length > 200 ||
          new Set(origin.elementIds).size !== origin.elementIds.length ||
          origin.elementIds.some((value) => typeof value !== 'string' || !identifier.test(value))
        )
          error('elementos de origen');
      }
    }
    object(scene.heading, ['text', 'html', 'interiorExterior', 'location', 'time', 'shot']);
    if (
      scene.heading.shot !== undefined &&
      (typeof scene.heading.shot !== 'string' || scene.heading.shot.length > 1000)
    )
      error('tipo de plano');
    for (const key of ['text', 'html', 'interiorExterior', 'location', 'time'])
      if (
        typeof scene.heading[key] !== 'string' ||
        scene.heading[key].length > (key === 'html' ? 20000 : 10000)
      )
        error('encabezado');
    if (!['', 'INT', 'EXT', 'INT/EXT', 'EXT/INT'].includes(scene.heading.interiorExterior))
      error('interior/exterior');
    const result = {
      ...scene,
      heading: { ...scene.heading, html: format(scene.heading.html) },
      blocks: blocks(scene.blocks),
    };
    // The retired sheet is read only for compatibility; empty fields are not recreated.
    if (scene.narrative !== undefined) {
      const legacy = screenplayNarrative(scene.narrative);
      if (Object.values(legacy).some(Boolean)) result.narrative = legacy;
      else delete result.narrative;
    }
    const parsedHeading = screenplayHeading(scene.heading.text, result.heading.html);
    if (scene.heading.shot === undefined && parsedHeading.shot) {
      result.heading.shot = parsedHeading.shot;
      result.heading.time = parsedHeading.time;
    }
    return result;
  });
  return { schema: SCREENPLAY_SCHEMA, version: 1, title, preamble, scenes };
}

export function screenplayHeading(text, html = escapeHTML(text)) {
  const shot = text.match(/\(([^()]*plano[^()]*)\)\s*$/i)?.[1] || '';
  const match = (shot ? text.replace(/\s*\([^()]*plano[^()]*\)\s*$/i, '') : text)
    .replace(/^\s*ESCENA\s+\d+\s*[:.\-]\s*/i, '')
    .match(/^\s*(INT\/EXT|EXT\/INT|INT|EXT)\.?\s+(.+?)(?:\s+[—–-]\s+(.+))?$/i);
  return {
    text,
    html,
    interiorExterior: match?.[1]?.toUpperCase() || '',
    location: match?.[2] || '',
    time: match?.[3] || '',
    ...(shot ? { shot } : {}),
  };
}

export function screenplaySceneDocument(scene) {
  const ids = new Set([
    scene?.id,
    ...(Array.isArray(scene?.blocks) ? scene.blocks : []).map((block) => block?.id),
  ]);
  let index = 0;
  while (ids.has(`projection-title-${index}`)) index++;
  return {
    schema: SCREENPLAY_SCHEMA,
    version: 1,
    title: { id: `projection-title-${index}`, type: 'title', text: '', html: '' },
    preamble: [],
    scenes: [scene],
  };
}

export function screenplayContext(doc) {
  const nodes = [{ id: doc.title.id, kind: 'title', text: doc.title.text, dates: [], temporalContext: [] }];
  const add = (block, scene) =>
    nodes.push({
      id: block.id,
      kind: block.type,
      text: block.text,
      sceneId: scene?.id,
      scene: scene?.heading.text,
      speakerId: block.speakerId,
      characterId: block.characterId,
      ...(block.type === 'character' ? { voice: block.voice ?? screenplayCharacter(block.text).voice } : {}),
      dates: [],
      temporalContext: [],
    });
  doc.preamble.forEach((block) => add(block));
  doc.scenes.forEach((scene) => {
    nodes.push({
      id: scene.id,
      kind: 'scene',
      text: scene.heading.text,
      heading: scene.heading,
      origins: scene.origins,
      locationId: scene.locationId,
      ...(scene.narrative ? { narrative: screenplayNarrative(scene.narrative) } : {}),
      dates: [],
      temporalContext: [],
    });
    scene.blocks.forEach((block) => add(block, scene));
  });
  return {
    nodes,
    text: nodes
      .map((node) => {
        const sheet = node.narrative
          ? Object.entries(node.narrative)
              .filter(([, value]) => value)
              .map(([key, value]) => `${SCREENPLAY_SCENE_FIELDS[key]}: ${value}`)
              .join('\n')
          : '';
        return `${SCREENPLAY_LABELS[node.kind].toUpperCase()}: ${node.text}` + (sheet ? '\n' + sheet : '');
      })
      .join('\n\n'),
  };
}
