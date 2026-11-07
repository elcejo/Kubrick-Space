/**
 * Catalog of text models of the providers connected by API key besides OpenRouter (OpenAI, Gemini, Replicate). Ids carry
 * the provider as a prefix (`openai:gpt-…`) so the server can route each request. Entries follow the shape of the
 * OpenRouter catalog; `supportedParameters` only lists `tools` where the provider's chat API really takes them.
 */
const { textModelPricing } = require('./text-model-prices.cjs');

const TTL_MS = 15 * 60 * 1000;
const TIMEOUT_MS = 15000;
const EXCLUDED =
  /(audio|realtime|image|tts|transcribe|whisper|embed|moderation|search|dall|sora|vision-preview|live|imagen|veo|aqa|robotics|computer-use)/i;

function entry(provider, model, name, extra = {}) {
  return {
    id: `${provider}:${model}`,
    provider,
    name,
    canonicalSlug: '',
    description: extra.description || '',
    created: extra.created || null,
    contextLength: extra.contextLength || null,
    maxCompletionTokens: extra.maxCompletionTokens || null,
    modality: 'text->text',
    inputModalities: extra.inputModalities || ['text'],
    outputModalities: ['text'],
    supportedParameters:
      provider === 'replicate'
        ? ['temperature', 'max_tokens']
        : ['tools', 'temperature', 'max_tokens', 'response_format'],
    pricing: extra.pricing || {},
  };
}

function createTextModelCatalog({ getApiKeys, fetchImpl = (...args) => fetch(...args) }) {
  let cached;
  let signature = '';
  let until = 0;
  let pending;

  const getJson = async (url, headers) => {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json', ...headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error('Catálogo no disponible');
    return response.json();
  };

  const loaders = {
    async openai(key) {
      const data = await getJson('https://api.openai.com/v1/models', { Authorization: `Bearer ${key}` });
      return (data.data || [])
        .filter((m) => /^(gpt-|o\d|chatgpt-)/i.test(m.id) && !EXCLUDED.test(m.id) && !/instruct/i.test(m.id))
        .map((m) =>
          entry('openai', m.id, m.id, {
            created: m.created,
            inputModalities: ['text', 'image'],
            pricing: textModelPricing('openai', m.id, m),
          }),
        );
    },
    async gemini(key) {
      const out = [];
      let token = '';
      for (let page = 0; page < 5; page += 1) {
        const data = await getJson(
          `https://generativelanguage.googleapis.com/v1beta/models?pageSize=200${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`,
          { 'x-goog-api-key': key },
        );
        for (const m of data.models || []) {
          const id = String(m.name || '').replace(/^models\//, '');
          if (!/^gemini-/i.test(id) || EXCLUDED.test(id)) continue;
          if (!(m.supportedGenerationMethods || []).includes('generateContent')) continue;
          out.push(
            entry('gemini', id, m.displayName || id, {
              description: m.description,
              contextLength: m.inputTokenLimit,
              maxCompletionTokens: m.outputTokenLimit,
              pricing: textModelPricing('gemini', id, m),
              inputModalities: ['text', 'image'],
            }),
          );
        }
        token = data.nextPageToken || '';
        if (!token) break;
      }
      return out;
    },
    // OpenCode Zen serves some families on other endpoints (GPT on /responses, Claude on /messages); only the models
    // that speak chat completions can run here.
    async opencode(key) {
      const data = await getJson('https://opencode.ai/zen/v1/models', { Authorization: `Bearer ${key}` });
      return (data.data || [])
        .filter(
          (m) => typeof m.id === 'string' && !/^(gpt-|claude-|gemini-)/i.test(m.id) && !EXCLUDED.test(m.id),
        )
        .map((m) =>
          entry('opencode', m.id, m.id, {
            created: m.created,
            pricing: textModelPricing('opencode', m.id, m),
          }),
        );
    },
    async replicate(key) {
      const data = await getJson('https://api.replicate.com/v1/collections/language-models', {
        Authorization: `Bearer ${key}`,
      });
      return (data.models || [])
        .filter((m) => /^[a-z0-9._-]+$/i.test(m.owner || '') && /^[a-z0-9._-]+$/i.test(m.name || ''))
        .map((m) =>
          entry('replicate', `${m.owner}/${m.name}`, `${m.owner}/${m.name}`, {
            description: m.description,
            pricing: textModelPricing('replicate', `${m.owner}/${m.name}`, m),
          }),
        );
    },
  };

  async function discover(keys) {
    const models = [];
    const warnings = [];
    await Promise.all(
      Object.keys(loaders)
        .filter((provider) => keys[provider])
        .map(async (provider) => {
          try {
            models.push(...(await loaders[provider](keys[provider])));
          } catch {
            warnings.push(provider);
          }
        }),
    );
    models.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    return { models, warnings };
  }

  /** Models of the connected providers; a provider that fails is reported in `warnings` and does not break the rest. */
  async function list({ force = false } = {}) {
    const keys = getApiKeys();
    const next = ['openai', 'gemini', 'replicate', 'opencode']
      .map((p) => `${p}:${keys[p] ? 1 : 0}`)
      .join('|');
    if (!force && cached && next === signature && Date.now() < until) return cached;
    if (pending && next === signature && !force) return pending;
    signature = next;
    pending = discover(keys)
      .then((result) => {
        cached = result;
        until = Date.now() + (result.warnings.length ? 60000 : TTL_MS);
        return result;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  }

  return { list };
}

module.exports = { createTextModelCatalog };
