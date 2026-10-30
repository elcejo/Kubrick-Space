const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { containedPath, UUID } = require('../security/index.cjs').security;
const MAX_CONVERSATIONS = 200;
const MAX_CONVERSATION_BYTES = 8_000_000;

function createProjectChatStore(projectsDir) {
  const fileFor = (projectId) => {
    if (!UUID.test(projectId)) throw Object.assign(new Error('ID de proyecto inválido.'), { status: 400 });
    return containedPath(projectsDir, projectId, 'chats.json');
  };
  const read = (projectId) => {
    try {
      const data = JSON.parse(fs.readFileSync(fileFor(projectId), 'utf8'));
      if (!Array.isArray(data)) throw new Error('El archivo de conversaciones tiene un formato inválido.');
      return data;
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  };
  const write = (projectId, items) => {
    const file = fileFor(projectId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(items, null, 2), {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      fs.renameSync(temporary, file);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  };
  const validate = (value) => {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).some((key) => !['name', 'messages'].includes(key))
    ) {
      throw Object.assign(new Error('Conversación inválida.'), { status: 400 });
    }
    const name = typeof value.name === 'string' ? value.name.trim() : '';
    if (!name || name.length > 120)
      throw Object.assign(new Error('El nombre debe tener entre 1 y 120 caracteres.'), { status: 400 });
    if (!Array.isArray(value.messages) || value.messages.length > 2000)
      throw Object.assign(new Error('La conversación contiene demasiados mensajes.'), { status: 400 });
    const messages = value.messages.map((item) => {
      if (
        !item ||
        typeof item !== 'object' ||
        Array.isArray(item) ||
        Object.keys(item).some((key) => !['role', 'text', 'time', 'visible'].includes(key))
      ) {
        throw Object.assign(new Error('Hay un mensaje inválido en la conversación.'), { status: 400 });
      }
      if (
        !['user', 'ai'].includes(item.role) ||
        typeof item.text !== 'string' ||
        item.text.length > 2_000_000 ||
        (item.time !== undefined && (typeof item.time !== 'string' || item.time.length > 40)) ||
        (item.visible !== undefined && typeof item.visible !== 'boolean')
      ) {
        throw Object.assign(new Error('Hay un mensaje inválido en la conversación.'), { status: 400 });
      }
      return { role: item.role, text: item.text, time: item.time || '', visible: item.visible !== false };
    });
    if (!messages.some((item) => item.visible && item.role === 'user' && item.text.trim())) {
      throw Object.assign(new Error('La conversación no contiene mensajes visibles.'), { status: 400 });
    }
    if (Buffer.byteLength(JSON.stringify(messages), 'utf8') > MAX_CONVERSATION_BYTES) {
      throw Object.assign(new Error('La conversación supera el tamaño máximo permitido de 8 MB.'), {
        status: 413,
      });
    }
    return { name, messages };
  };
  return {
    list(projectId) {
      return read(projectId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map(({ messages, ...item }) => ({
          ...item,
          messageCount: messages.filter((message) => message.visible).length,
        }));
    },
    get(projectId, chatId) {
      return read(projectId).find((item) => item.id === chatId) || null;
    },
    save(projectId, value, chatId = null) {
      const nextValue = validate(value);
      const items = read(projectId);
      const index = chatId ? items.findIndex((item) => item.id === chatId) : -1;
      if (chatId && index < 0)
        throw Object.assign(new Error('No se encontró la conversación.'), { status: 404 });
      if (!chatId && items.length >= MAX_CONVERSATIONS)
        throw Object.assign(new Error('Este proyecto ya alcanzó el límite de conversaciones guardadas.'), {
          status: 409,
        });
      const now = new Date().toISOString();
      const item = {
        id: chatId || randomUUID(),
        name: nextValue.name,
        createdAt: index >= 0 ? items[index].createdAt : now,
        updatedAt: now,
        messages: nextValue.messages,
      };
      if (index >= 0) items[index] = item;
      else items.push(item);
      write(projectId, items);
      return item;
    },
    remove(projectId, chatId) {
      const items = read(projectId);
      const next = items.filter((item) => item.id !== chatId);
      if (items.length === next.length) return false;
      write(projectId, next);
      return true;
    },
  };
}

module.exports = { createProjectChatStore };
