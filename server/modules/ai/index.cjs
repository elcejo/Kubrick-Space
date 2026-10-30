// Public server contract for ai.
module.exports = {
  createInference: require('./inference.cjs').createInference,
  createAIOperations: require('./operations.cjs').createAIOperations,
  createTextContext: require('./text-context.cjs').createTextContext,
  createProvider: require('./provider.cjs').createProvider,
  createConversationOperations: require('./conversation-operations.cjs').createConversationOperations,
  createContextManager: require('./context.cjs').createContextManager,
  POLICIES: require('./context.cjs').POLICIES,
  WRITING_ACTIONS: require('./context.cjs').WRITING_ACTIONS,
  narrative: require('./context.cjs').narrative,
  ingredientContext: require('./context.cjs').ingredientContext,
  streamChat: require('./chat-stream.cjs').streamChat,
  llmConfig: require('./config.cjs'),
  createProjectChatStore: require('./chat-store.cjs').createProjectChatStore,
  registerAIRoutes: require('./routes.cjs'),
  registerConversationRoutes: require('./conversation-routes.cjs'),
};
