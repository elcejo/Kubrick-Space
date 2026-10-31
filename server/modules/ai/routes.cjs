const { emptyCharacterDocument } = require('../../../public/js/contracts/character-model.js');
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
const { createBookAgent } = require('./book-agent.cjs');
const { createCoverJobs } = require('./cover-job.cjs');
const { createScenarioJobs } = require('../scenarios/index.cjs');
const { createFilmJobs, createFilmRender } = require('../film/index.cjs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createProvider } = require('./provider.cjs');
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
      localInference: dependencies.inference?.currentMode() === 'local',
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
  const bookInfer = async (input, ctx) => {
    const result = await createProvider({
      ...dependencies,
      backgroundSignal: ctx.signal,
      trackRequest: ctx.trackRequest,
    }).request(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + (dependencies.getApiKeys().openrouter || 'local'),
        },
        body: JSON.stringify({
          model: input.model,
          messages: input.messages,
          max_completion_tokens: input.maxTokens,
          response_format: { type: 'json_object' },
          temperature: 0.5,
        }),
      },
      300000,
      { omitBody: true },
    );
    if (
      result.status >= 400 ||
      !result.data?.choices?.[0]?.message?.content ||
      result.data.choices[0].finish_reason === 'length'
    )
      throw dependencies.security.fail(
        result.error || `El modelo no completó la etapa ${input.stage || 'del libro'}.`,
        result.status || 502,
      );
    try {
      return JSON.parse(result.data.choices[0].message.content);
    } catch {
      throw dependencies.security.fail(
        'El modelo devolvió una etapa inválida. Lo guardado se conserva.',
        502,
      );
    }
  };
  const bookAgent = createBookAgent({
    ...dependencies,
    async prepareStoryResource(resource, record, job, ctx) {
      if (!record.created) return dependencies.readCurrentProject(record.id);
      const project = dependencies.readCurrentProject(record.id);
      if (project.content) return project;
      let content;
      if (record.type === 'character') {
        const result = await makeHelpers(job.payload.textConfig, {
          signal: ctx.signal,
          trackRequest: ctx.trackRequest,
        }).designCharacter(
          {
            body: {
              projectId: record.id,
              document: emptyCharacterDocument({ id: record.id, name: record.name }),
              source: 'description',
              request: resource.description,
              ingredients: [],
            },
          },
          { management: false },
        );
        if (result.status !== 200 || !result.body?.document)
          throw dependencies.security.fail('No se pudo completar la ficha complementaria.', 502);
        content = JSON.stringify(result.body.document);
      } else content = resource.description;
      ctx.throwIfAborted();
      dependencies.writeProject(record.id, { content }, project.content);
      return dependencies.readCurrentProject(record.id);
    },
    infer: bookInfer,
  });
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
  const filmJobs = createFilmJobs(dependencies, { infer: bookInfer });
  const filmRender = createFilmRender(dependencies, {
    readImage: createImageStorage(dependencies).referenceImage,
  });
  const runJob = (job, context) =>
    job.kind === 'cover'
      ? coverJobs.run(job, context)
      : job.kind === 'scenario'
        ? scenarioJobs.run(job, context)
        : job.kind === 'film'
          ? filmJobs.run(job, context)
          : job.kind === 'film-render'
            ? filmRender.run(job, context)
            : job.kind === 'book'
              ? bookAgent.run(job, context)
              : workflow.run(job, context);
  const queue = createJobQueue({
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
  app.post(
    '/api/jobs/book',
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
      const { project } = bookAgent.read(body.projectId);
      return {
        status: 202,
        body: {
          job: queue.enqueue({
            projectId: project.id,
            kind: 'book',
            token: body.token,
            payload: {
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
    '/api/jobs/:jobId/message',
    endpoint(({ params, body }) => {
      const job = queue.get(params.jobId);
      if (!job || job.kind !== 'book' || !['queued', 'running'].includes(job.status))
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
  app.post('/api/ai/text', endpoint(operations.generateText, portsFor));
  app.post('/api/ai/video', endpoint(operations.generateVideo));
  app.post('/api/ai/multimodal', endpoint(operations.generateMultimodal));
  app.post('/api/ai/image', endpoint(operations.generateImage));
  app.post('/api/ai/image-flux', endpoint(operations.generateFlux));
  app.post('/api/ai/audio', endpoint(operations.generateAudio));
  return queue;
};
