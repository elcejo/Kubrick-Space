// Optional server-side integration with Artificial Analysis' language-model
// benchmark. The API key never leaves the server; the browser receives only
// the normalized rank and Intelligence Index attached to each model.
const crypto = require('node:crypto');
const DATA_URL = 'https://artificialanalysis.ai/api/v2/language/models/free';
const SOURCE_URL = 'https://artificialanalysis.ai/';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const STALE_TTL_MS = 48 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15000;

let cache = {
  models: [],
  indexVersion: null,
  fetchedAt: null,
  expiresAt: 0,
  staleUntil: 0,
  keyFingerprint: null,
  promiseKeyFingerprint: null,
  promise: null,
};

function fingerprint(apiKey) {
  return crypto.createHash('sha256').update(String(apiKey)).digest('hex');
}

function asString(value, max = 300) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function finiteNumber(value) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeText(value) {
  return asString(value, 500)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase();
}

function compact(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, '');
}

function modelCreatorName(value) {
  if (typeof value === 'string') return asString(value, 120);
  if (value && typeof value === 'object') return asString(value.name || value.slug, 120);
  return '';
}

function readScore(item) {
  const evaluations = item?.evaluations && typeof item.evaluations === 'object' ? item.evaluations : {};
  const candidates = [
    evaluations.artificial_analysis_intelligence_index,
    evaluations.intelligence_index,
    item?.artificial_analysis_intelligence_index,
    item?.intelligence_index,
  ];
  for (const candidate of candidates) {
    const score = finiteNumber(candidate);
    if (score !== null) return score;
  }
  return null;
}

function readRank(item) {
  const evaluations = item?.evaluations && typeof item.evaluations === 'object' ? item.evaluations : {};
  for (const candidate of [
    item?.rank,
    item?.intelligence_index_rank,
    evaluations.artificial_analysis_intelligence_index_rank,
    evaluations.intelligence_index_rank,
  ]) {
    const rank = finiteNumber(candidate);
    if (rank !== null && rank > 0) return Math.round(rank);
  }
  return null;
}

function normalizeModel(item) {
  if (!item || typeof item !== 'object') return null;
  const id = asString(item.id, 240);
  const name = asString(item.name, 300) || id;
  const slug = asString(item.slug, 240);
  const score = readScore(item);
  if (!id && !name) return null;
  return {
    id,
    name,
    slug,
    creator: modelCreatorName(item.model_creator || item.creator),
    score,
    rank: readRank(item),
  };
}

function normalizeModels(payload) {
  const source = Array.isArray(payload)
    ? payload
    : payload && Array.isArray(payload.data)
      ? payload.data
      : [];
  const models = source.map(normalizeModel).filter(Boolean);
  const scored = models
    .filter((model) => model.score !== null)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  let nextRank = 0;
  let previousScore = null;
  for (const model of scored) {
    nextRank += 1;
    if (model.rank === null) {
      model.rank =
        model.score === previousScore
          ? scored.find((item) => item.score === model.score)?.rank || nextRank
          : nextRank;
    }
    previousScore = model.score;
  }
  const byKey = new Map();
  for (const model of models) byKey.set(model.id || `${model.name}:${model.slug}`, model);
  return [...byKey.values()];
}

function responseIndexVersion(payload) {
  return asString(payload?.meta?.index_version || payload?.index_version || payload?.version, 80) || null;
}

function candidateKeys(model) {
  const values = [model?.id, model?.name, model?.slug, model?.canonicalSlug].filter(Boolean);
  const keys = new Set();
  for (const value of values) {
    const normalized = normalizeText(value);
    const pieces = normalized.split(/[/:]/).filter(Boolean);
    for (const piece of [normalized, ...pieces]) {
      const key = compact(piece);
      if (key) keys.add(key);
    }
  }
  return keys;
}

function matchBenchmark(openrouterModel, benchmarks) {
  const requested = candidateKeys(openrouterModel);
  if (!requested.size) return null;
  const matches = benchmarks.filter((benchmark) => {
    for (const key of candidateKeys(benchmark)) if (requested.has(key)) return true;
    return false;
  });
  // Never guess between similarly named models. A score is attached only for
  // one unambiguous identity match.
  return matches.length === 1 ? matches[0] : null;
}

function attachBenchmarks(models, benchmarkModels) {
  return (Array.isArray(models) ? models : []).map((model) => {
    const match = matchBenchmark(model, benchmarkModels);
    return match
      ? {
          ...model,
          artificialAnalysis: {
            rank: match.rank,
            intelligenceScore: match.score,
            modelName: match.name,
          },
        }
      : model;
  });
}

async function fetchCatalog(apiKey = '', fetchImpl = global.fetch) {
  if (!apiKey)
    throw Object.assign(new Error('Clave de Artificial Analysis no configurada'), {
      code: 'ARTIFICIAL_ANALYSIS_KEY_MISSING',
    });
  if (typeof fetchImpl !== 'function')
    throw Object.assign(new Error('Fetch no disponible'), { code: 'ARTIFICIAL_ANALYSIS_FETCH_UNAVAILABLE' });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(DATA_URL, {
      headers: { Accept: 'application/json', 'x-api-key': apiKey },
      signal: controller.signal,
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      /* handled as an empty response */
    }
    if (!response.ok)
      throw Object.assign(new Error(`Artificial Analysis devolvió HTTP ${response.status}`), {
        status: response.status,
        code: `ARTIFICIAL_ANALYSIS_HTTP_${response.status}`,
      });
    return { models: normalizeModels(payload), indexVersion: responseIndexVersion(payload) };
  } catch (error) {
    if (error?.name === 'AbortError')
      throw Object.assign(new Error('Tiempo de espera agotado al consultar Artificial Analysis'), {
        code: 'ARTIFICIAL_ANALYSIS_TIMEOUT',
      });
    if (!error.code && (error?.cause?.code || error?.message === 'fetch failed'))
      error.code = 'ARTIFICIAL_ANALYSIS_NETWORK';
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function getModels({ apiKey = '', force = false, fetchImpl = global.fetch, now = Date.now() } = {}) {
  if (!apiKey)
    return {
      source: 'artificial-analysis',
      available: false,
      models: [],
      fetchedAt: null,
      indexVersion: null,
      warning: 'Configura una clave de Artificial Analysis para mostrar el benchmark.',
    };
  const keyFingerprint = fingerprint(apiKey);
  if (!force && cache.keyFingerprint === keyFingerprint && cache.models.length && now < cache.expiresAt)
    return { source: 'artificial-analysis', available: true, stale: false, ...cache };
  if (cache.promise && cache.promiseKeyFingerprint === keyFingerprint) return cache.promise;
  cache.promiseKeyFingerprint = keyFingerprint;
  cache.promise = fetchCatalog(apiKey, fetchImpl)
    .then((result) => {
      const fetchedAt = new Date().toISOString();
      cache = {
        models: result.models,
        indexVersion: result.indexVersion,
        fetchedAt,
        expiresAt: Date.now() + CACHE_TTL_MS,
        staleUntil: Date.now() + STALE_TTL_MS,
        keyFingerprint,
        promiseKeyFingerprint: null,
        promise: null,
      };
      return { source: 'artificial-analysis', available: true, stale: false, ...cache };
    })
    .catch((error) => {
      const canUseStale =
        cache.keyFingerprint === keyFingerprint &&
        error.status !== 401 &&
        error.status !== 403 &&
        cache.models.length &&
        Date.now() < cache.staleUntil;
      const result = canUseStale
        ? {
            source: 'artificial-analysis',
            available: true,
            stale: true,
            models: cache.models,
            indexVersion: cache.indexVersion,
            fetchedAt: cache.fetchedAt,
            warning: 'No se pudo actualizar Artificial Analysis; se muestra la última copia disponible.',
          }
        : null;
      cache.promise = null;
      cache.promiseKeyFingerprint = null;
      if (result) return result;
      throw error;
    });
  return cache.promise;
}

function resetCache() {
  cache = {
    models: [],
    indexVersion: null,
    fetchedAt: null,
    expiresAt: 0,
    staleUntil: 0,
    keyFingerprint: null,
    promiseKeyFingerprint: null,
    promise: null,
  };
}

module.exports = {
  DATA_URL,
  SOURCE_URL,
  CACHE_TTL_MS,
  STALE_TTL_MS,
  FETCH_TIMEOUT_MS,
  normalizeModel,
  normalizeModels,
  attachBenchmarks,
  matchBenchmark,
  fetchCatalog,
  getModels,
  resetCache,
};
