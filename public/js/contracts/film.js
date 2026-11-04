/** Portable feature-film document: scenes as independent video nodes. No DOM, network or storage. */
export const FILM_SCHEMA = 'code-kai.feature-film';
export const FILM_VERSION = 6;
/** Version 1 documents (prompts only, no render state) are still read and upgraded on parse. */
const FILM_READABLE_VERSIONS = Object.freeze([1, 2, 3, 4, 5, 6]);
/** Historical API name: this bounds shot clips, not dramatic scenes. */
export const FILM_MAX_SCENES = 2000;
export const FILM_MAX_REFERENCES = 4;
export const FILM_MAX_SECONDS = 10;
/** MiniMax H3 frame counts follow 17k + 5 at 24 fps. Every clip is at most 10 seconds, with no exception. */
export const FILM_FRAME_OPTIONS = Object.freeze([124, 141, 158, 175, 192, 209, 226]);
export const FILM_FPS = 24;
/**
 * How a clip joins the one before it. auto: a new scene starts fresh (new) and another shot of the same scene is a cut
 * with continuity of action (cut). take: the same take goes on, guided by the last frames of the previous clip.
 * keyframe: a start frame is generated for the shot, from the end of the previous one. new: only the look of the scene.
 */
export const FILM_CONTINUITY_MODES = Object.freeze(['auto', 'take', 'cut', 'keyframe', 'new']);
/** The frames of the previous clip that guide a continuing take; they are repeated at its start and not played again. */
export const FILM_TAIL_FRAMES = 22;
export const FILM_DEFAULT_CONTINUITY = Object.freeze({
  mode: 'auto',
  note: '',
  noteSource: '',
  noteKey: '',
  frame: false,
  start: null,
});
/**
 * The aspect ratios of the author's Skalibur resolution selector, as the reduced pair the film stores
 * (1,85:1 is 37:20) and the name shown to the person.
 */
export const FILM_ASPECT_RATIOS = Object.freeze(
  [
    ['1:1', 'Cuadrado'],
    ['2:3', 'Retrato foto'],
    ['3:2', 'Foto'],
    ['3:4', 'Retrato estándar'],
    ['4:3', 'Estándar'],
    ['9:16', 'Retrato panorámico'],
    ['16:9', 'Panorámico'],
    ['21:9', 'Ultra panorámico'],
    ['4:5', 'Retrato'],
    ['5:4', 'Horizontal'],
    ['5:8', 'Retrato 10:16'],
    ['8:5', 'Horizontal 16:10'],
    ['3:7', 'Retrato ultra panorámico'],
    ['2:1', 'VR / Univisium'],
    ['1:2', 'Retrato alargado'],
    ['11:8', 'Academy 1,375:1'],
    ['143:100', 'Cine 1,43:1'],
    ['83:50', 'Cine 1,66:1'],
    ['37:20', 'Cine 1,85:1'],
    ['19:10', 'Cine 1,90:1'],
    ['11:5', 'Cine 2,20:1'],
    ['47:20', 'Cine 2,35:1'],
    ['239:100', 'Cine 2,39:1'],
    ['12:5', 'Cine 2,40:1'],
    ['69:25', 'Cine 2,76:1'],
  ].map(([value, name]) => Object.freeze({ value, name })),
);
export const FILM_STATUSES = Object.freeze(['pending', 'prompting', 'ready', 'failed']);
export const FILM_RENDER_STATES = Object.freeze([
  'idle',
  'conditioning',
  'generating',
  'finalizing',
  'failed',
]);
export const FILM_DEFAULT_PARAMS = Object.freeze({
  aspectRatio: '16:9',
  megapixels: 0.4,
  steps: 3,
  finalMegapixels: 1,
});

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const ENTRY_ID = /^[A-Za-z0-9_-]{1,140}$/;
const IMAGE =
  /^\/projects\/([a-f0-9-]{36})\/content\/[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.(?:png|jpe?g|webp|gif|bmp)$/i;
const PREVIEW = /^\/projects\/([a-f0-9-]{36})\/content\/[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.(?:mp4|webm)$/i;
const CONDITIONING_NAME = /^[A-Za-z0-9_-]{1,100}$/;
const LIMITS = Object.freeze({
  name: 120,
  title: 300,
  script: 12000,
  prompt: 6000,
  shot: 400,
  error: 1500,
  note: 900,
  look: 700,
});
const KEYS = Object.freeze({
  document: ['schema', 'version', 'id', 'revision', 'identity', 'source', 'params', 'scenes', 'looks'],
  identity: ['name'],
  source: ['projectId', 'name', 'origin', 'versionId', 'versionNumber'],
  params: ['aspectRatio', 'megapixels', 'steps', 'finalMegapixels'],
  scene: [
    'id',
    'sourceSceneId',
    'sourceShotId',
    'sourcePart',
    'sourceParts',
    'title',
    'script',
    'scriptHash',
    'status',
    'prompt',
    'creative',
    'promptSource',
    'promptHash',
    'continuity',
    'frames',
    'shot',
    'seed',
    'references',
    'referenceNotes',
    'sourceRemoved',
    'error',
    'conditioning',
    'preview',
    'final',
    'approved',
    'redo',
    'render',
    'renderError',
  ],
  // Version 1 stored an always-null video slot; it is accepted on read and dropped.
  legacyScene: ['video'],
  conditioning: ['name', 'key'],
  preview: ['url', 'seed', 'width', 'height', 'frames', 'version', 'key', 'overlap', 'guide'],
  final: ['url', 'seed', 'width', 'height', 'frames', 'version', 'key', 'overlap', 'guide'],
  continuity: ['mode', 'note', 'noteSource', 'noteKey', 'frame', 'start'],
  start: ['url', 'key'],
  look: ['text', 'key'],
  reference: ['id', 'kind', 'projectId', 'name', 'tag', 'image', 'picture'],
});

function fail(message) {
  throw new TypeError(message);
}
function record(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} inválido.`);
  const extra = Object.keys(value).find((key) => !keys.includes(key));
  if (extra) fail(`${label} contiene una propiedad desconocida: ${extra}.`);
  return value;
}
function text(value, max, label) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string' || value.length > max) fail(`${label} inválido.`);
  return value;
}

/** FNV-1a: detects that a scene's script changed since its prompt was written. */
export function filmHash(value) {
  let hash = 2166136261;
  for (const character of String(value ?? '')) hash = Math.imul(hash ^ character.codePointAt(0), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Nearest supported clip length that never exceeds ten seconds. */
export function snapFilmFrames(seconds) {
  const wanted = Number(seconds);
  if (!Number.isFinite(wanted)) return FILM_FRAME_OPTIONS[0];
  const frames = wanted * FILM_FPS;
  return FILM_FRAME_OPTIONS.reduce((best, option) =>
    Math.abs(option - frames) < Math.abs(best - frames) ? option : best,
  );
}
export const filmSeconds = (frames) => Math.round((frames / FILM_FPS) * 100) / 100;

/** A tag is the visible label of a reference: `<Picture 1> / <Carlos>`. Angle brackets are never part of it. */
export function filmReferenceTag(name) {
  return String(name ?? '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}
export const filmPictureLabel = (reference) =>
  `<Picture ${reference.picture}>${reference.tag ? ` / <${reference.tag}>` : ''}`;

export const filmImage = (url) => typeof url === 'string' && IMAGE.test(url);

export function emptyFilmDocument({ id, name = '' } = {}) {
  return validateFilmDocument({
    schema: FILM_SCHEMA,
    version: FILM_VERSION,
    id,
    revision: 0,
    identity: { name },
    source: null,
    params: { ...FILM_DEFAULT_PARAMS },
    scenes: [],
    looks: {},
  });
}

function normalizeReference(value, index) {
  record(value, KEYS.reference, 'Referencia');
  if (!['character', 'stage', 'continuity'].includes(value.kind)) fail('Tipo de referencia inválido.');
  if (!UUID.test(value.projectId ?? '')) fail('Proyecto de referencia inválido.');
  const image = value.image ?? '';
  if (image !== '' && !filmImage(image)) fail('Imagen de referencia inválida.');
  if (!Number.isSafeInteger(value.picture) || value.picture !== index + 1)
    fail('Orden de referencias inválido.');
  return {
    id: text(value.id, 80, 'ID de referencia') || `ref_${index + 1}`,
    kind: value.kind,
    projectId: value.projectId,
    name: text(value.name, LIMITS.name, 'Nombre de referencia'),
    tag: filmReferenceTag(value.tag),
    image,
    picture: index + 1,
  };
}

function normalizeConditioning(value) {
  if (value === undefined || value === null) return null;
  record(value, KEYS.conditioning, 'Conditioning');
  if (typeof value.name !== 'string' || !CONDITIONING_NAME.test(value.name)) fail('Conditioning inválido.');
  return { name: value.name, key: text(value.key, 16, 'Huella del conditioning') };
}
function normalizePreview(value, keys = KEYS.preview, label = 'Previsualización') {
  if (value === undefined || value === null) return null;
  record(value, keys, label);
  if (typeof value.url !== 'string' || !PREVIEW.test(value.url)) fail(`${label} inválida.`);
  for (const key of ['seed', 'width', 'height', 'frames', 'version'])
    if (!Number.isSafeInteger(value[key]) || value[key] < 0) fail(`${label} inválida.`);
  if (!FILM_FRAME_OPTIONS.includes(value.frames)) fail(`Duración de ${label.toLowerCase()} inválida.`);
  // The first frames of a clip that continues the previous one repeat its end: they are not played again.
  const overlap = value.overlap ?? 0;
  if (!Number.isSafeInteger(overlap) || overlap < 0 || overlap > FILM_TAIL_FRAMES) fail(`${label} inválida.`);
  return {
    overlap,
    guide: text(value.guide, 40, `Guía de ${label.toLowerCase()}`),
    url: value.url,
    seed: value.seed,
    width: value.width,
    height: value.height,
    frames: value.frames,
    version: value.version,
    key: text(value.key, 16, `Huella de ${label.toLowerCase()}`),
  };
}

function normalizeContinuity(value) {
  if (value === undefined || value === null) return { ...FILM_DEFAULT_CONTINUITY };
  record(value, KEYS.continuity, 'Continuidad');
  const mode = value.mode ?? 'auto';
  if (!FILM_CONTINUITY_MODES.includes(mode)) fail('Modo de continuidad inválido.');
  const noteSource = value.noteSource ?? '';
  if (!['', 'llm', 'manual'].includes(noteSource)) fail('Origen de la nota de continuidad inválido.');
  let start = null;
  if (value.start !== undefined && value.start !== null) {
    record(value.start, KEYS.start, 'Fotograma inicial');
    if (!filmImage(value.start.url)) fail('Fotograma inicial inválido.');
    start = { url: value.start.url, key: text(value.start.key, 40, 'Huella del fotograma inicial') };
  }
  return {
    mode,
    note: text(value.note, LIMITS.note, 'Nota de continuidad'),
    noteSource,
    noteKey: text(value.noteKey, 40, 'Huella de la nota de continuidad'),
    frame: value.frame === true,
    start,
  };
}

function normalizeScene(value) {
  record(value, [...KEYS.scene, ...KEYS.legacyScene], 'Escena');
  if (!UUID.test(value.id ?? '')) fail('ID de escena inválido.');
  if (typeof value.sourceSceneId !== 'string' || !ENTRY_ID.test(value.sourceSceneId))
    fail('Escena de origen inválida.');
  const sourceShotId = value.sourceShotId ?? value.sourceSceneId;
  if (typeof sourceShotId !== 'string' || !ENTRY_ID.test(sourceShotId)) fail('Plano de origen inválido.');
  const status = value.status ?? 'pending';
  if (!FILM_STATUSES.includes(status)) fail('Estado de escena inválido.');
  const frames = value.frames ?? FILM_FRAME_OPTIONS[0];
  if (!FILM_FRAME_OPTIONS.includes(frames)) fail('Duración de escena inválida.');
  const references = value.references ?? [];
  if (!Array.isArray(references) || references.length > FILM_MAX_REFERENCES)
    fail('Referencias de escena inválidas.');
  // A shot with more dialogue than a clip holds is several clips: this is part N of M, in order.
  const sourceParts = value.sourceParts ?? 1;
  const sourcePart = value.sourcePart ?? 1;
  if (!Number.isSafeInteger(sourceParts) || sourceParts < 1 || sourceParts > 50)
    fail('Partes de plano inválidas.');
  if (!Number.isSafeInteger(sourcePart) || sourcePart < 1 || sourcePart > sourceParts)
    fail('Parte de plano inválida.');
  // What the author should know about the references of the clip: who has no photo, who the model cited without one.
  const referenceNotes = value.referenceNotes ?? [];
  if (
    !Array.isArray(referenceNotes) ||
    referenceNotes.length > 8 ||
    referenceNotes.some((note) => typeof note !== 'string' || note.length > 200)
  )
    fail('Avisos de referencias inválidos.');
  const continuity = normalizeContinuity(value.continuity);
  const promptSource = value.promptSource ?? '';
  if (!['', 'llm', 'manual'].includes(promptSource)) fail('Origen del prompt inválido.');
  if (value.video !== undefined && value.video !== null) fail('Formato de video antiguo inválido.');
  const conditioning = normalizeConditioning(value.conditioning);
  const preview = normalizePreview(value.preview);
  const final = normalizePreview(value.final, KEYS.final, 'Video final');
  const render = value.render ?? 'idle';
  if (!FILM_RENDER_STATES.includes(render)) fail('Estado de generación inválido.');
  const redo = value.redo ?? 0;
  if (!Number.isSafeInteger(redo) || redo < 0) fail('Orden de repetición inválido.');
  const seed = value.seed ?? 0;
  if (!Number.isSafeInteger(seed) || seed < 0) fail('Semilla inválida.');
  return {
    id: value.id,
    sourceSceneId: value.sourceSceneId,
    sourceShotId,
    sourcePart,
    sourceParts,
    title: text(value.title, LIMITS.title, 'Título de escena'),
    script: text(value.script, LIMITS.script, 'Texto de la escena'),
    scriptHash: text(value.scriptHash, 16, 'Huella de la escena'),
    status,
    prompt: text(value.prompt, LIMITS.prompt, 'Prompt'),
    creative: text(value.creative, LIMITS.prompt, 'Descripción creativa'),
    continuity,
    promptSource,
    promptHash: text(value.promptHash, 16, 'Huella del prompt'),
    frames,
    shot: text(value.shot, LIMITS.shot, 'Plano'),
    seed,
    references: references.map(normalizeReference),
    referenceNotes,
    sourceRemoved: value.sourceRemoved === true,
    error: text(value.error, LIMITS.error, 'Error de escena'),
    conditioning,
    preview,
    final,
    approved: value.approved === true && preview !== null,
    redo,
    render,
    renderError: text(value.renderError, LIMITS.error, 'Error de generación'),
  };
}

/** Strict normalization; unknown keys are rejected so a stale writer cannot smuggle new state. */
export function validateFilmDocument(value) {
  record(value, KEYS.document, 'Película');
  if (value.schema !== FILM_SCHEMA || !FILM_READABLE_VERSIONS.includes(value.version))
    fail('Esquema de película inválido.');
  if (!UUID.test(value.id ?? '')) fail('ID de película inválido.');
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) fail('Revisión de película inválida.');
  record(value.identity, KEYS.identity, 'Identidad');
  let source = null;
  if (value.source) {
    record(value.source, KEYS.source, 'Origen');
    if (!UUID.test(value.source.projectId ?? '')) fail('Guión de origen inválido.');
    if (!['version', 'draft', 'legacy'].includes(value.source.origin)) fail('Origen del guión inválido.');
    source = {
      projectId: value.source.projectId,
      name: text(value.source.name, LIMITS.name, 'Nombre del guión'),
      origin: value.source.origin,
      versionId: value.source.versionId ? text(value.source.versionId, 80, 'Versión') : '',
      versionNumber: Number.isSafeInteger(value.source.versionNumber) ? value.source.versionNumber : 0,
    };
  }
  const params = { ...FILM_DEFAULT_PARAMS, ...(value.params ?? {}) };
  record(params, KEYS.params, 'Parámetros');
  if (!/^\d{1,3}:\d{1,3}$/.test(params.aspectRatio) || params.aspectRatio.split(':').includes('0'))
    fail('Proporción inválida.');
  if (typeof params.megapixels !== 'number' || !(params.megapixels >= 0.1 && params.megapixels <= 16))
    fail('Megapíxeles inválidos.');
  if (!Number.isSafeInteger(params.steps) || params.steps < 1 || params.steps > 10) fail('Pasos inválidos.');
  if (
    typeof params.finalMegapixels !== 'number' ||
    !(params.finalMegapixels >= 0.1 && params.finalMegapixels <= 16)
  )
    fail('Megapíxeles finales inválidos.');
  const scenesSource = value.scenes ?? [];
  if (!Array.isArray(scenesSource) || scenesSource.length > FILM_MAX_SCENES) fail('Escenas inválidas.');
  const scenes = scenesSource.map(normalizeScene);
  const looks = {};
  for (const [id, look] of Object.entries(value.looks ?? {})) {
    if (!ENTRY_ID.test(id)) fail('Escena de la ficha de aspecto inválida.');
    record(look, KEYS.look, 'Ficha de aspecto');
    looks[id] = {
      text: text(look.text, LIMITS.look, 'Ficha de aspecto'),
      key: text(look.key, 40, 'Huella de la ficha de aspecto'),
    };
  }
  if (new Set(scenes.map((scene) => scene.id)).size !== scenes.length) fail('Escenas repetidas.');
  if (new Set(scenes.map(filmSourceKey)).size !== scenes.length) fail('Planos de origen repetidos.');
  for (const scene of scenes)
    if (new Set(scene.references.map((reference) => reference.tag)).size !== scene.references.length)
      fail('Las referencias de una escena necesitan nombres distintos.');
  return {
    schema: FILM_SCHEMA,
    version: FILM_VERSION,
    id: value.id,
    revision: value.revision,
    identity: { name: text(value.identity.name, LIMITS.name, 'Nombre') },
    source,
    params: {
      aspectRatio: params.aspectRatio,
      megapixels: params.megapixels,
      steps: params.steps,
      finalMegapixels: params.finalMegapixels,
    },
    scenes,
    looks,
  };
}

/** Null for content that is not a film document (empty or legacy prose). A malformed claim throws. */
export function parseFilmDocument(content) {
  if (typeof content !== 'string' || !content.trim().startsWith('{')) return null;
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  return parsed?.schema === FILM_SCHEMA ? validateFilmDocument(parsed) : null;
}

/** A feature film is a video project of category feature. */
export const isFilmProject = (project) => project?.type === 'video' && project?.category === 'feature';

/** A feature film starts as an empty document; nothing is invented and legacy prose is not interpreted. */
export function prepareFilmProject(project) {
  const existing = parseFilmDocument(project.content || '');
  project.content = JSON.stringify(
    existing ?? emptyFilmDocument({ id: project.id, name: (project.name || '').slice(0, 120) }),
  );
  return project;
}

export const filmHasScenes = (document) => document.scenes.length > 0;
/** An automatic prompt that still cites references as <Picture N> predates named references and is rewritten. */
const LEGACY_REFERENCE = /<Picture \d+>/;
export const filmSceneNeedsPrompt = (scene) =>
  !scene.sourceRemoved &&
  (!scene.prompt ||
    (scene.promptSource !== 'manual' &&
      (scene.promptHash !== scene.scriptHash || LEGACY_REFERENCE.test(scene.prompt))));

/**
 * Width and height of a preview: the project's aspect ratio and megapixels, aligned to H3's 32 pixel grid. One
 * megapixel is 1024 x 1024 pixels, as in the author's Skalibur resolution selector.
 */
export function filmDimensions(params) {
  const [w, h] = String(params.aspectRatio).split(':').map(Number);
  const scale = Math.sqrt((params.megapixels * 1024 * 1024) / (w * h));
  return {
    width: Math.max(32, Math.round((w * scale) / 32) * 32),
    height: Math.max(32, Math.round((h * scale) / 32) * 32),
  };
}

/**
 * The final video of a clip: the approved preview's base pass (same conditioning, seed, size and length) enlarged and
 * refined by the H3 latent upscaler to the film's final megapixels. Its size follows the preview's proportions on the
 * same 32 pixel grid the upscaler uses.
 */
export function filmFinalDimensions(preview, megapixels) {
  const height = Math.sqrt((megapixels * 1024 * 1024 * preview.height) / preview.width);
  const width = (height * preview.width) / preview.height;
  return {
    width: Math.max(32, Math.round(width / 32) * 32),
    height: Math.max(32, Math.round(height / 32) * 32),
  };
}
/** Identity of what a final video was made from: the preview it enlarges and the target size and refinement steps. */
export const filmFinalKey = (scene, params) =>
  scene.preview
    ? filmHash(
        JSON.stringify([
          scene.preview.key,
          scene.preview.seed,
          scene.preview.width,
          scene.preview.height,
          scene.preview.frames,
          scene.preview.guide || '',
          params.finalMegapixels,
          params.steps,
        ]),
      )
    : '';
/** A preview made at another size than the film's current preview resolution is out of date. */
export function filmPreviewOutdated(scene, params, guide) {
  if (!scene.preview) return false;
  const { width, height } = filmDimensions(params);
  // A clip made to follow another is also out of date when what it followed has changed.
  if (guide !== undefined && (scene.preview.guide || '') !== guide) return true;
  return scene.preview.width !== width || scene.preview.height !== height;
}
/** True when the approved preview can be enlarged: the target must be larger than the preview. */
export function filmFinalBlocked(scene, params, guide) {
  if (scene.sourceRemoved) return 'Este plano ya no está en el guión.';
  if (!scene.preview) return 'Primero genera la previsualización.';
  if (filmPreviewOutdated(scene, params, guide))
    return 'La previsualización es de otra resolución, proporción o continuidad; genérala de nuevo.';
  if (!scene.approved) return 'Aprueba la previsualización para generar el video final.';
  if (!scene.conditioning || scene.conditioning.key !== scene.preview.key)
    return 'La previsualización es de un prompt anterior; genérala de nuevo.';
  const target = filmFinalDimensions(scene.preview, params.finalMegapixels);
  if (target.width <= scene.preview.width && target.height <= scene.preview.height)
    return 'La resolución final debe ser mayor que la de la previsualización.';
  return '';
}
/** 'none' (no final yet), 'ready' or 'stale' (the preview or the target changed since). */
export const filmFinalState = (scene, params) =>
  !scene.final ? 'none' : scene.final.key === filmFinalKey(scene, params) ? 'ready' : 'stale';
export const filmNeedsFinal = (scene, params, guide) =>
  !filmFinalBlocked(scene, params, guide) && filmFinalState(scene, params) !== 'ready';

/**
 * The dramatic scenes of the script, in order of first appearance: the unit the author works on. A scene gathers its
 * clips (shots and their parts), including the ones that left the script.
 */
export function filmScenesOf(document) {
  const groups = new Map();
  for (const clip of document.scenes) {
    if (!groups.has(clip.sourceSceneId))
      groups.set(clip.sourceSceneId, { id: clip.sourceSceneId, number: groups.size + 1, clips: [] });
    groups.get(clip.sourceSceneId).clips.push(clip);
  }
  return [...groups.values()].map((group) => {
    const live = group.clips.find((clip) => !clip.sourceRemoved) || group.clips[0];
    return { ...group, place: live.title.split('—').slice(1).join('—').trim() };
  });
}

/** Identity of everything the saved conditioning was computed from: prompt and named references, never the size. */
export function filmConditioningKey(scene) {
  return filmHash(
    JSON.stringify([
      scene.prompt,
      scene.references.map((reference) => [reference.tag, reference.projectId, reference.image]),
    ]),
  );
}
export const filmConditioningName = (document, scene) =>
  `${document.id.replace(/-/g, '').slice(0, 12)}-${scene.id.replace(/-/g, '').slice(0, 12)}`;
export const filmNeedsConditioning = (scene) =>
  !scene.sourceRemoved &&
  Boolean(scene.prompt) &&
  (!scene.conditioning || scene.conditioning.key !== filmConditioningKey(scene));

/** Pure reconciliation of script scenes with existing nodes: keeps ids, prompts and seeds of unchanged scenes. */
/** A clip is named by its scene, its shot and, when the shot is divided, its part: undivided shots keep their old key. */
export const filmSourceKey = (clip) =>
  `${clip.sourceSceneId}:${clip.sourceShotId ?? clip.sourceSceneId}` +
  ((clip.sourceParts ?? 1) > 1 ? `#${clip.sourcePart ?? 1}` : '');

export function reconcileFilmScenes(existing, incoming, newId) {
  const bySource = new Map(existing.map((scene) => [filmSourceKey(scene), scene]));
  const used = new Set();
  const result = incoming.map((scene) => {
    const previous = bySource.get(filmSourceKey(scene));
    used.add(filmSourceKey(scene));
    if (!previous)
      return {
        ...scene,
        id: newId(),
        frames: scene.frames ?? FILM_FRAME_OPTIONS[0],
        status: 'pending',
        prompt: '',
        promptSource: '',
        promptHash: '',
      };
    const changed = previous.scriptHash !== scene.scriptHash;
    return {
      ...previous,
      sourceShotId: scene.sourceShotId ?? scene.sourceSceneId,
      sourcePart: scene.sourcePart ?? 1,
      sourceParts: scene.sourceParts ?? 1,
      // The duration of a shot follows the screenplay when it changes; a shot that states none keeps the clip's own.
      frames: changed && scene.frames ? scene.frames : previous.frames,
      title: scene.title,
      script: scene.script,
      scriptHash: scene.scriptHash,
      shot: previous.promptSource === 'manual' ? previous.shot : scene.shot,
      sourceRemoved: false,
      // A manual prompt is never discarded; an automatic one becomes stale and is rewritten.
      status: changed && previous.promptSource !== 'manual' ? 'pending' : previous.status,
      error: '',
      renderError: '',
    };
  });
  // A clip that left the script keeps its prompt and its media in case the author brings it back; one that never
  // had either (a shot that failed before it was divided, say) has nothing to keep.
  for (const scene of existing)
    if (!used.has(filmSourceKey(scene)) && (scene.prompt || scene.preview || scene.conditioning))
      result.push({ ...scene, sourceRemoved: true });
  return result;
}

export function filmSummary(document) {
  const total = document.scenes.length;
  const ready = document.scenes.filter((scene) => scene.status === 'ready').length;
  const seconds = document.scenes.reduce((sum, scene) => sum + filmSeconds(scene.frames), 0);
  return { total, ready, seconds: Math.round(seconds * 100) / 100 };
}

// ── Continuity between clips ─────────────────────────────────────────────

/** The clip before this one in the film, the one it has to continue from. Clips that left the script do not count. */
export function filmPrevious(document, clip) {
  const live = document.scenes.filter((item) => !item.sourceRemoved);
  const index = live.findIndex((item) => item.id === clip.id);
  return index > 0 ? live[index - 1] : null;
}

/**
 * How the clip really joins the previous one: none (the first clip), new (another scene: only the look of the scene
 * carries over), cut (another shot of the same scene: the state of the action carries over), keyframe (a start frame
 * is made for the shot) or take (the same take goes on, guided by the end of the previous clip). A take needs a previous
 * clip of its own scene; without it the clip is a cut.
 */
export function filmContinuityMode(document, clip) {
  const previous = filmPrevious(document, clip);
  if (!previous) return 'none';
  const same = previous.sourceSceneId === clip.sourceSceneId;
  const wanted = clip.continuity?.mode ?? 'auto';
  if (wanted === 'auto') return same ? 'cut' : 'new';
  if (wanted === 'take') return same ? 'take' : 'cut';
  return wanted;
}

/** The frames a clip is generated with: a take also makes the repeated frames that guide it. */
export function filmTakeFrames(frames) {
  const wanted = frames + FILM_TAIL_FRAMES;
  return FILM_FRAME_OPTIONS.find((option) => option >= wanted) ?? FILM_FRAME_OPTIONS.at(-1);
}
/** What a clip's guide is made from, so that it is out of date when that changes: a take follows the preview it was made after. */
export function filmGuideKey(document, clip) {
  const mode = filmContinuityMode(document, clip);
  if (mode === 'take') {
    const previous = filmPrevious(document, clip);
    return previous?.preview ? `take:${previous.preview.key}:${previous.preview.version}` : '';
  }
  if (mode === 'keyframe') return clip.continuity?.start ? `start:${clip.continuity.start.key}` : '';
  return '';
}
/** What the previous clip's end looked like when a continuity note was written: the note is stale when it changes. */
export function filmNoteKey(document, clip) {
  const previous = filmPrevious(document, clip);
  return previous
    ? filmHash(
        JSON.stringify([
          previous.script,
          previous.prompt,
          previous.preview ? [previous.preview.key, previous.preview.version] : null,
          clip.scriptHash,
        ]),
      )
    : '';
}
/** The fingerprint of the script of a scene as the look sheet was written from it. */
export const filmLookKey = (document, sourceSceneId) =>
  filmHash(
    document.scenes
      .filter((item) => item.sourceSceneId === sourceSceneId && !item.sourceRemoved)
      .map((item) => item.scriptHash)
      .join('|'),
  );
