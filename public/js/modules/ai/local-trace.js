const POLL_MS = 1500;
const BACKOFF_MS = 6000;

const STYLE = {
  llm: 'color:#7819ff;font-weight:700',
  'llm-result': 'color:#16a34a;font-weight:700',
  image: 'color:#d97706;font-weight:700',
};

/** One entry of the local engine trace, printed as a console group the way the engine received it. */
export function printLocalTrace(entry, out = console) {
  const time = new Date(entry.at).toLocaleTimeString();
  if (entry.kind === 'llm') {
    out.group(
      `%c[Local · LLM]%c ${time} · ${entry.model}${entry.repair ? ' · reparación' : ''} · ${entry.images} imagen(es) · herramientas: ${entry.tools.join(', ') || 'ninguna'}`,
      STYLE.llm,
      '',
    );
    entry.systems.forEach((text, index) => out.log(`SYSTEM ${index + 1}/${entry.systems.length}:\n${text}`));
    entry.messages.forEach((message) =>
      out.log(
        `${message.role.toUpperCase()}${message.toolCalls ? ` (llama: ${message.toolCalls.join(', ')})` : ''}:\n${message.content}`,
      ),
    );
    out.log(`tool_choice: ${entry.toolChoice} · máx. tokens: ${entry.maxNewTokens}`);
    out.groupEnd();
  } else if (entry.kind === 'llm-result') {
    out.group(
      `%c[Local · LLM respuesta]%c ${time} · ${entry.model} · ${entry.status}`,
      STYLE['llm-result'],
      '',
    );
    if (entry.error) out.log(`ERROR DEL MOTOR:\n${entry.error}`);
    if (entry.content) out.log(`TEXTO:\n${entry.content}`);
    entry.toolCalls.forEach((call) => out.log(`LLAMADA ${call.name}:\n${call.arguments}`));
    out.groupEnd();
  } else if (entry.kind === 'image') {
    out.group(
      `%c[Local · FLUX]%c ${time} · ${entry.imageType} · ${entry.size} · ${entry.steps} pasos · ${entry.lora} · cfg ${entry.cfg} · ${entry.references} referencia(s) a ${entry.referenceMegapixels} MP`,
      STYLE.image,
      '',
    );
    out.log(
      entry.rewritten
        ? 'El LLM local reescribió el prompt antes de FLUX (promptReady = false).'
        : 'El prompt se envía a FLUX tal cual (promptReady = true).',
    );
    if (entry.rewritten) out.log(`PROMPT RECIBIDO:\n${entry.inputPrompt}`);
    out.log(`PROMPT DE FLUX:\n${entry.prompt}`);
    out.groupEnd();
  }
}

/**
 * Polls the server's trace of the local engine and prints each new prompt to the console, so what the
 * local LLM and FLUX are really asked can be followed live. Entries from before the page opened are
 * skipped; `replay()` prints the most recent ones.
 */
export function startLocalTrace({
  load,
  out = console,
  schedule = (callback, delay) => setTimeout(callback, delay),
  cancel = (handle) => clearTimeout(handle),
  visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
} = {}) {
  let cursor = null;
  let handle = null;
  let stopped = false;
  async function tick() {
    let delay = POLL_MS;
    if (visible()) {
      try {
        const result = await load(cursor ?? 0);
        if (cursor !== null) result.entries.forEach((entry) => printLocalTrace(entry, out));
        cursor = result.latest;
      } catch {
        delay = BACKOFF_MS;
      }
    }
    if (!stopped) handle = schedule(tick, delay);
  }
  tick();
  return {
    stop() {
      stopped = true;
      if (handle !== null) cancel(handle);
    },
    async replay(count = 20) {
      const { entries } = await load(0);
      entries.slice(-count).forEach((entry) => printLocalTrace(entry, out));
    },
  };
}
