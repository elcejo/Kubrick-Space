// Application operations with explicit storage/provider dependencies.
function createConfigurationOperations(dependencies) {
  const {
    getApiKeys,
    apiKeyVault,
    llmConfig,
    getLLMConfig,
    openrouterModels,
    artificialAnalysisModels,
    security,
    writeJSON,
    LLM_CONFIG_JSON,
  } = dependencies;

  function readKeys({ params = {}, body, headers = {}, query = {} } = {}) {
    const responseHeaders = {};
    const reply = (body, status = 200) => ({ body, status, headers: responseHeaders });

    try {
      const keys = getApiKeys();
      return reply(
        Object.fromEntries(
          Object.entries(keys).map(([name, value]) => [name, { configured: Boolean(value) }]),
        ),
        200,
      );
    } catch (err) {
      console.error('GET /api/keys error:', err);
      return reply({ error: 'Failed to read API keys' }, 500);
    }
  }

  function saveKeys({ params = {}, body, headers = {}, query = {} } = {}) {
    const responseHeaders = {};
    const reply = (body, status = 200) => ({ body, status, headers: responseHeaders });

    try {
      const keys = getApiKeys();
      for (const [name, value] of Object.entries(body)) {
        if (
          !['openrouter', 'replicate', 'gemini', 'openai', 'minimax', 'artificial-analysis'].includes(name) ||
          typeof value !== 'string' ||
          value.length > 1024
        )
          return reply({ error: 'Invalid key configuration' }, 400);
        keys[name] = value.trim();
      }

      apiKeyVault.save(keys);
      return reply({ success: true }, 200);
    } catch (err) {
      console.error('PUT /api/keys error:', err);
      return reply({ error: 'Failed to save API keys' }, 500);
    }
  }

  function readConfig({ params = {}, body, headers = {}, query = {} } = {}) {
    const responseHeaders = {};
    const reply = (body, status = 200) => ({ body, status, headers: responseHeaders });

    responseHeaders['Cache-Control'] = 'no-store';
    return reply(llmConfig.publicConfig(getLLMConfig()), 200);
  }

  async function listModels({ params = {}, body, headers = {}, query = {} } = {}) {
    const responseHeaders = {};
    const reply = (body, status = 200) => ({ body, status, headers: responseHeaders });

    try {
      if (headers['x-kubrick-inference-mode'] === 'local' && dependencies.localModels) {
        responseHeaders['Cache-Control'] = 'no-store';
        return reply(
          { source: 'local', models: dependencies.localModels(), catalogAvailable: true, stale: false },
          200,
        );
      }
      const keys = getApiKeys();
      const catalog = await openrouterModels.getModels({
        fetchImpl: dependencies.fetchImpl,
        apiKey: keys.openrouter || '',
        force: query.force === '1',
      });
      let benchmark = {
        provider: 'artificial-analysis',
        sourceUrl: artificialAnalysisModels.SOURCE_URL,
        available: false,
        indexVersion: null,
        fetchedAt: null,
        stale: false,
        warning:
          'Configura una clave de Artificial Analysis en Claves API para mostrar ranking y puntuación de inteligencia.',
      };
      let models = catalog.models;
      if (keys['artificial-analysis']) {
        try {
          const scores = await artificialAnalysisModels.getModels({
            fetchImpl: dependencies.fetchImpl,
            apiKey: keys['artificial-analysis'],
            force: query.force === '1',
          });
          models = artificialAnalysisModels.attachBenchmarks(models, scores.models);
          benchmark = {
            provider: 'artificial-analysis',
            sourceUrl: artificialAnalysisModels.SOURCE_URL,
            available: scores.available === true,
            indexVersion: scores.indexVersion || null,
            fetchedAt: scores.fetchedAt || null,
            stale: scores.stale === true,
            warning: scores.warning || null,
          };
        } catch (error) {
          benchmark.warning =
            'No se pudo actualizar Artificial Analysis; los modelos siguen disponibles sin puntuación nueva.';
          benchmark.code = typeof error.code === 'string' ? error.code : 'ARTIFICIAL_ANALYSIS_UNAVAILABLE';
          console.warn('GET /api/llm-models benchmark warning:', benchmark.code);
        }
      }
      responseHeaders['Cache-Control'] = 'no-store';
      return reply(
        {
          ...catalog,
          models: [...models, ...(dependencies.localModels?.() || [])],
          benchmark,
          attribution: 'Benchmark de inteligencia: Artificial Analysis.',
        },
        200,
      );
    } catch (error) {
      const config = llmConfig.publicConfig(getLLMConfig());
      const configuredIds = Object.values(config.prompts || {})
        .map((prompt) => prompt.model)
        .filter(Boolean);
      const code = typeof error.code === 'string' ? error.code : 'OPENROUTER_CATALOG_UNAVAILABLE';
      console.error('GET /api/llm-models error:', code, error.message);
      // Keep the selector usable during a provider outage. These are only the
      // models already selected in local configuration; the response clearly
      // marks that the complete live catalog was not loaded.
      responseHeaders['Cache-Control'] = 'no-store';
      return reply(
        {
          source: 'local-config',
          fetchedAt: null,
          stale: true,
          catalogAvailable: false,
          models: [
            ...openrouterModels.fallbackModels(configuredIds.filter((id) => !llmConfig.isLocalModel(id))),
            ...(dependencies.localModels?.() || []),
          ],
          benchmark: {
            provider: 'artificial-analysis',
            sourceUrl: artificialAnalysisModels.SOURCE_URL,
            available: false,
            indexVersion: null,
            fetchedAt: null,
            stale: false,
            warning:
              'El catálogo de OpenRouter no está disponible; el benchmark se mostrará al actualizar el catálogo.',
          },
          attribution: 'Benchmark de inteligencia: Artificial Analysis.',
          warning:
            'OpenRouter no está accesible. Se conservan los modelos configurados; pulsa Actualizar cuando la conexión esté disponible.',
          code,
        },
        200,
      );
    }
  }

  function saveConfig({ params = {}, body: inputBody, headers = {}, query = {} } = {}) {
    const responseHeaders = {};
    const reply = (body, status = 200) => ({ body, status, headers: responseHeaders });

    try {
      const body = inputBody && typeof inputBody === 'object' && !Array.isArray(inputBody) ? inputBody : null;
      if (
        !body ||
        Object.keys(body).some(
          (key) => !['maxCompletionTokens', 'timeouts', 'functions', 'prompts'].includes(key),
        )
      )
        throw security.fail('Configuración LLM inválida');
      if (body.prompts !== undefined)
        throw security.fail('Los system prompts son de solo lectura en Configuración.');
      const current = getLLMConfig();
      const nextConfig = llmConfig.normalize({
        ...current,
        ...body,
        timeouts: { ...current.timeouts, ...(body.timeouts || {}) },
        prompts: current.prompts,
        functions: Object.fromEntries(
          Object.entries({ ...current.functions, ...(body.functions || {}) }).map(([id, value]) => [
            id,
            {
              ...current.functions[id],
              ...value,
              apiModel: current.functions[id]?.apiModel || current.functions[id]?.model,
              ...(current.functions[id]?.inheritModel !== undefined
                ? {
                    inheritModel:
                      current.functions[id].inheritModel &&
                      (!body.functions?.[id]?.model ||
                        body.functions[id].model === current.functions[id].model),
                  }
                : {}),
            },
          ]),
        ),
      });
      if (
        body.maxCompletionTokens !== undefined &&
        (!Number.isInteger(body.maxCompletionTokens) ||
          body.maxCompletionTokens < 1 ||
          body.maxCompletionTokens > llmConfig.MAX_COMPLETION_TOKENS)
      )
        throw security.fail('El máximo de tokens debe ser un entero entre 1 y 128000');
      if (body.timeouts !== undefined) {
        if (
          !body.timeouts ||
          typeof body.timeouts !== 'object' ||
          Array.isArray(body.timeouts) ||
          Object.keys(body.timeouts).some((key) => !['default', 'cover', 'screenplay'].includes(key))
        )
          throw security.fail('Tiempos de espera inválidos');
        for (const value of Object.values(body.timeouts))
          if (
            !Number.isInteger(value) ||
            value < llmConfig.MIN_TIMEOUT_MS ||
            value > llmConfig.MAX_TIMEOUT_MS
          )
            throw security.fail('El tiempo de espera debe estar entre 10000 y 1800000 milisegundos');
      }
      if (body.functions !== undefined) {
        if (!body.functions || typeof body.functions !== 'object' || Array.isArray(body.functions))
          throw security.fail('Límites por función inválidos');
        for (const [id, value] of Object.entries(body.functions)) {
          if (
            !llmConfig.PROMPT_DEFINITIONS.some((definition) => definition.id === id) ||
            !value ||
            typeof value !== 'object' ||
            Array.isArray(value) ||
            (value.maxCompletionTokens !== undefined &&
              (!Number.isInteger(value.maxCompletionTokens) ||
                value.maxCompletionTokens < 1 ||
                value.maxCompletionTokens > llmConfig.MAX_COMPLETION_TOKENS)) ||
            (value.timeoutMs !== undefined &&
              (!Number.isInteger(value.timeoutMs) ||
                value.timeoutMs < llmConfig.MIN_TIMEOUT_MS ||
                value.timeoutMs > llmConfig.MAX_TIMEOUT_MS)) ||
            (value.model !== undefined && !llmConfig.isModelId(value.model)) ||
            (llmConfig.isLocalModel(value.model) &&
              !(dependencies.localModels?.() || []).some((model) => model.id === value.model)) ||
            Object.keys(value).some((key) => !['maxCompletionTokens', 'timeoutMs', 'model'].includes(key))
          )
            throw security.fail('Límite LLM por función inválido');
        }
      }
      writeJSON(LLM_CONFIG_JSON, nextConfig);
      responseHeaders['Cache-Control'] = 'no-store';
      return reply(llmConfig.publicConfig(nextConfig), 200);
    } catch (error) {
      throw error;
    }
  }
  return { readKeys, saveKeys, readConfig, listModels, saveConfig };
}
module.exports = { createConfigurationOperations };
