const commandNames = ['LEER_PROYECTO', 'CREAR_PROYECTO', 'EDITAR_DOCUMENTO', 'PERSONAJE', 'ESCRIBIR_LIBRO'];

/** Keep internal commands (including partial names/JSON) out of live Markdown. */
export function parseAgentResponse(source, final = false) {
  const commands = [];
  let text = '',
    cursor = 0,
    incomplete = false;
  while (cursor < source.length) {
    const start = source.indexOf('[', cursor);
    if (start < 0) {
      text += source.slice(cursor);
      break;
    }
    text += source.slice(cursor, start);
    const tail = source.slice(start);
    const name = commandNames.find((value) => tail.startsWith('[' + value));
    if (!name) {
      if (commandNames.some((value) => ('[' + value + ':').startsWith(tail))) {
        if (!final) break;
        if (tail.length > 1) {
          incomplete = true;
          break;
        }
      }
      text += '[';
      cursor = start + 1;
      continue;
    }
    const rest = tail.slice(name.length + 1);
    const separator = /^\s*:/.exec(rest);
    if (!separator) {
      const bare = /^\s*\]/.exec(rest);
      if (bare) {
        cursor = start + name.length + 1 + bare[0].length;
        continue;
      }
      if (!rest.trim()) {
        incomplete = true;
        break;
      }
      text += '[';
      cursor = start + 1;
      continue;
    }
    const argumentStart = start + name.length + 1 + separator[0].length;
    let end = argumentStart,
      depth = 0,
      quoted = false,
      escaped = false;
    for (; end < source.length; end++) {
      const char = source[end];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"' && name !== 'LEER_PROYECTO') quoted = true;
      else if ((char === '{' || char === '[') && name !== 'LEER_PROYECTO') depth++;
      else if (char === ']' && depth === 0) break;
      else if ((char === '}' || char === ']') && name !== 'LEER_PROYECTO') depth--;
    }
    if (end === source.length) {
      incomplete = true;
      break;
    }
    commands.push({ name, argument: source.slice(argumentStart, end).trim() });
    cursor = end + 1;
  }
  return { text, commands, incomplete };
}

/** Small adaptive reveal queue: network bursts stay fluid without long delays. */
export function createReplyAnimator(render) {
  let raw = '',
    shown = '',
    timer = null,
    finished = false,
    stopped = false,
    resolve;
  const done = new Promise((complete) => {
    resolve = complete;
  });
  const tick = () => {
    timer = null;
    if (stopped) return;
    const target = parseAgentResponse(raw, finished).text;
    if (!target.startsWith(shown)) shown = '';
    const pending = Array.from(target.slice(shown.length));
    if (pending.length) {
      shown += pending.slice(0, Math.max(1, Math.ceil(pending.length / 5))).join('');
      render(shown);
    }
    if (shown !== target) timer = setTimeout(tick, 32);
    else if (finished) resolve();
  };
  const schedule = () => {
    if (timer === null && !stopped) timer = setTimeout(tick, 0);
  };
  return {
    append(delta) {
      raw += delta;
      schedule();
    },
    finish(text) {
      raw = text;
      finished = true;
      schedule();
      return done;
    },
    cancel() {
      stopped = true;
      clearTimeout(timer);
      resolve();
    },
  };
}

/** Route authoring orders before generating a conversational answer. Advice remains conversational. */
export function storyBookIntent(source) {
  const text = String(source || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  if (
    /\b(?:no|sin)\s+(?:(?:lo|la|los|las)\s+)?(?:quiero\s+que\s+)?(?:edites?|modifiques?|escribas?|reescribas?|cambies?|generes?)\b/.test(
      text,
    ) ||
    /^(?:solo\s+)?(?:analiza|explica|aconseja|opina|dime|revisa si|hazme preguntas|que opinas|como (?:puedo|podria|deberia))\b/.test(
      text,
    )
  )
    return 'chat';
  if (
    /\b(?:nuevo|otro)\s+(?:proyecto|libro)|\b(?:proyecto|libro)\s+(?:nuevo|aparte)|\b(?:crea|genera|agrega|anade)\s+(?:un[oa]?\s+)?personaje\b/.test(
      text,
    )
  )
    return 'chat';
  const act =
    /\b(?:escrib(?:e|elo|ela|ir|as)|redact(?:a|alo|ala|ar|es)|cre(?:a|alo|ala|ar|es)|haz(?:lo|la)?|modific(?:a|alo|ala|ar|as|ues)|edit(?:a|alo|ala|ar|es)|reescrib(?:e|elo|ela|ir|as)|ampli(?:a|alo|ala|ar|es)|expand(?:e|elo|ela|ir|as)|alarg(?:a|alo|ala|ar|ues)|desarroll(?:a|alo|ala|ar|es)|complet(?:a|alo|ala|ar|es)|continu(?:a|alo|ala|ar|es)|cambi(?:a|alo|ala|ar|es)|corrig(?:e|elo|ela|es)|corrijas|elimin(?:a|alo|ala|ar|es)|anad(?:e|elo|ela|ir|as)|agreg(?:a|alo|ala|ar|ues)|sigue)\b/.test(
      text,
    );
  const implied =
    /\bquiero\s+(?:(?:una?|que)\s+)?(?:historia|relato|libro|novela|reescritura|ampliacion)\b|\bhazlo\b/.test(
      text,
    );
  return act ||
    implied ||
    /\bquiero que\b[\s\S]*\b(?:mas largo|mas extensa?|mas larga|dure|duracion)\b/.test(text)
    ? 'edit'
    : 'chat';
}
