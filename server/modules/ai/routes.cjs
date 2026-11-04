const { parseCharacterDocument } = require('../../../public/js/contracts/character-model.js');
const { endpoint } = require('../transport/index.cjs');
const { createAIOperations } = require('./operations.cjs');
const { streamChat } = require('./chat-stream.cjs');
const {
  registerCharacterAssistant,
  createCharacterBackgroundWorkflow,
  createCharacterOperations,
  createCharacterImagePromptOperation,
  createCharacterVisualLibraryOperation,
  createCharacterManagement,
  createCharacterAssetDirectionOperation,
  createCharacterCompositionReviewer,
  createCharacterLoreOperations,
} = require('../characters/index.cjs');
const { createJobQueue } = require('./job-queue.cjs');
const { registerJobRoutes } = require('./job-routes.cjs');
const { validateImageEngine } = require('../../../public/js/contracts/project-inference.js');
const { createElementAgent } = require('./element-agent.cjs');
const { createScreenplayAdapter, adaptationRequest } = require('./screenplay-adapter.cjs');
const { createNarrativeResources } = require('./narrative-resources.cjs');
const { createCoverJobs } = require('./cover-job.cjs');
const { createScenarioJobs } = require('../scenarios/index.cjs');
const { createFilmJobs, createFilmRender, createVideoFrames } = require('../film/index.cjs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createProvider } = require('./provider.cjs');
const { createBookInfer } = require('./book-infer.cjs');
const { createContinuityReview } = require('./continuity-review.cjs');
const { createThinking } = require('./thinking.cjs');
const { createImageStorage, createCharacterAgentMedia } = require('../media/index.cjs');

module.exports = function registerAIRoutes(app, dependencies) {
  const operations = createAIOperations(dependencies);
  const characterDependencies = {
    ...dependencies,
    readCharacterImage: createImageStorage(dependencies).referenceImage,
    proxyRequest: createProvider(dependencies).request,
  };
  registerCharacterAssistant(
    app,
    {
      ...dependencies,
      readCharacterImage: createImageStorage(dependencies).referenceImage,
    },
    createProvider(dependencies).request,
  );
  let management;
  const makeHelpers = (config, { signal, reportProgress, trackRequest } = {}) => {
    const capabilities = {
      ...characterDependencies,
      characterManagement: management,
      backgroundSignal: signal,
      reportProgress,
      proxyRequest: createProvider({ ...dependencies, backgroundSignal: signal, trackRequest }).request,
      getLLMConfig: () => config || dependencies.getLLMConfig(),
    };
    return {
      // Jobs run inside their captured inference scope, so this reflects the job's mode.
      localInference: dependencies.inference?.currentImageMode() === 'local',
      designCharacter: createCharacterOperations(capabilities).designCharacter,
      preparePrompt: createCharacterImagePromptOperation(capabilities),
      prepareLibrary: createCharacterVisualLibraryOperation(capabilities),
      prepareAsset: createCharacterAssetDirectionOperation(capabilities),
      reviewComposition: createCharacterCompositionReviewer(capabilities),
      discoverLore: createCharacterLoreOperations(capabilities).discover,
    };
  };
  const generateImage = (input, { signal, trackRequest } = {}) =>
    createAIOperations({
      ...dependencies,
      backgroundSignal: signal,
      trackRequest,
      fetchImpl: (url, options = {}) => {
        signal?.throwIfAborted();
        return (dependencies.fetchImpl || fetch)(url, {
          ...options,
          signal: signal
            ? AbortSignal.any([signal, ...(options.signal ? [options.signal] : [])])
            : options.signal,
        });
      },
    }).generateImage(input);
  management = createCharacterManagement({
    ...dependencies,
    makeHelpers,
    generateImage,
    copyImage: createCharacterAgentMedia(dependencies),
  });
  const workflow = createCharacterBackgroundWorkflow({
    ...dependencies,
    makeHelpers,
    generateImage,
    management,
  });
  const bookInfer = createBookInfer(dependencies);
  const resourceWorkflow = createCharacterBackgroundWorkflow({
    ...dependencies,
    makeHelpers,
    management,
    generateImage: (input, options) => {
      const settings = dependencies.readCurrentProject(
        input.body?.projectId || input.projectId,
      )?.inferenceSettings;
      return dependencies.inference && (settings?.mode || settings?.imageMode)
        ? dependencies.inference.run(
            settings.mode || 'api',
            () => generateImage(input, options),
            dependencies.inference.currentLocalModel(),
            { ...settings, projectId: input.body?.projectId || input.projectId },
          )
        : generateImage(input, options);
    },
  });
  const narrativeResources = createNarrativeResources(
    {
      ...dependencies,
      // The scenario pipeline is created below; it is only called while a job runs.
      runScenario: (job, ctx) => scenarioJobs.run(job, ctx),
    },
    resourceWorkflow,
  );
  const elementAgent = createElementAgent({
    ...dependencies,
    infer: bookInfer,
    prepareStoryResource: narrativeResources.prepare,
    isCharacterShell(id) {
      try {
        const project = dependencies.readCurrentProject(id);
        const sheet = parseCharacterDocument(project.content || '');
        return !project.covers?.length && (!sheet || (!sheet.identity.base && !sheet.fields.length));
      } catch {
        return false;
      }
    },
    updateResourceNarrative: narrativeResources.narrative,
    requireResourceModel: true,
  });
  // Adapting a linked book to a screenplay runs in bounded rounds of its own (CK-SCRIPT-018).
  const screenplayAdapter = createScreenplayAdapter({ ...dependencies, infer: bookInfer });
  const coverJobs = createCoverJobs(dependencies, (config, ctx) =>
    createAIOperations({
      ...dependencies,
      backgroundSignal: ctx.signal,
      trackRequest: ctx.trackRequest,
      getLLMConfig: () => (dependencies.inference ? dependencies.inference.configure(config) : config),
    }),
  );
  const scenarioJobs = createScenarioJobs(dependencies, {
    infer: bookInfer,
    readImage: createImageStorage(dependencies).referenceImage,
    makeOperations: (config, ctx) =>
      createAIOperations({
        ...dependencies,
        backgroundSignal: ctx.signal,
        trackRequest: ctx.trackRequest,
        getLLMConfig: () => (dependencies.inference ? dependencies.inference.configure(config) : config),
      }),
  });
  const videoFrames = createVideoFrames({ appRoot: dependencies.appRoot });
  const filmJobs = createFilmJobs(dependencies, {
    infer: bookInfer,
    readImage: createImageStorage(dependencies).referenceImage,
    videoFrames,
    makeOperations: (config, ctx) =>
      createAIOperations({
        ...dependencies,
        backgroundSignal: ctx.signal,
        trackRequest: ctx.trackRequest,
        getLLMConfig: () => (dependencies.inference ? dependencies.inference.configure(config) : config),
      }),
  });
  const continuityReview = createContinuityReview(dependencies, { infer: bookInfer });
  const thinking = createThinking(dependencies, { infer: bookInfer });
  const filmRender = createFilmRender(dependencies, {
    readImage: createImageStorage(dependencies).referenceImage,
    videoFrames,
  });
  const runJob = (job, context) =>
    job.kind === 'cover'
      ? coverJobs.run(job, context)
      : job.kind === 'continuity'
        ? continuityReview.run(job, context)
        : job.kind === 'scenario'
          ? scenarioJobs.run(job, context)
          : job.kind === 'film'
            ? filmJobs.run(job, context)
            : job.kind === 'film-render'
              ? filmRender.run(job, context)
              : job.kind === 'edit'
                ? job.payload.adapt
                  ? screenplayAdapter.run(job, context)
                  : elementAgent.run(job, context)
                : workflow.run(job, context);
  // Props of a new character are rendered after the book job, in their own task; the book never waits for them.
  const queueNewCharacterProps = (job) => {
    const wanted = [...(job.state.assetJobs || []), ...Object.keys(job.state.viewJobs || {})];
    if (job.kind !== 'edit' || !wanted.length) return;
    const done = job.state.assetsQueued || [];
    const pending = wanted.filter((id) => !done.includes(id));
    if (!pending.length) return;
    for (const id of pending) {
      try {
        const views = job.state.viewJobs?.[id];
        if (views) {
          const stage = dependencies.readCurrentProject(id);
          if (!stage?.content) continue;
          queue.enqueue({
            projectId: id,
            kind: 'scenario',
            token: randomUUID(),
            payload: {
              source: 'regenerate',
              request: 'Ángulos del escenario',
              scope: 'views',
              references: [],
              expectedContent: stage.content,
              engine: views.engine,
              category: stage.category,
              viewPrompts: views.viewPrompts,
              textConfig: job.payload.textConfig,
              inferenceMode: job.payload.inferenceMode,
              inferenceSettings: { ...(job.payload.inferenceSettings || {}), projectId: id },
              localModel: job.payload.localModel,
            },
          });
          continue;
        }
        const project = dependencies.readCurrentProject(id);
        const choice = job.state.resourceModels?.[id];
        const referenceImage = project?.covers?.[project.currentCoverIndex] || project?.covers?.[0];
        if (!project || !choice || !referenceImage) continue;
        queue.enqueue({
          projectId: id,
          kind: 'assets',
          token: randomUUID(),
          payload: {
            engine: choice.engine,
            referenceImage,
            refreshAssets: false,
            followUp: true,
            expectedContent: project.content,
            textConfig: job.payload.textConfig,
            // Text keeps the book's provider and model; only the images follow the choice made for this character.
            inferenceSettings: {
              ...(job.payload.inferenceSettings || {}),
              projectId: id,
              imageMode: choice.mode,
              ...(choice.mode === 'api' ? { imageModel: choice.engine } : {}),
            },
            inferenceMode: job.payload.inferenceMode,
            localModel: job.payload.localModel,
          },
        });
      } catch (error) {
        console.error('[Jobs] No se pudieron encolar los props de', id, error?.message || error);
      }
    }
    job.state.assetsQueued = [...done, ...pending];
    queue.update(job);
  };
  const queue = createJobQueue({
    settled: (job) => {
      queueNewCharacterProps(job);
      // A model that misses the visual breakdown once usually succeeds on the next call: retry the props once.
      if (job.kind === 'assets' && job.status === 'failed' && job.payload.followUp && !job.state.retried) {
        job.state.retried = true;
        queue.update(job);
        queue.retry(job.id);
      }
    },
    directory: path.join(dependencies.ROOT_DIR, 'jobs'),
    run: (job, context) =>
      dependencies.inference
        ? dependencies.inference.run(
            job.payload.inferenceMode || 'hybrid',
            () => runJob(job, context),
            job.payload.localModel,
            job.payload.inferenceSettings,
          )
        : runJob(job, context),
  });
  coverJobs.register(app, queue);
  scenarioJobs.register(app, queue);
  filmJobs.register(app, queue);
  filmRender.register(app, queue);
  continuityReview.register(app, queue);
  app.post(
    '/api/jobs/edit',
    endpoint(({ body }) => {
      if (
        !body ||
        Object.keys(body).some((k) => !['projectId', 'request', 'context', 'token'].includes(k)) ||
        !dependencies.security.UUID.test(body.projectId || '') ||
        !dependencies.security.UUID.test(body.token || '') ||
        typeof body.request !== 'string' ||
        !body.request.trim() ||
        body.request.length > 12000 ||
        (body.context !== undefined &&
          (!Array.isArray(body.context) ||
            body.context.length > 6 ||
            body.context.some((text) => typeof text !== 'string' || text.length > 1500)))
      )
        throw dependencies.security.fail('Solicitud de libro inválida.');
      const { project, document, kind } = elementAgent.read(body.projectId);
      const adapt =
        kind === 'screenplay' &&
        (project.ingredients || []).some(
          (item) => item.type === 'book' && item.active !== false && item.importedProjectId,
        ) &&
        adaptationRequest(body.request, document);
      if (!queue.list(project.id).some((job) => queue.get(job.id).token === body.token))
        dependencies.saveSafetyVersion?.(project.id, 'Antes de editar con IA: ' + body.request.slice(0, 120));
      return {
        status: 202,
        body: {
          job: queue.enqueue({
            projectId: project.id,
            kind: 'edit',
            token: body.token,
            payload: {
              ...(adapt ? { adapt: true } : {}),
              request: body.request,
              context: body.context || [],
              textConfig: dependencies.getLLMConfig(),
              expectedContent: project.content,
              inferenceMode: dependencies.inference?.currentMode() || 'hybrid',
              inferenceSettings: dependencies.inference?.currentSettings() || {},
              ...(dependencies.inference?.currentLocalModel()
                ? { localModel: dependencies.inference.currentLocalModel() }
                : {}),
            },
          }),
        },
      };
    }),
  );
  app.post(
    '/api/jobs/:jobId/resource-model',
    endpoint(({ params, body }) => {
      const job = queue.get(params.jobId),
        pending = job?.state.pendingResource;
      if (
        job?.kind !== 'edit' ||
        job.status !== 'awaiting_choice' ||
        !pending ||
        !body ||
        Object.keys(body).some((key) => !['projectId', 'mode', 'engine'].includes(key)) ||
        body.projectId !== pending.projectId ||
        !['local', 'api'].includes(body.mode)
      )
        throw dependencies.security.fail('Decisión de modelo inválida.', 409);
      dependencies.assertProject(job.projectId);
      dependencies.assertProject(pending.projectId);
      const engine = validateImageEngine(body.engine);
      if ((body.mode === 'local') !== (engine.provider === 'local'))
        throw dependencies.security.fail('El modelo no corresponde al modo elegido.', 422);
      // Only the image provider is chosen here: the character keeps the book's text provider and model.
      const text = job.payload.inferenceSettings || {};
      dependencies.saveResourceInference(pending.projectId, {
        mode: text.mode || job.payload.inferenceMode || 'api',
        ...(text.localModel ? { localModel: text.localModel } : {}),
        ...(text.textModel ? { textModel: text.textModel } : {}),
        imageMode: body.mode,
        imageModel: engine,
      });
      job.state.resourceModels ??= {};
      job.state.resourceModels[pending.projectId] = { mode: body.mode, engine };
      delete job.state.pendingResource;
      queue.update(job);
      return { status: 200, body: { job: queue.resumeChoice(job.id) } };
    }),
  );
  app.post(
    '/api/jobs/:jobId/message',
    endpoint(({ params, body }) => {
      const job = queue.get(params.jobId);
      if (!job || !job.kind === 'edit' || !['queued', 'running'].includes(job.status))
        throw dependencies.security.fail('El trabajo no está activo.', 409);
      dependencies.assertProject(job.projectId);
      if (
        !body ||
        Object.keys(body).some((k) => k !== 'message') ||
        typeof body.message !== 'string' ||
        !body.message.trim() ||
        body.message.length > 12000 ||
        (job.state.messages || []).length >= 50 ||
        (job.state.messages || []).join('').length + body.message.length > 16000
      )
        throw dependencies.security.fail(
          'La cola de indicaciones alcanzó su límite; espera al siguiente trabajo.',
        );
      job.state.messages = [...(job.state.messages || []), body.message.trim()];
      queue.update(job);
      return { status: 200, body: { accepted: true } };
    }),
  );
  app.post(
    '/api/characters/lore/approve',
    endpoint(
      createCharacterLoreOperations({
        ...characterDependencies,
        enqueueLoreApproval(project, ids) {
          const engine = project.inferenceSettings?.imageModel || project.characterImageGeneration;
          if (!engine?.model || !engine?.provider)
            throw dependencies.security.fail(
              'Selecciona un modelo de imagen para crear las referencias visuales.',
              428,
            );
          const existing = queue
            .list(project.id)
            .find(
              (job) =>
                ['queued', 'running'].includes(job.status) &&
                queue.get(job.id).payload.expectedContent === project.content &&
                JSON.stringify(queue.get(job.id).payload.loreIds) === JSON.stringify(ids),
            );
          const job =
            existing ||
            queue.enqueue({
              projectId: project.id,
              kind: 'lore',
              token: randomUUID(),
              payload: {
                expectedContent: project.content,
                loreIds: ids,
                engine,
                textConfig: dependencies.getLLMConfig(),
                inferenceMode: dependencies.inference?.currentMode() || 'hybrid',
                inferenceSettings: dependencies.inference?.currentSettings() || {},
              },
            });
          return {
            job: queue.publicJob(queue.get(job.id)),
            draft: dependencies.documentStore.getDraft(project.id),
          };
        },
      }).approve,
    ),
  );
  registerJobRoutes(app, {
    ...dependencies,
    queue,
    workflow,
    management,
    copyCharacterImage: createCharacterAgentMedia(dependencies),
  });
  const portsFor = (req, res) => ({
    streamText: (url, options, settings) => streamChat(res, url, options, settings),
  });

  app.post('/api/context-sessions', endpoint(operations.syncContext));
  if (dependencies.inference) {
    app.get(
      '/api/ai/local-runtime',
      endpoint(() => ({
        status: 200,
        body: {
          models: dependencies.inference.models(),
          imageModels: dependencies.inference.imageModels(),
          videoModels: dependencies.inference.videoModels(),
          ...dependencies.inference.localStatus(),
        },
      })),
    );
    app.get(
      '/api/ai/local-trace',
      endpoint(({ query }) => {
        const after = query?.after === undefined ? 0 : Number(query.after);
        if (!Number.isSafeInteger(after) || after < 0 || !/^\d{1,12}$/.test(String(query?.after ?? '0')))
          throw dependencies.security.fail('Posición de traza inválida.');
        return { status: 200, body: dependencies.inference.localTrace.since(after) };
      }),
    );
    app.post(
      '/api/ai/local-runtime',
      endpoint(async ({ body }) => {
        if (
          !body ||
          Object.keys(body).some((key) => !['action', 'model'].includes(key)) ||
          !['load', 'unload'].includes(body.action)
        )
          throw dependencies.security.fail('Control local inválido.');
        return { status: 200, body: await dependencies.inference.controlLocal(body.action, body.model) };
      }),
    );
  }
  thinking.register(app);
  app.post('/api/ai/text', endpoint(operations.generateText, portsFor));
  app.post('/api/ai/video', endpoint(operations.generateVideo));
  app.post('/api/ai/multimodal', endpoint(operations.generateMultimodal));
  app.post('/api/ai/image', endpoint(operations.generateImage));
  app.post('/api/ai/image-flux', endpoint(operations.generateFlux));
  app.post('/api/ai/audio', endpoint(operations.generateAudio));
  return queue;
};
