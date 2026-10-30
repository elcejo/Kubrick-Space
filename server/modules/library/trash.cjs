const fs = require('node:fs');
const path = require('node:path');
const { UUID, containedPath } = require('../security/index.cjs').security;

// Includes projects removed by the former session-delete implementation.
function listTrash(root, data) {
  const active = new Set(data.projects.map((project) => project.id));
  const trash = new Map((data.trashedProjects || []).filter((p) => !active.has(p.id)).map((p) => [p.id, p]));
  const directory = path.join(root, 'projects');
  if (!fs.existsSync(directory)) return [...trash.values()];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (
      !entry.isDirectory() ||
      entry.isSymbolicLink() ||
      !UUID.test(entry.name) ||
      active.has(entry.name) ||
      trash.has(entry.name)
    )
      continue;
    try {
      const meta = JSON.parse(fs.readFileSync(containedPath(directory, entry.name, 'meta.json'), 'utf8'));
      if (
        meta.id === entry.name &&
        typeof meta.name === 'string' &&
        typeof meta.type === 'string' &&
        typeof meta.category === 'string'
      )
        trash.set(meta.id, meta);
    } catch {
      /* A damaged or linked folder is never restored implicitly. */
    }
  }
  return [...trash.values()];
}
module.exports = { listTrash };
