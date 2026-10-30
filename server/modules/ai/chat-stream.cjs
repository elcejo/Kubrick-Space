const { once } = require('node:events');
const { fastOpenRouterOptions } = require('./request-metrics.cjs');

/** Relay only answer deltas, with an explicit success/error terminal event. */
async function streamChat(
  res,
  url,
  options,
  { timeoutMs, debug, fetchImpl = fetch, redact = (value) => value },
) {
  options = fastOpenRouterOptions(url, options);
  const { readSSE } = await import('../../../public/js/modules/ai/event-stream.mjs');
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const disconnect = () => controller.abort();
  res.on('close', disconnect);
  let heartbeat;
  const send = async (event, value) => {
    if (res.destroyed) throw new Error('Cliente desconectado');
    if (!res.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`)) {
      await once(res, 'drain', { signal: controller.signal });
    }
  };
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const message =
        body.error?.message ||
        (typeof body.error === 'string' ? body.error : 'El proveedor rechazó la petición de IA.');
      return res.status(response.status).json({ error: redact(message), code: 'AI_PROVIDER_ERROR' });
    }
    if (!response.headers.get('content-type')?.includes('text/event-stream')) {
      throw Object.assign(new Error('El proveedor no devolvió una respuesta en streaming.'), {
        code: 'AI_INVALID_STREAM',
      });
    }
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    heartbeat = setInterval(() => {
      if (!res.destroyed && !res.writableNeedDrain) res.write(': keep-alive\n\n');
    }, 15000);
    let text = '',
      completed = false,
      finishReason = null,
      usage = null,
      model = debug.model;
    for await (const frame of readSSE(response.body)) {
      if (frame.data === '[DONE]') {
        completed = true;
        break;
      }
      const chunk = JSON.parse(frame.data);
      if (chunk.error)
        throw Object.assign(new Error('El proveedor interrumpió la respuesta de IA.'), {
          code: 'AI_PROVIDER_ERROR',
        });
      const choice = chunk.choices?.[0];
      if (chunk.model) model = chunk.model;
      if (chunk.usage) usage = chunk.usage;
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      const delta = choice?.delta?.content;
      if (typeof delta === 'string' && delta) {
        text += delta;
        await send('delta', { text: delta });
      }
    }
    if (!completed)
      throw Object.assign(new Error('La conexión terminó antes de completar la respuesta.'), {
        code: 'AI_STREAM_INTERRUPTED',
      });
    if (finishReason === 'length' || finishReason === 'content_filter' || finishReason === 'error') {
      throw Object.assign(new Error('El proveedor devolvió una respuesta incompleta.'), {
        code: 'AI_RESPONSE_TRUNCATED',
      });
    }
    if (!text.trim())
      throw Object.assign(new Error('El proveedor no devolvió texto utilizable.'), {
        code: 'AI_EMPTY_RESPONSE',
      });
    await send('done', { text, debug: { ...debug, model, finishReason, usage } });
  } catch (error) {
    if (res.destroyed) return;
    const message = timedOut
      ? `La petición de IA superó el tiempo de espera configurado (${Math.ceil(timeoutMs / 1000)} s).`
      : error.code
        ? error.message
        : 'Se interrumpió la conexión con el proveedor de IA.';
    const payload = {
      error: redact(message),
      code: timedOut ? 'AI_REQUEST_TIMEOUT' : error.code || 'AI_STREAM_INTERRUPTED',
    };
    if (res.headersSent) res.write(`event: error\ndata: ${JSON.stringify(payload)}\n\n`);
    else res.status(timedOut ? 504 : 502).json(payload);
  } finally {
    clearTimeout(timeout);
    clearInterval(heartbeat);
    res.off('close', disconnect);
    controller.abort();
    if (!res.destroyed && !res.writableEnded) res.end();
  }
}
module.exports = { streamChat };
