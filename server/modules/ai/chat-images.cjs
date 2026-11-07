'use strict';
/**
 * Images the user attached to a message of the general assistant. The conversation carries only their addresses; here
 * they become `image_url` parts of the message the model receives, read from the asset's own content folder. A model
 * without vision is refused with a clear 422 instead of silently dropping the image.
 */
const {
  CHAT_ATTACHMENT_URL,
  CHAT_ATTACHMENT_NO_VISION,
} = require('../../../public/js/contracts/chat-attachments.js');

/** The attachments a message list asks for, in order. */
function attachedUrls(messages) {
  return messages.flatMap((message) => (Array.isArray(message.attachments) ? message.attachments : []));
}

/** True when the model of the request can read images. Local models are multimodal; unknown API models are refused. */
function canSeeImages(model, modelInfo, isLocal) {
  if (isLocal) return true;
  return Boolean(modelInfo?.inputModalities?.includes('image'));
}

/**
 * Replaces each message's `attachments` by image parts. `readImage(projectId, filename)` returns a data URL and throws
 * when the file does not exist or is not an image of that asset.
 */
function withChatImages(messages, { projectId, readImage, vision, fail }) {
  const urls = attachedUrls(messages);
  if (urls.length && !vision) throw fail(CHAT_ATTACHMENT_NO_VISION, 422);
  return messages.map(({ attachments, ...message }) => {
    if (!Array.isArray(attachments) || !attachments.length) return message;
    const parts = attachments.map((url) => {
      const match = CHAT_ATTACHMENT_URL.exec(url);
      if (!match || match[1] !== projectId)
        throw fail('La imagen adjunta no pertenece a este elemento.', 422);
      let dataUrl;
      try {
        dataUrl = readImage(match[1], match[2]);
      } catch {
        throw fail('Una imagen adjunta ya no existe en este elemento.', 422);
      }
      return { type: 'image_url', image_url: { url: dataUrl } };
    });
    const text = typeof message.content === 'string' ? message.content : '';
    return { ...message, content: [{ type: 'text', text: text || 'Observa la imagen adjunta.' }, ...parts] };
  });
}

/** Messages without the private `attachments` key, for code that never sends images. */
const withoutAttachments = (messages) => messages.map(({ attachments, ...message }) => message);

module.exports = { attachedUrls, canSeeImages, withChatImages, withoutAttachments };
