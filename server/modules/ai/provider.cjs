const {
  fastOpenRouterOptions,
  requestDescription,
  responseMetric,
  enrichGeneration,
} = require('./request-metrics.cjs');
const { readCompletionStream } = require('./completion-stream.cjs');

function createProvider({
  security,
  getApiKeys,
  fetchImpl = (...args) => fetch(...args),
  backgroundSignal,
  trackRequest,
}) {
  async function proxyRequest(
    url,
    options,
    timeoutMs = 120000,
    { omitBody = false, completionStream = false } = {},
  ) {
    let streaming = false;
    if (completionStream && url === 'https://openrouter.ai/api/v1/chat/completions') {
      const body = JSON.parse(options.body);
      if (typeof body.model === 'string' && !body.model.startsWith('local:')) {
        streaming = true;
        options = {
          ...options,
          body: JSON.stringify({
            ...body,
            stream: true,
            stream_options: { ...body.stream_options, include_usage: true },
          }),
        };
      }
    }
    options = fastOpenRouterOptions(url, options, { sort: streaming ? 'throughput' : 'latency' });
    const description = requestDescription(url, options);
    const updateMetric = trackRequest?.(description) || (() => {});
    const started = performance.now();
    let headersMs,
      observedStatus,
      firstTokenMs,
      metadata = {},
      timeoutKind;
    const controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      ...(backgroundSignal ? [backgroundSignal] : []),
      ...(options.signal ? [options.signal] : []),
    ]);
    let timeoutId;
    const resetIdle = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        timeoutKind = 'idle';
        controller.abort();
      }, timeoutMs);
    };
    resetIdle();
    const totalTimeoutMs = streaming ? Math.min(300000, Math.max(timeoutMs, timeoutMs * 3)) : timeoutMs;
    const totalTimer = streaming
      ? setTimeout(() => {
          timeoutKind = 'total';
          controller.abort();
        }, totalTimeoutMs)
      : undefined;
    if (streaming) updateMetric({ idleTimeoutMs: timeoutMs, totalTimeoutMs });
    const observeMetadata = (data) => {
      const next = responseMetric(data);
      if (Object.keys(next).some((key) => next[key] !== metadata[key])) {
        metadata = { ...metadata, ...next };
        updateMetric(next);
      }
    };
    const activity = () => {
      resetIdle();
      if (firstTokenMs === undefined) {
        firstTokenMs = performance.now() - started;
        updateMetric({ firstTokenMs });
      }
    };
    let onAbort;

    // Log outgoing request details (redacting API keys)
    try {
      const loggedOptions = { ...options };
      if (loggedOptions.headers) {
        loggedOptions.headers = { ...loggedOptions.headers };
        for (const key of Object.keys(loggedOptions.headers)) {
          const lowerKey = key.toLowerCase();
          if (lowerKey.includes('auth') || lowerKey.includes('key') || lowerKey.includes('token')) {
            loggedOptions.headers[key] = '[REDACTED]';
          }
        }
      }
      let parsedBody = null;
      if (omitBody) parsedBody = '[Contenido de la ficha omitido]';
      else if (loggedOptions.body) {
        try {
          parsedBody = JSON.parse(loggedOptions.body);
        } catch (e) {
          parsedBody = loggedOptions.body;
        }
      }
      console.log(
        security.redact(
          `\n=== OUTGOING INFERENCE REQUEST ===\nMotor: ${description.service}\nURL: ${description.service === 'ComfyUI local' ? 'http://127.0.0.1:8189 (adaptador local)' : url}\nMethod: ${loggedOptions.method || 'GET'}\nHeaders: ${JSON.stringify(loggedOptions.headers, null, 2)}\nBody: ${JSON.stringify(parsedBody, null, 2)}\n============================\n`,
          Object.values(getApiKeys()),
        ),
      );
    } catch (logErr) {
      console.error('Error logging proxy request:', logErr);
    }

    try {
      signal.throwIfAborted();
      const halted = new Promise((resolve, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener('abort', onAbort, { once: true });
      });
      const { response, data } = await Promise.race([
        (async () => {
          const response = await fetchImpl(url, { ...options, signal });
          observedStatus = response.status;
          headersMs = performance.now() - started;
          const headerId = response.headers?.get?.('x-generation-id');
          observeMetadata({ id: headerId });
          updateMetric({ headersMs, httpStatus: response.status });
          const sse = response.ok && response.headers?.get?.('content-type')?.includes('text/event-stream');
          return {
            response,
            data:
              streaming && sse
                ? await readCompletionStream(response.body, { signal, activity, metadata: observeMetadata })
                : await response.json(),
          };
        })(),
        halted,
      ]);
      signal.throwIfAborted();
      clearTimeout(timeoutId);
      metadata = { ...metadata, ...responseMetric(data) };
      updateMetric({
        ...metadata,
        durationMs: performance.now() - started,
        headersMs,
        httpStatus: response.status,
        status: response.ok ? 'completed' : 'failed',
        ...(description.service === 'OpenRouter' && metadata.generationId ? { statsStatus: 'pending' } : {}),
      });
      if (trackRequest && description.service === 'OpenRouter' && metadata.generationId)
        enrichGeneration({
          id: metadata.generationId,
          key: getApiKeys().openrouter,
          fetchImpl,
          update: updateMetric,
        });

      if (!response.ok) {
        console.error(
          `AI proxy error (${response.status}):`,
          security.redact(data, Object.values(getApiKeys())),
        );
        return { error: data, status: response.status, ...(data.code ? { code: data.code } : {}) };
      }

      return { data, status: response.status };
    } catch (err) {
      clearTimeout(timeoutId);
      updateMetric({
        ...metadata,
        durationMs: performance.now() - started,
        headersMs,
        status: backgroundSignal?.aborted ? 'cancelled' : err.name === 'AbortError' ? 'timeout' : 'failed',
        httpStatus: observedStatus || (err.name === 'AbortError' ? 504 : 503),
      });
      if (backgroundSignal?.aborted) throw backgroundSignal.reason;
      const cause = err.cause || {};
      const causeCode = typeof cause.code === 'string' ? cause.code : '';
      const causeMessage = typeof cause.message === 'string' ? cause.message : '';
      console.error('AI proxy transport error:', {
        name: err.name,
        code: causeCode || undefined,
        message: security.redact(causeMessage || err.message, Object.values(getApiKeys())),
      });
      const timedOut = err.name === 'AbortError';
      const errorMsg = timedOut
        ? streaming
          ? timeoutKind === 'total'
            ? `La respuesta de IA superó el máximo total (${Math.ceil(totalTimeoutMs / 1000)} s).`
            : `El proveedor dejó de enviar avances durante ${Math.ceil(timeoutMs / 1000)} s.`
          : `La petición de IA superó el tiempo de espera configurado (${Math.ceil(timeoutMs / 1000)} s).`
        : err.code === 'AI_STREAM_INTERRUPTED' || err.code === 'AI_PROVIDER_STREAM_ERROR'
          ? 'El proveedor interrumpió el análisis antes de completarlo. Los resultados guardados se conservan.'
          : 'No se pudo conectar con el proveedor de IA. Comprueba la conexión a Internet, VPN, firewall o proxy y vuelve a intentarlo.';
      return {
        error: errorMsg,
        status: timedOut ? 504 : err.code?.startsWith('AI_') ? 502 : 503,
        code: timedOut
          ? 'AI_REQUEST_TIMEOUT'
          : err.code?.startsWith('AI_')
            ? err.code
            : 'AI_PROVIDER_CONNECTION_FAILED',
      };
    } finally {
      clearTimeout(timeoutId);
      clearTimeout(totalTimer);
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }
  }

  return { request: proxyRequest };
}
module.exports = { createProvider };
