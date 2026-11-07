import { SCREENPLAY_SHOTS, SCREENPLAY_VOICES, SCREENPLAY_SHOT_SECONDS } from './screenplay.js';
import { FILM_MOVEMENT_NAMES } from './film-movements.js';
import { FILM_TRANSITION_NAMES } from './film-transitions.js';
import { validateSchema, explainSchemaErrors, pruneUndeclared } from './json-schema.js';
import { inlineDefinitions, INLINE_BRANCHES } from './inline-operations.js';

/**
 * The only vocabulary through which a model may change a screenplay. Everything it proposes is validated against this
 * schema before anything is applied: an unknown operation, a field that is not in the format, a framing that is not
 * one of the nine, a duration off the half-second grid or a scene without shots never reaches the document.
 * The schema is built from the same constants as the document contract, so the two cannot drift apart.
 */
export const SCREENPLAY_OPERATIONS_SCHEMA_VERSION = 1;
export const MAX_SHOTS_PER_SCENE = 24;
export const MAX_INTERVENTIONS_PER_SHOT = 8;
export const PLACES = Object.freeze(['INT', 'EXT', 'INT/EXT', 'EXT/INT']);

const text = (max, extra = {}) => ({ type: 'string', maxLength: max, ...extra });
const NOT_EMPTY = Object.freeze({ minLength: 1 });

function definitions() {
  const id = { type: 'string', minLength: 1, maxLength: 140, pattern: '^[A-Za-z0-9_-]+$' };
  const reference = {
    type: 'string',
    pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
  };
  return {
    Id: id,
    Reference: reference,
    ShotType: { enum: [...SCREENPLAY_SHOTS] },
    Seconds: {
      type: 'number',
      enum: [...SCREENPLAY_SHOT_SECONDS],
      'x-hint':
        'La duración de un plano es la de un clip de H3 (17k + 5 fotogramas a 24 por segundo): ' +
        SCREENPLAY_SHOT_SECONDS.join(', ') +
        ' segundos.',
    },
    Camera: {
      type: 'string',
      enum: ['', ...FILM_MOVEMENT_NAMES],
      'x-hint':
        'El movimiento de cámara del plano: vacío (lo elige el modelo del metraje) o exactamente uno de: ' +
        FILM_MOVEMENT_NAMES.join(', ') +
        '. Es la misma lista que el selector del guión y el metraje la hereda.',
    },
    Transition: {
      type: 'string',
      enum: ['', ...FILM_TRANSITION_NAMES],
      'x-hint':
        'La transición del plano, cómo se une al anterior: vacío (el sistema decide) o exactamente uno de: ' +
        FILM_TRANSITION_NAMES.join(', ') +
        '. Es la misma lista que el selector del guión y el metraje la hereda. El primer plano del guión (el primero de la primera escena) no lleva transición: va siempre vacía, escribas lo que escribas.',
    },
    Voice: { enum: Object.keys(SCREENPLAY_VOICES) },
    Place: { enum: [...PLACES] },
    Intervention: {
      type: 'object',
      required: ['character'],
      additionalProperties: false,
      properties: {
        character: text(200, NOT_EMPTY),
        characterId: { $ref: '#/$defs/Reference' },
        voice: { $ref: '#/$defs/Voice' },
        parenthetical: text(1000),
        text: text(4000),
      },
      // A line, or what the character does while staying silent: an intervention with neither is nothing.
      anyOf: [
        { required: ['text'], properties: { text: { type: 'string', minLength: 1 } } },
        { required: ['parenthetical'], properties: { parenthetical: { type: 'string', minLength: 1 } } },
      ],
      'x-hint':
        'Una intervención lleva texto (lo que dice) o una acotación en parenthetical (lo que hace, si está en silencio, con text vacío).',
    },
    Dialogues: {
      type: 'array',
      maxItems: MAX_INTERVENTIONS_PER_SHOT,
      items: { $ref: '#/$defs/Intervention' },
      'x-hint':
        'Un plano admite hasta ' +
        MAX_INTERVENTIONS_PER_SHOT +
        ' intervenciones; reparte el diálogo en más planos.',
    },
    Shot: {
      type: 'object',
      required: ['type', 'seconds'],
      additionalProperties: false,
      properties: {
        type: { $ref: '#/$defs/ShotType' },
        seconds: { $ref: '#/$defs/Seconds' },
        camera: { $ref: '#/$defs/Camera' },
        action: text(4000),
        dialogues: { $ref: '#/$defs/Dialogues' },
        transition: { $ref: '#/$defs/Transition' },
      },
    },
    Shots: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_SHOTS_PER_SCENE,
      items: { $ref: '#/$defs/Shot' },
      'x-hint':
        'Toda escena necesita al menos un plano y admite hasta ' +
        MAX_SHOTS_PER_SCENE +
        '; si la acción necesita más, continúa en otra escena del mismo lugar y momento.',
    },
    InsertScene: {
      type: 'object',
      required: ['op', 'interiorExterior', 'location', 'time', 'shots'],
      additionalProperties: false,
      properties: {
        op: { const: 'insert_scene' },
        afterId: { oneOf: [{ $ref: '#/$defs/Id' }, { type: 'null' }] },
        interiorExterior: { $ref: '#/$defs/Place' },
        location: text(1000, NOT_EMPTY),
        time: text(1000),
        locationId: { $ref: '#/$defs/Reference' },
        shots: { $ref: '#/$defs/Shots' },
        // Notes the adaptation keeps with the scene; the document never stores them as content.
        synopsis: text(600),
        sources: { type: 'array', maxItems: 200, items: { $ref: '#/$defs/Id' } },
      },
    },
    InsertShot: {
      type: 'object',
      required: ['op', 'sceneId', 'type', 'seconds'],
      additionalProperties: false,
      properties: {
        op: { const: 'insert_shot' },
        sceneId: { $ref: '#/$defs/Id' },
        afterId: { oneOf: [{ $ref: '#/$defs/Id' }, { type: 'null' }] },
        type: { $ref: '#/$defs/ShotType' },
        seconds: { $ref: '#/$defs/Seconds' },
        camera: { $ref: '#/$defs/Camera' },
        action: text(4000),
        dialogues: { $ref: '#/$defs/Dialogues' },
        transition: { $ref: '#/$defs/Transition' },
      },
    },
    InsertDialogue: {
      type: 'object',
      required: ['op', 'sceneId', 'shotId', 'character'],
      additionalProperties: false,
      properties: {
        op: { const: 'insert_dialogue' },
        sceneId: { $ref: '#/$defs/Id' },
        shotId: { $ref: '#/$defs/Id' },
        afterId: { $ref: '#/$defs/Id' },
        character: text(200, NOT_EMPTY),
        characterId: { $ref: '#/$defs/Reference' },
        voice: { $ref: '#/$defs/Voice' },
        parenthetical: text(1000),
        text: text(4000),
      },
    },
    ReplaceText: {
      type: 'object',
      required: ['op', 'id', 'text'],
      additionalProperties: false,
      properties: { op: { const: 'replace_text' }, id: { $ref: '#/$defs/Id' }, text: text(12000) },
    },
    SetScene: {
      type: 'object',
      required: ['op', 'id'],
      additionalProperties: false,
      properties: {
        op: { const: 'set_scene' },
        id: { $ref: '#/$defs/Id' },
        interiorExterior: { $ref: '#/$defs/Place' },
        location: text(1000, NOT_EMPTY),
        time: text(1000),
        locationId: { oneOf: [{ $ref: '#/$defs/Reference' }, { type: 'null' }] },
      },
    },
    SetShot: {
      type: 'object',
      required: ['op', 'id', 'type', 'seconds', 'camera'],
      additionalProperties: false,
      properties: {
        op: { const: 'set_shot' },
        id: { $ref: '#/$defs/Id' },
        type: { $ref: '#/$defs/ShotType' },
        seconds: { $ref: '#/$defs/Seconds' },
        camera: { $ref: '#/$defs/Camera' },
      },
    },
    RemoveElement: {
      type: 'object',
      required: ['op', 'id'],
      additionalProperties: false,
      properties: { op: { const: 'remove_element' }, id: { $ref: '#/$defs/Id' } },
    },
    ...inlineDefinitions(),
    MoveScene: {
      type: 'object',
      required: ['op', 'id'],
      additionalProperties: false,
      properties: {
        op: { const: 'move_scene' },
        id: { $ref: '#/$defs/Id' },
        afterId: { oneOf: [{ $ref: '#/$defs/Id' }, { type: 'null' }] },
      },
      'x-hint': 'afterId es la escena tras la que colocarla, null al principio, o ausente al final.',
    },
    MoveShot: {
      type: 'object',
      required: ['op', 'id'],
      additionalProperties: false,
      properties: {
        op: { const: 'move_shot' },
        id: { $ref: '#/$defs/Id' },
        toSceneId: { $ref: '#/$defs/Id' },
        afterId: { oneOf: [{ $ref: '#/$defs/Id' }, { type: 'null' }] },
      },
      'x-hint':
        'id es el plano; toSceneId la escena de destino (ausente para quedarse en la suya); afterId el plano tras el que colocarlo, null al principio, o ausente al final. El plano se lleva su acción, diálogos y transición.',
    },
    CreateResource: {
      type: 'object',
      required: ['op', 'type', 'name', 'description'],
      additionalProperties: false,
      properties: {
        op: { const: 'create_resource' },
        type: { enum: ['character', 'stage'] },
        name: text(120, NOT_EMPTY),
        description: text(12000, NOT_EMPTY),
        existingId: { type: 'string', minLength: 1, maxLength: 140 },
      },
    },
    SetResourceNarrative: {
      type: 'object',
      required: ['op', 'projectId', 'fields'],
      additionalProperties: false,
      properties: {
        op: { const: 'set_resource_narrative' },
        projectId: { $ref: '#/$defs/Reference' },
        fields: { type: 'object', additionalProperties: text(10000) },
      },
    },
  };
}
const OPERATIONS = [
  'InsertScene',
  'InsertShot',
  'InsertDialogue',
  'ReplaceText',
  'SetScene',
  'SetShot',
  'RemoveElement',
  'MoveScene',
  'MoveShot',
  ...INLINE_BRANCHES,
  'CreateResource',
  'SetResourceNarrative',
];
const head = (title) => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title,
  'x-version': SCREENPLAY_OPERATIONS_SCHEMA_VERSION,
});

/** One operation: any of the sixteen, told apart by `op`. */
export function screenplayOperationSchema() {
  return {
    ...head('Operación de edición de un guión de Kubrick Space'),
    $defs: definitions(),
    oneOf: OPERATIONS.map((name) => ({ $ref: '#/$defs/' + name })),
  };
}
/** What the adaptation returns each round: scenes to add, the continuity memory and a short summary. */
export function adaptationRoundSchema() {
  return {
    ...head('Ronda de adaptación de un libro a guión'),
    $defs: definitions(),
    type: 'object',
    required: ['operations'],
    additionalProperties: false,
    properties: {
      operations: {
        type: 'array',
        minItems: 1,
        maxItems: 40,
        items: { $ref: '#/$defs/InsertScene' },
        'x-hint': 'Devuelve al menos una operación insert_scene.',
      },
      memory: text(6000),
      summary: text(400),
    },
  };
}

/**
 * What a provider can be asked to enforce while it writes: the same schema with its keywords restated in the
 * dialect structured-output endpoints accept (anyOf for oneOf, no pattern or multipleOf). The server's own
 * validation is still the guarantee; this only makes a straying answer less likely.
 */
export function providerSchema(schema) {
  const clean = (node) => {
    if (Array.isArray(node)) return node.map(clean);
    if (!node || typeof node !== 'object') return node;
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      if (['pattern', 'multipleOf', '$schema', 'x-hint', 'x-version', 'title'].includes(key)) continue;
      out[key === 'oneOf' ? 'anyOf' : key] = clean(value);
    }
    return out;
  };
  return clean(schema);
}

/** Readings a model gets wrong all the time and that mean one thing only; anything else is left for the schema. */
export function tidyScreenplayOperation(operation) {
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)) return operation;
  const framing = (value) => {
    const wanted = String(value ?? '')
      .trim()
      .toLowerCase();
    return (
      SCREENPLAY_SHOTS.find((name) => name.toLowerCase() === wanted) ||
      SCREENPLAY_SHOTS.find((name) => name.toLowerCase() === 'plano ' + wanted) ||
      value
    );
  };
  const place = (value) =>
    typeof value === 'string' ? value.replace(/\./g, '').trim().toUpperCase() : value;
  // A null where an optional text or reference goes means "nothing": read it as absent or empty.
  const clean = (item, emptyTexts, dropped) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const out = { ...item };
    for (const key of emptyTexts) if (out[key] === null) out[key] = '';
    for (const key of dropped) if (out[key] === null) delete out[key];
    return out;
  };
  const tidyIntervention = (item) => clean(item, ['voice', 'parenthetical', 'text'], ['characterId']);
  const tidyShot = (shot) => {
    const next = clean(shot, ['camera', 'action', 'transition'], []);
    if (!next || typeof next !== 'object' || Array.isArray(next)) return next;
    if (next.type !== undefined) next.type = framing(next.type);
    if (Array.isArray(next.dialogues)) next.dialogues = next.dialogues.map(tidyIntervention);
    return next;
  };
  const next = clean(operation, [], ['locationId']);
  if (next.op === 'set_scene' && operation.locationId === null) next.locationId = null;
  if (next.interiorExterior !== undefined) next.interiorExterior = place(next.interiorExterior);
  if (typeof next.time === 'string') next.time = next.time.trim().toUpperCase();
  if (next.type !== undefined && ['set_shot', 'insert_shot'].includes(next.op))
    next.type = framing(next.type);
  if (Array.isArray(next.shots)) next.shots = next.shots.map(tidyShot);
  return next;
}

/**
 * What a round or a list of operations says, without the fields the format does not have, and which ones were dropped.
 * Whatever remains is then validated: the schema stays strict about everything it does declare.
 */
export function withoutUndeclared(value, schema) {
  return pruneUndeclared(value, schema);
}
export function operationsWithoutUndeclared(operations) {
  const schema = screenplayOperationSchema();
  const removed = [];
  const kept = operations.map((operation, index) => {
    const result = pruneUndeclared(operation, schema, schema, 'operations[' + index + ']');
    removed.push(...result.removed);
    return result.value;
  });
  return { operations: kept, removed };
}

/** Errors of one operation, or of a list of them, against the schema ([] when it is valid). */
export function checkScreenplayOperations(operations) {
  const schema = screenplayOperationSchema();
  return operations.flatMap((operation, index) =>
    validateSchema(operation, schema, schema, 'operations[' + index + ']'),
  );
}
export function checkAdaptationRound(round) {
  const schema = adaptationRoundSchema();
  return validateSchema(round, schema, schema);
}
export { explainSchemaErrors };
