/**
 * Which project types can be created today. A single list shared by the creation wizard (through the module
 * definitions) and by the assistant's CREAR_PROYECTO command. Existing projects of other types still open.
 */
export const CREATABLE_PROJECTS = Object.freeze({
  book: Object.freeze(['story-book', 'screenplay']),
  character: Object.freeze(['protagonist', 'antagonist', 'secondary']),
  stage: Object.freeze(['interior', 'exterior']),
  video: Object.freeze(['feature']),
});

/** Every category that exists for a type, available or not: a known but unavailable one is refused, never replaced. */
export const KNOWN_CATEGORIES = Object.freeze({
  book: Object.freeze(['story-book', 'screenplay', 'theater', 'comic', 'digital']),
  character: Object.freeze(['protagonist', 'antagonist', 'secondary']),
  stage: Object.freeze(['interior', 'exterior']),
  video: Object.freeze(['feature', 'short-film', 'documentary', 'music-video', 'animation']),
  song: Object.freeze(['single', 'album', 'soundtrack']),
});
export const isKnownCategory = (type, category) =>
  Object.hasOwn(KNOWN_CATEGORIES, type) && KNOWN_CATEGORIES[type].includes(category);

/** Creatable categories of a type, or null. Own properties only, so "__proto__" and friends are never a type. */
export const creatableCategories = (type) =>
  Object.hasOwn(CREATABLE_PROJECTS, type) ? CREATABLE_PROJECTS[type] : null;

export const isCreatableProject = (type, category) => creatableCategories(type)?.includes(category) === true;

/** Default category used when the assistant omits a valid one, per creatable type. */
export const DEFAULT_CATEGORY = Object.freeze({
  book: 'story-book',
  character: 'secondary',
  stage: 'interior',
  video: 'feature',
});

/** Spanish list of what the assistant may create, for its own instructions and refusals. */
export const CREATABLE_DESCRIPTION =
  'libro (story-book o screenplay), personaje (protagonist, antagonist o secondary), escenario (interior o exterior) y metraje (feature)';
