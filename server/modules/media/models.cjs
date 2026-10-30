const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const manifest = require('./model-assets.json');
function verifyModel(name, buffer) {
  const entry = manifest.find((item) => item.name === name);
  if (
    !entry ||
    buffer.length !== entry.bytes ||
    createHash('sha256').update(buffer).digest('hex') !== entry.sha256
  )
    throw new Error('Integridad del modelo no válida');
  return true;
}
async function ensureModels(directory, download = fetch) {
  fs.mkdirSync(directory, { recursive: true });
  for (const entry of manifest) {
    const file = path.join(directory, entry.name);
    if (fs.existsSync(file)) {
      try {
        verifyModel(entry.name, fs.readFileSync(file));
        continue;
      } catch {}
    }
    const response = await download(entry.url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error('No se pudo descargar el modelo verificado');
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > entry.bytes) throw new Error('El modelo supera su tamaño permitido');
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    verifyModel(entry.name, buffer);
    const temporary = file + '.' + randomUUID() + '.tmp';
    try {
      fs.writeFileSync(temporary, buffer, { flag: 'wx' });
      fs.renameSync(temporary, file);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
}
module.exports = { verifyModel, ensureModels };
