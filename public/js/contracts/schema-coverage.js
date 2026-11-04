import { CREATABLE_PROJECTS } from './project-availability.js';

/**
 * Which schema governs what a model may change in each kind of project that can be created. A kind of project cannot
 * be added to CREATABLE_PROJECTS without an entry here (a test enforces it), and an entry names the schema that must
 * exist: the operations of element-operations.js / screenplay-operations.js, or the character sheet's tool.
 */
export const SCHEMA_COVERAGE = Object.freeze({
  book: Object.freeze({
    'story-book': { operations: 'story-book' },
    screenplay: { operations: 'screenplay' },
  }),
  character: Object.freeze({ '*': { tool: 'propose_character_changes' } }),
  stage: Object.freeze({ '*': { operations: 'stage' } }),
  video: Object.freeze({ '*': { operations: 'video' } }),
});

/** The schema entry of a project (type, category), or null when none governs it. */
export function schemaFor(type, category) {
  if (!Object.hasOwn(SCHEMA_COVERAGE, type)) return null;
  const entries = SCHEMA_COVERAGE[type];
  return entries[category] || entries['*'] || null;
}

/** Every creatable (type, category) without a schema: must stay empty. */
export function uncoveredProjects() {
  return Object.entries(CREATABLE_PROJECTS).flatMap(([type, categories]) =>
    categories.filter((category) => !schemaFor(type, category)).map((category) => type + ':' + category),
  );
}
