import {
  selectedCharacterAssets,
  characterAssetSelectionPending,
  characterVisualLibraryCurrent,
  characterAssetImage,
  validateCharacterVisualLibrary,
} from '../characters/character-model.js';

/** Individual roles and dependency stages are assigned by the server. */
export async function prepareCharacterAssetSelection(project, document, signal) {
  signal?.throwIfAborted();
  const library = validateCharacterVisualLibrary(project.characterVisualLibrary, project.id);
  if (
    !library ||
    !characterVisualLibraryCurrent(project, document) ||
    !characterAssetSelectionPending(library)
  )
    throw Error('No hay cambios de piezas pendientes para aplicar.');
  const items = selectedCharacterAssets(library).filter((item) => item.image);
  if (!items.length || items.some((item) => !characterAssetImage(item.image, project.id)))
    throw Error('Las piezas deben tener imágenes de este personaje.');
  return {
    sourceImage: library.sourceImage,
    sourceKey: library.sourceKey,
    ids: items.map((item) => item.id),
  };
}
