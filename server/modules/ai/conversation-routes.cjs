const { endpoint } = require('../transport/index.cjs');
const { createConversationOperations } = require('./conversation-operations.cjs');
module.exports = function registerConversationRoutes(app, dependencies) {
  const operations = createConversationOperations(dependencies);
  app.get('/api/projects/:id/chats', endpoint(operations.listConversations));
  app.post('/api/projects/:id/chats', endpoint(operations.saveConversation));
  app.get('/api/projects/:id/chats/:chatId', endpoint(operations.getConversation));
  app.put('/api/projects/:id/chats/:chatId', endpoint(operations.updateConversation));
  app.delete('/api/projects/:id/chats/:chatId', endpoint(operations.deleteConversation));
};
