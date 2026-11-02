/**
 * In-memory ring of what the local engine is asked and answers: the system prompts and messages sent
 * to the local LLM and the final prompts sent to FLUX. The browser console polls it, so a character
 * or prop that comes out wrong can be traced to the exact text that produced it. Nothing is persisted.
 */
const MAX_TEXT = 60_000;

const clip = (value) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return text.length > MAX_TEXT
    ? text.slice(0, MAX_TEXT) + `… [+${text.length - MAX_TEXT} caracteres]`
    : text;
};

function createLocalTrace({ limit = 300, now = () => new Date() } = {}) {
  const entries = [];
  let sequence = 0;
  return {
    add(entry) {
      entries.push({ seq: ++sequence, at: now().toISOString(), ...entry });
      if (entries.length > limit) entries.shift();
    },
    /** Entries after `after`; `latest` lets a client that just opened skip the history. */
    since(after = 0) {
      return { latest: sequence, entries: entries.filter((entry) => entry.seq > after) };
    },
  };
}

/** Text of a chat message as the local engine receives it; attached images are counted, never inlined. */
function describeMessages(messages) {
  return messages.map((message) => ({
    role: message.role,
    content: clip(message.content ?? ''),
    ...(message.tool_calls?.length
      ? { toolCalls: message.tool_calls.map((call) => call.function?.name).filter(Boolean) }
      : {}),
  }));
}

module.exports = { createLocalTrace, describeMessages, clip };
