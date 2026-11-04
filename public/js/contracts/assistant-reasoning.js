import { validateSchema, explainSchemaErrors, pruneUndeclared } from './json-schema.js';

/**
 * What a local model is given to compensate for its small context and its lack of real reasoning, as contracts with
 * no DOM, network or storage:
 *
 *  - the continuity review by parts: the material is split without losing a character, each part is read with a
 *    notebook of the facts found so far, and what the model writes (facts and contradictions) has a closed schema;
 *  - simulated thinking: a fixed number of short, focused steps whose notes (also a closed schema) precede the answer.
 *
 * Neither changes a project: they only read, and the model that does it is the one chosen in the workspace top bar.
 */
export const ASSISTANT_REASONING_SCHEMA_VERSION = 1;

const text = (max, extra = {}) => ({ type: 'string', maxLength: max, ...extra });
const NOT_EMPTY = Object.freeze({ minLength: 1 });
const head = (title) => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title,
  'x-version': ASSISTANT_REASONING_SCHEMA_VERSION,
});

// ── Continuity review by parts ───────────────────────────────────────────────────────────────────────────────────
export const CONTINUITY_MAX_FACTS = 50;
export const CONTINUITY_MAX_PART_FINDINGS = 20;
export const CONTINUITY_MAX_FINDINGS = 200;
export const CONTINUITY_FACT_CHARS = 160;
export const CONTINUITY_WHERE_CHARS = 150;
export const CONTINUITY_ISSUE_CHARS = 400;
export const CONTINUITY_EVIDENCE_CHARS = 200;
/** The most the notebook a part carries can weigh: the facts, and a short line for each contradiction already found. */
export const CONTINUITY_NOTEBOOK_CHARS = CONTINUITY_MAX_FACTS * CONTINUITY_FACT_CHARS + 6000;

const findingSchema = () => ({
  type: 'object',
  required: ['where', 'issue', 'certainty'],
  additionalProperties: false,
  properties: {
    where: text(CONTINUITY_WHERE_CHARS, NOT_EMPTY),
    issue: text(CONTINUITY_ISSUE_CHARS, NOT_EMPTY),
    certainty: { enum: ['segura', 'dudosa'] },
    evidence: { type: 'array', maxItems: 1, items: text(CONTINUITY_EVIDENCE_CHARS, NOT_EMPTY) },
  },
});
/** What a model writes after reading one part: the facts established so far and the contradictions new in this part. */
export const continuityPartSchema = () => ({
  ...head('Parte de la revisión de continuidad de Kubrick Space'),
  type: 'object',
  required: ['facts', 'findings'],
  additionalProperties: false,
  properties: {
    facts: {
      type: 'array',
      maxItems: CONTINUITY_MAX_FACTS,
      items: text(CONTINUITY_FACT_CHARS, NOT_EMPTY),
      'x-hint':
        'Lista COMPLETA y actualizada de hechos establecidos (nombres, edades, fechas, lugares, rasgos, objetos, reglas, relaciones), con su ubicación breve.',
    },
    findings: {
      type: 'array',
      maxItems: CONTINUITY_MAX_PART_FINDINGS,
      items: findingSchema(),
      'x-hint': 'Solo contradicciones NUEVAS de esta parte; [] si no hay ninguna.',
    },
  },
});
/** The review once every part has been read: nothing is cut, and the findings are the ones the parts found. */
export const continuityReportSchema = () => ({
  ...head('Informe de continuidad de Kubrick Space'),
  type: 'object',
  required: ['coverage', 'findings'],
  additionalProperties: false,
  properties: {
    coverage: {
      type: 'object',
      required: ['sources', 'parts'],
      additionalProperties: false,
      properties: {
        sources: { type: 'array', maxItems: 200, items: text(200) },
        parts: { type: 'integer', minimum: 1, maximum: 5000 },
      },
    },
    findings: { type: 'array', maxItems: CONTINUITY_MAX_FINDINGS, items: findingSchema() },
  },
});
const check = (schema, value) => {
  const cleaned = pruneUndeclared(value, schema);
  const problems = validateSchema(cleaned.value, schema);
  return { value: cleaned.value, removed: cleaned.removed, problems, text: explainSchemaErrors(problems) };
};
export const checkContinuityPart = (value) => check(continuityPartSchema(), value);
export const checkContinuityReport = (value) => check(continuityReportSchema(), value);

/** Findings without repeats: the same place and the same complaint, however the model worded the margins. */
export function mergeFindings(known, incoming, limit = CONTINUITY_MAX_FINDINGS) {
  const key = (finding) =>
    (finding.where + '|' + finding.issue)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .slice(0, 120);
  const seen = new Set(known.map(key));
  const merged = [...known];
  for (const finding of incoming) {
    if (merged.length >= limit) break;
    if (seen.has(key(finding))) continue;
    seen.add(key(finding));
    merged.push(finding);
  }
  return merged;
}

/**
 * The size of what one part may carry, in characters, for a model with this context window (in tokens). Characters per
 * token are counted at two, as the rest of the application does, so a part never overruns the window. Local engines
 * also refuse a request over `localCharacters` characters. Nothing is dropped to make it fit: a smaller budget only
 * means more parts. A window too small to hold the instructions, the notebook and some material is an error.
 */
export function continuityPartBudget({
  contextLength,
  maxTokens,
  local = false,
  localCharacters = 95000,
  systemCharacters = 4000,
  overheadCharacters = 3000,
  cap = 600000,
}) {
  const window = Math.min(
    local ? localCharacters : Infinity,
    Math.max(0, (contextLength - maxTokens - 1024) * 2),
  );
  const budget = Math.min(cap, window - systemCharacters - CONTINUITY_NOTEBOOK_CHARS - overheadCharacters);
  if (!(budget >= 4000))
    throw Object.assign(
      new Error(
        'El contexto del modelo elegido es demasiado pequeño para leer el material por partes. Elige un modelo con más contexto.',
      ),
      { status: 413 },
    );
  return Math.floor(budget);
}

/** Where a text may be cut, from the cleanest break to the last resort: paragraph, line, sentence, word. */
const BREAKS = Object.freeze(['\n\n', '\n', '. ', ' ']);
function cutPoint(textValue, limit) {
  const window = textValue.slice(0, limit);
  for (const mark of BREAKS) {
    const index = window.lastIndexOf(mark);
    // A break in the first fifth would leave a sliver; the next kind of break is better.
    if (index > limit * 0.2) return index + mark.length;
  }
  return limit;
}
/**
 * The material cut into parts of at most `budget` characters. `sections` is [{label, text}]; each part lists the
 * pieces it carries ({label, text, piece, of}) in order. Concatenating the pieces of one label gives back its text
 * exactly: nothing is dropped, summarised or repeated.
 */
export function splitForReview(sections, budget) {
  if (!Number.isInteger(budget) || budget < 1000) throw new Error('Presupuesto de parte inválido.');
  const pieces = [];
  for (const section of sections) {
    let rest = String(section.text || '');
    if (!rest.trim()) continue;
    const cuts = [];
    while (rest.length > budget) {
      const at = cutPoint(rest, budget);
      cuts.push(rest.slice(0, at));
      rest = rest.slice(at);
    }
    cuts.push(rest);
    cuts.forEach((value, index) =>
      pieces.push({ label: section.label, text: value, piece: index + 1, of: cuts.length }),
    );
  }
  const parts = [];
  let current = [];
  let size = 0;
  for (const piece of pieces) {
    if (current.length && size + piece.text.length > budget) {
      parts.push(current);
      current = [];
      size = 0;
    }
    current.push(piece);
    size += piece.text.length;
  }
  if (current.length) parts.push(current);
  return parts;
}

// ── Simulated thinking ───────────────────────────────────────────────────────────────────────────────────────────
export const MAX_THINKING_STEPS = 30;
export const THINKING_LEVELS = Object.freeze([
  Object.freeze({ id: 'off', label: 'Sin pensamiento', steps: 0 }),
  Object.freeze({ id: 'low', label: 'Bajo · 5 pasos', steps: 5 }),
  Object.freeze({ id: 'medium', label: 'Medio · 10 pasos', steps: 10 }),
  Object.freeze({ id: 'high', label: 'Alto · 20 pasos', steps: 20 }),
]);
const FIRST_FOCUS =
  'Entender: qué pide exactamente la persona, con sus propias palabras, y qué da por supuesto o deja sin decir.';
const LAST_FOCUS =
  'Decisión final: qué hará la respuesta, en orden, y qué comando del asistente emitirá (si alguno). No redactes aún la respuesta.';
const MIDDLE_FOCI = Object.freeze([
  'Contexto: qué datos del proyecto, de los ingredientes y de la conversación son relevantes. Cita nombres y hechos reales; no supongas ninguno.',
  'Herramientas: si pide una acción, qué comando corresponde y con qué datos exactos (IDs, proyectos); si es solo conversación, dilo.',
  'Riesgos: qué podría salir mal o no estar permitido (modelo elegido, proyecto abierto, reglas) y qué no debe afirmarse sin un resultado real.',
  'Alternativas: otra manera razonable de responder y por qué se prefiere o se descarta.',
  'Verificación: relee tus notas anteriores buscando errores, omisiones o contradicciones y corrígelos.',
]);
/** What step `step` of `total` is for. Every step has its own purpose, so the notes do not repeat one another. */
export function thinkingFocus(step, total) {
  if (!Number.isInteger(step) || !Number.isInteger(total) || step < 1 || step > total)
    throw new Error('Paso de pensamiento inválido.');
  if (step === 1) return FIRST_FOCUS;
  if (step === total) return LAST_FOCUS;
  return MIDDLE_FOCI[(step - 2) % MIDDLE_FOCI.length];
}
export const THINKING_NOTE_CHARS = 1500;
/** What a model writes in one thinking step. */
export const thinkingStepSchema = () => ({
  ...head('Paso de pensamiento de Kubrick Space'),
  type: 'object',
  required: ['note'],
  additionalProperties: false,
  properties: { note: text(THINKING_NOTE_CHARS, NOT_EMPTY) },
});
export const checkThinkingStep = (value) => check(thinkingStepSchema(), value);
/** The `thinking` field of a request for one step, and the `thinkingNotes` that reach the final answer. */
export const thinkingRequestSchema = () => ({
  ...head('Petición de paso de pensamiento de Kubrick Space'),
  type: 'object',
  required: ['step', 'total', 'notes'],
  additionalProperties: false,
  properties: {
    step: { type: 'integer', minimum: 1, maximum: MAX_THINKING_STEPS },
    total: { type: 'integer', minimum: 1, maximum: MAX_THINKING_STEPS },
    notes: {
      type: 'array',
      maxItems: MAX_THINKING_STEPS - 1,
      items: text(THINKING_NOTE_CHARS, NOT_EMPTY),
    },
  },
});
export const thinkingNotesSchema = () => ({
  type: 'array',
  maxItems: MAX_THINKING_STEPS,
  items: text(THINKING_NOTE_CHARS, NOT_EMPTY),
});
export function checkThinkingRequest(value) {
  const result = check(thinkingRequestSchema(), value);
  if (!result.problems.length && (value.step > value.total || value.notes.length !== value.step - 1)) {
    result.problems.push({ path: '', message: 'El paso no corresponde a las notas anteriores.' });
    result.text = explainSchemaErrors(result.problems);
  }
  return result;
}
export const checkThinkingNotes = (value) => {
  const schema = thinkingNotesSchema();
  const problems = validateSchema(value, schema);
  return { problems, text: explainSchemaErrors(problems) };
};
/** The notes of the thinking steps as the instruction that precedes the final answer. */
export function thinkingInstruction(notes) {
  return (
    'Notas de tu razonamiento previo, escritas por ti en ' +
    notes.length +
    ' pasos privados antes de responder (úsalas para decidir y responder bien; no las cites ni las repitas a la persona):\n' +
    notes.map((note, index) => index + 1 + '. ' + note).join('\n')
  );
}
/** The count of steps for a level id or a custom number; 0 means no thinking. */
export function thinkingSteps(level) {
  if (Number.isInteger(level)) return Math.max(0, Math.min(MAX_THINKING_STEPS, level));
  return THINKING_LEVELS.find((item) => item.id === level)?.steps ?? 0;
}
export { explainSchemaErrors };
