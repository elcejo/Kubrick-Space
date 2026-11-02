/** Alternative names of a linked character: the ones written on its card plus those of older sheets. */
export function characterPseudonyms(ingredient) {
  const names = [];
  const add = (value) => {
    if (typeof value !== 'string') return;
    for (const part of value.split(',')) {
      const name = part.trim();
      if (name && !names.some((item) => item.toLowerCase() === name.toLowerCase())) names.push(name);
    }
  };
  add(ingredient?.pseudonyms);
  try {
    add(JSON.parse(ingredient?.value || '{}').traits?.pseudonyms);
  } catch {
    /* A value that is not JSON has no legacy traits. */
  }
  return names;
}

/** Normalised text of the pseudonym field: comma separated, trimmed, no empty or repeated names. */
export function normalizePseudonyms(text) {
  return characterPseudonyms({ pseudonyms: text }).join(', ');
}
