import { API } from '../../api-service.js';
import {
  emptyCharacterDocument,
  parseCharacterDocument,
  validateCharacterDocument,
  characterDescriptionLocked,
  characterPhotoNeedsInterpretation,
} from './character-model.js';
import { CHARACTER_NATURES, selectCharacterNature } from '../../contracts/character-options.js';

/** Public orchestration for Kubrick Space: one scoped API for the same four creation sources. No UI or persistence. */
export async function prepareCharacterCreation(project, specification, { signal, ingredients = [] } = {}) {
  if (
    project.type !== 'character' ||
    !specification ||
    typeof specification !== 'object' ||
    Array.isArray(specification)
  )
    throw new Error('Creación de personaje inválida.');
  if (
    Object.keys(specification).some(
      (key) => !['source', 'request', 'base', 'nature', 'referenceImage', 'options'].includes(key),
    )
  )
    throw new Error('La creación contiene parámetros desconocidos.');
  let source = specification.source || 'auto';
  if (!['auto', 'description', 'image', 'options', 'ingredients'].includes(source))
    throw new Error('Origen de personaje inválido.');
  let document = parseCharacterDocument(project.content) || emptyCharacterDocument(project);
  if (characterDescriptionLocked(document) && !characterPhotoNeedsInterpretation(document)) {
    if (!['auto', 'description'].includes(source)) throw new Error('La vía de creación ya está fijada.');
    source = 'description';
  } else document.creation.mode = source === 'auto' ? '' : source;
  if (specification.options?.length) {
    const base = specification.base || document.identity.base || 'humanoid';
    document = selectCharacterNature(
      document,
      base,
      specification.nature || document.identity.nature || CHARACTER_NATURES[base]?.[0],
    );
  } else if (specification.base || specification.nature) {
    document.identity.base = specification.base || document.identity.base;
    document.identity.nature = specification.nature || document.identity.nature;
    document = validateCharacterDocument(document);
  }
  const request =
    specification.request ||
    (specification.referenceImage
      ? 'Extrae los rasgos visibles de la referencia.'
      : specification.options?.length
        ? 'Redacta una ficha con las opciones seleccionadas.'
        : 'Desarrolla el personaje a partir de las referencias indicadas.');
  const response = await API.characterDesign(
    {
      projectId: project.id,
      document,
      source,
      request,
      ingredients,
      ...(specification.referenceImage ? { referenceImage: specification.referenceImage } : {}),
      ...(specification.options ? { selections: specification.options } : {}),
    },
    { signal },
  );
  const result = validateCharacterDocument(response.document);
  if (result.id !== project.id) throw new Error('La ficha generada pertenece a otro personaje.');
  return { ...response, document: result };
}
