const { chatAttachmentList } = require('../../../public/js/contracts/chat-attachments.js');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { containedPath, UUID } = require('../security/index.cjs').security;
const MAX_CONVERSATIONS = 200;
const MAX_CONVERSATION_BYTES = 8_000_000;

function createProjectChatStore(projectsDir, { listAssets = () => [], listFolders = () => [] } = {}) {
  const fileFor = (projectId) => {
    if (!UUID.test(projectId)) throw Object.assign(new Error('ID de proyecto inválido.'), { status: 400 });
    return containedPath(projectsDir, projectId, 'chats.json');
  };
  // A shared chat is found by reading the conversations of every asset, so the parsed files are kept by their size and
  // modification time: when nothing changed a read costs one stat. What read() returns is shared and never modified;
  // the writers build a new list.
  const cache = new Map();
  const keyOf = (stat) => `${stat.size}:${stat.mtimeMs}`;
  const read = (projectId) => {
    const file = fileFor(projectId);
    let stat;
    try {
      stat = fs.statSync(file);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      cache.delete(projectId);
      return [];
    }
    const known = cache.get(projectId);
    if (known?.key === keyOf(stat)) return known.items;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(data)) throw new Error('El archivo de conversaciones tiene un formato inválido.');
    cache.set(projectId, { key: keyOf(stat), items: data });
    return data;
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
      cache.set(projectId, { key: keyOf(fs.statSync(file)), items });
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  };
  /** A result card of the chat: the task it follows (optional) and the project it is about. */
  const validCard = (card) =>
    card &&
    typeof card === 'object' &&
    !Array.isArray(card) &&
    Object.keys(card).every((key) => ['projectId', 'jobId', 'kind'].includes(key)) &&
    /^[a-f0-9-]{36}$/.test(card.projectId) &&
    (card.jobId === undefined || /^[a-f0-9-]{36}$/.test(card.jobId)) &&
    (card.kind === undefined || (typeof card.kind === 'string' && /^[a-z-]{1,40}$/.test(card.kind)));
  const validate = (value) => {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).some((key) => !['name', 'messages', 'revision'].includes(key))
    ) {
      throw Object.assign(new Error('Conversación inválida.'), { status: 400 });
    }
    if (value.revision !== undefined && (!Number.isSafeInteger(value.revision) || value.revision < 1))
      throw Object.assign(new Error('Revisión de conversación inválida.'), { status: 400 });
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
        Object.keys(item).some(
          (key) => !['role', 'text', 'time', 'visible', 'card', 'attachments'].includes(key),
        )
      ) {
        throw Object.assign(new Error('Hay un mensaje inválido en la conversación.'), { status: 400 });
      }
      if (
        !['user', 'ai'].includes(item.role) ||
        typeof item.text !== 'string' ||
        item.text.length > 2_000_000 ||
        (item.time !== undefined && (typeof item.time !== 'string' || item.time.length > 40)) ||
        (item.visible !== undefined && typeof item.visible !== 'boolean') ||
        (item.card !== undefined && !validCard(item.card)) ||
        (item.attachments !== undefined && !chatAttachmentList(item.attachments))
      ) {
        throw Object.assign(new Error('Hay un mensaje inválido en la conversación.'), { status: 400 });
      }
      return {
        role: item.role,
        text: item.text,
        time: item.time || '',
        visible: item.visible !== false,
        ...(item.card ? { card: { ...item.card } } : {}),
        ...(item.attachments?.length ? { attachments: [...item.attachments] } : {}),
      };
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
  const fail = (message, status = 400) => Object.assign(new Error(message), { status });
  const assets = (projectId) => {
    fileFor(projectId);
    const found = listAssets().filter((asset) => !asset.deletedAt && UUID.test(asset.id));
    return found.some((asset) => asset.id === projectId) ? found : [...found, { id: projectId }];
  };
  const sharedWith = (chat, projectId, folders) =>
    chat.sharing?.assetIds?.includes(projectId) ||
    folders.some(
      (folder) => chat.sharing?.folderIds?.includes(folder.id) && folder.assetIds.includes(projectId),
    );
  const projectChats = (projectId) => {
    const folders = listFolders();
    return assets(projectId).flatMap((asset) =>
      read(asset.id)
        .filter((chat) => asset.id === projectId || sharedWith(chat, projectId, folders))
        .map((chat) => ({
          ...chat,
          ownerProjectId: asset.id,
          ownerName: asset.name || '',
          revision: chat.revision || 1,
          sharing: chat.sharing || { assetIds: [], folderIds: [] },
        })),
    );
  };
  const find = (projectId, chatId) => {
    if (!UUID.test(chatId)) throw fail('ID de conversación inválido.');
    // The asset's own conversations first: most chats are never shared, and they cost one file.
    const own = read(projectId).find((chat) => chat.id === chatId);
    if (own)
      return {
        ...own,
        ownerProjectId: projectId,
        ownerName: listAssets().find((asset) => asset.id === projectId)?.name || '',
        revision: own.revision || 1,
        sharing: own.sharing || { assetIds: [], folderIds: [] },
      };
    return projectChats(projectId).find((chat) => chat.id === chatId) || null;
  };
  const checkRevision = (chat, revision, required = false) => {
    if ((required || revision !== undefined) && revision !== chat.revision)
      throw fail('La conversación cambió. Vuelve a abrirla antes de guardar; tu texto se conserva.', 409);
  };
  const replace = (chat, item) => {
    const items = [...read(chat.ownerProjectId)],
      index = items.findIndex((entry) => entry.id === chat.id);
    if (index < 0) throw fail('No se encontró la conversación.', 404);
    const { ownerProjectId, ownerName, ...stored } = item;
    items[index] = stored;
    write(chat.ownerProjectId, items);
    return item;
  };
  return {
    list(projectId) {
      return projectChats(projectId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map(({ messages, ...item }) => ({
          ...item,
          messageCount: messages.filter((message) => message.visible !== false).length,
        }));
    },
    get: find,
    save(projectId, value, chatId = null) {
      const nextValue = validate(value);
      if (chatId) {
        const chat = find(projectId, chatId);
        if (!chat) throw fail('No se encontró la conversación.', 404);
        checkRevision(
          chat,
          value.revision,
          chat.sharing.assetIds.length > 0 || chat.sharing.folderIds.length > 0,
        );
        return replace(chat, {
          ...chat,
          ...nextValue,
          revision: chat.revision + 1,
          updatedAt: new Date().toISOString(),
        });
      }
      const items = [...read(projectId)];
      if (items.length >= MAX_CONVERSATIONS)
        throw fail('Este asset alcanzó el límite de conversaciones guardadas.', 409);
      const now = new Date().toISOString(),
        item = {
          id: randomUUID(),
          ...nextValue,
          revision: 1,
          sharing: { assetIds: [], folderIds: [] },
          createdAt: now,
          updatedAt: now,
        };
      items.push(item);
      write(projectId, items);
      return { ...item, ownerProjectId: projectId };
    },
    share(projectId, chatId, value) {
      const chat = find(projectId, chatId);
      if (!chat) throw fail('No se encontró la conversación.', 404);
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.keys(value).some((key) => !['revision', 'assetIds', 'folderIds'].includes(key))
      )
        throw fail('Selección de uso compartido inválida.');
      for (const key of ['assetIds', 'folderIds'])
        if (
          !Array.isArray(value[key]) ||
          value[key].length > 500 ||
          value[key].some((id) => typeof id !== 'string' || !UUID.test(id)) ||
          new Set(value[key]).size !== value[key].length
        )
          throw fail('Selección de uso compartido inválida.');
      checkRevision(chat, value.revision, true);
      const known = assets(projectId),
        folders = listFolders();
      if (
        value.assetIds.some((id) => !known.some((asset) => asset.id === id)) ||
        value.folderIds.some((id) => !folders.some((folder) => folder.id === id))
      )
        throw fail('Uno de los assets o proyectos ya no está disponible.');
      return replace(chat, {
        ...chat,
        revision: chat.revision + 1,
        updatedAt: new Date().toISOString(),
        sharing: {
          assetIds: value.assetIds.filter((id) => id !== chat.ownerProjectId),
          folderIds: [...value.folderIds],
        },
      });
    },
    remove(projectId, chatId) {
      const chat = find(projectId, chatId);
      if (!chat) return false;
      write(
        chat.ownerProjectId,
        read(chat.ownerProjectId).filter((item) => item.id !== chatId),
      );
      return true;
    },
  };
}

module.exports = { createProjectChatStore };
