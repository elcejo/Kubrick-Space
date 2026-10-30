import { CharacterWorkspace } from '../../characters/character-workspace.js';

/** A character has a typed, dynamic sheet rather than a text editing surface. */
export function renderCharacterMode(view) {
  if (!view.context.node) return;
  view.context.surface = null;
  const workspace = new CharacterWorkspace(view.context.node, {
    onChange: () => view.context.emitChange(),
    onCreationSelected: () => view.context.refitCanvas?.(),
    onGeneratePhoto: view.context.generateCharacterPhoto,
    onUploadPhoto: view.context.uploadCharacterPhoto,
    onGenerateVisualLibrary: view.context.generateCharacterVisualLibrary,
    onVisualAssetAction: view.context.visualAssetAction,
    onBackgroundState: view.context.onBackgroundState,
    onBackgroundChoice: view.context.onBackgroundChoice,
    onSelectImageEngine: view.context.selectCharacterEngine,
  });
  view.characterWorkspace = workspace;
  view.previewCleanup = () => {
    workspace.destroy();
    view.characterWorkspace = null;
  };
}
