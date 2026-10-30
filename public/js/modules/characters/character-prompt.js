/**
 * Prompt direction for API character reference generation.
 * Character records contain narrative data, but image models need a compact
 * visual brief plus explicit framing rules.
 */

const SKIN_PROMPTS = Object.freeze({
  'muy-clara': 'very light skin',
  clara: 'light skin',
  media: 'medium skin',
  morena: 'brown skin',
  oscura: 'dark skin',
});

const BODY_PROMPTS = Object.freeze({
  1: 'very slender build',
  2: 'slender build',
  3: 'average build',
  4: 'athletic build',
  5: 'robust build',
});

function clean(value, fallback = '') {
  return String(value ?? fallback)
    .replace(/\s+/g, ' ')
    .trim();
}

function limit(value, max) {
  const text = clean(value);
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Compatibility brief for legacy human traits; narrative fields never enter image prompts. */
export function buildCharacterVisualDescription({ projectName = 'the character', traits = {} } = {}) {
  const age =
    traits.age !== undefined &&
    traits.age !== null &&
    traits.age !== '' &&
    Number.isFinite(Number(traits.age))
      ? `${Number(traits.age)}-year-old`
      : '';
  const skin = SKIN_PROMPTS[traits.skin] || clean(traits.skin);
  const body = BODY_PROMPTS[traits.body] || '';
  const clothing = limit(traits.clothing, 360);

  return [
    `Character: ${clean(projectName)}.`,
    age && `Age: ${age}.`,
    skin && `Skin: ${skin}.`,
    body && `Build: ${body}.`,
    clothing && `Preserve this wardrobe specification faithfully: ${clothing}.`,
  ]
    .filter(Boolean)
    .join(' ');
}

/** Prefer the last generated local image, independently of the chosen primary. */
export function characterPortraitReference(project, document) {
  const local = (url) =>
    typeof url === 'string' &&
    url.startsWith(`/projects/${project.id}/content/`) &&
    /^\/projects\/[A-Za-z0-9_-]{1,140}\/content\/[A-Za-z0-9][A-Za-z0-9_.-]{0,180}\.(png|jpe?g|webp|gif|bmp)$/i.test(
      url,
    );
  const covers = (project.covers || []).filter(local);
  return (
    (covers.includes(project.lastCharacterImage) && project.lastCharacterImage) ||
    covers.at(-1) ||
    (local(document?.creation.referenceImage) ? document.creation.referenceImage : '')
  );
}

/** The final instruction comes from the visual writer, not a canned character template. */
export function buildCharacterPortraitPrompt({ direction = '' } = {}) {
  if (typeof direction !== 'string' || direction.trim().length < 60 || direction.length > 3000)
    throw new Error('No se recibió una dirección visual válida para este personaje.');
  return direction.trim();
}
