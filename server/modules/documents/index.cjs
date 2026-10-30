// Public server contract for documents.
module.exports = {
  applyBookAgentPatch: require('./book-patches.cjs').applyBookAgentPatch,
  createBackgroundDraftWriter: require('./background.cjs').createBackgroundDraftWriter,
  createDocumentOperations: require('./operations.cjs').createDocumentOperations,
  createDocumentStore: require('./store.cjs').createDocumentStore,
  registerDocumentRoutes: require('./routes.cjs'),
};
