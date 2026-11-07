// Public server contract for library.
module.exports = {
  createLibrarySpace: require('./space.cjs').createLibrarySpace,
  createProjectRepository: require('./repository.cjs').createProjectRepository,
  createLibraryOperations: require('./operations.cjs').createLibraryOperations,
  createProjectStore: require('./store.cjs').createProjectStore,
  listTrash: require('./trash.cjs').listTrash,
  registerProjectRoutes: require('./routes.cjs'),
};
