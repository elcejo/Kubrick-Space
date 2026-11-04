// Public server contract for documents.
module.exports = {
  applyElementPatch: require('./element-patches.cjs').applyElementPatch,
  applyBookAgentPatch: require('./book-patches.cjs').applyBookAgentPatch,
  createBackgroundDraftWriter: require('./background.cjs').createBackgroundDraftWriter,
  createSafetyVersionWriter: require('./background.cjs').createSafetyVersionWriter,
  createDocumentOperations: require('./operations.cjs').createDocumentOperations,
  createDocumentStore: require('./store.cjs').createDocumentStore,
  registerDocumentRoutes: require('./routes.cjs'),
};
