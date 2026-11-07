/**
 * Text models of providers other than OpenRouter and the local engine. Every function of the app speaks the
 * OpenRouter chat format; this adapter turns one request into the provider's own call and answers in the same format,
 * so the rest of the server does not know which provider ran it.
 *  - OpenAI and Gemini expose OpenAI-compatible chat endpoints (tools and JSON schemas included).
 *  - Replicate runs language models as predictions: plain text in, text out, no tools and no native JSON mode.
 */
const { providerOf } = require('./config.cjs');

const ENDPOINTS = {
  openai: 'https://api.openai.com/v1/chat/completions',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  opencode: 'https://opencode.ai/zen/v1/chat/completions',
};
const PROVIDER_NAMES = {
  openai: 'OpenAI',
  gemini: 'Gemini',
  opencode: 'OpenCode Zen',
  replicate: 'Replicate',
};
// Fields only OpenRouter understands.
const OPENROUTER_ONLY = [
  'provider',
  'reasoning',
  'include_reasoning',
  'usage',
  'transforms',
  'models',
  'route',
];
const POLL_MS = 1500;
const MAX_WAIT_MS = 180000;

const failure = (message, status, code) => Response.json({ error: { message }, code }, { status });
const textOf = (content) =>
  Array.isArray(content)
    ? content
        .filter((part) => part?.type === 'text')
        .map((part) => part.text)
        .join('\n')
    : String(content ?? '');

function openAiCompatibleBody(provider, body) {
  const next = { ...body, model: body.model.slice(provider.length + 1) };
  for (const field of OPENROUTER_ONLY) delete next[field];
  if (provider === 'gemini') {
    if (next.max_completion_tokens !== undefined) {
      next.max_tokens = next.max_completion_tokens;
      delete next.max_completion_tokens;
    }
    delete next.stream_options;
  }
  return next;
}

function replicateInput(body) {
  const system = [];
  const turns = [];
  for (const message of body.messages || []) {
    const text = textOf(message.content);
    if (message.role === 'system') system.push(text);
    else turns.push(message.role === 'assistant' ? `Assistant: ${text}` : text);
  }
  const schema = body.response_format?.json_schema?.schema;
  if (body.response_format?.type === 'json_schema' || body.response_format?.type === 'json_object')
    system.push(
      'Responde únicamente con un objeto JSON válido, sin texto adicional ni bloques de código' +
        (schema ? ' y conforme a este esquema: ' + JSON.stringify(schema) : '') +
        '.',
    );
  return {
    prompt: turns.join('\n\n') || ' ',
    ...(system.length ? { system_prompt: system.join('\n\n') } : {}),
    ...(Number.isInteger(body.max_completion_tokens ?? body.max_tokens)
      ? { max_tokens: body.max_completion_tokens ?? body.max_tokens }
      : {}),
    ...(typeof body.temperature === 'number' ? { temperature: body.temperature } : {}),
  };
}

const completion = (model, content, usage) => ({
  id: 'replicate-' + Date.now().toString(36),
  object: 'chat.completion',
  model,
  choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
  usage,
});

function asStream(payload) {
  const text = payload.choices[0].message.content;
  const frame = (data) => `data: ${JSON.stringify(data)}\n\n`;
  const body =
    frame({
      ...payload,
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: { content: text } }],
    }) +
    frame({ ...payload, object: 'chat.completion.chunk', choices: [], usage: payload.usage }) +
    'data: [DONE]\n\n';
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

function createTextProviders({
  fetchImpl,
  getApiKeys,
  sleep = (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
}) {
  async function replicate(body, key, signal) {
    if (Array.isArray(body.tools) && body.tools.length)
      return failure(
        'Los modelos de Replicate no admiten herramientas. Elige un modelo de OpenRouter, OpenAI, Gemini o local para esta función.',
        422,
        'MODEL_TOOLS_UNSUPPORTED',
      );
    const name = body.model.slice('replicate:'.length);
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
    let response = await fetchImpl(`https://api.replicate.com/v1/models/${name}/predictions`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'wait=30' },
      body: JSON.stringify({ input: replicateInput(body) }),
      signal,
    });
    let prediction = await response.json().catch(() => ({}));
    if (!response.ok)
      return failure(
        prediction.detail || prediction.title || 'Replicate rechazó la petición.',
        response.status,
      );
    const deadline = Date.now() + MAX_WAIT_MS;
    while (!['succeeded', 'failed', 'canceled'].includes(prediction.status)) {
      if (signal?.aborted || Date.now() > deadline || !prediction.urls?.get)
        return failure('Replicate no terminó a tiempo.', 504, 'AI_PROVIDER_TIMEOUT');
      await sleep(POLL_MS);
      response = await fetchImpl(prediction.urls.get, { headers, signal });
      prediction = await response.json().catch(() => ({}));
      if (!response.ok) return failure(prediction.detail || 'Replicate no respondió.', response.status);
    }
    if (prediction.status !== 'succeeded')
      return failure(String(prediction.error || 'La predicción de Replicate falló.'), 502);
    const output = Array.isArray(prediction.output)
      ? prediction.output.join('')
      : String(prediction.output ?? '');
    const payload = completion(body.model, output, {
      prompt_tokens: Number(prediction.metrics?.input_token_count) || 0,
      completion_tokens: Number(prediction.metrics?.output_token_count) || 0,
    });
    return body.stream ? asStream(payload) : Response.json(payload);
  }

  /** Runs a chat request on its provider, or answers why it cannot. */
  async function run(body, options = {}) {
    const provider = providerOf(body.model);
    const key = String(getApiKeys()[provider] || '').trim();
    if (!key)
      return failure(
        `Conecta la clave de ${PROVIDER_NAMES[provider]} para usar este modelo.`,
        428,
        'PROVIDER_KEY_REQUIRED',
      );
    if (provider === 'replicate') return replicate(body, key, options.signal);
    return fetchImpl(ENDPOINTS[provider], {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(openAiCompatibleBody(provider, body)),
      signal: options.signal,
    });
  }
  return { run };
}

module.exports = { createTextProviders, PROVIDER_NAMES };
