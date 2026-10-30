const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { containedPath, UUID } = require('../security/index.cjs').security;
const DOCUMENT_FILES = new Set(['document-draft.json', 'document-versions.json']);

// A durable intent is written before either copy changes. Recovery rolls the
// entire operation forward; no subsequent read/write can observe half a commit.
function createProjectStore(root) {
  const projects = path.join(root, 'projects');
  const registry = path.join(root, 'projects.json');
  const journal = path.join(root, 'project-transaction.json');
  function atomicWrite(file, value) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    let fd;
    try {
      fd = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(fd, JSON.stringify(value, null, 2), 'utf8');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(temporary, file);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
  function recover() {
    if (!fs.existsSync(journal)) return;
    const transaction = JSON.parse(fs.readFileSync(journal, 'utf8'));
    const { data, project, deleteId, extraWrites = [], extraDeletes = [] } = transaction;
    if (
      !Array.isArray(data?.projects) ||
      (project && !UUID.test(project.id)) ||
      (deleteId && !UUID.test(deleteId))
    )
      throw new Error('Invalid project transaction');
    if (
      !Array.isArray(extraWrites) ||
      extraWrites.some((item) => !item || !UUID.test(item.projectId) || !DOCUMENT_FILES.has(item.file)) ||
      !Array.isArray(extraDeletes) ||
      extraDeletes.some((item) => !item || !UUID.test(item.projectId) || !DOCUMENT_FILES.has(item.file))
    )
      throw new Error('Invalid project transaction files');
    if (project) {
      const directory = containedPath(projects, project.id);
      fs.mkdirSync(path.join(directory, 'content'), { recursive: true });
      atomicWrite(containedPath(projects, project.id, 'meta.json'), project);
    }
    for (const item of extraWrites)
      atomicWrite(containedPath(projects, item.projectId, item.file), item.value);
    atomicWrite(registry, data);
    for (const item of extraDeletes) {
      const file = containedPath(projects, item.projectId, item.file);
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    if (deleteId) {
      const directory = containedPath(projects, deleteId);
      fs.rmSync(directory, { recursive: true, force: true });
    }
    fs.unlinkSync(journal);
  }
  function commit(data, { project = null, deleteId = null, extraWrites = [], extraDeletes = [] } = {}) {
    recover();
    atomicWrite(journal, { data, project, deleteId, extraWrites, extraDeletes });
    try {
      recover();
    } catch (error) {
      // A transient failure can be completed immediately. Persistent failures
      // retain the journal and block later requests until recovery succeeds.
      try {
        recover();
      } catch {
        throw error;
      }
    }
  }
  return { recover, commit };
}
module.exports = { createProjectStore };
