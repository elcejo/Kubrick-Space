/** Assemble private tool-call deltas; never publish partial arguments or reasoning. */
async function readCompletionStream(body, { signal, activity, metadata }) {
  const { readSSE } = await import('../../../public/js/modules/ai/event-stream.mjs');
  const data = { choices: [] },
    calls = new Map();
  let content = '',
    refusal = '',
    finishReason = null,
    complete = false,
    bytes = 0;
  for await (const frame of readSSE(body, { signal })) {
    if (frame.data === '[DONE]') {
      complete = true;
      break;
    }
    bytes += frame.data.length;
    const invalid = () =>
      Object.assign(Error('La respuesta en streaming no está completa.'), { code: 'AI_STREAM_INTERRUPTED' });
    if (bytes > 16 * 1024 * 1024) throw invalid();
    let chunk;
    try {
      chunk = JSON.parse(frame.data);
    } catch {
      throw invalid();
    }
    if (
      !chunk ||
      typeof chunk !== 'object' ||
      Array.isArray(chunk) ||
      (chunk.choices !== undefined && !Array.isArray(chunk.choices))
    )
      throw invalid();
    for (const field of ['id', 'model', 'provider', 'provider_name', 'usage'])
      if (chunk[field] !== undefined) data[field] = chunk[field];
    metadata(data);
    if (chunk.error)
      throw Object.assign(Error('El proveedor interrumpió la respuesta.'), {
        code: 'AI_PROVIDER_STREAM_ERROR',
      });
    const choice = chunk.choices?.find((item) => (item.index || 0) === 0);
    if (!choice) continue;
    if (choice.finish_reason) finishReason = choice.finish_reason;
    const delta = choice.delta || {};
    if (
      (delta.tool_calls !== undefined && !Array.isArray(delta.tool_calls)) ||
      (delta.reasoning_details !== undefined && !Array.isArray(delta.reasoning_details))
    )
      throw invalid();
    const progressing =
      [delta.content, delta.refusal, delta.reasoning, delta.reasoning_content].some(
        (value) => typeof value === 'string' && value.length,
      ) ||
      delta.reasoning_details?.some((item) =>
        ['text', 'summary', 'data'].some((key) => typeof item[key] === 'string' && item[key].length),
      ) ||
      delta.tool_calls?.some((item) =>
        ['arguments', 'name'].some(
          (key) => typeof item.function?.[key] === 'string' && item.function[key].length,
        ),
      );
    if (progressing) activity();
    if (typeof delta.content === 'string') content += delta.content;
    if (typeof delta.refusal === 'string') refusal += delta.refusal;
    for (const part of delta.tool_calls || []) {
      if (!Number.isSafeInteger(part.index) || part.index < 0 || part.index > 63) throw invalid();
      if (!calls.has(part.index))
        calls.set(part.index, { type: 'function', function: { name: '', arguments: '' } });
      const call = calls.get(part.index);
      if (part.id) call.id = part.id;
      if (typeof part.function?.name === 'string') call.function.name += part.function.name;
      if (typeof part.function?.arguments === 'string') call.function.arguments += part.function.arguments;
    }
  }
  if (!complete || !finishReason || finishReason === 'error')
    throw Object.assign(Error('La conexión terminó antes de completar la respuesta.'), {
      code: 'AI_STREAM_INTERRUPTED',
    });
  const message = { role: 'assistant', content: content || null };
  if (refusal) message.refusal = refusal;
  if (calls.size)
    message.tool_calls = [...calls.entries()].sort(([a], [b]) => a - b).map(([, value]) => value);
  data.choices = [{ index: 0, finish_reason: finishReason, message }];
  return data;
}
module.exports = { readCompletionStream };
