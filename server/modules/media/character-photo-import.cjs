const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns/promises');
const { BlockList, isIP } = require('node:net');
const { randomUUID } = require('node:crypto');
const blocked = new BlockList(),
  globalV6 = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
])
  blocked.addSubnet(address, prefix, 'ipv4');
globalV6.addSubnet('2000::', 3, 'ipv6');
for (const [address, prefix] of [
  ['2001::', 32],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
])
  blocked.addSubnet(address, prefix, 'ipv6');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
function isPublicPhotoAddress(address) {
  const family = isIP(address);
  return family === 4
    ? !blocked.check(address, 'ipv4')
    : family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}
function photoURL(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw fail('Escribe una URL válida de imagen.');
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    url.href.length > 4096
  )
    throw fail('Usa una URL pública http o https, sin credenciales ni puertos especiales.');
  return url;
}
async function downloadCharacterPhoto(
  value,
  {
    lookup = (...args) => dns.lookup(...args),
    request = (url, opts, callback) =>
      (url.protocol === 'https:' ? https : http).request(url, opts, callback),
    limit = 15 * 1024 * 1024,
    timeout = 20000,
  } = {},
) {
  let url = photoURL(value);
  const signal = AbortSignal.timeout(timeout);
  async function addresses(host) {
    if (isIP(host)) return [{ address: host, family: isIP(host) }];
    let abort;
    try {
      return await Promise.race([
        lookup(host, { all: true, verbatim: true }),
        new Promise((_, reject) => {
          abort = () => reject(fail('La descarga superó el tiempo de espera.', 504));
          signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted) abort();
        }),
      ]);
    } finally {
      if (abort) signal.removeEventListener('abort', abort);
    }
  }
  for (let redirects = 0; redirects <= 3; redirects++) {
    signal.throwIfAborted();
    const host = url.hostname.replace(/^\[|\]$/g, ''),
      resolved = await addresses(host);
    if (!resolved.length || resolved.some((record) => !isPublicPhotoAddress(record.address)))
      throw fail('La URL debe apuntar a una imagen pública; no se admiten direcciones internas.');
    const chosen = resolved.find((record) => record.family === 4) || resolved[0];
    const response = await new Promise((resolve, reject) => {
      const req = request(
        url,
        {
          agent: false,
          signal,
          headers: { Accept: 'image/png,image/jpeg,image/webp,image/gif,image/bmp' },
          lookup: (_hostname, options, callback) =>
            options.all ? callback(null, [chosen]) : callback(null, chosen.address, chosen.family),
        },
        (res) => {
          res.on('error', reject);
          if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
            res.destroy();
            resolve({ location: res.headers.location });
            return;
          }
          if (res.statusCode !== 200) {
            res.destroy();
            reject(fail('No se pudo descargar la fotografía desde esa URL.', 502));
            return;
          }
          if (Number(res.headers['content-length']) > limit) {
            res.destroy();
            reject(fail('La fotografía supera los 15 MB.', 413));
            return;
          }
          const chunks = [];
          let bytes = 0;
          res.on('data', (chunk) => {
            bytes += chunk.length;
            if (bytes > limit) {
              res.destroy();
              reject(fail('La fotografía supera los 15 MB.', 413));
            } else chunks.push(chunk);
          });
          res.on('end', () => resolve({ buffer: Buffer.concat(chunks) }));
        },
      );
      req.on('error', reject);
      req.end();
    });
    if (response.buffer) return response.buffer;
    if (!response.location || redirects === 3)
      throw fail('La URL redirige demasiadas veces o no contiene una imagen.', 502);
    url = photoURL(new URL(response.location, url).href);
  }
  throw fail('No se pudo descargar la fotografía.', 502);
}
function createCharacterPhotoImportOperation({
  security,
  assertProject,
  repository,
  fs,
  path,
  PROJECTS_DIR,
  ensureDir,
  downloadPhoto = downloadCharacterPhoto,
}) {
  const active = new Set();
  return async ({ body } = {}) => {
    if (
      !body ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => !['projectId', 'url'].includes(key)) ||
      typeof body.url !== 'string'
    )
      throw security.fail('Importación de fotografía inválida.');
    assertProject(body.projectId);
    if (!['character', 'stage'].includes(repository.get(body.projectId)?.type))
      throw security.fail('La fotografía pertenece a un personaje o escenario.');
    if (active.has(body.projectId) || active.size >= 4)
      throw security.fail('Ya hay una fotografía descargándose. Espera un momento.', 409);
    active.add(body.projectId);
    try {
      photoURL(body.url);
      const buffer = await downloadPhoto(body.url);
      if (buffer.length > 15 * 1024 * 1024) throw security.fail('La fotografía supera los 15 MB.', 413);
      const type = security.imageType(buffer),
        filename = `photo-reference-${randomUUID()}.${type}`;
      assertProject(body.projectId);
      const output = security.containedPath(PROJECTS_DIR, body.projectId, 'content', filename);
      ensureDir(path.dirname(output));
      fs.writeFileSync(output, buffer, { flag: 'wx' });
      return {
        status: 200,
        headers: { 'Cache-Control': 'no-store' },
        body: { imageUrl: `/projects/${body.projectId}/content/${filename}` },
      };
    } catch (error) {
      if (error.status) throw error;
      throw security.fail(
        'No se pudo descargar una imagen válida desde esa URL. Revisa el enlace y reintenta.',
        502,
      );
    } finally {
      active.delete(body.projectId);
    }
  };
}
module.exports = { createCharacterPhotoImportOperation, downloadCharacterPhoto, isPublicPhotoAddress };
