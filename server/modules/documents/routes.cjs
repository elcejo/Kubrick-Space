const { endpoint } = require('../transport/index.cjs');
const { createDocumentOperations } = require('./operations.cjs');
module.exports = function registerDocumentRoutes(app, dependencies) {
  const operations = createDocumentOperations(dependencies);
  app.get('/api/projects/:id/draft', endpoint(operations.readDraft));
  app.put('/api/projects/:id/draft', endpoint(operations.saveDraft));
  app.get('/api/projects/:id/versions', endpoint(operations.listVersions));
  app.get('/api/projects/:id/versions/:versionId', endpoint(operations.getVersion));
  app.post('/api/projects/:id/versions', endpoint(operations.saveVersion));
};
