/**
 * Some OpenRouter models cannot run without reasoning and answer 400 when a request turns it off
 * (effort "none", used for quick chat turns). The model is remembered and asked for a low effort
 * instead; local models and every other request are untouched.
 */
const REQUIRED = new Set();
const MANDATORY = /reasoning is mandatory/i;

const effortOf = (body) => body.reasoning?.effort ?? body.reasoning_effort;
function withEffort(options, body, effort) {
  const next = { ...body };
  if (next.reasoning) next.reasoning = { ...next.reasoning, effort };
  else next.reasoning_effort = effort;
  return { ...options, body: JSON.stringify(next) };
}
function parse(options) {
  try {
    const body = typeof options?.body === 'string' ? JSON.parse(options.body) : null;
    return body && typeof body.model === 'string' && !body.model.startsWith('local:') ? body : null;
  } catch {
    return null;
  }
}

/** Requests for a model already known to need reasoning never ask for "none". */
function prepareReasoning(options) {
  const body = parse(options);
  return body && REQUIRED.has(body.model) && effortOf(body) === 'none'
    ? withEffort(options, body, 'low')
    : options;
}

/** The same request with a low effort when the provider just refused "none"; otherwise null. */
function retryReasoning(options, failure) {
  const body = parse(options);
  const message = typeof failure === 'string' ? failure : JSON.stringify(failure ?? '');
  if (!body || effortOf(body) !== 'none' || !MANDATORY.test(message)) return null;
  REQUIRED.add(body.model);
  return withEffort(options, body, 'low');
}

module.exports = { prepareReasoning, retryReasoning };
