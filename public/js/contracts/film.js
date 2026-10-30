/** Portable feature-film document: scenes as independent video nodes. No DOM, network or storage. */
export const FILM_SCHEMA = 'code-kai.feature-film';
export const FILM_VERSION = 2;
/** Version 1 documents (prompts only, no render state) are still read and upgraded on parse. */
const FILM_READABLE_VERSIONS = Object.freeze([1, 2]);
export const FILM_MAX_SCENES = 200;
export const FILM_MAX_REFERENCES = 4;
export const FILM_MAX_SECONDS = 10;
/** MiniMax H3 frame counts follow 17k + 5 at 24 fps. Every clip is at most 10 seconds, with no exception. */
export const FILM_FRAME_OPTIONS = Object.freeze([124, 141, 158, 175, 192, 209, 226]);
export const FILM_FPS = 24;
export const FILM_STATUSES = Object.freeze(['pending', 'prompting', 'ready', 'failed']);
export const FILM_RENDER_STATES = Object.freeze(['idle', 'conditioning', 'generating', 'failed']);
export const FILM_DEFAULT_PARAMS = Object.freeze({ aspectRatio: '16:9', megapixels: 0.4, steps: 3 });

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const ENTRY_ID = /^[A-Za-z0-9_-]{1,140}$/;
const IMAGE =
  /^\/projects\/([a-f0-9-]{36})\/content\/[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.(?:png|jpe?g|webp|gif|bmp)$/i;
const PREVIEW = /^\/projects\/([a-f0-9-]{36})\/content\/[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.(?:mp4|webm)$/i;
const CONDITIONING_NAME = /^[A-Za-z0-9_-]{1,100}$/;
const LIMITS = Object.freeze({ name: 120, title: 300, script: 12000, prompt: 6000, shot: 400, error: 1500 });
const KEYS = Object.freeze({
  document: ['schema', 'version', 'id', 'revision', 'identity', 'source', 'params', 'scenes'],
  identity: ['name'],
  source: ['projectId', 'name', 'origin', 'versionId', 'versionNumber'],
  params: ['aspectRatio', 'megapixels', 'steps'],
  scene: [
    'id',
    'sourceSceneId',
    'title',
    'script',
    'scriptHash',
    'status',
    'prompt',
    'promptSource',
    'promptHash',
    'frames',
    'shot',
    'seed',
    'references',
    'sourceRemoved',
    'error',
    'conditioning',
    'preview',
    'approved',
    'redo',
    'render',
    'renderError',
  ],
  // Version 1 stored an always-null video slot; it is accepted on read and dropped.
  legacyScene: ['video'],
  conditioning: ['name', 'key'],
  preview: ['url', 'seed', 'width', 'height', 'frames', 'version', 'key'],
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
  });
}

function normalizeReference(value, index) {
  record(value, KEYS.reference, 'Referencia');
  if (!['character', 'stage'].includes(value.kind)) fail('Tipo de referencia inválido.');
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
function normalizePreview(value) {
  if (value === undefined || value === null) return null;
  record(value, KEYS.preview, 'Previsualización');
  if (typeof value.url !== 'string' || !PREVIEW.test(value.url)) fail('Previsualización inválida.');
  for (const key of ['seed', 'width', 'height', 'frames', 'version'])
    if (!Number.isSafeInteger(value[key]) || value[key] < 0) fail('Previsualización inválida.');
  if (!FILM_FRAME_OPTIONS.includes(value.frames)) fail('Duración de previsualización inválida.');
  return {
    url: value.url,
    seed: value.seed,
    width: value.width,
    height: value.height,
    frames: value.frames,
    version: value.version,
    key: text(value.key, 16, 'Huella de la previsualización'),
  };
}

function normalizeScene(value) {
  record(value, [...KEYS.scene, ...KEYS.legacyScene], 'Escena');
  if (!UUID.test(value.id ?? '')) fail('ID de escena inválido.');
  if (typeof value.sourceSceneId !== 'string' || !ENTRY_ID.test(value.sourceSceneId))
    fail('Escena de origen inválida.');
  const status = value.status ?? 'pending';
  if (!FILM_STATUSES.includes(status)) fail('Estado de escena inválido.');
  const frames = value.frames ?? FILM_FRAME_OPTIONS[0];
  if (!FILM_FRAME_OPTIONS.includes(frames)) fail('Duración de escena inválida.');
  const references = value.references ?? [];
  if (!Array.isArray(references) || references.length > FILM_MAX_REFERENCES)
    fail('Referencias de escena inválidas.');
  const promptSource = value.promptSource ?? '';
  if (!['', 'llm', 'manual'].includes(promptSource)) fail('Origen del prompt inválido.');
  if (value.video !== undefined && value.video !== null) fail('Formato de video antiguo inválido.');
  const conditioning = normalizeConditioning(value.conditioning);
  const preview = normalizePreview(value.preview);
  const render = value.render ?? 'idle';
  if (!FILM_RENDER_STATES.includes(render)) fail('Estado de generación inválido.');
  const redo = value.redo ?? 0;
  if (!Number.isSafeInteger(redo) || redo < 0) fail('Orden de repetición inválido.');
  const seed = value.seed ?? 0;
  if (!Number.isSafeInteger(seed) || seed < 0) fail('Semilla inválida.');
  return {
    id: value.id,
    sourceSceneId: value.sourceSceneId,
    title: text(value.title, LIMITS.title, 'Título de escena'),
    script: text(value.script, LIMITS.script, 'Texto de la escena'),
    scriptHash: text(value.scriptHash, 16, 'Huella de la escena'),
    status,
    prompt: text(value.prompt, LIMITS.prompt, 'Prompt'),
    promptSource,
    promptHash: text(value.promptHash, 16, 'Huella del prompt'),
    frames,
    shot: text(value.shot, LIMITS.shot, 'Plano'),
    seed,
    references: references.map(normalizeReference),
    sourceRemoved: value.sourceRemoved === true,
    error: text(value.error, LIMITS.error, 'Error de escena'),
    conditioning,
    preview,
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
  if (!/^\d{1,2}:\d{1,2}$/.test(params.aspectRatio)) fail('Proporción inválida.');
  if (typeof params.megapixels !== 'number' || !(params.megapixels >= 0.1 && params.megapixels <= 16))
    fail('Megapíxeles inválidos.');
  if (!Number.isSafeInteger(params.steps) || params.steps < 1 || params.steps > 10) fail('Pasos inválidos.');
  const scenesSource = value.scenes ?? [];
  if (!Array.isArray(scenesSource) || scenesSource.length > FILM_MAX_SCENES) fail('Escenas inválidas.');
  const scenes = scenesSource.map(normalizeScene);
  if (new Set(scenes.map((scene) => scene.id)).size !== scenes.length) fail('Escenas repetidas.');
  if (new Set(scenes.map((scene) => scene.sourceSceneId)).size !== scenes.length)
    fail('Escenas de origen repetidas.');
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
    params: { aspectRatio: params.aspectRatio, megapixels: params.megapixels, steps: params.steps },
    scenes,
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
export function reconcileFilmScenes(existing, incoming, newId) {
  const bySource = new Map(existing.map((scene) => [scene.sourceSceneId, scene]));
  const used = new Set();
  const result = incoming.map((scene) => {
    const previous = bySource.get(scene.sourceSceneId);
    used.add(scene.sourceSceneId);
    if (!previous)
      return { ...scene, id: newId(), status: 'pending', prompt: '', promptSource: '', promptHash: '' };
    const changed = previous.scriptHash !== scene.scriptHash;
    return {
      ...previous,
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
  for (const scene of existing)
    if (!used.has(scene.sourceSceneId)) result.push({ ...scene, sourceRemoved: true });
  return result;
}

export function filmSummary(document) {
  const total = document.scenes.length;
  const ready = document.scenes.filter((scene) => scene.status === 'ready').length;
  const seconds = document.scenes.reduce((sum, scene) => sum + filmSeconds(scene.frames), 0);
  return { total, ready, seconds: Math.round(seconds * 100) / 100 };
}
