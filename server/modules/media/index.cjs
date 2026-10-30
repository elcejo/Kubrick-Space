// Public server contract for media.
module.exports = {
  createScreenplayCovers: require('./screenplay-cover.cjs').createScreenplayCovers,
  createFaceCropper: require('./face-crop.cjs').createFaceCropper,
  createProjectPreview: require('./project-preview.cjs').createProjectPreview,
  createUniversalPropStore: require('./universal-props.cjs').createUniversalPropStore,
  createCharacterAgentMedia: require('./character-agent-media.cjs').createCharacterAgentMedia,
  ...require('./character-photo-import.cjs'),
  createCharacterAssetLibraryOperations: require('./character-asset-library.cjs')
    .createCharacterAssetLibraryOperations,
  createScenarioTrashOperation: require('./scenario-trash.cjs').createScenarioTrashOperation,
  createCharacterTrashOperation: require('./character-trash.cjs').createCharacterTrashOperation,
  createImageStorage: require('./image-storage.cjs').createImageStorage,
  createFileOperations: require('./operations.cjs').createFileOperations,
  verifyModel: require('./models.cjs').verifyModel,
  ensureModels: require('./models.cjs').ensureModels,
  registerFileRoutes: require('./routes.cjs'),
};
