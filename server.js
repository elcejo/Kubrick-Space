// Compatible entry point for the single Kubrick Space server.
const path = require('node:path');
const { createApp } = require('./server/create-app.cjs');
const { ensureModels } = require('./server/modules/media/index.cjs');
const appRoot = __dirname;
const dataRoot = path.resolve(
  appRoot,
  process.env.KUBRICK_SPACE_DATA_DIR ||
    process.env.KUBRICK_STUDIO_DATA_DIR ||
    process.env.CODE_KAI_DATA_DIR ||
    '.',
);
const port = Number(process.env.PORT || 3001);
const app = createApp({ appRoot, dataRoot, port });
if (require.main === module) {
  require('node:fs').mkdirSync(path.join(dataRoot, 'projects'), { recursive: true });
  app.listen(port, '127.0.0.1', () => {
    console.log('Kubrick Space: http://localhost:' + port);
    void app.locals
      .ensureCharacterPreviews()
      .catch((error) => console.error('[Character previews]', error.message));
    ensureModels(path.join(appRoot, 'public', 'models')).catch((error) =>
      console.error('[Models]', error.message),
    );
  });
}
module.exports = app;
