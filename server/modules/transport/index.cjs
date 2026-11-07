// Public server contract for transport.
module.exports = {
  createImageCatalog: require('./image-models.cjs').createImageCatalog,
  createTextModelCatalog: require('./text-models.cjs').createTextModelCatalog,
  endpoint: require('./endpoint.cjs').endpoint,
  createConfigurationOperations: require('./operations.cjs').createConfigurationOperations,
  openrouterModels: require('./openrouter-models.cjs'),
  artificialAnalysisModels: require('./artificial-analysis-models.cjs'),
  registerConfigurationRoutes: require('./routes.cjs'),
};
