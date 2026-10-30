const { endpoint } = require('../transport/index.cjs');
const { createCharacterOperations } = require('./operations.cjs');
const { createCharacterImagePromptOperation } = require('./image-prompt.cjs');
const { createCharacterVisualLibraryOperation } = require('./visual-library.cjs');

module.exports = function registerCharacterAssistant(app, dependencies, proxyRequest) {
  const operations = createCharacterOperations({ ...dependencies, proxyRequest });
  const prepareLibrary = createCharacterVisualLibraryOperation({ ...dependencies, proxyRequest });
  const preparePrompt = createCharacterImagePromptOperation({ ...dependencies, proxyRequest });

  app.post('/api/ai/character-design', endpoint(operations.designCharacter));
  app.post('/api/ai/character-visual-library', endpoint(prepareLibrary));
  app.post('/api/ai/character-image-prompt', endpoint(preparePrompt));
  return { designCharacter: operations.designCharacter, prepareLibrary, preparePrompt };
};
