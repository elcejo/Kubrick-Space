const { endpoint } = require('../transport/index.cjs');
const { createLibraryOperations } = require('./operations.cjs');
module.exports = function registerProjectRoutes(app, dependencies) {
  const operations = createLibraryOperations(dependencies);
  app.get('/api/projects', endpoint(operations.listProjects));
  app.get('/api/trash', endpoint(operations.listTrash));
  app.post('/api/trash/:id/restore', endpoint(operations.restoreProject));
  app.post('/api/projects', endpoint(operations.createProject));
  app.get('/api/projects/:id', endpoint(operations.getProject));
  app.put('/api/projects/:id', endpoint(operations.updateProject));
  app.patch('/api/projects/:id/inference', endpoint(operations.updateInference));
  app.delete('/api/projects/:id', endpoint(operations.trashProject));
  app.delete('/api/projects/:id/full', endpoint(operations.deleteProject));
};
