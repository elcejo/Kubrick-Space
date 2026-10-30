const { endpoint } = require('../transport/index.cjs');
const { createFileOperations } = require('./operations.cjs');
const { createCharacterTrashOperation } = require('./character-trash.cjs');
const { createScenarioTrashOperation } = require('./scenario-trash.cjs');
const { createCharacterAssetLibraryOperations } = require('./character-asset-library.cjs');
const { createCharacterPhotoImportOperation } = require('./character-photo-import.cjs');
module.exports = function registerFileRoutes(app, dependencies) {
  const universal = dependencies.universalProps;
  if (universal) {
    app.post(
      '/api/files/prop-library/code',
      endpoint((input) => {
        if (dependencies.repository.read().projects.some((p) => dependencies.isProjectBusy?.(p.id)))
          throw dependencies.security.fail('Espera a que terminen las tareas antes de editar tags.', 423);
        return universal.rename(input);
      }),
    );
    app.get('/api/files/prop-library', endpoint(universal.list));
    app.post(
      '/api/files/prop-library',
      endpoint((input) => {
        if (dependencies.repository.read().projects.some((p) => dependencies.isProjectBusy?.(p.id)))
          throw dependencies.security.fail(
            'Espera a que terminen los trabajos de personaje antes de modificar la biblioteca.',
            423,
          );
        return universal.change(input);
      }),
    );
    app.get('/api/files/prop-library/:libraryId/image', (req, res, next) => {
      try {
        const image = universal.image({ params: req.params });
        res.set('Cache-Control', 'no-store');
        res.sendFile(image.path);
      } catch (error) {
        next(error);
      }
    });
  }
  const operations = createFileOperations(dependencies);
  app.post('/api/files/import-character-photo', endpoint(createCharacterPhotoImportOperation(dependencies)));
  const assets = createCharacterAssetLibraryOperations(dependencies);
  app.get('/api/files/character-assets', endpoint(assets.list));
  app.post('/api/files/character-assets/import', endpoint(assets.importAsset));
  app.post('/api/files/upload/:projectId', endpoint(operations.prepareUpload));
  app.post('/api/files/upload-base64/:projectId', endpoint(operations.uploadImage));
  app.post('/api/files/delete', endpoint(operations.deleteFile));
  app.post('/api/files/purge-character-trash', endpoint(createCharacterTrashOperation(dependencies)));
  app.post('/api/files/purge-scenario-trash', endpoint(createScenarioTrashOperation(dependencies)));
  app.get('/api/files/:projectId', endpoint(operations.listFiles));
};
