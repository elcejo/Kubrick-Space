const CATALOG_URL = 'https://openrouter.ai/api/v1/models?output_modalities=text';
const CATALOG_FALLBACK_URL = 'https://openrouter.ai/api/v1/models';
const CACHE_TTL_MS = 15 * 60 * 1000;
const STALE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15000;

let cache = {
  models: [],
  fetchedAt: null,
  expiresAt: 0,
  staleUntil: 0,
  stale: false,
  promise: null,
};

function asString(value, max = 20000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function arrayOfStrings(value) {
  return Array.isArray(value)
    ? value
        .filter((item) => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function isBatchModel(model) {
  const values = [model?.id, model?.name, model?.canonical_slug].filter((value) => typeof value === 'string');
  return values.some((value) => /(?:^|[^a-z0-9])batch(?:$|[^a-z0-9])/i.test(value));
}

function isTextModel(model) {
  const architecture = model && typeof model.architecture === 'object' ? model.architecture : {};
  const outputs = arrayOfStrings(architecture.output_modalities).map((value) => value.toLowerCase());
  const modality = asString(architecture.modality, 100).toLowerCase();
  // OpenRouter's output_modalities filter is authoritative when present. Keep
  // text->text models returned by older catalog responses as a compatibility
  // fallback, while excluding image/audio/embedding-only models.
  if (outputs.length) return outputs.includes('text');
  return modality === 'text->text' || modality.endsWith('->text');
}

function normalizeModel(model) {
  if (!model || typeof model !== 'object') return null;
  const id = asString(model.id, 200);
  if (!id || !isTextModel(model) || isBatchModel(model)) return null;
  const architecture = model.architecture && typeof model.architecture === 'object' ? model.architecture : {};
  const topProvider = model.top_provider && typeof model.top_provider === 'object' ? model.top_provider : {};
  const pricing = model.pricing && typeof model.pricing === 'object' ? model.pricing : {};
  return {
    id,
    name: asString(model.name, 300) || id,
    canonicalSlug: asString(model.canonical_slug, 300),
    description: asString(model.description, 4000),
    created: Number.isFinite(model.created) ? model.created : null,
    contextLength: Number.isInteger(model.context_length) ? model.context_length : null,
    maxCompletionTokens: Number.isInteger(topProvider.max_completion_tokens)
      ? topProvider.max_completion_tokens
      : null,
    modality: asString(architecture.modality, 100),
    inputModalities: arrayOfStrings(architecture.input_modalities),
    outputModalities: arrayOfStrings(architecture.output_modalities),
    supportedParameters: arrayOfStrings(model.supported_parameters),
    pricing: Object.fromEntries(
      Object.entries(pricing).filter(
        ([key, value]) =>
          ['prompt', 'completion', 'request', 'image', 'input_cache_read', 'input_cache_write'].includes(
            key,
          ) &&
          (typeof value === 'string' || typeof value === 'number'),
      ),
    ),
  };
}

function normalizeModels(payload) {
  const source = Array.isArray(payload)
    ? payload
    : payload && Array.isArray(payload.data)
      ? payload.data
      : [];
  const byId = new Map();
  for (const item of source) {
    const normalized = normalizeModel(item);
    if (normalized) byId.set(normalized.id, normalized);
  }
  return [...byId.values()].sort((a, b) =>
    (a.name || a.id).localeCompare(b.name || b.id, undefined, { sensitivity: 'base' }),
  );
}

async function fetchCatalog(apiKey = '', fetchImpl = global.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('Fetch no disponible');
  const request = async (url, includeKey) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const headers = { Accept: 'application/json', 'X-Title': 'Kubrick Space' };
      if (includeKey && apiKey) headers.Authorization = `Bearer ${apiKey}`;
      const response = await fetchImpl(url, { headers, signal: controller.signal });
      let payload;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (!response.ok) {
        const error = new Error(`OpenRouter devolvió HTTP ${response.status}`);
        error.status = response.status;
        error.code = `OPENROUTER_CATALOG_HTTP_${response.status}`;
        throw error;
      }
      return normalizeModels(payload);
    } catch (error) {
      if (error?.name === 'AbortError') {
        const timeoutError = new Error('Tiempo de espera agotado al consultar OpenRouter');
        timeoutError.code = 'OPENROUTER_CATALOG_TIMEOUT';
        throw timeoutError;
      }
      if (
        !error.code &&
        (error?.cause?.code === 'EACCES' ||
          error?.cause?.code === 'ENETUNREACH' ||
          error?.cause?.code === 'ECONNREFUSED' ||
          error?.cause?.code === 'ENOTFOUND' ||
          error?.message === 'fetch failed')
      ) {
        error.code = 'OPENROUTER_CATALOG_NETWORK';
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };
  const attempts = [];
  // The filtered endpoint is preferred. Some proxies reject its query string,
  // so retry the unfiltered catalog and apply the text-output filter locally.
  for (const url of [CATALOG_URL, CATALOG_FALLBACK_URL]) {
    const authModes = apiKey ? [true, false] : [false];
    for (const includeKey of authModes) {
      try {
        return await request(url, includeKey);
      } catch (error) {
        attempts.push(error);
        // Retrying a network outage four times only makes the settings screen
        // feel frozen. Alternate URL/auth attempts are useful for HTTP-level
        // proxy and authentication responses, not for a blocked connection.
        if (error.code === 'OPENROUTER_CATALOG_NETWORK' || error.code === 'OPENROUTER_CATALOG_TIMEOUT')
          throw error;
        // An authenticated 401 is not a reason to stop: the catalog is public
        // and the unauthenticated attempt may still work.
      }
    }
  }
  const last = attempts.at(-1) || new Error('No se pudo consultar OpenRouter');
  const error = new Error(last.message);
  error.code = last.code || 'OPENROUTER_CATALOG_UNAVAILABLE';
  error.status = last.status;
  throw error;
}

async function getModels({ apiKey = '', force = false, fetchImpl = global.fetch, now = Date.now() } = {}) {
  if (!force && cache.models.length && now < cache.expiresAt) {
    return { source: 'openrouter', fetchedAt: cache.fetchedAt, stale: false, models: cache.models };
  }
  if (cache.promise) return cache.promise;
  cache.promise = fetchCatalog(apiKey, fetchImpl)
    .then((models) => {
      const fetchedAt = new Date().toISOString();
      cache = {
        models,
        fetchedAt,
        expiresAt: Date.now() + CACHE_TTL_MS,
        staleUntil: Date.now() + STALE_TTL_MS,
        stale: false,
        promise: null,
      };
      return { source: 'openrouter', fetchedAt, stale: false, models };
    })
    .catch((error) => {
      const canUseStale = cache.models.length && Date.now() < cache.staleUntil;
      const result = canUseStale
        ? {
            source: 'openrouter',
            fetchedAt: cache.fetchedAt,
            stale: true,
            models: cache.models,
            warning: 'No se pudo actualizar el catálogo; se muestra la última lista disponible.',
          }
        : null;
      cache.promise = null;
      if (result) return result;
      throw error;
    });
  return cache.promise;
}

function findModel(id) {
  return cache.models.find((model) => model.id === id) || null;
}

function fallbackModels(ids = []) {
  return [...new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === 'string' && id.trim()) : [])]
    .filter((id) => !isBatchModel({ id }))
    .map((id) => ({
      id,
      name: id,
      canonicalSlug: id,
      description:
        'Modelo conservado en la configuración local. El catálogo de OpenRouter no está disponible en este momento.',
      created: null,
      contextLength: null,
      maxCompletionTokens: null,
      modality: 'text->text',
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportedParameters: [],
      pricing: {},
    }));
}

function resetCache() {
  cache = { models: [], fetchedAt: null, expiresAt: 0, staleUntil: 0, stale: false, promise: null };
}

module.exports = {
  CATALOG_URL,
  CATALOG_FALLBACK_URL,
  CACHE_TTL_MS,
  STALE_TTL_MS,
  FETCH_TIMEOUT_MS,
  normalizeModel,
  normalizeModels,
  isTextModel,
  isBatchModel,
  getModels,
  findModel,
  fallbackModels,
  resetCache,
};
