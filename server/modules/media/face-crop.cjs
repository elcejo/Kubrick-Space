const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { randomUUID } = require('node:crypto');
const run = promisify(execFile);

/** One CPU worker; only validated project images, no shell or network. */
function createFaceCropper({ appRoot, PROJECTS_DIR, security, execute = run }) {
  const pending = new Map();
  let tail = Promise.resolve();
  function ensure(url) {
    const match = /^\/projects\/([^/]+)\/content\/([^/]+)$/.exec(url || '');
    if (!match || !security.UUID.test(match[1]) || !security.IMAGE_NAME.test(match[2]))
      return Promise.resolve();
    const source = security.containedPath(PROJECTS_DIR, match[1], 'content', match[2]);
    const target = source.replace(/\.[^.]+$/, '-face.png');
    if (source === target || !fs.existsSync(source)) return Promise.resolve();
    if (pending.has(target)) return pending.get(target);
    const task = tail
      .catch(() => {})
      .then(async () => {
        const temp = target + '.' + randomUUID() + '.tmp';
        try {
          if (fs.existsSync(target)) {
            const png = fs.readFileSync(target);
            if (png.length >= 24 && png.readUInt32BE(16) === png.readUInt32BE(20)) return;
          }
          await execute(
            path.join(appRoot, 'local-generation/comfyui/.venv/Scripts/python.exe'),
            [path.join(__dirname, 'face-crop.py'), source, temp],
            { windowsHide: true, timeout: 30000 },
          );
          fs.renameSync(temp, target);
        } finally {
          fs.rmSync(temp, { force: true });
        }
      })
      .finally(() => pending.delete(target));
    pending.set(target, task);
    tail = task;
    return task;
  }
  return { ensure };
}
module.exports = { createFaceCropper };
