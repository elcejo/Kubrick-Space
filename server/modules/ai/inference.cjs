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
  const currentLocalModel = () => scope.getStore()?.localModel;
  const currentSettings = () => scope.getStore()?.settings || {};
  function run(mode, task, localModel, settings = {}) {
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
    for (const entry of Object.values(config.functions)) {
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
    if (currentMode() === 'local')
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
    currentLocalModel,
    currentSettings,
    configure,
    models: local.models,
    fetch: routedFetch,
    localStatus: local.status,
    controlLocal: local.control,
    imageModels: local.imageModels,
    /** Runs a film task on the local engine, serialized with every other local GPU operation. */
    runLocalVideo: local.video,
    localVideoAvailable: local.videoAvailable,
    videoModels: local.videoModels,
    generateLocalImage: (body, signal) =>
      local.image({ ...body, localModel: currentLocalModel() || LOCAL_ID }, signal),
  };
}
module.exports = { createInference };
