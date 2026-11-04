'use strict';
const { createProvider } = require('./provider.cjs');

/**
 * One JSON answer from a model for a background job. When the job gives a schema and the model advertises
 * structured outputs, the provider is asked to write inside it; the caller still validates what comes back.
 */
/** The sentence a provider gave for refusing a request (its error is an object, never to be shown as one). */
const providerReason = (error) => {
  if (typeof error === 'string') return error;
  const detail = error?.error || error;
  const message = detail?.message;
  // OpenRouter often says only "Provider returned error" and keeps the real reason in the metadata.
  const raw = detail?.metadata?.raw;
  const why = [
    detail?.metadata?.provider_name,
    raw && String(typeof raw === 'string' ? raw : JSON.stringify(raw)).slice(0, 300),
  ]
    .filter(Boolean)
    .join(': ');
  return message && why ? message + ' (' + why + ')' : message || undefined;
};

function createBookInfer(dependencies) {
  return async (input, ctx) => {
    // Background stages are short JSON edits: a model that reasons is asked for little, since reasoning tokens count
    // against the same limit and a long deliberation used to leave no answer.
    const info =
      !String(input.model).startsWith('local:') && dependencies.openrouterModels?.findModel(input.model);
    const reasoningParameter = info?.supportedParameters?.includes('reasoning_effort')
      ? 'reasoning_effort'
      : info?.supportedParameters?.includes('reasoning')
        ? 'reasoning'
        : null;
    const effortOf = (effort) =>
      !reasoningParameter
        ? {}
        : reasoningParameter === 'reasoning'
          ? { reasoning: { effort } }
          : { reasoning_effort: effort };
    const send = (format, effort = 'low') =>
      createProvider({
        ...dependencies,
        backgroundSignal: ctx.signal,
        trackRequest: ctx.trackRequest,
      }).request(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + (dependencies.getApiKeys().openrouter || 'local'),
          },
          body: JSON.stringify({
            model: input.model,
            messages: input.messages,
            max_completion_tokens: input.maxTokens,
            response_format: format,
            temperature: 0.5,
            ...effortOf(effort),
          }),
        },
        300000,
        { omitBody: true },
      );
    // A model that advertises structured outputs is asked to write inside the schema of the format. The server's
    // own validation stays the guarantee; if the provider refuses the schema the request is made as plain JSON.
    const structured =
      input.schema &&
      !String(input.model).startsWith('local:') &&
      dependencies.openrouterModels
        ?.findModel(input.model)
        ?.supportedParameters?.includes('structured_outputs');
    const format = structured
      ? {
          type: 'json_schema',
          json_schema: {
            name: input.schemaName || 'kubrick_operations',
            strict: false,
            schema: input.schema,
          },
        }
      : { type: 'json_object' };
    let result = await send(format);
    if (structured && result.status === 400) result = await send({ type: 'json_object' });
    // The whole budget went on reasoning: once more with the least reasoning the model admits.
    if (reasoningParameter && result.data?.choices?.[0]?.finish_reason === 'length') {
      const again = await send(
        result.status === 200 && structured ? format : { type: 'json_object' },
        'minimal',
      );
      if (again.status < 400 && again.data?.choices?.[0]?.message?.content) result = again;
    }
    if (
      result.status >= 400 ||
      !result.data?.choices?.[0]?.message?.content ||
      result.data.choices[0].finish_reason === 'length'
    )
      throw dependencies.security.fail(
        providerReason(result.error) ||
          (result.data?.choices?.[0]?.finish_reason === 'length'
            ? `El modelo agotó su presupuesto de razonamiento en la etapa ${input.stage || 'del libro'} antes de responder. Lo guardado se conserva; reintenta o elige un modelo con menos razonamiento.`
            : `El modelo no completó la etapa ${input.stage || 'del libro'}.`),
        result.status || 502,
      );
    try {
      return JSON.parse(result.data.choices[0].message.content);
    } catch {
      throw Object.assign(
        dependencies.security.fail('El modelo devolvió una etapa inválida. Lo guardado se conserva.', 502),
        { code: 'MODEL_JSON_INVALID' },
      );
    }
  };
}
module.exports = { createBookInfer };
