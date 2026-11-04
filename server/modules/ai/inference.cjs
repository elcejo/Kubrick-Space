const { canonicalLocalModel } = require('../../../public/js/contracts/local-models.js');
const { AsyncLocalStorage } = require('node:async_hooks');
const { createLocalProvider, LOCAL_ID } = require('./local-provider.cjs');
const llmConfig = require('./config.cjs');
const { startLocalEngine } = require('./local-engine.cjs');

function createInference({ appRoot, fetchImpl, findModel = () => null }) {
  const scope = new AsyncLocalStorage();
  const sourceFetch = fetchImpl || ((...args) => fetch(...args));
  const local = createLocalProvider({
    appRoot,
    fetchImpl: sourceFetch,
    startEngine: !fetchImpl ? () => startLocalEngine(appRoot) : undefined,
  });
  const currentMode = () => scope.getStore()?.mode || 'hybrid';
  // Text and image can run on different providers: a project may keep an LLM on OpenRouter and FLUX locally.
  const currentImageMode = () => {
    const store = scope.getStore();
    return store?.settings?.imageMode || store?.mode || 'hybrid';
  };
  const currentLocalModel = () => scope.getStore()?.localModel;
  const currentSettings = () => scope.getStore()?.settings || {};
  function run(mode, task, localModel, settings = {}) {
    localModel = canonicalLocalModel(localModel);
    if (!['local', 'api', 'hybrid'].includes(mode))
      throw Object.assign(new Error('Modo de inferencia inválido.'), { status: 400 });
    if (
      mode === 'local' &&
      localModel !== undefined &&
      !local.models().some((model) => model.id === localModel)
    )
      throw Object.assign(new Error('Modelo local no disponible.'), { status: 422 });
    return scope.run({ mode, localModel, settings }, task);
  }
  function configure(raw) {
    const config = llmConfig.normalize(raw);
    const mode = currentMode();
    // Inside a project the only model that counts is the one chosen in the workspace's top bar: no function falls
    // back to the model of the settings file or to a default.
    if (
      scope.getStore()?.settings?.projectId &&
      !(mode === 'local' ? currentLocalModel() : currentSettings().textModel)
    )
      throw Object.assign(
        new Error(
          'Elige un modelo LLM en la barra superior del workspace para usar cualquier función de IA.',
        ),
        { status: 422, code: 'MODEL_NOT_SELECTED' },
      );
    for (const entry of Object.values(config.functions)) {
      entry.model = canonicalLocalModel(entry.model);
      if (mode === 'local' && (currentLocalModel() || !llmConfig.isLocalModel(entry.model)))
        entry.model = currentLocalModel() || LOCAL_ID;
      else if (mode === 'api')
        entry.model =
          currentSettings().textModel || (llmConfig.isLocalModel(entry.model) ? entry.apiModel : entry.model);
      const limit = findModel(entry.model)?.maxCompletionTokens;
      if (Number.isInteger(limit) && limit > 0)
        entry.maxCompletionTokens = Math.min(entry.maxCompletionTokens, limit);
    }
    return config;
  }
  async function routedFetch(url, options = {}) {
    const target = new URL(url);
    let body;
    try {
      body = JSON.parse(options.body);
    } catch {}
    // Image requests (other providers, or OpenRouter with image output) follow the image mode.
    const imageCall =
      !(target.origin === 'https://openrouter.ai' && target.pathname === '/api/v1/chat/completions') ||
      (Array.isArray(body?.modalities) && body.modalities.includes('image'));
    if (llmConfig.isLocalModel(body?.model)) {
      if (currentMode() === 'api')
        throw Object.assign(new Error('API no admite modelos locales.'), {
          status: 422,
          code: 'INFERENCE_MODE_MISMATCH',
        });
      if (target.origin !== 'https://openrouter.ai' || target.pathname !== '/api/v1/chat/completions')
        throw Object.assign(new Error('Operación local no disponible.'), {
          status: 422,
          code: 'LOCAL_MODALITY_UNSUPPORTED',
        });
      try {
        return await local.fetchLocal(body, options.signal);
      } catch (error) {
        if (options.signal?.aborted) throw error;
        return Response.json(
          { error: { message: error.message }, code: error.code },
          { status: error.status || 502 },
        );
      }
    }
    if ((imageCall ? currentImageMode() : currentMode()) === 'local')
      return Response.json(
        {
          error: { message: 'No hay un modelo local configurado para esta función.' },
          code: 'LOCAL_MODALITY_UNSUPPORTED',
        },
        { status: 422 },
      );
    return sourceFetch(url, options);
  }
  return {
    run,
    currentMode,
    currentImageMode,
    currentLocalModel,
    currentSettings,
    configure,
    models: local.models,
    fetch: routedFetch,
    localStatus: local.status,
    localTrace: local.trace,
    controlLocal: local.control,
    imageModels: local.imageModels,
    /** Runs a film task on the local engine, serialized with every other local GPU operation. */
    runLocalVideo: local.video,
    localVideoAvailable: local.videoAvailable,
    localUpscalerAvailable: local.upscalerAvailable,
    videoModels: local.videoModels,
    generateLocalImage: (body, signal) =>
      local.image({ ...body, localModel: currentLocalModel() || LOCAL_ID }, signal),
  };
}
module.exports = { createInference };
