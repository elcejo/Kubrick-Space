import { SCREENPLAY_SHOTS } from './screenplay-document.js';
import { enhanceSelect } from '../../custom-select.js';

export const SHOT_HELP = {
  'Gran plano general': 'Muestra un paisaje o un espacio enorme; el personaje apenas se distingue.',
  'Plano general': 'Muestra todo el escenario y sitúa a los personajes dentro de él.',
  'Plano entero': 'Encuadra al personaje de cuerpo completo, de la cabeza a los pies.',
  'Plano americano': 'Corta al personaje por las rodillas o los muslos; es el plano típico de acción.',
  'Plano medio largo': 'Encuadra al personaje desde la cintura o la cadera hacia arriba.',
  'Plano medio': 'Encuadra al personaje de la cintura hacia arriba; ideal para diálogos.',
  'Primer plano': 'Encuadra el rostro y los hombros; resalta la emoción.',
  'Primerísimo primer plano': 'Encuadra solo una parte del rostro, como los ojos o la boca.',
  'Plano detalle': 'Muestra un objeto o una parte del cuerpo muy de cerca, como unas manos o una llave.',
};

/** Decode existing technical lines without discarding camera notes or custom framing names. */
export function readShotHeading(value) {
  const parts = String(value || '')
    .replace(/^\s*PLANO\s+\d+\s*(?:[—–:\-]\s*)?/i, '')
    .trim()
    .split(/\s*;\s*/)
    .filter(Boolean);
  const duration = parts.at(-1)?.match(/^(\d+(?:[.,]\d+)?)\s*(?:s|seg\.?|segundos?|seconds?)$/i);
  if (duration) parts.pop();
  return {
    type: parts.shift() || '',
    notes: parts.join('; '),
    seconds: duration
      ? Math.min(10, Math.max(1, Math.round(Number(duration[1].replace(',', '.')) * 2) / 2))
      : 8,
  };
}

/** Only the controls are interactive; the canonical technical line stays outside exported interface markup. */
export function mountScreenplayShot(block, number, changed) {
  const doc = block.ownerDocument;
  let text = block.querySelector('[data-screenplay-shot-text]');
  if (!text) {
    text = doc.createElement('span');
    text.dataset.screenplayShotText = '';
    text.hidden = true;
    text.textContent = block.textContent;
    block.replaceChildren(text);
    block.contentEditable = 'false';
    block.removeAttribute('data-placeholder');
    block.removeAttribute('title');
    const controls = doc.createElement('span');
    controls.className = 'screenplay-shot__controls';
    controls.dataset.screenplayControls = '';
    controls.contentEditable = 'false';
    const label = doc.createElement('span');
    label.className = 'screenplay-shot__number';
    label.dataset.shotLabel = '';
    label.contentEditable = 'false';
    const type = doc.createElement('select');
    type.dataset.shotType = '';
    type.setAttribute('aria-label', 'Tipo de plano');
    type.title =
      'Encuadre del plano. La numeración se actualiza automáticamente. Opciones:\n' +
      SCREENPLAY_SHOTS.map((value) => value + ': ' + SHOT_HELP[value]).join('\n');
    for (const value of ['', ...SCREENPLAY_SHOTS]) {
      const option = doc.createElement('option');
      option.value = value;
      option.textContent = value || 'Tipo de plano';
      option.title = SHOT_HELP[value] || '';
      type.append(option);
    }
    const durationLabel = doc.createElement('label');
    durationLabel.className = 'screenplay-shot__duration';
    const duration = doc.createElement('input');
    duration.type = 'number';
    duration.dataset.shotDuration = '';
    duration.min = '1';
    duration.max = '10';
    duration.step = '0.5';
    duration.inputMode = 'decimal';
    duration.setAttribute('aria-label', 'Duración del plano en segundos');
    duration.title = 'Duración: de 1 a 10 segundos, en pasos de 0,5 segundos.';
    const unit = doc.createElement('span');
    unit.textContent = 's';
    durationLabel.append(duration, unit);
    const notes = doc.createElement('input');
    notes.type = 'text';
    notes.dataset.shotDirection = '';
    notes.maxLength = 2000;
    notes.placeholder = 'Ángulo y movimiento de cámara';
    notes.setAttribute('aria-label', 'Dirección de cámara');
    notes.title = 'Dirección de cámara del plano: conserva el ángulo y movimiento existentes.';
    const commit = (event) => {
      event.stopPropagation();
      if (!duration.checkValidity() || !Number.isFinite(duration.valueAsNumber)) {
        duration.value = String(readShotHeading(text.textContent).seconds);
        return;
      }
      text.textContent =
        'PLANO ' +
        block.dataset.shotNumber +
        ' — ' +
        [type.value, notes.value.trim(), duration.valueAsNumber + ' s'].filter(Boolean).join('; ');
      changed();
    };
    type.addEventListener('change', commit);
    duration.addEventListener('change', commit);
    notes.addEventListener('input', commit);
    for (const control of [type, duration, notes]) {
      control.addEventListener('keydown', (event) => event.stopPropagation());
      control.addEventListener('input', (event) => event.stopPropagation());
    }
    controls.append(label, type, durationLabel, notes);
    block.append(controls);
    enhanceSelect(type, { searchable: false });
  }
  // Idempotent updates matter: this surface is observed, and rebuilding it would interrupt typing.
  block.dataset.shotNumber = String(number);
  const initial = readShotHeading(text.textContent);
  const canonical =
    'PLANO ' +
    number +
    ' — ' +
    [initial.type, initial.notes, initial.seconds + ' s'].filter(Boolean).join('; ');
  if (text.textContent !== canonical) text.textContent = canonical;
  const label = block.querySelector('[data-shot-label]');
  if (label.textContent !== 'Plano ' + number) label.textContent = 'Plano ' + number;
  const settings = readShotHeading(text.textContent);
  const type = block.querySelector('[data-shot-type]');
  let value = [...type.options].find(
    (option) => option.value.toLocaleLowerCase() === settings.type.toLocaleLowerCase(),
  )?.value;
  if (value === undefined) {
    const option = doc.createElement('option');
    option.value = settings.type;
    option.textContent = settings.type;
    type.append(option);
    value = settings.type;
  }
  if (type.value !== value) {
    type.value = value;
    enhanceSelect(type).refresh();
  }
  const duration = block.querySelector('[data-shot-duration]');
  if (doc.activeElement !== duration) duration.value = String(settings.seconds);
  const notes = block.querySelector('[data-shot-direction]');
  if (doc.activeElement !== notes) notes.value = settings.notes;
}
