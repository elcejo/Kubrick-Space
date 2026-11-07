/**
 * Images attached to a message of the general assistant, to be seen by the model. Portable and pure: no DOM, network or
 * storage. An attachment is an image of the open asset's own content folder; the message carries its address, and the
 * server reads the file when it builds the request. Only a model that accepts images can be sent one.
 */
export const CHAT_ATTACHMENT_LIMIT = 4;
export const CHAT_ATTACHMENT_BYTES = 15 * 1024 * 1024;
export const CHAT_ATTACHMENT_TYPES = Object.freeze([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/bmp',
]);
export const CHAT_ATTACHMENT_URL =
  /^\/projects\/([a-f0-9-]{36})\/content\/([A-Za-z0-9][A-Za-z0-9._-]{0,180}\.(?:png|jpe?g|webp|gif|bmp))$/i;

export const isChatAttachmentUrl = (value) => typeof value === 'string' && CHAT_ATTACHMENT_URL.test(value);

/** The reason a file cannot be attached, or an empty string when it can. */
export function chatAttachmentError(file) {
  if (
    !file ||
    !CHAT_ATTACHMENT_TYPES.includes(file.type) ||
    !(file.size > 0) ||
    file.size > CHAT_ATTACHMENT_BYTES
  )
    return 'Elige una imagen PNG, JPEG, WebP, GIF o BMP de hasta 15 MB.';
  return '';
}

/** The attachments of a message as a list of valid addresses, or null when the value is not one. */
export function chatAttachmentList(value) {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > CHAT_ATTACHMENT_LIMIT ||
    new Set(value).size !== value.length ||
    !value.every(isChatAttachmentUrl)
  )
    return null;
  return [...value];
}

/** What the model is told when the chosen model cannot see images. */
export const CHAT_ATTACHMENT_NO_VISION =
  'El modelo elegido no acepta imágenes. Elige uno con visión en la barra superior (filtro «Visión» del selector de modelos).';
