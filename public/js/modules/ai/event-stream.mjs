/** Decode SSE frames across arbitrary network/UTF-8 boundaries. */
export async function* readSSE(body, { signal } = {}) {
  if (!body) throw new Error('La respuesta no contiene un flujo de datos.');
  signal?.throwIfAborted();
  const reader = body.getReader();
  const abort = () => {
    void reader.cancel(signal.reason).catch(() => {});
  };
  signal?.addEventListener('abort', abort, { once: true });
  const decoder = new TextDecoder();
  let buffer = '',
    data = [],
    event = 'message',
    ended = false;
  try {
    while (true) {
      signal?.throwIfAborted();
      const chunk = await reader.read();
      signal?.throwIfAborted();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      let match;
      while ((match = /[\r\n]/.exec(buffer))) {
        const index = match.index;
        if (buffer[index] === '\r' && index === buffer.length - 1 && !chunk.done) break;
        const line = buffer.slice(0, index);
        const length = buffer[index] === '\r' && buffer[index + 1] === '\n' ? 2 : 1;
        buffer = buffer.slice(index + length);
        if (!line) {
          if (data.length) yield { event, data: data.join('\n') };
          data = [];
          event = 'message';
        } else if (!line.startsWith(':')) {
          const colon = line.indexOf(':');
          const name = colon < 0 ? line : line.slice(0, colon);
          const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
          if (name === 'data') data.push(value);
          if (name === 'event') event = value || 'message';
        }
      }
      if (chunk.done) {
        ended = true;
        break;
      }
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    if (!ended) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function readChatStream(body, onDelta) {
  let text = '';
  for await (const frame of readSSE(body)) {
    const value = JSON.parse(frame.data);
    if (frame.event === 'error')
      throw Object.assign(new Error(value.error || 'La respuesta se interrumpió.'), { code: value.code });
    if (frame.event === 'delta' && typeof value.text === 'string') {
      text += value.text;
      onDelta?.(value.text);
    }
    if (frame.event === 'done') {
      if (value.text !== text) throw new Error('La respuesta en streaming llegó incompleta.');
      return value;
    }
  }
  throw Object.assign(new Error('La conexión terminó antes de completar la respuesta.'), {
    code: 'AI_STREAM_INTERRUPTED',
  });
}
