/** Portable scenario document: validation and normalization only. No DOM, network or storage. */
export const SCENARIO_SCHEMA = 'code-kai.scenario';
export const SCENARIO_VERSION = 1;
export const SCENARIO_KINDS = Object.freeze({ interior: 'Interior', exterior: 'Exterior' });
export const SCENARIO_CREATION_MODES = Object.freeze(['description', 'image', 'options', 'ingredients']);
export const SCENARIO_MAX_REFERENCES = 8;
export const SCENARIO_TRASH_LIMIT = 100;
export const SCENARIO_FIELDS = Object.freeze([
  Object.freeze({ key: 'period', label: 'Época y lugar', max: 200 }),
  Object.freeze({ key: 'timeOfDay', label: 'Momento del día', max: 120 }),
  Object.freeze({ key: 'atmosphere', label: 'Atmósfera', max: 400 }),
  Object.freeze({ key: 'lighting', label: 'Iluminación', max: 400 }),
  Object.freeze({ key: 'style', label: 'Estilo visual', max: 400 }),
  Object.freeze({ key: 'keyElements', label: 'Elementos clave', max: 800 }),
]);
/** The four angles of one scenario; the panorama is stored separately. */
export const SCENARIO_VIEWS = Object.freeze([
  Object.freeze({
    id: 'establishing',
    label: 'Plano general',
    direction:
      'Wide establishing shot at eye level, the whole space readable, a clear foreground, midground and background',
  }),
  Object.freeze({
    id: 'reverse',
    label: 'Contraplano',
    direction:
      'Reverse angle looking back from the opposite side of the space, showing what the establishing shot hides',
  }),
  Object.freeze({
    id: 'high',
    label: 'Vista elevada',
    direction:
      'High vantage point looking down at roughly 45 degrees, revealing the layout and the relation between areas',
  }),
  Object.freeze({
    id: 'detail',
    label: 'Perspectiva baja',
    direction:
      'Low camera close to the ground with a wide lens, a dramatic foreground element and the space receding behind it',
  }),
]);

const IMAGE =
  /^\/projects\/([a-f0-9-]{36})\/content\/([A-Za-z0-9][A-Za-z0-9._-]{0,150}\.(?:png|jpe?g|webp|gif|bmp))$/i;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const ENTRY_ID = /^[A-Za-z0-9_-]{1,80}$/;
const LIMITS = Object.freeze({ name: 120, description: 4000, request: 12000, legacy: 60000, history: 40 });
const KEYS = Object.freeze({
  document: [
    'schema',
    'version',
    'id',
    'revision',
    'identity',
    'creation',
    'fields',
    'description',
    'request',
    'history',
    'panorama',
    'views',
    'archive',
    'legacyText',
  ],
  identity: ['name', 'kind'],
  creation: ['mode', 'references', 'initialState'],
  image: ['url', 'prompt', 'generatedAt'],
  view: ['id', 'label', 'url', 'prompt', 'generatedAt'],
  turn: ['id', 'source', 'text', 'status', 'message', 'at'],
  trash: ['url', 'slot', 'prompt', 'generatedAt', 'archivedAt'],
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
function text(value, max, label, { allowEmpty = true } = {}) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim()))
    fail(`${label} inválido.`);
  return value;
}
const isoDate = (value) => (typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : '');
export const scenarioImage = (url, projectId) => {
  const match = typeof url === 'string' ? IMAGE.exec(url) : null;
  return Boolean(match) && (!projectId || match[1] === projectId);
};

export function emptyScenarioDocument({ id, name = '', kind = '' } = {}) {
  return validateScenarioDocument({
    schema: SCENARIO_SCHEMA,
    version: SCENARIO_VERSION,
    id,
    revision: 0,
    identity: { name, kind },
    creation: { mode: '', references: [], initialState: '' },
    fields: {},
    description: '',
    request: '',
    history: [],
    panorama: null,
    views: [],
    archive: [],
  });
}

function normalizeImage(value, projectId, label) {
  record(value, KEYS.image, label);
  if (!scenarioImage(value.url, projectId)) fail(`${label}: la imagen no pertenece a este escenario.`);
  return {
    url: value.url,
    prompt: text(value.prompt, 6000, `${label}: prompt`),
    generatedAt: isoDate(value.generatedAt),
  };
}

/** Strict normalization; unknown keys are rejected so a stale writer cannot smuggle new state. */
export function validateScenarioDocument(value) {
  record(value, KEYS.document, 'Escenario');
  if (value.schema !== SCENARIO_SCHEMA || value.version !== SCENARIO_VERSION)
    fail('Esquema de escenario inválido.');
  if (typeof value.id !== 'string' || !UUID.test(value.id)) fail('ID de escenario inválido.');
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) fail('Revisión de escenario inválida.');
  record(value.identity, KEYS.identity, 'Identidad');
  const kind = value.identity.kind ?? '';
  if (kind !== '' && !Object.hasOwn(SCENARIO_KINDS, kind)) fail('Tipo de escenario inválido.');
  record(value.creation, KEYS.creation, 'Creación');
  const mode = value.creation.mode ?? '';
  if (mode !== '' && !SCENARIO_CREATION_MODES.includes(mode)) fail('Vía de creación inválida.');
  const references = value.creation.references ?? [];
  if (
    !Array.isArray(references) ||
    references.length > SCENARIO_MAX_REFERENCES ||
    new Set(references).size !== references.length ||
    references.some((url) => !scenarioImage(url, value.id))
  )
    fail('Referencias de escenario inválidas.');
  const initialState = value.creation.initialState ?? '';
  if (!['', 'pending', 'complete'].includes(initialState)) fail('Estado inicial inválido.');
  const fieldsSource = value.fields ?? {};
  if (!fieldsSource || typeof fieldsSource !== 'object' || Array.isArray(fieldsSource))
    fail('Campos inválidos.');
  const known = SCENARIO_FIELDS.map((field) => field.key);
  const unknown = Object.keys(fieldsSource).find((key) => !known.includes(key));
  if (unknown) fail(`Campo de escenario desconocido: ${unknown}.`);
  const fields = Object.fromEntries(
    SCENARIO_FIELDS.map(({ key, label, max }) => [key, text(fieldsSource[key], max, label)]),
  );
  const history = value.history ?? [];
  if (!Array.isArray(history) || history.length > LIMITS.history) fail('Historial inválido.');
  const ids = new Set();
  const turns = history.map((turn) => {
    record(turn, KEYS.turn, 'Turno');
    if (!ENTRY_ID.test(turn.id) || ids.has(turn.id)) fail('ID de turno inválido.');
    ids.add(turn.id);
    if (!['description', 'image', 'options', 'ingredients', 'change', 'regenerate'].includes(turn.source))
      fail('Origen de turno inválido.');
    if (!['pending', 'applied', 'failed', 'cancelled'].includes(turn.status))
      fail('Estado de turno inválido.');
    return {
      id: turn.id,
      source: turn.source,
      text: text(turn.text, LIMITS.request, 'Texto del turno'),
      status: turn.status,
      message: text(turn.message, 1500, 'Mensaje del turno'),
      at: isoDate(turn.at),
    };
  });
  const viewsSource = value.views ?? [];
  if (!Array.isArray(viewsSource) || viewsSource.length > SCENARIO_VIEWS.length) fail('Ángulos inválidos.');
  const seen = new Set();
  const views = viewsSource
    .map((view) => {
      record(view, KEYS.view, 'Ángulo');
      const definition = SCENARIO_VIEWS.find((item) => item.id === view.id);
      if (!definition || seen.has(view.id)) fail('Ángulo desconocido o repetido.');
      seen.add(view.id);
      return {
        id: view.id,
        label: definition.label,
        ...normalizeImage(
          { url: view.url, prompt: view.prompt, generatedAt: view.generatedAt },
          value.id,
          'Ángulo',
        ),
      };
    })
    .sort(
      (a, b) =>
        SCENARIO_VIEWS.findIndex((v) => v.id === a.id) - SCENARIO_VIEWS.findIndex((v) => v.id === b.id),
    );
  const archiveSource = value.archive ?? [];
  if (!Array.isArray(archiveSource) || archiveSource.length > SCENARIO_TRASH_LIMIT)
    fail('Papelera inválida.');
  const slots = ['', 'panorama', 'reference', ...SCENARIO_VIEWS.map((view) => view.id)];
  const archive = archiveSource.map((entry) => {
    // Older documents stored bare URLs; they stay in the trash but cannot be restored to a slot.
    const item = typeof entry === 'string' ? { url: entry, slot: '' } : entry;
    record(item, KEYS.trash, 'Imagen de la papelera');
    if (!scenarioImage(item.url, value.id)) fail('La papelera contiene una imagen de otro escenario.');
    if (!slots.includes(item.slot ?? '')) fail('Ranura de papelera inválida.');
    return {
      url: item.url,
      slot: item.slot ?? '',
      prompt: text(item.prompt, 6000, 'Prompt de la papelera'),
      generatedAt: isoDate(item.generatedAt),
      archivedAt: isoDate(item.archivedAt),
    };
  });
  if (new Set(archive.map((entry) => entry.url)).size !== archive.length)
    fail('Papelera con imágenes repetidas.');
  return {
    schema: SCENARIO_SCHEMA,
    version: SCENARIO_VERSION,
    id: value.id,
    revision: value.revision,
    identity: { name: text(value.identity.name, LIMITS.name, 'Nombre'), kind },
    creation: { mode, references: [...references], initialState },
    fields,
    description: text(value.description, LIMITS.description, 'Descripción'),
    request: text(value.request, LIMITS.request, 'Petición'),
    history: turns,
    panorama: value.panorama ? normalizeImage(value.panorama, value.id, 'Panorama') : null,
    views,
    archive,
    ...(value.legacyText ? { legacyText: text(value.legacyText, LIMITS.legacy, 'Ficha anterior') } : {}),
  };
}

/**
 * Null for content that is not a scenario document (empty or legacy prose).
 * A document that claims our schema but is malformed throws instead of being replaced.
 */
export function parseScenarioDocument(content) {
  if (typeof content !== 'string' || !content.trim().startsWith('{')) return null;
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  return parsed?.schema === SCENARIO_SCHEMA ? validateScenarioDocument(parsed) : null;
}

/** Legacy stage prose becomes a retained note; nothing is invented or discarded. */
export function legacyScenarioDocument(project, legacyText = '') {
  const document = emptyScenarioDocument({
    id: project.id,
    name: project.name || '',
    kind: Object.hasOwn(SCENARIO_KINDS, project.category) ? project.category : '',
  });
  const note = String(legacyText || '')
    .trim()
    .slice(0, LIMITS.legacy);
  return note ? { ...document, legacyText: note } : document;
}

export const scenarioHasContent = (document) =>
  Boolean(document.panorama || document.views.length || document.description.trim());

/** Creation is locked once the first request is accepted, mirroring the character flow. */
export const scenarioNeedsCreationChoice = (document) =>
  !document.creation.mode && !scenarioHasContent(document) && !document.history.length;

export const scenarioPhotoNeedsInterpretation = (document) =>
  document.creation.mode === 'image' &&
  !scenarioHasContent(document) &&
  document.creation.initialState !== 'complete';

/** True when the sheet was authored by the assistant; direct edits would diverge from the images. */
export const scenarioAssistedCreation = (document) =>
  ['description', 'image'].includes(document.creation.mode) && scenarioHasContent(document);

export function scenarioContextText(document) {
  const lines = [
    `Escenario: ${document.identity.name || 'Sin nombre'}`,
    document.identity.kind ? `Tipo: ${SCENARIO_KINDS[document.identity.kind]}` : '',
    ...SCENARIO_FIELDS.filter(({ key }) => document.fields[key]).map(
      ({ key, label }) => `${label}: ${document.fields[key]}`,
    ),
    document.description ? `Descripción: ${document.description}` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

/** Everything in the sheet that shapes the pictures; used to decide whether images are stale. */
export const scenarioVisualBasis = (document) =>
  JSON.stringify([document.identity.kind, document.fields, document.description]);

// ── Trash: pure operations on scenario documents. Each returns a new document; none touches files. ──
export function scenarioSlotLabel(slot) {
  if (slot === 'panorama') return 'Panorama 360°';
  if (slot === 'reference') return 'Referencia';
  return SCENARIO_VIEWS.find((view) => view.id === slot)?.label || 'Imagen anterior';
}

/** The project gallery: the four angles, then the panorama. Home previews use the first one. */
export const scenarioCovers = (document) => [
  ...document.views.map((view) => view.url),
  ...(document.panorama ? [document.panorama.url] : []),
];

/** Move a replaced or removed image to the trash, newest last. The oldest entries leave first. */
export function archiveScenarioImage(document, image, at = new Date().toISOString()) {
  const next = structuredClone(document);
  if (!image?.url) return next;
  next.archive = [
    ...next.archive.filter((entry) => entry.url !== image.url),
    {
      url: image.url,
      slot: image.slot ?? '',
      prompt: image.prompt ?? '',
      generatedAt: image.generatedAt ?? '',
      archivedAt: at,
    },
  ].slice(-SCENARIO_TRASH_LIMIT);
  return next;
}

/** Put a trashed image back in its slot; whatever occupied the slot goes to the trash in exchange. */
export function restoreScenarioImage(document, url, at = new Date().toISOString()) {
  const entry = document.archive.find((item) => item.url === url);
  if (!entry) fail('La imagen ya no está en la papelera.');
  let next = structuredClone(document);
  next.archive = next.archive.filter((item) => item.url !== url);
  if (entry.slot === 'reference') {
    if (next.creation.references.length >= SCENARIO_MAX_REFERENCES)
      fail(`Ya hay ${SCENARIO_MAX_REFERENCES} referencias. Quita una antes de restaurar esta.`);
    next.creation.references = [...next.creation.references, url];
    return next;
  }
  const restored = { url, prompt: entry.prompt, generatedAt: entry.generatedAt };
  if (entry.slot === 'panorama') {
    if (next.panorama) next = archiveScenarioImage(next, { ...next.panorama, slot: 'panorama' }, at);
    next.panorama = restored;
    return next;
  }
  const view = SCENARIO_VIEWS.find((item) => item.id === entry.slot);
  if (!view) fail('Esta imagen no tiene un lugar al que volver. Solo puede eliminarse.');
  const previous = next.views.find((item) => item.id === view.id);
  if (previous) next = archiveScenarioImage(next, { ...previous, slot: view.id }, at);
  next.views = [
    ...next.views.filter((item) => item.id !== view.id),
    { id: view.id, label: view.label, ...restored },
  ];
  return next;
}

export function removeScenarioReference(document, url, at = new Date().toISOString()) {
  if (!document.creation.references.includes(url)) fail('Esa fotografía ya no es una referencia.');
  const next = archiveScenarioImage(document, { url, slot: 'reference' }, at);
  next.creation.references = next.creation.references.filter((item) => item !== url);
  return next;
}

/** Forget trashed images. The caller decides whether files can also be deleted. */
export function purgeScenarioImages(document, urls) {
  const gone = new Set(urls);
  const next = structuredClone(document);
  next.archive = next.archive.filter((entry) => !gone.has(entry.url));
  return next;
}
