// Public server contract for characters.
module.exports = {
  createCharacterLoreOperations: require('./lore.cjs').createCharacterLoreOperations,
  createCharacterCompositionReviewer: require('./composition.cjs').createCharacterCompositionReviewer,
  createCharacterAssetDirectionOperation:
    require('./asset-direction.cjs').createCharacterAssetDirectionOperation,
  createCharacterManagement: require('./management.cjs').createCharacterManagement,
  createCharacterBackgroundWorkflow: require('./background-workflow.cjs').createCharacterBackgroundWorkflow,
  characterAssetRules: require('./asset-state.cjs'),
  createCharacterVisualLibraryOperation:
    require('./visual-library.cjs').createCharacterVisualLibraryOperation,
  createCharacterOperations: require('./operations.cjs').createCharacterOperations,
  createCharacterImagePromptOperation: require('./image-prompt.cjs').createCharacterImagePromptOperation,
  registerCharacterAssistant: require('./routes.cjs'),
};
