const fs = require('node:fs');
const path = require('node:path');
const { security } = require('../security/index.cjs');
const { createProjectStore } = require('./store.cjs');

function createProjectRepository(dataRoot) {
  const root = path.resolve(dataRoot);
  const store = createProjectStore(root);
  function read() {
    store.recover();
    try {
      return JSON.parse(fs.readFileSync(path.join(root, 'projects.json'), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return { projects: [] };
      throw error;
    }
  }
  function get(id) {
    return read().projects.find((project) => project.id === id);
  }
  function assertProject(id) {
    if (typeof id !== 'string' || !security.UUID.test(id)) throw security.fail('Invalid project ID');
    if (!get(id)) throw security.fail('Project not found', 404);
    security.containedPath(path.join(root, 'projects'), id, 'content');
  }
  return { read, get, assertProject, recover: store.recover, commit: store.commit };
}
module.exports = { createProjectRepository };
