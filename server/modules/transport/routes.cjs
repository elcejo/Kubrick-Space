const { endpoint } = require('./endpoint.cjs');
const { createConfigurationOperations } = require('./operations.cjs');
module.exports = function registerConfigurationRoutes(app, dependencies) {
  const operations = createConfigurationOperations(dependencies);
  app.get(
    '/api/image-models',
    endpoint(async ({ query }) => ({
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
      body: await dependencies.imageCatalog.list({ force: query.force === '1' }),
    })),
  );
  app.get('/api/keys', endpoint(operations.readKeys));
  app.put('/api/keys', endpoint(operations.saveKeys));
  app.get('/api/llm-config', endpoint(operations.readConfig));
  app.get('/api/llm-models', endpoint(operations.listModels));
  app.put('/api/llm-config', endpoint(operations.saveConfig));
};
