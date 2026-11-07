import { API } from '../../api-service.js';
import { AppState } from '../../app-state.js';
import { EventBus } from '../../event-bus.js';
import { enhanceSelect } from '../../custom-select.js';
import { MAX_THINKING_STEPS, THINKING_LEVELS, thinkingSteps } from '../../contracts/assistant-reasoning.js';
import { createTaskProgress } from './task-progress.js';

/**
 * Simulated thinking for local models, which cannot reason by themselves: before the answer, a number of short steps
 * (each its own request to the server, with its own focus) whose notes then go with the final request. The level is a
 * convenience of whoever is looking at the chat, so it lives in the browser, and it only exists for a local model.
 */
const STORAGE_KEY = 'kubrick-thinking';
const DEFAULT_LEVEL = 'low';
const DEFAULT_CUSTOM = 7;
/** A greeting or a one-word answer is not worth a round of thinking. */
const MIN_MESSAGE_CHARACTERS = 12;

function readPreference() {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) || 'null');
    const known = [...THINKING_LEVELS.map((level) => level.id), 'custom'];
    return {
      level: known.includes(saved?.level) ? saved.level : DEFAULT_LEVEL,
      custom: Number.isInteger(saved?.custom)
        ? Math.max(1, Math.min(MAX_THINKING_STEPS, saved.custom))
        : DEFAULT_CUSTOM,
    };
  } catch {
    return { level: DEFAULT_LEVEL, custom: DEFAULT_CUSTOM };
  }
}
function savePreference(preference) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(preference));
  } catch {
    // The choice only lasts for this session.
  }
}
const isLocal = () => AppState.inferenceMode === 'local';

/** The level selector of the chat: {element, steps(), destroy()}. It is hidden while the model is not a local one. */
export function createThinkingControls() {
  let preference = readPreference();
  const element = document.createElement('div');
  element.className = 'chat-thinking-controls';
  const select = document.createElement('select');
  select.className = 'chat-thinking-select';
  select.setAttribute('aria-label', 'Nivel de pensamiento del modelo local');
  select.title = 'Pensamiento simulado: pasos breves antes de responder';
  for (const level of THINKING_LEVELS) select.append(new Option(level.label.split(' · ')[0], level.id));
  select.append(new Option('Personalizado', 'custom'));
  const custom = document.createElement('input');
  custom.type = 'number';
  custom.min = '1';
  custom.max = String(MAX_THINKING_STEPS);
  custom.className = 'chat-thinking-custom';
  custom.setAttribute('aria-label', 'Número de pasos de pensamiento');
  element.append(select, custom);
  // The application never shows the browser-native select.
  const picker = enhanceSelect(select, { searchable: false });
  const show = () => {
    select.value = preference.level;
    picker.refresh?.();
    custom.value = String(preference.custom);
    custom.hidden = preference.level !== 'custom';
    element.hidden = !isLocal();
  };
  select.addEventListener('change', () => {
    preference = { ...preference, level: select.value };
    savePreference(preference);
    show();
  });
  custom.addEventListener('change', () => {
    const value = Math.round(Number(custom.value));
    preference = {
      ...preference,
      custom: Math.max(1, Math.min(MAX_THINKING_STEPS, Number.isFinite(value) ? value : DEFAULT_CUSTOM)),
    };
    savePreference(preference);
    show();
  });
  const listener = ({ key }) => {
    if (['inferenceMode', 'inferenceSettings', 'currentProject'].includes(key)) show();
  };
  EventBus.on('state:change', listener);
  show();
  return {
    element,
    /** How many steps to think now: 0 for any model that is not local, and for the level "no thinking". */
    steps: () =>
      isLocal() ? thinkingSteps(preference.level === 'custom' ? preference.custom : preference.level) : 0,
    destroy: () => {
      EventBus.off('state:change', listener);
      picker.destroy?.();
    },
  };
}

/** Whether a message gets thinking: a local model, a level above zero, and something to think about. */
export const thinkingApplies = (steps, message) =>
  steps > 0 && String(message || '').trim().length >= MIN_MESSAGE_CHARACTERS;

/**
 * Thinks `steps` steps about the message of `payload` (the same request the answer will use) and shows them in the
 * conversation as a block that closes when it is done. Returns the notes written; a failure keeps what was thought
 * and says so in the block, because the answer is still worth giving.
 */
export async function runThinking({ payload, steps, signal, list, before }) {
  const block = document.createElement('details');
  block.className = 'chat-thinking';
  block.open = true;
  const summary = document.createElement('summary');
  summary.className = 'chat-thinking__summary';
  const bar = createTaskProgress();
  const notes = [];
  const items = document.createElement('ol');
  items.className = 'chat-thinking__notes';
  block.append(summary, bar.element, items);
  list.insertBefore(block, before || null);
  const show = (step, label, status = 'running') => {
    summary.textContent = label;
    bar.update({ value: (step / steps) * 100, label, status });
  };
  try {
    for (let step = 1; step <= steps; step++) {
      signal?.throwIfAborted();
      show(step - 1, `Pensando · paso ${step} de ${steps}`);
      const { note } = await API.aiThink(
        { ...payload, thinking: { step, total: steps, notes: [...notes] } },
        { signal },
      );
      notes.push(note);
      const item = document.createElement('li');
      item.textContent = note;
      items.append(item);
    }
    show(steps, `Pensamiento · ${steps} pasos`, 'completed');
    block.open = false;
  } catch (error) {
    if (signal?.aborted) {
      block.remove();
      throw error;
    }
    const label = notes.length
      ? `Pensamiento interrumpido en el paso ${notes.length + 1} de ${steps}`
      : 'No se pudo pensar antes de responder';
    show(notes.length, label, 'failed');
    const reason = document.createElement('p');
    reason.className = 'chat-thinking__error';
    const cause = String(error.message || 'Error desconocido').replace(/[.!?]*$/, '.');
    reason.textContent = `${cause} Respondo con ${notes.length ? 'lo pensado hasta aquí' : 'lo que sé'}.`;
    block.append(reason);
    if (!notes.length) block.open = true;
  }
  return notes;
}
