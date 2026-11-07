import { SCREENPLAY_SHOTS } from './screenplay.js';
import { SCENARIO_FIELDS } from './scenario.js';
import { FILM_FRAME_OPTIONS, FILM_PREVIEW_MEGAPIXELS, FILM_FINAL_MEGAPIXELS } from './film.js';
import { FILM_OPTICS_GROUPS } from './film-optics.js';
import { FILM_PALETTES, FILM_PALETTE_MAX_COLORS } from './film-palettes.js';
import { FILM_MOVEMENTS } from './film-movements.js';
import { inlineDefinitions, INLINE_BRANCHES } from './inline-operations.js';
import { validateSchema, explainSchemaErrors, pruneUndeclared } from './json-schema.js';
import {
  SCREENPLAY_OPERATIONS_SCHEMA_VERSION,
  screenplayOperationSchema,
  providerSchema,
  tidyScreenplayOperation,
} from './screenplay-operations.js';

/**
 * The vocabulary through which a model may change a Story Book, a scenario or a film. Like the screenplay's, each is a
 * closed JSON Schema built from the same constants as the document contract: an operation that is not here, a field
 * the format lacks, an empty title or a value out of range is refused with its exact path before anything is applied.
 * create_resource and set_resource_narrative are shared with the screenplay and always allowed.
 */
export const ELEMENT_OPERATIONS_SCHEMA_VERSION = 1;
export const MAX_THEMES_PER_CHAPTER = 12;
export const MAX_PARAGRAPHS_PER_THEME = 150;

const text = (max, extra = {}) => ({ type: 'string', maxLength: max, ...extra });
const NOT_EMPTY = Object.freeze({ minLength: 1 });
const shared = () => {
  const { Id, Reference, CreateResource, SetResourceNarrative } = screenplayOperationSchema().$defs;
  return { Id, Reference, CreateResource, SetResourceNarrative };
};
const head = (title) => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title,
  'x-version': ELEMENT_OPERATIONS_SCHEMA_VERSION,
});

function storyBookDefinitions() {
  return {
    ...shared(),
    AfterId: {
      type: ['string', 'null'],
      maxLength: 140,
      pattern: '^[A-Za-z0-9_-]+$',
      'x-hint': 'afterId es el id del elemento tras el que insertar, null al principio o ausente al final.',
    },
    Paragraphs: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_PARAGRAPHS_PER_THEME,
      items: text(20000, NOT_EMPTY),
      'x-hint':
        'Un tema lleva de 1 a ' + MAX_PARAGRAPHS_PER_THEME + ' párrafos; reparte el resto en otro tema.',
    },
    ReplaceText: {
      type: 'object',
      required: ['op', 'id', 'text'],
      additionalProperties: false,
      properties: { op: { const: 'replace_text' }, id: { $ref: '#/$defs/Id' }, text: text(12000) },
    },
    InsertChapter: {
      type: 'object',
      required: ['op', 'title', 'themes'],
      additionalProperties: false,
      properties: {
        op: { const: 'insert_chapter' },
        afterId: { $ref: '#/$defs/AfterId' },
        title: text(300, NOT_EMPTY),
        themes: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_THEMES_PER_CHAPTER,
          items: {
            type: 'object',
            required: ['title', 'paragraphs'],
            additionalProperties: false,
            properties: { title: text(300, NOT_EMPTY), paragraphs: { $ref: '#/$defs/Paragraphs' } },
          },
          'x-hint': 'Un capítulo nuevo lleva de 1 a ' + MAX_THEMES_PER_CHAPTER + ' temas.',
        },
      },
    },
    InsertTheme: {
      type: 'object',
      required: ['op', 'chapterId', 'title', 'paragraphs'],
      additionalProperties: false,
      properties: {
        op: { const: 'insert_theme' },
        chapterId: { $ref: '#/$defs/Id' },
        afterId: { $ref: '#/$defs/AfterId' },
        title: text(300, NOT_EMPTY),
        paragraphs: { $ref: '#/$defs/Paragraphs' },
      },
    },
    InsertParagraph: {
      type: 'object',
      required: ['op', 'themeId', 'text'],
      additionalProperties: false,
      properties: {
        op: { const: 'insert_paragraph' },
        themeId: { $ref: '#/$defs/Id' },
        afterId: { $ref: '#/$defs/AfterId' },
        text: text(12000, NOT_EMPTY),
      },
    },
    RemoveElement: {
      type: 'object',
      required: ['op', 'id'],
      additionalProperties: false,
      properties: { op: { const: 'remove_element' }, id: { $ref: '#/$defs/Id' } },
    },
    MoveElement: {
      type: 'object',
      required: ['op', 'id'],
      additionalProperties: false,
      properties: {
        op: { const: 'move_element' },
        id: { $ref: '#/$defs/Id' },
        toId: { $ref: '#/$defs/Id' },
        afterId: { $ref: '#/$defs/AfterId' },
      },
      'x-hint':
        'move_element cambia de sitio un capítulo, un tema o un párrafo (lo que arrastra una persona): toId es el capítulo (para un tema) o el tema (para un párrafo) de destino, y se omite para quedarse donde está; afterId es el elemento tras el que colocarlo en ese destino, null al principio, o ausente al final. Un capítulo solo se reordena entre capítulos.',
    },
    ...timelineDefinitions(),
    ...inlineDefinitions(),
  };
}
/**
 * The timeline of a Story Book: dates and ranges, and the links that tie a chapter, a theme or a paragraph to them. An
 * entry is named by its own date, never by an id: the server keeps ids, and two entries never share a date.
 */
function timelineDefinitions() {
  const op = (name, properties, required = []) => ({
    type: 'object',
    required: ['op', ...required],
    additionalProperties: false,
    properties: { op: { const: name }, ...properties },
  });
  const date = { $ref: '#/$defs/CalendarDate' };
  const id = { $ref: '#/$defs/Id' };
  const color = { $ref: '#/$defs/TimelineColor' };
  return {
    CalendarDate: {
      type: 'string',
      pattern: '^-?\\d{4}-\\d{2}-\\d{2}$',
      'x-hint': 'Las fechas se escriben AAAA-MM-DD; un año negativo es antes de Cristo (-0044-03-15).',
    },
    TimelineColor: {
      type: 'string',
      pattern: '^#[0-9a-fA-F]{6}$',
      'x-hint': 'El color es hexadecimal: #22d3ee.',
    },
    AddDate: op('add_date', { date }, ['date']),
    AddRange: op('add_range', { start: date, end: date, color }, ['start', 'end']),
    EditDate: op('edit_date', { date, newDate: date }, ['date', 'newDate']),
    EditRange: op('edit_range', { start: date, end: date, newStart: date, newEnd: date, color }, [
      'start',
      'end',
    ]),
    RemoveDate: op('remove_date', { date }, ['date']),
    RemoveRange: op('remove_range', { start: date, end: date }, ['start', 'end']),
    LinkDate: op('link_date', { id, date }, ['id', 'date']),
    LinkRange: op('link_range', { id, start: date, end: date, color }, ['id', 'start', 'end']),
    UnlinkDate: op('unlink_date', { id, date }, ['id', 'date']),
    UnlinkRange: op('unlink_range', { id, start: date, end: date }, ['id', 'start', 'end']),
  };
}
export const TIMELINE_OPERATIONS = Object.freeze([
  'add_date',
  'add_range',
  'edit_date',
  'edit_range',
  'remove_date',
  'remove_range',
  'link_date',
  'link_range',
  'unlink_date',
  'unlink_range',
]);
const STORY_BOOK = [
  'ReplaceText',
  'InsertChapter',
  'InsertTheme',
  'InsertParagraph',
  'RemoveElement',
  'MoveElement',
  ...INLINE_BRANCHES,
  'AddDate',
  'AddRange',
  'EditDate',
  'EditRange',
  'RemoveDate',
  'RemoveRange',
  'LinkDate',
  'LinkRange',
  'UnlinkDate',
  'UnlinkRange',
  'CreateResource',
  'SetResourceNarrative',
];

function stageDefinitions() {
  const field = (id, max) => ({
    type: 'object',
    required: ['op', 'id', 'text'],
    additionalProperties: false,
    properties: { op: { const: 'set_field' }, id: { const: id }, text: text(max) },
  });
  return {
    ...shared(),
    SetDescription: field('description', 4000),
    ...Object.fromEntries(SCENARIO_FIELDS.map(({ key, max }) => ['Set_' + key, field(key, max)])),
  };
}
const stageBranches = () => [
  'SetDescription',
  ...SCENARIO_FIELDS.map(({ key }) => 'Set_' + key),
  'CreateResource',
  'SetResourceNarrative',
];

function videoDefinitions() {
  const field = (id, value) => ({
    type: 'object',
    required: ['op', 'id', 'value'],
    additionalProperties: false,
    properties: { op: { const: 'set_field' }, id: { const: id }, value },
  });
  return {
    ...shared(),
    SetAspectRatio: field('aspectRatio', {
      type: 'string',
      pattern: '^\\d{1,3}:\\d{1,3}$',
      'x-hint': 'La proporción se escribe como «16:9» (también «37:20» para 1,85:1, etc.).',
    }),
    SetMegapixels: field('megapixels', { type: 'number', enum: FILM_PREVIEW_MEGAPIXELS }),
    SetSteps: field('steps', { type: 'integer', minimum: 1, maximum: 10 }),
    SetFinalMegapixels: field('finalMegapixels', { type: 'number', enum: FILM_FINAL_MEGAPIXELS }),
    SetScenePrompt: {
      type: 'object',
      required: ['op', 'id', 'prompt'],
      additionalProperties: false,
      properties: {
        op: { const: 'set_scene_prompt' },
        id: { $ref: '#/$defs/Id' },
        prompt: text(6000),
      },
      'x-hint':
        'set_scene_prompt escribe a mano el prompt de un plano (id es el de la escena del metraje); un prompt vacío lo borra y deja el plano pendiente. Para que el modelo escriba el prompt se usa el comando PELICULA.',
    },
    SetSceneContinuity: {
      type: 'object',
      required: ['op', 'id'],
      additionalProperties: false,
      properties: {
        op: { const: 'set_scene_continuity' },
        id: { $ref: '#/$defs/Id' },
        mode: { enum: ['auto', 'take', 'cut', 'keyframe', 'new'] },
        note: text(900),
        frame: { type: 'boolean' },
      },
      'x-hint':
        'set_scene_continuity cambia cómo un clip sigue al anterior: mode auto, take (la misma toma continúa, guiada por los últimos fotogramas del anterior), cut (otro plano de la misma escena, con nota de continuidad), keyframe (con un fotograma inicial generado) o new (otra escena); note es la nota de continuidad escrita a mano (dónde está cada personaje, cómo está y qué sostiene al empezar el plano; vacía la borra) y frame indica si el último fotograma del plano anterior viaja como referencia. El fotograma inicial y la nota escrita por el modelo se piden con el comando PELICULA.',
    },
    RemoveScene: {
      type: 'object',
      required: ['op', 'id'],
      additionalProperties: false,
      properties: { op: { const: 'remove_scene' }, id: { $ref: '#/$defs/Id' } },
      'x-hint':
        'remove_scene descarta un clip que ya no está en el guión (sourceRemoved); un clip que sigue en el guión no se descarta: se cambia el guión y se actualiza la película.',
    },
    SetSceneOptics: {
      type: 'object',
      required: ['op', 'id'],
      additionalProperties: false,
      properties: {
        op: { const: 'set_scene_optics' },
        id: { $ref: '#/$defs/Id' },
        camera: { enum: FILM_OPTICS_GROUPS.camera.map((item) => item.id) },
        lens: { enum: FILM_OPTICS_GROUPS.lens.map((item) => item.id) },
        aperture: { enum: FILM_OPTICS_GROUPS.aperture.map((item) => item.id) },
        palette: { enum: ['auto', 'custom', ...FILM_PALETTES.map((item) => item.id)] },
        colors: {
          type: 'array',
          maxItems: FILM_PALETTE_MAX_COLORS,
          items: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
        },
      },
      'x-hint':
        'set_scene_optics cambia la óptica de una escena del metraje, como sus selectores: id es el de cualquier clip de esa escena; camera, lens y aperture eligen una opción de su catálogo (auto deja que decida el plano) y palette una paleta de color (auto, una del catálogo o custom con colors, hasta ' +
        FILM_PALETTE_MAX_COLORS +
        ' valores #rrggbb). Los prompts de todos los clips de la escena se componen de nuevo con la óptica.',
    },
    SetSceneFraming: {
      type: 'object',
      required: ['op', 'id', 'framing'],
      additionalProperties: false,
      properties: {
        op: { const: 'set_scene_framing' },
        id: { $ref: '#/$defs/Id' },
        framing: { enum: ['', ...SCREENPLAY_SHOTS] },
      },
      'x-hint':
        'set_scene_framing {id,framing} elige el encuadre del catálogo del guión. Duración, encuadre y movimiento son heredados y no se cambian en metraje mientras exista un guión vinculado: edita el guión y actualiza desde él. Sin guión vinculado pueden editarse aquí.',
    },
    SetSceneMovement: {
      type: 'object',
      required: ['op', 'id', 'movement'],
      additionalProperties: false,
      properties: {
        op: { const: 'set_scene_movement' },
        id: { $ref: '#/$defs/Id' },
        movement: { enum: FILM_MOVEMENTS.map((item) => item.id) },
      },
      'x-hint':
        'Solo sin guión vinculado: set_scene_movement elige el movimiento de cámara de un plano (id es el del clip): auto deja que lo elija el modelo; cualquier otro lo escribe en la línea técnica del prompt y el modelo lo desarrolla al escribir la descripción.',
    },
    SetSceneFrames: {
      'x-hint':
        'Duración heredada: solo se cambia sin guión vinculado. Con guión, edita su plano y actualiza el metraje.',
      type: 'object',
      required: ['op', 'id', 'frames'],
      additionalProperties: false,
      properties: {
        op: { const: 'set_scene_frames' },
        id: { $ref: '#/$defs/Id' },
        frames: {
          enum: [...FILM_FRAME_OPTIONS],
          'x-hint': 'Los fotogramas a 24 por segundo: ' + FILM_FRAME_OPTIONS.join(', ') + ' (hasta 15 s).',
        },
      },
    },
  };
}
const VIDEO = [
  'SetAspectRatio',
  'SetMegapixels',
  'SetSteps',
  'SetFinalMegapixels',
  'SetScenePrompt',
  'SetSceneFrames',
  'SetSceneFraming',
  'SetSceneOptics',
  'SetSceneMovement',
  'SetSceneContinuity',
  'RemoveScene',
  'CreateResource',
  'SetResourceNarrative',
];

const KINDS = {
  'story-book': {
    title: 'Operación de edición de un Story Book de Kubrick Space',
    defs: storyBookDefinitions,
    branches: () => STORY_BOOK,
  },
  stage: {
    title: 'Operación de edición de un escenario de Kubrick Space',
    defs: stageDefinitions,
    branches: stageBranches,
    hint: () =>
      'set_field edita un campo del escenario: id debe ser ' +
      ['description', ...SCENARIO_FIELDS.map((field) => field.key)].join(', ') +
      ' y text su contenido.',
  },
  video: {
    title: 'Operación de edición de un largometraje de Kubrick Space',
    defs: videoDefinitions,
    branches: () => VIDEO,
    hint: () =>
      'set_field edita un parámetro del metraje: id aspectRatio ("16:9"), megapixels (0.1 a 0.6, de la previsualización, en pasos de 0.1), finalMegapixels (0.5 a 2, del video final escalado, en pasos de 0.1) o steps (1 a 10) y value su valor; set_scene_prompt {id,prompt} escribe el prompt de un plano, set_scene_frames {id,frames} cambia su duración, set_scene_framing {id,framing} cambia el encuadre del catálogo del guión y set_scene_continuity {id,mode,note,frame} cambia cómo sigue al plano anterior; remove_scene {id} descarta un clip que ya no está en el guión.',
  },
};

export const hasElementSchema = (kind) => kind === 'screenplay' || Object.hasOwn(KINDS, kind);
export const elementSchemaVersion = (kind) =>
  kind === 'screenplay' ? SCREENPLAY_OPERATIONS_SCHEMA_VERSION : ELEMENT_OPERATIONS_SCHEMA_VERSION;

/** One operation of a project kind, as a JSON Schema (the screenplay's is built where the screenplay is defined). */
export function elementOperationSchema(kind) {
  if (kind === 'screenplay') return screenplayOperationSchema();
  const spec = KINDS[kind];
  if (!spec) throw new Error('Tipo de proyecto sin esquema de operaciones: ' + kind);
  return {
    ...head(spec.title),
    $defs: spec.defs(),
    ...(spec.hint ? { 'x-hint': spec.hint() } : {}),
    oneOf: spec.branches().map((name) => ({ $ref: '#/$defs/' + name })),
  };
}

/** Readings that mean one thing only; only the screenplay has any. */
export function tidyElementOperation(kind, operation) {
  return kind === 'screenplay' ? tidyScreenplayOperation(operation) : operation;
}
/** The operations without the fields their format does not have, and which paths were dropped. */
export function elementOperationsWithoutUndeclared(kind, operations) {
  const schema = elementOperationSchema(kind);
  const removed = [];
  const kept = operations.map((operation, index) => {
    const result = pruneUndeclared(operation, schema, schema, 'operations[' + index + ']');
    removed.push(...result.removed);
    return result.value;
  });
  return { operations: kept, removed };
}
/** Errors of a list of operations against the schema of the project kind ([] when valid). */
export function checkElementOperations(kind, operations) {
  const schema = elementOperationSchema(kind);
  return operations.flatMap((operation, index) =>
    validateSchema(operation, schema, schema, 'operations[' + index + ']'),
  );
}
export { explainSchemaErrors, providerSchema };

/**
 * What the editing agent returns each round. With strictOperations the operations are the kind's own schema (what a
 * provider is asked to write); without it they only have to be objects, because the server first reads loose shapes
 * such as {type, params} into the flat form and only then checks each operation against the kind's schema.
 */
export function elementRoundSchema(kind, { strictOperations = false } = {}) {
  const full = strictOperations ? elementOperationSchema(kind) : null;
  const round = {
    ...head('Ronda del agente de edición de Kubrick Space'),
    ...(full ? { $defs: full.$defs } : {}),
    type: 'object',
    required: ['status', 'operations', 'assessment'],
    additionalProperties: false,
    properties: {
      status: { enum: ['continue', 'complete'] },
      operations: {
        type: 'array',
        maxItems: 8,
        items: full
          ? { oneOf: full.oneOf, ...(full['x-hint'] ? { 'x-hint': full['x-hint'] } : {}) }
          : { type: 'object' },
        'x-hint': 'Una ronda lleva como máximo 8 operaciones; complete exige operations vacío.',
      },
      assessment: {
        type: 'object',
        required: ['satisfied', 'reason', 'evidenceIds', 'remaining'],
        additionalProperties: false,
        properties: {
          satisfied: { type: 'boolean' },
          reason: text(4000),
          evidenceIds: { type: 'array', maxItems: 200, items: text(140) },
          remaining: { type: 'array', maxItems: 50, items: text(1000) },
        },
      },
      continuity: {
        type: 'object',
        required: ['checked', 'issues'],
        additionalProperties: false,
        properties: {
          checked: { type: 'boolean' },
          issues: { type: 'array', maxItems: 50, items: text(1000) },
        },
        'x-hint':
          'Revisión de continuidad de esta ronda sobre el documento que recibiste: checked=true si la hiciste; issues lista cada contradicción abierta (cronología, personajes, lugares, hechos) con dónde ocurre.',
      },
      estimatedRounds: {
        type: 'integer',
        minimum: 1,
        maximum: 500,
        'x-hint': 'Total estimado de rondas del trabajo, contando la actual y la de verificación final.',
      },
      estimatedProgress: { type: 'number', minimum: 0, maximum: 100 },
      targetWords: { type: 'integer', minimum: 0, maximum: 250000 },
      summary: text(1000),
      memory: text(8000),
      question: text(1000),
      focus: { type: 'array', maxItems: 24, items: text(140) },
    },
  };
  return round;
}
/** A round without the fields its format lacks, and what is still wrong with the rest (exact paths). */
export function checkElementRound(kind, round) {
  const schema = elementRoundSchema(kind);
  const cleaned = pruneUndeclared(round, schema);
  const problems = validateSchema(cleaned.value, schema);
  return { value: cleaned.value, removed: cleaned.removed, problems, text: explainSchemaErrors(problems) };
}
