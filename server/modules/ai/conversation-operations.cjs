// Application operations with explicit storage/provider dependencies.
function createConversationOperations(dependencies) {
  const { assertProject, security, chatStore } = dependencies;

  function listConversations({ params = {}, body, headers = {}, query = {} } = {}) {
    const responseHeaders = {};
    const reply = (body, status = 200) => ({ body, status, headers: responseHeaders });

    try {
      assertProject(params.id);
      return reply({ chats: chatStore.list(params.id) }, 200);
    } catch (error) {
      throw error;
    }
  }

  function saveConversation({ params = {}, body, headers = {}, query = {} } = {}) {
    const responseHeaders = {};
    const reply = (body, status = 200) => ({ body, status, headers: responseHeaders });

    try {
      assertProject(params.id);
      return reply(chatStore.save(params.id, body), 201);
    } catch (error) {
      throw error;
    }
  }

  function getConversation({ params = {}, body, headers = {}, query = {} } = {}) {
    const responseHeaders = {};
    const reply = (body, status = 200) => ({ body, status, headers: responseHeaders });

    try {
      assertProject(params.id);
      if (!security.UUID.test(params.chatId)) throw security.fail('ID de conversación inválido.');
      const chat = chatStore.get(params.id, params.chatId);
      if (!chat) throw security.fail('No se encontró la conversación.', 404);
      return reply(chat, 200);
    } catch (error) {
      throw error;
    }
  }

  function updateConversation({ params = {}, body, headers = {}, query = {} } = {}) {
    const responseHeaders = {};
    const reply = (body, status = 200) => ({ body, status, headers: responseHeaders });

    try {
      assertProject(params.id);
      if (!security.UUID.test(params.chatId)) throw security.fail('ID de conversación inválido.');
      return reply(chatStore.save(params.id, body, params.chatId), 200);
    } catch (error) {
      throw error;
    }
  }

  function deleteConversation({ params = {}, body, headers = {}, query = {} } = {}) {
    const responseHeaders = {};
    const reply = (body, status = 200) => ({ body, status, headers: responseHeaders });

    try {
      assertProject(params.id);
      if (!security.UUID.test(params.chatId)) throw security.fail('ID de conversación inválido.');
      if (!chatStore.remove(params.id, params.chatId))
        throw security.fail('No se encontró la conversación.', 404);
      return reply(undefined, 204);
    } catch (error) {
      throw error;
    }
  }
  return { listConversations, saveConversation, getConversation, updateConversation, deleteConversation };
}
module.exports = { createConversationOperations };
