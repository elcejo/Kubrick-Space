const { UUID, fail } = require('../../../public/js/contracts/common.js');
const IMAGE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,180}\.(png|jpe?g|gif|webp|bmp)$/i;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

function imageType(buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'jpg';
  if (/^GIF8[79]a/.test(buffer.subarray(0, 6).toString())) return 'gif';
  if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP')
    return 'webp';
  if (buffer.subarray(0, 2).toString() === 'BM') return 'bmp';
  throw fail('Unsupported image content');
}

function decodeImage(data) {
  if (typeof data !== 'string') throw fail('Invalid image');
  const match = /^data:image\/(png|jpeg|gif|webp|bmp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);
  if (!match) throw fail('Invalid image data');
  if (match[2].length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) throw fail('Image exceeds 15 MB', 413);
  const buffer = Buffer.from(match[2], 'base64');
  const type = imageType(buffer);
  if (type !== (match[1] === 'jpeg' ? 'jpg' : match[1])) throw fail('Image type does not match its content');
  return { buffer, type };
}

module.exports = { UUID, IMAGE_NAME, MAX_IMAGE_BYTES, fail, imageType, decodeImage };
