const { randomUUID } = require('node:crypto');

const text = (value, max = 200) =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, '').slice(0, max) : null;
const number = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(value, 1e12) : null;
const generationId = (value) =>
  typeof value === 'string' && /^gen-[A-Za-z0-9-]{1,140}$/.test(value) ? value : null;

/** Whitelist only operational metadata. Never retain headers, bodies, messages or images. */
function cleanRequestMetric(value = {}) {
  const out = {};
  for (const key of [
    'service',
    'operation',
    'model',
    'provider',
    'status',
    'statsStatus',
    'finishReason',
    'routing',
  ]) {
    const result = text(value[key]);
    if (result !== null) out[key] = result;
  }
  for (const key of [
    'durationMs',
    'headersMs',
    'firstTokenMs',
    'idleTimeoutMs',
    'totalTimeoutMs',
    'latencyMs',
    'generationMs',
    'inputTokens',
    'outputTokens',
    'reasoningTokens',
    'httpStatus',
    'fallbacks',
  ]) {
    const result = number(value[key]);
    if (result !== null) out[key] = result;
  }
  const id = generationId(value.generationId);
  if (id) out.generationId = id;
  return out;
}

function requestDescription(url, options) {
  let target, body;
  try {
    target = new URL(url);
    body = JSON.parse(options.body || '{}');
  } catch {
    return { service: 'Proveedor', operation: 'Solicitud' };
  }
  const local = typeof body.model === 'string' && body.model.startsWith('local:');
  const openrouter = !local && target.origin === 'https://openrouter.ai';
  const service = local
    ? 'ComfyUI local'
    : openrouter
      ? 'OpenRouter'
      : target.hostname.includes('replicate')
        ? 'Replicate'
        : target.hostname === 'api.openai.com'
          ? 'OpenAI'
          : 'Proveedor';
  return cleanRequestMetric({
    service,
    operation:
      /images|predictions/.test(target.pathname) ||
      body.tools?.some?.((tool) => tool.type === 'image_generation')
        ? 'Imagen'
        : 'Texto / visión',
    model: body.model || /^\/v1\/models\/(.+)\/predictions$/.exec(target.pathname)?.[1],
    routing: openrouter ? body.provider?.sort : undefined,
  });
}

function responseMetric(data) {
  const usage = data?.usage || {};
  return cleanRequestMetric({
    generationId: data?.id,
    provider:
      data?.provider_name ||
      (typeof data?.provider === 'string' ? data.provider : undefined) ||
      data?.error?.metadata?.provider_name,
    model: data?.model,
    inputTokens: usage.prompt_tokens ?? usage.input_tokens,
    outputTokens: usage.completion_tokens ?? usage.output_tokens,
    reasoningTokens: usage.completion_tokens_details?.reasoning_tokens,
    finishReason: data?.choices?.[0]?.finish_reason,
  });
}

/** Same model/capabilities and privacy constraints; prefer fast starts over a fixed vendor. */
function fastOpenRouterOptions(url, options, { sort = 'latency' } = {}) {
  let target;
  try {
    target = new URL(url);
  } catch {
    return options;
  }
  if (
    target.origin !== 'https://openrouter.ai' ||
    !/^\/api\/v1\/(chat\/completions|responses|images)$/.test(target.pathname) ||
    typeof options.body !== 'string'
  )
    return options;
  let body;
  try {
    body = JSON.parse(options.body);
  } catch {
    return options;
  }
  const provider = {
    ...(body.provider || {}),
    sort: sort === 'throughput' ? 'throughput' : 'latency',
    allow_fallbacks: true,
  };
  delete provider.order;
  if (target.pathname !== '/api/v1/images') provider.require_parameters = true;
  return { ...options, body: JSON.stringify({ ...body, provider }) };
}

const lookups = new Set();
/** One bounded, non-blocking metadata lookup, independent of inference timing. */
function enrichGeneration({ id, key, fetchImpl, update }) {
  const record = (patch) => {
    try {
      update(patch);
    } catch {
      /* Inference has finished; metadata must not reject it. */
    }
  };
  if (!generationId(id) || !key || lookups.size >= 4) {
    record({ statsStatus: 'unavailable' });
    return;
  }
  const marker = randomUUID();
  lookups.add(marker);
  void (async () => {
    const controller = new AbortController();
    let timeout;
    try {
      const expired = new Promise((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(Error('metadata timeout'));
        }, 2500);
        timeout.unref?.();
      });
      const response = await Promise.race([
        fetchImpl(`https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${key.trim()}` },
          signal: controller.signal,
        }),
        expired,
      ]);
      if (!response.ok) throw Error('metadata unavailable');
      const result = await Promise.race([response.json(), expired]);
      const data = result?.data;
      if (!data || data.id !== id) throw Error('metadata mismatch');
      record({
        ...cleanRequestMetric({
          provider: data.provider_name,
          latencyMs: data.latency,
          generationMs: data.generation_time,
          inputTokens: data.native_tokens_prompt,
          outputTokens: data.native_tokens_completion,
          reasoningTokens: data.native_tokens_reasoning,
          finishReason: data.finish_reason,
          fallbacks: Array.isArray(data.provider_responses)
            ? Math.max(0, data.provider_responses.length - 1)
            : undefined,
        }),
        statsStatus: 'ready',
      });
    } catch {
      record({ statsStatus: 'unavailable' });
    } finally {
      clearTimeout(timeout);
      lookups.delete(marker);
    }
  })();
}
module.exports = {
  cleanRequestMetric,
  requestDescription,
  responseMetric,
  fastOpenRouterOptions,
  enrichGeneration,
};
