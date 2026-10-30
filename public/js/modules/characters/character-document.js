import { getSkinLabel, getBodyLabel, getVoiceLabel } from './generators.js';
import { parseCharacterDocument, legacyCharacterDocument } from './character-model.js';

// One mapping for the editor, the traits form and generated proposals.
export const CHARACTER_FIELDS = Object.freeze({
  age: ['age', 'Edad'],
  skin: ['skin', 'Tonalidad Piel'],
  body: ['complexion', 'Complexión'],
  voice: ['voice', 'Voz'],
  pitch: ['pitch', 'Frecuencia de referencia (Hz)'],
  pseudonyms: ['pseudonyms', 'Pseudónimos'],
  clothing: ['clothing', 'Vestimenta'],
  lore: ['lore', 'Lore y Trasfondo'],
  psychology: ['psychology', 'Psicología y Personalidad'],
});
const bounds = { age: [0, 10000], body: [1, 5], pitch: [0, 20000] };
const fold = (value) =>
  String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
const unspecified = (value) =>
  ['', 'sin definir', 'ninguno', 'sin detalles de vestimenta'].includes(fold(value));

function section(root, title) {
  const heading = [...root.querySelectorAll('h2')].find((el) => fold(el.textContent) === fold(title));
  const nodes = [];
  for (let el = heading?.nextElementSibling; el && !/^H[12]$/.test(el.tagName); el = el.nextElementSibling)
    nodes.push(el);
  return { heading, nodes };
}

export function characterFieldText(key, value) {
  if (
    key === 'pseudonyms' &&
    (value === undefined || value === null || value === '' || fold(value) === 'ninguno')
  )
    return 'Ninguno';
  if (value === undefined || value === null || value === '') return 'Sin definir';
  return String(
    key === 'skin'
      ? getSkinLabel(value)
      : key === 'body'
        ? getBodyLabel(value)
        : key === 'voice'
          ? getVoiceLabel(value)
          : value,
  );
}

/** Read without changing the DOM or inventing missing values; keep unknown prose intact. */
export function readCharacterTraits(root, previous = {}) {
  const traits = { ...previous };
  for (const [key, [tag, title]] of Object.entries(CHARACTER_FIELDS)) {
    const element = root.querySelector(tag);
    const { nodes } = section(root, title);
    if (!element && !nodes.length) continue;
    let value = (element?.textContent ?? nodes.map((el) => el.textContent).join('\n')).trim();
    if (['lore', 'psychology', 'clothing', 'pseudonyms'].includes(key) && nodes.length) {
      value = nodes
        .map((el) => el.textContent.trim())
        .join('\n')
        .trim();
    }
    if (unspecified(value)) {
      delete traits[key];
      continue;
    }
    if (key in bounds) {
      if (key === 'pitch' && !element) value = value.match(/(?:Frecuencia|Pitch):\s*(\d+)/i)?.[1] ?? '';
      if (key === 'body') {
        const labels = ['muy delgada', 'delgada', 'media', 'atletica', 'robusta'];
        const index = labels.indexOf(fold(value));
        if (index !== -1) value = String(index + 1);
      }
      const number = Number(value),
        [min, max] = bounds[key];
      if (value !== '' && Number.isInteger(number) && number >= min && number <= max) traits[key] = number;
    } else if (key === 'skin' || key === 'voice') {
      const values =
        key === 'skin'
          ? ['muy-clara', 'clara', 'media', 'morena', 'oscura']
          : ['male-deep', 'male-warm', 'female-soft', 'female-bright', 'neutral'];
      if (key === 'voice') value = value.replace(/\s*\(Frecuencia:[\s\S]*$/i, '').trim();
      const match = values.find(
        (candidate) =>
          fold(candidate) === fold(value) || fold(characterFieldText(key, candidate)) === fold(value),
      );
      // Free-form descriptions are valid in the stored character schema.
      traits[key] = match || value;
    } else traits[key] = value;
  }
  return traits;
}

/** Replace only explicitly supplied fields. Preserve role, notes, title and unrelated sections. */
export function patchCharacterDocument(html, changes) {
  const root = new DOMParser().parseFromString(html || '', 'text/html').body;
  for (const [key, value] of Object.entries(changes)) {
    if (!CHARACTER_FIELDS[key]) continue;
    const [tag, title] = CHARACTER_FIELDS[key];
    const existing = root.querySelector(tag);
    const { heading, nodes } = section(root, title);
    if (existing && !['lore', 'psychology', 'clothing', 'pseudonyms'].includes(key)) {
      existing.textContent = characterFieldText(key, value);
      continue;
    }
    if (existing && !heading) {
      existing.textContent = characterFieldText(key, value);
      continue;
    }
    const h2 = heading || root.ownerDocument.createElement('h2');
    if (!heading) {
      h2.textContent = title;
      root.appendChild(h2);
    }
    if (key === 'voice' || key === 'pitch') {
      const p = nodes[0] || root.ownerDocument.createElement('p');
      const el = root.ownerDocument.createElement(tag);
      el.textContent = characterFieldText(key, value);
      p.append(' ', el);
      if (!nodes.length) h2.after(p);
    } else {
      const p = root.ownerDocument.createElement('p');
      const el = root.ownerDocument.createElement(tag);
      el.textContent = value ?? '';
      if (key === 'skin' || key === 'body') el.textContent = characterFieldText(key, value);
      p.appendChild(el);
      nodes.forEach((node) => node.remove());
      h2.after(p);
    }
  }
  return root.innerHTML;
}

export function prepareCharacterProject(project) {
  const existing = parseCharacterDocument(project.content || '');
  if (existing) {
    project.content = JSON.stringify(existing);
    return project;
  }
  const root = new DOMParser().parseFromString(project.content || '', 'text/html').body;
  project.traits = readCharacterTraits(root, project.traits || {});
  const document = legacyCharacterDocument(project, {
    legacyText: root.textContent.trim(),
    traits: project.traits,
    fieldText: characterFieldText,
    labels: CHARACTER_FIELDS,
  });
  project.content = JSON.stringify(document);
  return project;
}

export function parseCharacterProposal(text) {
  const cleaned = String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const traits = JSON.parse(cleaned);
  if (!traits || typeof traits !== 'object' || Array.isArray(traits))
    throw new Error('La respuesta debe ser una ficha JSON.');
  for (const key of Object.keys(traits)) {
    if (!CHARACTER_FIELDS[key]) throw new Error(`Campo de personaje desconocido: ${key}`);
    if (key in bounds) {
      const [min, max] = bounds[key];
      if (!Number.isInteger(traits[key]) || traits[key] < min || traits[key] > max)
        throw new Error(`Valor inválido para ${CHARACTER_FIELDS[key][1]}.`);
    } else if (typeof traits[key] !== 'string' || traits[key].length > 100000)
      throw new Error(`Texto inválido para ${CHARACTER_FIELDS[key][1]}.`);
  }
  for (const key of ['age', 'skin', 'body', 'voice', 'pitch', 'clothing', 'lore', 'psychology']) {
    if (!(key in traits)) throw new Error(`Falta el campo ${CHARACTER_FIELDS[key][1]}.`);
  }
  return traits;
}
