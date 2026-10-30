const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');

/** Immutable derived artwork. Historical images stay intact for saved versions. */
function createScreenplayCovers({ appRoot, PROJECTS_DIR, security, execute = execFileSync }) {
  const python = path.join(
    appRoot,
    'local-generation',
    'comfyui',
    '.venv',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  );
  const font = path.join(appRoot, 'public/fonts/unica-one/UnicaOne-Regular.ttf');
  const decorate = (payload, identity = payload) => {
    if (identity?.type !== 'book' || identity.category !== 'screenplay') return payload;
    if (!security.UUID.test(identity.id || '')) throw security.fail('Proyecto de guión inválido.');
    const name = String(payload.name ?? identity.name ?? 'Guión sin título').trim() || 'Guión sin título';
    const hash = createHash('sha256')
      .update('screenplay-cover-v1:' + name)
      .digest('hex')
      .slice(0, 24);
    const filename = `screenplay-cover-v1-${hash}.png`;
    const file = security.containedPath(PROJECTS_DIR, identity.id, 'content', filename);
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        execute(python, [path.join(__dirname, 'screenplay-cover.py'), font, temporary], {
          input: JSON.stringify({ name }),
          encoding: 'utf8',
          windowsHide: true,
          timeout: 15000,
          env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        });
        fs.renameSync(temporary, file);
      } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      }
    }
    return { ...payload, covers: [`/projects/${identity.id}/content/${filename}`], currentCoverIndex: 0 };
  };
  return { decorate };
}
module.exports = { createScreenplayCovers };
