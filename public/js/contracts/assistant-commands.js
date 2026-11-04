import { validateSchema, explainSchemaErrors, pruneUndeclared } from './json-schema.js';
import { SCENARIO_VIEWS } from './scenario.js';

/**
 * The commands the general assistant may write into its answer, and the exact shape of each. They are the assistant's
 * tools: the chat reads them, checks them against these schemas and either runs them or tells the model, with exact
 * paths, what to correct. Nothing else the assistant writes ever changes a project directly: an edit of the open
 * project is EDITAR_PROYECTO, which hands the work to the editing agent and its operation schemas.
 */
export const ASSISTANT_COMMANDS_SCHEMA_VERSION = 1;
export const ASSISTANT_COMMAND_NAMES = Object.freeze([
  'LEER_PROYECTO',
  'CREAR_PROYECTO',
  'PERSONAJE',
  'ESCENARIO',
  'VERSION',
  'INGREDIENTE',
  'PORTADA',
  'CONTINUIDAD',
  'PROYECTO',
  'PELICULA',
  'EDITAR_PROYECTO',
]);

/** The id of any project (what the open project and the directory call it) and the id of a character, which is always a UUID. */
const PROJECT_ID = { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' };
const CHARACTER_ID = { type: 'string', pattern: '^[a-f0-9-]{36}$' };
const text = (max, extra = {}) => ({ type: 'string', maxLength: max, ...extra });
const NOT_EMPTY = { minLength: 1 };
export const CREATABLE_TYPES = Object.freeze(['character', 'book', 'stage', 'video', 'song']);
export const CHARACTER_SOURCES = Object.freeze(['auto', 'description', 'image', 'options', 'ingredients']);
export const CHARACTER_BASES = Object.freeze(['humanoid', 'animal', 'object', 'entity', 'hybrid']);
export const CHARACTER_ACTIONS = Object.freeze(['interpret', 'manage', 'generate', 'retry']);
/** complete: whatever the scenario lacks (sheet, 360° panorama, four angles); change: edit an existing one; regenerate: redo images. */
export const SCENARIO_ACTIONS = Object.freeze(['complete', 'change', 'regenerate']);
/** What a person does with the images of a scenario besides generating them: see them, bring one back, references, the trash. */
export const SCENARIO_IMAGE_ACTIONS = Object.freeze([
  'list_images',
  'restore_image',
  'add_reference',
  'remove_reference',
  'purge_images',
]);
export const SCENARIO_SCOPES = Object.freeze(['all', 'views', 'view']);
export const VERSION_ACTIONS = Object.freeze(['save', 'list', 'restore']);
export const INGREDIENT_ACTIONS = Object.freeze(['link', 'unlink', 'activate', 'deactivate', 'set_version']);
export const COVER_MODES = Object.freeze(['proyecto', 'personalizado']);
/** What a person does with the jobs of a feature film: see it, generate it, write a prompt, preview, approve or redo a shot, stop or retry. */
export const FILM_ACTIONS = Object.freeze([
  'status',
  'generate',
  'write_prompt',
  'retry_failed',
  'preview',
  'final',
  'continuity',
  'keyframe',
  'approve',
  'unapprove',
  'redo',
  'cancel',
  'retry',
]);
/** generate is the default; select shows a cover of the history, delete removes one for good, list says what there is. */
export const COVER_ACTIONS = Object.freeze(['generate', 'select', 'delete', 'list']);
const IMAGE_PATH = {
  type: 'string',
  pattern: '^/projects/[a-f0-9-]{36}/content/[A-Za-z0-9][A-Za-z0-9._-]{0,150}\\.(png|jpe?g|webp|gif|bmp)$',
};
/** What a person does to a project from the library: rename it, send it to the trash, bring it back, see what is in the trash. */
export const PROJECT_ACTIONS = Object.freeze(['rename', 'trash', 'restore', 'list_trash', 'export']);
/** The formats the Export button of each workspace offers (a book: pdf, doc or docx for a screenplay, md; a character: pdf-sheet, png-card; a scenario: pdf, png). */
export const EXPORT_FORMATS = Object.freeze(['pdf', 'doc', 'docx', 'md', 'pdf-sheet', 'png-card', 'png']);
/** The most projects one batch command may name. */
export const BATCH_LIMIT = 25;

const SCHEMAS = {
  LEER_PROYECTO: PROJECT_ID,
  EDITAR_PROYECTO: {
    type: 'object',
    required: ['projectId'],
    additionalProperties: false,
    properties: { projectId: PROJECT_ID },
  },
  PERSONAJE: {
    type: 'object',
    required: ['projectId', 'action'],
    additionalProperties: false,
    properties: {
      projectId: CHARACTER_ID,
      action: { enum: [...CHARACTER_ACTIONS] },
      source: { enum: [...CHARACTER_SOURCES] },
      request: text(12000, NOT_EMPTY),
      base: { enum: [...CHARACTER_BASES] },
      nature: text(120),
      referenceImage: text(300),
      attachmentImage: text(300),
      options: {
        type: 'array',
        maxItems: 40,
        items: {
          type: 'object',
          required: ['group', 'choice'],
          additionalProperties: false,
          properties: {
            group: text(60, NOT_EMPTY),
            choice: { type: ['string', 'integer'] },
          },
        },
      },
    },
  },
  ESCENARIO: {
    type: 'object',
    required: ['projectIds', 'action'],
    additionalProperties: false,
    properties: {
      projectIds: { type: 'array', minItems: 1, maxItems: BATCH_LIMIT, items: CHARACTER_ID },
      action: { enum: [...SCENARIO_ACTIONS, ...SCENARIO_IMAGE_ACTIONS] },
      urls: { type: 'array', minItems: 1, maxItems: BATCH_LIMIT, items: IMAGE_PATH },
      request: text(12000),
      scope: { enum: [...SCENARIO_SCOPES] },
      viewId: { enum: SCENARIO_VIEWS.map((view) => view.id) },
    },
  },
  VERSION: {
    type: 'object',
    required: ['projectId', 'action'],
    additionalProperties: false,
    properties: {
      projectId: CHARACTER_ID,
      action: { enum: [...VERSION_ACTIONS] },
      note: text(300),
      number: { type: 'integer', minimum: 1, maximum: 100000 },
    },
  },
  PROYECTO: {
    type: 'object',
    required: ['action'],
    additionalProperties: false,
    properties: {
      action: { enum: [...PROJECT_ACTIONS] },
      projectId: CHARACTER_ID,
      name: text(300, NOT_EMPTY),
      format: { enum: [...EXPORT_FORMATS] },
    },
  },
  PELICULA: {
    type: 'object',
    required: ['projectId', 'action'],
    additionalProperties: false,
    properties: {
      projectId: CHARACTER_ID,
      action: { enum: [...FILM_ACTIONS] },
      sceneId: CHARACTER_ID,
      scene: {
        type: 'integer',
        minimum: 1,
        maximum: 2000,
        'x-hint':
          'preview y final: el número de la escena del guión (status lo dice); la película se trabaja escena por escena.',
      },
      scriptProjectId: CHARACTER_ID,
    },
  },
  INGREDIENTE: {
    type: 'object',
    required: ['action', 'projectIds'],
    additionalProperties: false,
    properties: {
      action: { enum: [...INGREDIENT_ACTIONS] },
      projectIds: { type: 'array', minItems: 1, maxItems: BATCH_LIMIT, items: CHARACTER_ID },
      version: {
        type: 'string',
        pattern: '^(latest|[0-9]{1,6})$',
        'x-hint': 'set_version: el número de la versión guardada, o latest para la más reciente.',
      },
    },
  },
  PORTADA: {
    type: 'object',
    required: ['projectId'],
    additionalProperties: false,
    properties: {
      projectId: CHARACTER_ID,
      action: { enum: [...COVER_ACTIONS] },
      mode: { enum: [...COVER_MODES] },
      number: { type: 'integer', minimum: 1, maximum: 1000 },
      request: text(12000),
    },
  },
  CONTINUIDAD: {
    type: 'object',
    required: ['projectId'],
    additionalProperties: false,
    properties: { projectId: CHARACTER_ID },
  },
  CREAR_PROYECTO: {
    type: 'object',
    required: ['name', 'type'],
    additionalProperties: false,
    properties: {
      name: text(200, NOT_EMPTY),
      type: { enum: [...CREATABLE_TYPES] },
      category: text(40),
      linkAsIngredient: { type: 'boolean' },
      characterCreation: {
        type: 'object',
        additionalProperties: false,
        properties: {
          source: { enum: [...CHARACTER_SOURCES] },
          request: text(12000),
          base: { enum: [...CHARACTER_BASES] },
          nature: text(120),
          referenceImage: text(300),
          options: {
            type: 'array',
            maxItems: 40,
            items: {
              type: 'object',
              required: ['group', 'choice'],
              additionalProperties: false,
              properties: { group: text(60, NOT_EMPTY), choice: { type: ['string', 'integer'] } },
            },
          },
        },
      },
    },
  },
};
export const assistantCommandSchema = (name) => {
  if (!Object.hasOwn(SCHEMAS, name)) throw new Error('Comando del asistente desconocido: ' + name);
  return SCHEMAS[name];
};

/**
 * The argument of a command, read and checked. LEER_PROYECTO carries a bare id; the others carry one JSON object.
 * Fields the command does not have (the old `content` and `traits` of CREAR_PROYECTO among them) are dropped and
 * reported; what remains is validated. Which categories can actually be created is decided by project-availability.
 */
export function checkAssistantCommand(name, argument) {
  const schema = assistantCommandSchema(name);
  let value = argument;
  if (name !== 'LEER_PROYECTO') {
    try {
      value = JSON.parse(argument);
    } catch (error) {
      const message = 'no es JSON válido (' + error.message + ')';
      return { value: undefined, removed: [], problems: [{ path: '', message }], text: '- ' + message + '.' };
    }
  } else value = String(argument).trim();
  const cleaned = pruneUndeclared(value, schema);
  const problems = validateSchema(cleaned.value, schema);
  return { value: cleaned.value, removed: cleaned.removed, problems, text: explainSchemaErrors(problems) };
}

/** The message that goes back to the assistant after a command that did not respect its schema. */
export const assistantCommandCorrection = (name, text) =>
  '[Sistema: El comando ' +
  name +
  ' no respeta el formato (esquema ' +
  ASSISTANT_COMMANDS_SCHEMA_VERSION +
  '):\n' +
  text +
  '\nEmite el comando de nuevo, corregido y sin campos que no existan; no anuncies el error al usuario.]';

export { explainSchemaErrors };
