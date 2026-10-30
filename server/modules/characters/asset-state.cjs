const { validateCharacterDocument } = require('../../../public/js/contracts/character-model.js');
const {
  validateCharacterVisualLibrary,
  characterVisualLibraryCurrent,
  characterAssetCategory,
  characterAssetKind,
  characterAssetSlot,
  characterAppearanceKey,
  normalizeCharacterAssetCode,
  characterAssetCodeKey,
} = require('../../../public/js/contracts/character-visual-library.js');

/** Public domain rules for Media; storage and copying remain with Media. */
function readStoredState(project) {
  const document = validateCharacterDocument(JSON.parse(project.content));
  const library =
    project.characterVisualLibrary &&
    validateCharacterVisualLibrary(project.characterVisualLibrary, project.id);
  if (!library) return null;
  return { document, library };
}
function readState(project) {
  const state = readStoredState(project);
  return state &&
    characterVisualLibraryCurrent({ ...project, characterVisualLibrary: state.library }, state.document)
    ? state
    : null;
}
module.exports = {
  readStoredState,
  readState,
  characterAssetCategory,
  characterAssetKind,
  characterAssetSlot,
  characterAppearanceKey,
  normalizeCharacterAssetCode,
  characterAssetCodeKey,
};
