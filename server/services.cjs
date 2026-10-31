const fs = require('node:fs');
const path = require('node:path');
const { randomUUID: uuidv4 } = require('node:crypto');
const { createApiKeyVault, security } = require('./modules/security/index.cjs');
const {
  llmConfig,
  createProjectChatStore: createChatStore,
  createContextManager,
} = require('./modules/ai/index.cjs');
const { createProjectRepository } = require('./modules/library/index.cjs');
const { createDocumentStore } = require('./modules/documents/index.cjs');
const {
  createUniversalPropStore,
  createProjectPreview,
  createScreenplayCovers,
} = require('./modules/media/index.cjs');

function createServices(dataRoot, appRoot = path.resolve(__dirname, '..')) {
  const ROOT_DIR = path.resolve(dataRoot);
  const PROJECTS_DIR = path.join(ROOT_DIR, 'projects');
  const API_KEYS_JSON = path.join(ROOT_DIR, 'api_keys.json');
  const LLM_CONFIG_JSON = path.join(ROOT_DIR, 'llm_config.json');
  const apiKeyVault = createApiKeyVault(API_KEYS_JSON);
  const repository = createProjectRepository(ROOT_DIR);
  const projectStore = repository;
  const screenplayCovers = createScreenplayCovers({ appRoot, PROJECTS_DIR, security });
  const prepareProjectArtwork = screenplayCovers.decorate;
  const rawDocumentStore = createDocumentStore(PROJECTS_DIR, {
    preparePayload: (id, payload) => prepareProjectArtwork(payload, repository.get(id)),
  });
  const universalProps = createUniversalPropStore({
    ROOT_DIR,
    PROJECTS_DIR,
    repository,
    security,
    readProject: (id) => ({ ...repository.get(id), ...(rawDocumentStore.getDraft(id)?.payload || {}) }),
  });
  const decorateProject = (project) => prepareProjectArtwork(universalProps.decorate(project));
  const previewProject = createProjectPreview({
    PROJECTS_DIR,
    security,
    readDraft: rawDocumentStore.getDraft,
    decorateArtwork: prepareProjectArtwork,
  });
  const decoratePayload = (payload, id) => {
    const result = prepareProjectArtwork(universalProps.decorate({ ...payload, id }), repository.get(id));
    if (!Object.hasOwn(payload, 'id')) delete result.id;
    return result;
  };
  const decorateRecord = (record, id) =>
    record && {
      ...record,
      ...(record.payload ? { payload: decoratePayload(record.payload, id) } : {}),
      ...(record.snapshot ? { snapshot: decoratePayload(record.snapshot, id) } : {}),
    };
  const documentStore = {
    ...rawDocumentStore,
    getDraft: (id) => decorateRecord(rawDocumentStore.getDraft(id), id),
    saveDraft: (id, ...args) => decorateRecord(rawDocumentStore.saveDraft(id, ...args), id),
    getVersion: (id, version) => decorateRecord(rawDocumentStore.getVersion(id, version), id),
    getVersions: (id) => rawDocumentStore.getVersions(id).map((record) => decorateRecord(record, id)),
  };
  const chatStore = createChatStore(PROJECTS_DIR);
  const aiContexts = createContextManager({
    readProject: repository.get,
    readVersion: (id, versionId) => documentStore.getVersion(id, versionId),
  });
  projectStore.recover();

  /**
   * Read and parse a JSON file. Returns `defaultValue` when the file does not
   * exist. Malformed data throws instead of silently replacing it.
   */
  function readJSON(filePath, defaultValue = null) {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw);
    } catch (err) {
      if (err.code === 'ENOENT') return defaultValue;
      console.error(`Error reading ${filePath}:`, err.message);
      throw err;
    }
  }

  /**
   * Stringify and write a JSON file with 2-space indentation.
   */
  function writeJSON(filePath, data) {
    const temporary = `${filePath}.${uuidv4()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(data, null, 2), {
        encoding: 'utf-8',
        flag: 'wx',
        mode: 0o600,
      });
      fs.renameSync(temporary, filePath);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }

  /**
   * Create a directory (and parents) if it does not already exist.
   */
  function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  /**
   * Read the current API keys from disk.
   */
  function getApiKeys() {
    return apiKeyVault.read();
  }
  function getLLMConfig() {
    return llmConfig.read(LLM_CONFIG_JSON);
  }

  const assertProject = repository.assertProject;
  const readCurrentProject = (id) => {
    assertProject(id);
    return decorateProject({ ...repository.get(id), ...(documentStore.getDraft(id)?.payload || {}) });
  };

  return {
    repository,
    universalProps,
    decorateProject,
    previewProject,
    prepareProjectArtwork,
    readCurrentProject,
    ROOT_DIR,
    PROJECTS_DIR,
    LLM_CONFIG_JSON,
    apiKeyVault,
    projectStore,
    documentStore,
    chatStore,
    aiContexts,
    readJSON,
    writeJSON,
    ensureDir,
    getApiKeys,
    getLLMConfig,
    assertProject,
  };
}
module.exports = { createServices };
