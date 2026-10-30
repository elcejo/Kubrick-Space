export function detectBookLanguage(text) {
  const tokens =
    String(text || '')
      .toLowerCase()
      .match(/[a-záéíóúüñ]+/g) || [];
  const scores = {
    es: new Set([
      'el',
      'la',
      'los',
      'las',
      'un',
      'una',
      'de',
      'del',
      'que',
      'en',
      'y',
      'con',
      'por',
      'para',
      'es',
      'su',
      'se',
      'como',
      'pero',
      'más',
      'madre',
      'hijo',
      'desierto',
      'historia',
    ]),
    en: new Set([
      'the',
      'a',
      'an',
      'of',
      'and',
      'in',
      'to',
      'with',
      'for',
      'is',
      'his',
      'her',
      'on',
      'as',
      'but',
      'more',
      'mother',
      'son',
      'desert',
      'story',
    ]),
  };
  const score = (key) => tokens.reduce((total, token) => total + (scores[key].has(token) ? 1 : 0), 0);
  const spanish = score('es');
  const english = score('en');
  if (spanish >= 2 && spanish >= english + 2) return 'Spanish (español)';
  if (english >= 2 && english >= spanish + 2) return 'English (inglés)';
  return 'the language used by the source prose and title';
}

export function parseCoverBrief(response) {
  const text = typeof response === 'string' ? response : (response?.text ?? response?.message ?? '');
  let brief;
  try {
    brief = JSON.parse(
      text
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, ''),
    );
  } catch {
    throw new Error(
      'La IA no devolvió un concepto de portada válido. Intenta de nuevo o usa Prompt personalizado.',
    );
  }
  if (
    !brief ||
    typeof brief.visualPrompt !== 'string' ||
    brief.visualPrompt.trim().length < 80 ||
    brief.visualPrompt.length > 2500 ||
    typeof brief.tagline !== 'string' ||
    !brief.tagline.trim() ||
    brief.tagline.length > 150 ||
    brief.tagline.trim().split(/\s+/).length > 8
  ) {
    throw new Error(
      'El concepto o el lema no cumple el formato de portada. Intenta de nuevo o usa Prompt personalizado.',
    );
  }
  return { visualPrompt: brief.visualPrompt.trim(), tagline: brief.tagline.trim() };
}

export function sanitizeMuseCoverScene(scene) {
  let value = String(scene || '').trim();
  const replacements = [
    [/\bcrawling(?:\s+exhaustedly)?\b/gi, 'kneeling and bracing himself on the sand, visibly weary'],
    [/\bcrawling\b/gi, 'kneeling'],
    [/\bexhausted(?:ly)?\b/gi, 'weary'],
    [/\bgaunt\b/gi, 'weathered'],
    [/\btorn\b/gi, 'dust-worn'],
    [/\bgrowing despair\b/gi, 'deep uncertainty'],
    [/\bdespair\b/gi, 'uncertainty'],
    [/\bblood orange\b/gi, 'deep orange'],
  ];
  let changed = false;
  for (const [pattern, replacement] of replacements) {
    const next = value.replace(pattern, replacement);
    changed ||= next !== value;
    value = next;
  }
  return changed
    ? `${value}\n\nUse a calm, non-graphic editorial treatment. Convey tension through composition, posture, expression, atmosphere and light while keeping every figure intact and safe.`
    : value;
}

export function buildCoverImagePrompt({ scene, title, tagline = '', includeText = true, references = [] }) {
  const parts = [];
  if (includeText) {
    parts.push(
      `Create the finished vertical front cover following this concept. Render the exact title ${JSON.stringify(String(title || '').trim())} as the dominant designed lettering, readable at thumbnail size. ${tagline ? 'Render ' + JSON.stringify(String(tagline).trim()) + ' as a clearly subordinate supporting line.' : 'Render no supporting line.'} No author name, author credit, byline, publisher or additional inscriptions.`,
    );
    parts.push(
      'Preserve the exact spelling, accents and punctuation of each supplied inscription. Print only the supplied text once, with no labels, headings, duplicate title or extra words. Design the title as a bespoke editorial wordmark integrated with the image: use the concept’s specific letterforms, material, light and texture while preserving clear counters and readable edges. Allocate roughly 30–40% of the cover height and most of its usable width to the title; compose long titles over deliberate lines with smaller connecting words. Keep the title front-facing and parallel to the page in a clear zone in the upper half, never foreshortened on a floor or hidden as writing on a scene object. Reserve clean contrast behind the lettering, safe margins and a distinct focal subject. Avoid a generic white sans-serif caption across a busy photograph, miniature text, meme layout and unrelated decorative effects. Follow the concept’s genre-specific treatment.',
    );
  } else {
    parts.push(
      'Create finished vertical front-cover artwork from this concept without typography or lettering.',
    );
  }
  parts.push('ARTWORK AND LETTERING DIRECTION:\n' + String(scene || '').trim());
  if (references.length) {
    parts.push(
      'Use only the explicitly selected reference subjects that belong in this concept. Preserve recognizable identity while following the action, expression, pose and composition described in the concept; references do not dictate those choices. Do not add unselected manuscript characters.',
    );
    parts.push(...references);
  } else {
    parts.push('No visual references were selected for this cover.');
  }
  return parts.filter(Boolean).join('\n\n');
}
