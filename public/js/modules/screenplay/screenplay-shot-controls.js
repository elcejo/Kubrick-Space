import {
  SCREENPLAY_SHOTS,
  SCREENPLAY_SHOT_SECONDS,
  snapShotSeconds,
  shotSecondsLabel,
} from './screenplay-document.js';
import { enhanceSelect } from '../../custom-select.js';
import { renderIcon } from '../../icons.js';
import { safeHTML } from '../../safe-html.js';
import { FILM_MOVEMENTS, filmMovementFromNote } from '../../contracts/film-movements.js';
import { FILM_TRANSITIONS, filmTransitionFromNote } from '../../contracts/film-transitions.js';

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
    // A duration is a clip H3 can generate (17k + 5 frames); anything written before that rule snaps to the nearest.
    seconds: duration ? snapShotSeconds(Number(duration[1].replace(',', '.'))) : 8,
  };
}

/**
 * Puts the transition button of the first shot of a scene in the gap above its scene, at the right, where the two scenes
 * meet. The button lives in its shot, so it is lifted by the distance from the shot to the top edge of the scene.
 */
export function placeSceneTransition(block) {
  const shot = block.closest('.screenplay-shot');
  const scene = block.closest('.screenplay-scene');
  if (!shot || !scene) return;
  const win = block.ownerDocument.defaultView;
  const style = win.getComputedStyle(scene);
  const border = parseFloat(style.borderTopWidth) || 0;
  // From the shot up to the top edge of the scene, and from the right edge of the shot to the right edge of the scene.
  let top = 0,
    left = 0;
  for (let node = shot; node && node !== scene; node = node.offsetParent) {
    top += node.offsetTop;
    left += node.offsetLeft;
  }
  const insetRight = Math.max(0, scene.clientWidth - (left + shot.offsetWidth));
  // The gap between the two scenes, measured: the button is centred in it.
  const previous = scene.previousElementSibling;
  const box = scene.getBoundingClientRect();
  const scale = scene.offsetWidth ? box.width / scene.offsetWidth : 1;
  const measured = previous ? (box.top - previous.getBoundingClientRect().bottom) / scale : 0;
  const gap = measured > 0 ? measured : parseFloat(style.marginTop) || 24;
  block.style.top = -(top + border + gap / 2 + 19) + 'px';
  block.style.right = 30 - insetRight - border + 'px';
}

/** Puts every scene-change button in place again (the layout changed without the document changing). */
export function placeSceneTransitions(surface) {
  for (const block of surface.querySelectorAll('h5[data-transition-kind="scene"]:not([hidden])'))
    placeSceneTransition(block);
}

/**
 * The transition of a shot, as a list of the four ways the film joins a clip to the previous one (Auto is no note).
 * The text of the block keeps the name chosen; a note of an older screenplay that names none stays as its own entry.
 * The first shot of the screenplay joins no previous shot, so it has no transition: its field is not shown and stays empty.
 */
export function mountScreenplayTransition(block, changed, first = false, sceneChange = false) {
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
    controls.className = 'screenplay-transition__controls';
    controls.dataset.screenplayControls = '';
    controls.contentEditable = 'false';
    const select = doc.createElement('select');
    select.dataset.shotTransition = '';
    select.setAttribute('aria-label', 'Transición');
    select.title =
      'Transición del plano: cómo se une al anterior. El metraje la hereda al vincular o actualizar el guión; Auto deja que la elija el sistema.';
    const none = doc.createElement('option');
    none.value = '';
    none.textContent = 'Auto (decide el sistema)';
    select.append(none);
    for (const item of FILM_TRANSITIONS) {
      const option = doc.createElement('option');
      option.value = item.name;
      option.textContent = item.name;
      option.title = item.hint;
      select.append(option);
    }
    select.addEventListener('change', (event) => {
      event.stopPropagation();
      text.textContent = select.value;
      changed();
    });
    for (const event of ['keydown', 'input']) select.addEventListener(event, (e) => e.stopPropagation());
    controls.append(select);
    block.append(controls);
    // The control is a round button between this shot and the one it follows; the list opens from it.
    const control = enhanceSelect(select, { searchable: false, allowEmpty: true });
    const trigger = control.root?.querySelector('.kai-select__trigger');
    if (trigger) {
      trigger.classList.add('screenplay-transition__button');
      const icon = doc.createElement('span');
      icon.className = 'screenplay-transition__icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = safeHTML(renderIcon('transition-down', 22));
      trigger.append(icon);
    }
  }
  const select = block.querySelector('[data-shot-transition]');
  block.hidden = first;
  // The first shot of a scene joins the previous scene: its button is orange and sits between the two scenes.
  block.dataset.transitionKind = sceneChange ? 'scene' : 'shot';
  if (sceneChange) placeSceneTransition(block);
  else {
    block.style.removeProperty('top');
    block.style.removeProperty('right');
  }
  if (first && text.textContent) text.textContent = '';
  const named = filmTransitionFromNote(text.textContent);
  const note = text.textContent.trim();
  let value = named === 'auto' ? '' : FILM_TRANSITIONS.find((item) => item.id === named).name;
  if (named === 'auto' && note) {
    value = note;
    if (![...select.options].some((option) => option.value === note)) {
      const option = doc.createElement('option');
      option.value = note;
      option.textContent = note;
      select.append(option);
    }
  }
  if (select.value !== value) {
    select.value = value;
    enhanceSelect(select).refresh();
  }
  // The button shows no text, so its name and tooltip say which transition is chosen.
  const trigger = block.querySelector('.screenplay-transition__button');
  if (trigger) {
    const label =
      (sceneChange ? 'Transición con la escena anterior: ' : 'Transición con el plano anterior: ') +
      (value || 'Auto');
    trigger.dataset.kind = sceneChange ? 'scene' : 'shot';
    trigger.title = label;
    trigger.setAttribute('aria-label', label);
    trigger.dataset.chosen = value ? 'true' : 'false';
  }
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
    const duration = doc.createElement('select');
    duration.dataset.shotDuration = '';
    duration.setAttribute('aria-label', 'Duración del plano');
    duration.title =
      'Duración del plano: la de un clip que H3 puede generar (17k + 5 fotogramas a 24 por segundo), de 5,17 a 14,38 segundos.';
    for (const seconds of SCREENPLAY_SHOT_SECONDS) {
      const option = doc.createElement('option');
      option.value = String(seconds);
      option.textContent = shotSecondsLabel(seconds);
      duration.append(option);
    }
    durationLabel.append(duration);
    // The camera movement is chosen from the list of the film; the shot line keeps its name (Auto is no note).
    const notes = doc.createElement('select');
    notes.dataset.shotDirection = '';
    notes.setAttribute('aria-label', 'Movimiento de cámara');
    notes.title =
      'Movimiento de cámara del plano. El metraje lo hereda al vincular o actualizar el guión; Auto deja que lo elija el modelo.';
    for (const move of FILM_MOVEMENTS) {
      const option = doc.createElement('option');
      option.value = move.id === 'auto' ? '' : move.name;
      option.textContent = move.id === 'auto' ? 'Auto (lo elige el modelo)' : move.name;
      option.dataset.icon = move.icon;
      option.title = move.hint;
      notes.append(option);
    }
    const commit = (event) => {
      event.stopPropagation();
      text.textContent =
        'PLANO ' +
        block.dataset.shotNumber +
        ' — ' +
        [type.value, notes.value.trim(), duration.value + ' s'].filter(Boolean).join('; ');
      changed();
    };
    type.addEventListener('change', commit);
    duration.addEventListener('change', commit);
    notes.addEventListener('change', commit);
    for (const control of [type, duration, notes]) {
      control.addEventListener('keydown', (event) => event.stopPropagation());
      control.addEventListener('input', (event) => event.stopPropagation());
    }
    controls.append(label, type, notes, durationLabel);
    block.append(controls);
    enhanceSelect(type, { searchable: false });
    enhanceSelect(duration, { searchable: false });
    enhanceSelect(notes, {
      searchable: true,
      allowEmpty: true,
      label: (option) => {
        if (!option?.dataset.icon) return null;
        const row = doc.createElement('span');
        row.className = 'screenplay-shot__move';
        const icon = doc.createElement('span');
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML = safeHTML(renderIcon(option.dataset.icon, 18));
        const name = doc.createElement('span');
        name.textContent = option.textContent;
        row.append(icon, name);
        return row;
      },
    });
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
  if (duration.value !== String(settings.seconds)) {
    duration.value = String(settings.seconds);
    enhanceSelect(duration).refresh();
  }
  // A note that names a movement selects it; any other text of an older screenplay stays as its own entry.
  const notes = block.querySelector('[data-shot-direction]');
  const named = filmMovementFromNote(settings.notes);
  let note = named === 'auto' ? '' : FILM_MOVEMENTS.find((move) => move.id === named).name;
  if (named === 'auto' && settings.notes) {
    note = settings.notes;
    if (![...notes.options].some((option) => option.value === note)) {
      const option = doc.createElement('option');
      option.value = note;
      option.textContent = note;
      notes.append(option);
    }
  }
  if (notes.value !== note) {
    notes.value = note;
    enhanceSelect(notes).refresh();
  }
}
