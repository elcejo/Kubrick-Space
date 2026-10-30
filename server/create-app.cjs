const express = require('express');
const { randomUUID: uuidv4 } = require('node:crypto');
const { security } = require('./modules/security/index.cjs');
const fs = require('fs');
const path = require('path');
const {
  llmConfig,
  registerAIRoutes,
  registerConversationRoutes,
  createInference,
} = require('./modules/ai/index.cjs');
const {
  createImageCatalog,
  openrouterModels,
  artificialAnalysisModels,
  registerConfigurationRoutes,
} = require('./modules/transport/index.cjs');
const { registerProjectRoutes, createLibraryOperations } = require('./modules/library/index.cjs');
const {
  registerDocumentRoutes,
  createBackgroundDraftWriter,
  applyBookAgentPatch,
} = require('./modules/documents/index.cjs');
const {
  registerFileRoutes,
  createCharacterAssetLibraryOperations,
  createFaceCropper,
} = require('./modules/media/index.cjs');
const { createServices } = require('./services.cjs');
const { installHTTP } = require('./http.cjs');

function createApp({
  dataRoot = path.resolve(
    __dirname,
    '..',
    process.env.KUBRICK_SPACE_DATA_DIR ||
      process.env.KUBRICK_STUDIO_DATA_DIR ||
      process.env.CODE_KAI_DATA_DIR ||
      '.',
  ),
  appRoot = path.resolve(__dirname, '..'),
  port = Number(process.env.PORT || 3001),
  fetchImpl,
} = {}) {
  const app = express();
  const inference = createInference({ appRoot, fetchImpl, findModel: openrouterModels.findModel });

  // OpenRouter documents up to 128k completion tokens for Luna Pro. Keep this
  // as the provider ceiling instead of imposing a small application-wide cap;
  // the prompt still determines how much text the model actually returns.
  const LUNA_PRO_MAX_COMPLETION_TOKENS = 128000;

  // ---------------------------------------------------------------------------
  // Paths
  // ---------------------------------------------------------------------------
  const {
    repository,
    universalProps,
    decorateProject,
    previewProject,
    prepareProjectArtwork,
    readCurrentProject,
    ROOT_DIR,
    PROJECTS_DIR,
    LLM_CONFIG_JSON,
    keyStore,
    projectStore,
    documentStore,
    chatStore,
    aiContexts,
    readJSON,
    writeJSON,
    ensureDir,
    getApiKeys,
    getLLMConfig: readLLMConfig,
    assertProject,
  } = createServices(dataRoot, appRoot);
  const faceCropper = createFaceCropper({ appRoot, PROJECTS_DIR, security });
  const ensureCharacterFace = (url) =>
    faceCropper.ensure(url).catch((error) => console.warn('[Character face]', error.message));
  app.locals.ensureCharacterPreviews = async () => {
    for (const summary of repository.read().projects.filter((p) => p.type === 'character')) {
      const project = readCurrentProject(summary.id);
      for (const url of project.covers || []) await ensureCharacterFace(url);
    }
  };
  const imageCatalog = createImageCatalog({ getApiKeys, fetchImpl });
  const getLLMConfig = () => inference.configure(readLLMConfig());
  const modelCatalog = {
    ...openrouterModels,
    findModel: (id) => inference.models().find((model) => model.id === id) || openrouterModels.findModel(id),
  };
  // ---------------------------------------------------------------------------
  // Middleware
  // ---------------------------------------------------------------------------
  installHTTP(app, {
    port,
    appRoot,
    projectStore,
    getApiKeys,
    assertProject,
    PROJECTS_DIR,
    LUNA_PRO_MAX_COMPLETION_TOKENS,
  });
  app.use('/api', (req, res, next) => {
    // Scope is per request. Persistent jobs capture it explicitly before leaving HTTP.
    const relevant =
      /^\/(?:ai\/|jobs\/(?:character|book|cover|scenario|film)|characters\/lore\/approve)/.test(req.path);
    if (!relevant) return next();
    try {
      const projectId = req.body?.projectId || req.get('X-Kubrick-Project-ID');
      const project = security.UUID.test(projectId || '') ? readCurrentProject(projectId) : null;
      if (
        project?.type === 'book' &&
        project.category === 'screenplay' &&
        ((req.path === '/ai/image' && req.body?.imageType === 'cover') || req.path === '/jobs/cover')
      )
        throw security.fail('Las portadas de guión se crean automáticamente.', 422);
      const settings = project?.inferenceSettings || {};
      const requestedMode = project ? settings.mode : req.get('X-Kubrick-Inference-Mode');
      const mode = project ? (requestedMode === 'local' ? 'local' : 'api') : requestedMode || 'hybrid';
      return inference.run(
        mode,
        next,
        settings.localModel ||
          (project
            ? mode === 'local'
              ? 'local:qwen3.5-4b-int8-convrot'
              : undefined
            : req.get('X-Kubrick-Local-Model') || undefined),
        { ...settings, projectId: project?.id },
      );
    } catch (error) {
      return next(error);
    }
  });
  // Validate UUID format for security (prevent directory traversal)
  const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  app.param('id', (req, res, next, id) => {
    if (!uuidRegex.test(id)) {
      return res.status(400).json({ error: 'Invalid ID format' });
    }
    next();
  });
  app.param('projectId', (req, res, next, projectId) => {
    if (!uuidRegex.test(projectId)) {
      return res.status(400).json({ error: 'Invalid Project ID format' });
    }
    next();
  });

  // ---------------------------------------------------------------------------
  // Route modules. Shared security and validation middleware is registered above;
  // module facades mount adapters and receive their dependencies explicitly.
  // ---------------------------------------------------------------------------

  let backgroundQueue;
  app.use('/api/projects/:id', (req, res, next) => {
    const job = backgroundQueue?.active(req.params.id);
    const coverDraftSave = job?.kind === 'cover' && req.method === 'PUT' && req.path === '/draft';
    if (['PUT', 'POST', 'DELETE'].includes(req.method) && job && !coverDraftSave)
      return res.status(423).json({
        error: 'El servidor está actualizando este proyecto. Espera a que termine el trabajo.',
        code: 'PROJECT_JOB_BUSY',
      });
    next();
  });
  registerProjectRoutes(app, {
    repository,
    ROOT_DIR,
    security,
    projectStore,
    uuidv4,
    decorateProject,
    previewProject,
    prepareProjectArtwork,
    beforeDeleteProject: (project, keep) =>
      universalProps.beforeDelete(
        { ...project, ...(documentStore.getDraft(project.id)?.payload || {}), id: project.id },
        keep,
      ),
  });
  registerDocumentRoutes(app, {
    ensureCharacterFace,
    repository,
    assertProject,
    security,
    documentStore,
    projectStore,
  });
  registerConversationRoutes(app, { assertProject, security, chatStore });
  registerConfigurationRoutes(app, {
    imageCatalog,
    fetchImpl,
    localModels: inference.models,
    getApiKeys,
    keyStore,
    llmConfig,
    getLLMConfig,
    createImageCatalog,
    openrouterModels,
    artificialAnalysisModels,
    security,
    writeJSON,
    LLM_CONFIG_JSON,
  });
  backgroundQueue = registerAIRoutes(app, {
    ensureCharacterFace,
    imageCatalog,
    inference,
    propCatalog: {
      search: universalProps.search,
      resolve: universalProps.resolveCode,
      change: (action, code) => {
        const entry = universalProps.resolveCode(code);
        if (entry.status === (action === 'trash' ? 'trash' : 'active')) return { success: true };
        return universalProps.change({ body: { action, ids: [entry.id] } }).body;
      },
      importAsset: (projectId, code) => {
        const entry = universalProps.resolveCode(code),
          project = readCurrentProject(projectId);
        const operations = createCharacterAssetLibraryOperations({
          repository,
          readCurrentProject,
          assertProject,
          security,
          fs,
          path,
          PROJECTS_DIR,
          ensureDir,
          universalProps,
        });
        return operations.importAsset({
          body: {
            projectId,
            libraryId: entry.id,
            assetId: 'asset_library',
            targetImage: project.characterVisualLibrary?.sourceImage,
            targetKey: project.characterVisualLibrary?.sourceKey,
          },
        }).body.item;
      },
    },
    appRoot,
    ROOT_DIR,
    documentStore,
    writeProject: (() => {
      const write = createBackgroundDraftWriter({
        assertProject,
        readCurrentProject,
        documentStore,
        security,
      });
      return (...args) => {
        const result = write(...args);
        if (args[1]?.covers && readCurrentProject(args[0]).type === 'character')
          for (const url of args[1].covers) void ensureCharacterFace(url);
        return result;
      };
    })(),
    applyBookAgentPatch,
    createStoryResource(resource) {
      if (
        !resource ||
        !['character', 'stage'].includes(resource.type) ||
        typeof resource.name !== 'string' ||
        !resource.name.trim() ||
        resource.name.length > 120
      )
        throw security.fail('Recurso narrativo inválido.');
      const normalized = (value) =>
        value
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .trim()
          .toLowerCase();
      const existing = repository
        .read()
        .projects.find((p) => p.type === resource.type && normalized(p.name) === normalized(resource.name));
      if (existing) return { id: existing.id, name: existing.name, type: existing.type, created: false };
      const response = createLibraryOperations({
        repository,
        ROOT_DIR,
        security,
        projectStore,
        uuidv4,
      }).createProject({
        body: {
          name: resource.name.trim(),
          type: resource.type,
          category: resource.type === 'character' ? 'secondary' : 'custom',
        },
      });
      if (response.status !== 201) throw security.fail('No se pudo crear el recurso narrativo.', 502);
      return { id: response.body.id, name: response.body.name, type: response.body.type, created: true };
    },
    repository,
    readCurrentProject,
    fetchImpl: inference.fetch,
    security,
    fs,
    path,
    llmConfig,
    openrouterModels: modelCatalog,
    uuidv4,
    LUNA_PRO_MAX_COMPLETION_TOKENS,
    PROJECTS_DIR,
    getApiKeys,
    getLLMConfig,
    aiContexts,
    assertProject,
    ensureDir,
  });
  app.locals.backgroundQueue = backgroundQueue;
  const listen = app.listen.bind(app);
  app.listen = (...args) => {
    const server = listen(...args);
    server.once('close', () => void backgroundQueue.stop());
    return server;
  };
  registerFileRoutes(app, {
    universalProps,
    isProjectBusy: (id) => !!backgroundQueue.active(id),
    assertProject,
    repository,
    documentStore,
    readCurrentProject,
    fs,
    path,
    security,
    PROJECTS_DIR,
    uuidv4,
    ensureDir,
    readJSON,
  });

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    let secrets = [];
    try {
      secrets = Object.values(getApiKeys());
    } catch {}
    console.error('[Request error]', security.redact(err.message, secrets));
    res
      .status(err.status || 500)
      .json({ error: err.status && err.status < 500 ? err.message : 'Internal server error' });
  });

  return app;
}
module.exports = { createApp };
