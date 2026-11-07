import { mountScreenplayInsertion } from './screenplay-insertion.js';
import { syncScreenplayRemoval } from './screenplay-removal.js';
import { screenplayProjectionNodes, arrangeScreenplayBlocks } from './screenplay-layout.js';
import {
  mountScreenplayShot,
  mountScreenplayTransition,
  placeSceneTransitions,
  SHOT_HELP,
} from './screenplay-shot-controls.js';
import {
  SCREENPLAY_SHOTS,
  SCREENPLAY_VOICES,
  screenplayShots,
  screenplayCharacter,
  screenplayId,
  screenplayHeading,
  screenplayToHTML,
} from './screenplay-document.js';
import { renderIcon } from '../../icons.js';
import { safeHTML, escapeHTML } from '../../safe-html.js';
import { AppState } from '../../app-state.js';
import { enhanceSelect } from '../../custom-select.js';
import { ingredientPortrait } from '../ingredients/ingredient-portrait.js';

const INTERIOR_HELP = {
  '': 'Sin definir todavía.',
  INT: 'Interior: la escena sucede dentro de un lugar cerrado.',
  EXT: 'Exterior: la escena sucede al aire libre.',
  'INT/EXT': 'Interior y exterior a la vez: la acción se ve desde dentro hacia fuera o cruza la puerta.',
  'EXT/INT': 'Exterior e interior a la vez: la acción empieza fuera y entra a un lugar cerrado.',
};
const TIME_HELP = {
  AMANECER: 'Los primeros momentos del día, con la luz saliendo.',
  DÍA: 'Pleno día, con luz natural completa.',
  ATARDECER: 'El final de la tarde, con luz cálida y baja.',
  NOCHE: 'Después de anochecer, con poca luz o luz artificial.',
  CONTINUO: 'Sucede justo después de la escena anterior, sin salto de tiempo.',
  'MÁS TARDE': 'Ha pasado un rato desde la escena anterior.',
};
const TIME_OF_DAY = Object.keys(TIME_HELP);
const VOICE_HELP = {
  '': 'Normal: el personaje habla en cuadro y se le ve.',
  'V.O.': 'V.O. (voz en off): voz del personaje que no está en la escena, como un narrador o un pensamiento.',
  'O.S.': 'O.S. (fuera de cuadro): el personaje está en la escena pero no se ve en el encuadre.',
  'O.C.': 'O.C. (fuera de cámara): el personaje habla desde fuera del plano, igual que O.S.',
  OFF: 'OFF: voz que se oye sin que el personaje aparezca, por ejemplo por teléfono o radio.',
  'CONT.': 'CONT. (continúa): el mismo personaje sigue hablando tras una acción que interrumpe su diálogo.',
};

/** Tooltip: what the control is for, how many options it has and what each one means. */
function describe(control, name, summary, entries = []) {
  const options = entries.filter(([, text]) => text);
  control.title =
    name +
    ': ' +
    summary +
    (options.length
      ? ` Puedes elegir entre ${options.length} opciones:\n` +
        options.map(([label, text]) => `• ${label}: ${text}`).join('\n')
      : '');
  return control;
}

/** Only projects linked as ingredients of the open screenplay can be chosen. */
export function linkedProjects(type) {
  const seen = new Set();
  return (AppState.currentProject?.ingredients || [])
    .filter((item) => item.type === type && item.importedProjectId)
    .map((item) => ({
      id: item.importedProjectId,
      name: item.importedProjectName || item.label || '',
      color1: item.color1,
      color2: item.color2,
      portrait: ingredientPortrait(item),
    }))
    .filter((item) => (seen.has(item.id) ? false : seen.add(item.id)));
}

/**
 * A round picture for the index: the initial of the name and, on top of it, the image of the linked project (the face
 * of a humanoid character, falling back to the whole picture). `item` may have no portrait: the initial stays.
 */
function portraitDisc(doc, item, label, className) {
  const disc = doc.createElement('span');
  disc.className = 'screenplay-navigation__disc ' + className;
  disc.setAttribute('role', 'img');
  disc.setAttribute('aria-label', label);
  disc.title = label;
  disc.textContent = (String(item.name || '').trim()[0] || '?').toLocaleUpperCase();
  if (item.color1 && item.color2) {
    disc.style.setProperty('--disc-color1', item.color1);
    disc.style.setProperty('--disc-color2', item.color2);
  }
  if (item.portrait) {
    const image = doc.createElement('img');
    image.alt = '';
    image.loading = 'lazy';
    image.src = item.portrait.url;
    image.addEventListener(
      'error',
      () => {
        if (image.src !== item.portrait.source && item.portrait.face) image.src = item.portrait.source;
        else image.remove();
      },
      { once: true },
    );
    disc.append(image);
  }
  return disc;
}

/** Themed select (never the browser's) that keeps typing inside it from reaching the editor. */
function themed(select, { beforeOpen, ...options } = {}) {
  const control = enhanceSelect(select, { searchable: false, ...options });
  // Ingredients can be linked while the script is open: the list is rebuilt just before it opens.
  if (beforeOpen) {
    control.root?.addEventListener('pointerdown', beforeOpen, true);
    control.root?.addEventListener(
      'keydown',
      (event) => {
        if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) beforeOpen();
      },
      true,
    );
  }
  // The link rails ask for current options before writing a value through this selector.
  if (beforeOpen) select.addEventListener('screenplay:refresh', () => beforeOpen());
  control.root?.addEventListener('keydown', (event) => event.stopPropagation());
  return control;
}

/** Releases the themed selects of nodes that are leaving the page. */
function releaseSelects(node) {
  for (const select of node.querySelectorAll('select')) enhanceSelect(select).destroy?.({ restore: false });
}

/** The coloured character tag the editor and the screenplay use for a linked character. */
function characterTag(doc, character) {
  const tag = doc.createElement('span');
  tag.className = 'kai-tag kai-character-tag';
  tag.setAttribute('spellcheck', 'false');
  tag.dataset.tag = character.name;
  tag.dataset.definition = 'character:' + character.id;
  tag.textContent = character.name;
  if (character.color1 && character.color2) {
    tag.style.setProperty('--grad-color1', character.color1);
    tag.style.setProperty('--grad-color2', character.color2);
  }
  return tag;
}

/** Scene shells own the editable body and fixed narrative sheet, never exported UI. */
export function screenplayGroups(surface) {
  const groups = [];
  for (const heading of surface.querySelectorAll('h2[data-kai-id]')) {
    const container = heading.closest('.screenplay-scene');
    const nodes = [heading];
    if (container && container.querySelector('h2') === heading) {
      nodes.push(...container.querySelector('.screenplay-scene__body').children);
    } else {
      let next = heading.nextElementSibling;
      while (next && next.tagName !== 'H2') {
        if (!next.matches('.screenplay-editor__add-scene')) nodes.push(next);
        next = next.nextElementSibling;
      }
    }
    groups.push({ id: heading.dataset.kaiId, heading, nodes, container });
  }
  return groups;
}

function screenplayCaption(heading) {
  return heading.textContent;
}

/** Inline controls change the canonical slugline; they never become script content. */
function mountSceneHeading(shell, group, scene, index, context) {
  const doc = shell.ownerDocument;
  const row = doc.createElement('div');
  row.className = 'screenplay-scene__slugline';
  row.dataset.screenplayControls = '';
  row.contentEditable = 'false';
  const number = doc.createElement('span');
  number.textContent = `ESCENA ${index + 1}:`;
  number.dataset.sceneNumber = '';
  number.contentEditable = 'false';
  number.title = 'Número de escena: se actualiza solo según el orden de las escenas.';
  const select = (label, entries, value) => {
    const control = doc.createElement('select');
    control.setAttribute('aria-label', label);
    for (const [key, text] of entries) {
      const option = doc.createElement('option');
      option.value = key;
      option.textContent = text;
      control.append(option);
    }
    control.value = value;
    return control;
  };
  const text = (label, value, placeholder) => {
    const control = doc.createElement('input');
    control.type = 'text';
    control.value = value;
    control.maxLength = 2000;
    control.setAttribute('aria-label', label);
    control.placeholder = placeholder;
    return control;
  };
  const shot = scene.heading.shot || '';
  const shots = ['', ...SCREENPLAY_SHOTS];
  if (shot && !shots.some((value) => value.toLocaleLowerCase() === shot.toLocaleLowerCase()))
    shots.push(shot);
  const shotControl = select(
    'Tipo de plano',
    shots.map((value) => [value, value || 'Tipo de plano']),
    shots.find((value) => value.toLocaleLowerCase() === shot.toLocaleLowerCase()) || '',
  );
  shotControl.dataset.sceneHeading = 'shot';
  describe(
    shotControl,
    'Tipo de plano',
    'Selecciona el tipo de plano de la escena.',
    SCREENPLAY_SHOTS.map((value) => [value, SHOT_HELP[value]]),
  );
  for (const option of shotControl.options) option.title = SHOT_HELP[option.value] || '';
  const interior = select(
    'Interior / exterior',
    ['', 'INT', 'EXT', 'INT/EXT', 'EXT/INT'].map((value) => [value, value ? value + '.' : 'INT./EXT.']),
    scene.heading.interiorExterior,
  );
  interior.dataset.sceneHeading = 'interiorExterior';
  describe(
    interior,
    'Interior / exterior',
    'Indica dónde sucede la escena.',
    ['INT', 'EXT', 'INT/EXT', 'EXT/INT'].map((value) => [value + '.', INTERIOR_HELP[value]]),
  );
  for (const option of interior.options) option.title = INTERIOR_HELP[option.value] || '';
  let stages = linkedProjects('stage');
  const normalize = (value) =>
    String(value || '')
      .trim()
      .toLocaleLowerCase();
  const linked =
    stages.find((stage) => stage.id === scene.locationId) ||
    stages.find((stage) => normalize(stage.name) === normalize(scene.heading.location));
  const stage = select(
    'Escenario',
    [['', 'Escenario'], ...stages.map((project) => [project.id, project.name]), ['custom', 'Personalizado']],
    linked?.id || (scene.heading.location ? 'custom' : ''),
  );
  stage.dataset.sceneStage = '';
  const describeStages = () =>
    describe(
      stage,
      'Escenario',
      stages.length
        ? `Elige dónde sucede la escena. Solo aparecen los ${stages.length} escenarios vinculados como ingredientes de este guión; con Personalizado escribes un nombre propio.`
        : 'Elige dónde sucede la escena. No hay escenarios vinculados: añádelos como ingredientes del guión o usa Personalizado para escribir un nombre propio.',
      [
        ...stages.map((project) => [project.name, 'Escenario vinculado al guión.']),
        ['Personalizado', 'Escribe tú el nombre del lugar.'],
      ],
    );
  describeStages();
  /** Picks up the stages linked (or unlinked) since this scene was drawn. */
  const refreshStages = () => {
    const fresh = linkedProjects('stage');
    if (
      fresh.map((item) => item.id + item.name).join('|') ===
      stages.map((item) => item.id + item.name).join('|')
    )
      return;
    stages = fresh;
    const value = stage.value;
    stage.replaceChildren(
      ...[
        ['', 'Escenario'],
        ...stages.map((project) => [project.id, project.name]),
        ['custom', 'Personalizado'],
      ].map(([key, label]) => {
        const option = doc.createElement('option');
        option.value = key;
        option.textContent = label;
        return option;
      }),
    );
    stage.value = value === 'custom' || stages.some((project) => project.id === value) ? value : '';
    describeStages();
  };
  const custom = text('Escenario personalizado', scene.heading.location, 'Nombre del escenario');
  custom.dataset.sceneHeading = 'location';
  custom.title =
    'Escenario personalizado: escribe el nombre del lugar cuando no hay un escenario vinculado que sirva.';
  custom.hidden = stage.value !== 'custom';
  const knownTime = TIME_OF_DAY.find((value) => normalize(value) === normalize(scene.heading.time));
  const timeSelect = select(
    'Momento del día',
    [['', 'Momento del día'], ...TIME_OF_DAY.map((value) => [value, value]), ['custom', 'Personalizado']],
    knownTime || (scene.heading.time ? 'custom' : ''),
  );
  describe(
    timeSelect,
    'Momento del día',
    'Indica cuándo sucede la escena; con Personalizado escribes tu propio momento.',
    [...TIME_OF_DAY.map((value) => [value, TIME_HELP[value]]), ['Personalizado', 'Escribe tú el momento.']],
  );
  for (const option of timeSelect.options) option.title = TIME_HELP[option.value] || '';
  const timeCustom = text('Momento del día personalizado', scene.heading.time, 'Momento del día');
  timeCustom.title = 'Momento del día personalizado: escribe cuándo sucede la escena, por ejemplo ANOCHECER.';
  timeCustom.hidden = timeSelect.value !== 'custom';
  const timeValue = () => (timeSelect.value === 'custom' ? timeCustom.value : timeSelect.value);
  const commit = () => {
    const current = context.screenplayDocument.scenes.find((item) => item.id === group.id);
    if (!current) return;
    const location =
      stage.value === 'custom'
        ? custom.value
        : stages.find((project) => project.id === stage.value)?.name || '';
    const heading = {
      ...current.heading,
      interiorExterior: interior.value,
      location,
      time: timeValue(),
      shot: shotControl.value,
    };
    const prefix = /^\s*ESCENA\s+\d+\s*[:.\-]/i.test(current.heading.text)
      ? `ESCENA ${[...shell.parentElement.querySelectorAll('h2[data-kai-id]')].indexOf(group.heading) + 1}: `
      : '';
    const slug = (
      [heading.interiorExterior && heading.interiorExterior + '.', location].filter(Boolean).join(' ') +
      (heading.time ? ' - ' + heading.time : '') +
      (heading.shot ? ' (' + heading.shot.toUpperCase() + ')' : '')
    ).trim();
    group.heading.textContent = prefix + slug;
    context.setScreenplayMetadata(group.id, {
      heading: { ...heading, text: prefix + slug, html: escapeHTML(prefix + slug) },
      locationId: stages.some((project) => project.id === stage.value) ? stage.value : '',
    });
  };
  for (const control of [shotControl, interior, stage, custom, timeSelect, timeCustom]) {
    control.addEventListener(control.tagName === 'SELECT' ? 'change' : 'input', (event) => {
      event.stopPropagation();
      custom.hidden = stage.value !== 'custom';
      timeCustom.hidden = timeSelect.value !== 'custom';
      commit();
    });
    control.addEventListener('keydown', (event) => event.stopPropagation());
  }
  row.append(number, shotControl, interior, stage, custom, timeSelect, timeCustom);
  shell.append(row);
  const legacyShotPicker = themed(shotControl);
  legacyShotPicker.root.hidden = scene.blocks.some((block) => block.type === 'shot');
  themed(interior);
  themed(timeSelect);
  themed(stage, { beforeOpen: refreshStages });
}

/**
 * The speaker is a themed selector listing only the characters linked to the screenplay, plus
 * "Personalizado" for a free name. The hidden name span keeps the data the document is built from.
 */
function syncCharacterControls(block) {
  const doc = block.ownerDocument;
  const name = block.querySelector('[data-screenplay-name]');
  const picker = block.querySelector('[data-character-link]');
  const custom = block.querySelector('[data-character-custom]');
  if (!name || !picker || !custom) return;
  const characters = linkedProjects('character');
  const tag = name.querySelector('[data-definition^="character:"]');
  const id = tag?.dataset.definition.slice('character:'.length) || '';
  const text = name.textContent.trim();
  // An explicitly chosen custom speaker remains editable even before typing or after clearing its name.
  const value = characters.some((item) => item.id === id)
    ? id
    : text || picker.value === 'custom'
      ? 'custom'
      : '';
  custom.hidden = value !== 'custom';
  if (value === 'custom' && custom.value !== text) custom.value = text;
  // Re-rendering must not touch the DOM when nothing changed (the surface is observed).
  const key =
    value + '|' + characters.map((item) => item.id + item.name + item.color1 + item.color2).join('|');
  if (picker.dataset.key === key) return;
  picker.dataset.key = key;
  const option = (label, optionValue) => {
    const item = doc.createElement('option');
    item.value = optionValue;
    item.textContent = label;
    return item;
  };
  picker.replaceChildren(
    option('Personaje', ''),
    ...characters.map((item) => option(item.name, item.id)),
    option('Personalizado', 'custom'),
  );
  picker.value = value;
  describe(
    picker,
    'Personaje',
    characters.length
      ? `Elige quién habla entre los ${characters.length} personajes vinculados como ingredientes de este guión, o Personalizado para escribir otro nombre.`
      : 'Elige quién habla. No hay personajes vinculados (añádelos como ingredientes del guión); con Personalizado escribes un nombre propio.',
    [
      ...characters.map((item) => [item.name, 'Personaje vinculado al guión.']),
      ['Personalizado', 'Escribe tú el nombre del personaje.'],
    ],
  );
}

function mountScreenplayCharacter(block, editable) {
  if (block.dataset.screenplayVoice !== undefined) {
    block.contentEditable = 'false';
    const name = block.querySelector('[data-screenplay-name]');
    if (name) name.contentEditable = 'false';
    syncCharacterControls(block);
    return;
  }
  const doc = block.ownerDocument;
  const parsed = screenplayCharacter(block.textContent);
  // Trim only the suffix; retain inline character tags and formatting in the name.
  if (parsed.voice) {
    const walker = doc.createTreeWalker(block, 4);
    let node,
      remaining = parsed.name.length;
    while ((node = walker.nextNode())) {
      if (remaining <= node.length) {
        const range = doc.createRange();
        range.selectNodeContents(block);
        range.setStart(node, remaining);
        range.deleteContents();
        break;
      }
      remaining -= node.length;
    }
  }
  const name = doc.createElement('span');
  name.dataset.screenplayName = '';
  // The speaker is chosen in the Personaje selector (or typed as Personalizado), never in this span.
  name.contentEditable = 'false';
  name.title = 'Nombre del personaje que habla: se elige en la lista Personaje.';
  name.setAttribute('role', 'textbox');
  name.setAttribute('aria-label', 'Nombre del personaje');
  name.dataset.placeholder = 'PERSONAJE';
  name.append(...block.childNodes);
  if (!name.textContent.trim()) name.replaceChildren(doc.createElement('br'));
  const controls = doc.createElement('span');
  controls.dataset.screenplayControls = '';
  controls.contentEditable = 'false';
  const voice = doc.createElement('select');
  voice.dataset.voiceType = '';
  voice.setAttribute('aria-label', 'Tipo de voz');
  for (const [value, label] of Object.entries(SCREENPLAY_VOICES)) {
    const option = doc.createElement('option');
    option.value = value;
    option.textContent = label;
    voice.append(option);
  }
  voice.value = parsed.voice;
  describe(
    voice,
    'Tipo de voz',
    'Indica cómo se oye al personaje.',
    Object.entries(SCREENPLAY_VOICES).map(([value, label]) => [label, VOICE_HELP[value]]),
  );
  for (const option of voice.options) option.title = VOICE_HELP[option.value] || '';
  const picker = doc.createElement('select');
  picker.dataset.characterLink = '';
  picker.setAttribute('aria-label', 'Personaje');
  const custom = doc.createElement('input');
  custom.type = 'text';
  custom.dataset.characterCustom = '';
  custom.maxLength = 200;
  custom.placeholder = 'Nombre del personaje';
  custom.setAttribute('aria-label', 'Personaje personalizado');
  custom.title = 'Personaje personalizado: escribe el nombre de quien habla cuando no está vinculado.';
  custom.hidden = true;
  const changed = () => block.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
  picker.addEventListener('change', (event) => {
    event.stopPropagation();
    const character = linkedProjects('character').find((item) => item.id === picker.value);
    if (character) name.replaceChildren(characterTag(doc, character));
    else if (picker.value === 'custom') name.textContent = custom.value || name.textContent.trim();
    else name.replaceChildren(doc.createElement('br'));
    syncCharacterControls(block);
    changed();
  });
  custom.addEventListener('input', (event) => {
    event.stopPropagation();
    name.textContent = custom.value;
    changed();
  });
  for (const control of [picker, custom, voice])
    control.addEventListener('keydown', (event) => event.stopPropagation());
  block.dataset.screenplayVoice = parsed.voice;
  block.contentEditable = 'false';
  voice.addEventListener('change', (event) => {
    event.stopPropagation();
    block.dataset.screenplayVoice = voice.value;
    changed();
  });
  controls.append(picker, custom, voice);
  block.append(name, controls);
  syncCharacterControls(block);
  // The selector shows the character as its coloured tag, inside the control itself.
  themed(picker, {
    beforeOpen: () => syncCharacterControls(block),
    label: (option) => {
      const character = linkedProjects('character').find((item) => item.id === option.value);
      return character ? characterTag(doc, character) : null;
    },
  });
  themed(voice, { allowEmpty: true });
}

/** Keep existing numbered sluglines consistent without flattening coloured/inline tags. */
function renumberSceneHeadings(surface) {
  [...surface.querySelectorAll('h2[data-kai-id]')].forEach((heading, index) => {
    const match = heading.textContent.match(/^(\s*ESCENA\s+)(\d+)(?=\s*[:.\-])/i);
    if (!match || match[2] === String(index + 1)) return;
    const walker = heading.ownerDocument.createTreeWalker(heading, 4);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    let offset = match[1].length,
      remaining = match[2].length,
      inserted = false;
    for (const text of nodes) {
      if (offset >= text.length) {
        offset -= text.length;
        continue;
      }
      const length = Math.min(remaining, text.length - offset);
      text.replaceData(offset, length, inserted ? '' : String(index + 1));
      inserted = true;
      remaining -= length;
      offset = 0;
      if (!remaining) break;
    }
  });
}

function appendScreenplayDialogue(anchor, context) {
  const doc = anchor.ownerDocument;
  const fields = ['h3', 'h4', 'blockquote'].map((tag) => {
    const field = doc.createElement(tag);
    field.dataset.kaiId = screenplayId();
    field.contentEditable = 'true';
    field.dataset.placeholder = { h4: 'Acotación', blockquote: 'Diálogo' }[tag] || '';
    field.append(doc.createElement('br'));
    return field;
  });
  anchor.before(...fields);
  mountScreenplayCharacter(fields[0], true);
  context.emitChange();
  fields[0].querySelector('.kai-select__trigger')?.focus({ preventScroll: true });
  fields[0].scrollIntoView?.({ block: 'nearest' });
}

/** Adds one complete cinematic shot; footer and index share the exact same operation. */
function appendScreenplayShot(shell, context, before = null) {
  const scene = context.screenplayDocument.scenes.find((item) => item.id === shell?.dataset.sceneId);
  const body = shell?.querySelector('.screenplay-scene__body');
  if (!scene || !body) return;
  const doc = body.ownerDocument;
  const explicit = scene.blocks.filter((block) => block.type === 'shot');
  if (!explicit.length && scene.blocks.length) {
    const initial = doc.createElement('h6');
    initial.dataset.kaiId = screenplayId();
    initial.contentEditable = 'true';
    initial.textContent = `PLANO 1 — ${scene.heading.shot || 'Plano general'}; 8 s`;
    body.prepend(initial);
  }
  const number = (explicit.length || (scene.blocks.length ? 1 : 0)) + 1;
  const heading = doc.createElement('h6');
  heading.dataset.kaiId = screenplayId();
  heading.contentEditable = 'true';
  heading.textContent = `PLANO ${number} — Plano general; 8 s`;
  const nodes = [heading];
  for (const tag of ['p', 'h3', 'h4', 'blockquote', 'h5']) {
    const field = doc.createElement(tag);
    field.dataset.kaiId = screenplayId();
    field.contentEditable = 'true';
    field.append(doc.createElement('br'));
    nodes.push(field);
  }
  if (before?.parentElement === body) before.before(...nodes);
  else body.append(...nodes);
  const action = nodes[1];
  const legacy = shell.querySelector('[data-scene-heading="shot"]')?.closest('.kai-select');
  if (legacy) legacy.hidden = true;
  context.emitChange();
  const selection = doc.defaultView.getSelection();
  const range = doc.createRange();
  action.focus?.({ preventScroll: true });
  range.selectNodeContents(action);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** One dialogue insertion action per shot, outside the persisted cinematic blocks. */
function syncShotDialogueActions(body, context) {
  const fields = screenplayProjectionNodes(body).filter((node) => node.nodeType === 1);
  const headings = fields.filter((block) => block.tagName === 'H6');
  const wanted = new Set(headings.map((block) => block.dataset.kaiId));
  const existing = [...body.querySelectorAll('.screenplay-shot__add-character')];
  for (const button of existing) if (!wanted.has(button.dataset.shotId)) button.remove();
  for (const [index, heading] of headings.entries()) {
    const end = headings[index + 1] || null;
    const container = heading.closest('.screenplay-shot') || body;
    let anchor = end?.parentElement === container ? end : null;
    for (const node of fields.slice(fields.indexOf(heading) + 1, end ? fields.indexOf(end) : undefined)) {
      if (node.tagName === 'H5') {
        anchor = node;
        break;
      }
    }
    let button = existing.find((item) => item.dataset.shotId === heading.dataset.kaiId);
    if (!button) {
      const doc = body.ownerDocument;
      button = doc.createElement('button');
      button.type = 'button';
      button.className = 'screenplay-navigation__add screenplay-shot__add-character';
      button.dataset.screenplayControls = '';
      button.dataset.shotId = heading.dataset.kaiId;
      button.contentEditable = 'false';
      button.setAttribute('aria-label', 'Añadir personaje y diálogo a este plano');
      button.title = 'Añadir otro personaje y su diálogo dentro del mismo plano.';
      button.innerHTML = safeHTML(renderIcon('plus'));
      const label = doc.createElement('span');
      label.textContent = 'Añadir diálogo';
      button.append(label);
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        appendScreenplayDialogue(button, context);
      });
    }
    if (button.parentElement !== container || button.nextElementSibling !== anchor)
      container.insertBefore(button, anchor);
  }
}

/** Index and manuscript footer create the same complete, empty cinematic scene. */
function appendScreenplayScene(surface, context, before = null) {
  const scene = {
    id: screenplayId(),
    heading: screenplayHeading(''),
    blocks: ['shot', 'action', 'character', 'parenthetical', 'dialogue', 'transition'].map((type) => ({
      id: screenplayId(),
      type,
      text: '',
      html: '',
      ...(type === 'character' ? { voice: '' } : {}),
    })),
  };
  const fragment = surface.ownerDocument.createElement('div');
  fragment.innerHTML = safeHTML(
    screenplayToHTML({ ...context.screenplayDocument, scenes: [scene], preamble: [] }),
  );
  fragment.querySelector('h1').remove();
  const footer = [...surface.children].find((node) => node.matches('.screenplay-editor__add-scene'));
  if (before?.parentElement === surface) before.before(...fragment.childNodes);
  else if (footer) footer.before(...fragment.childNodes);
  else surface.append(...fragment.childNodes);
  renumberSceneHeadings(surface);
  context.emitChange();
}

export function organizeScreenplayScenes(surface, context, editable) {
  const headings = [...surface.querySelectorAll('h2[data-kai-id]')];
  const alreadyGrouped =
    headings.every((h) => h.closest('.screenplay-scene')?.querySelector('h2') === h) &&
    surface.querySelectorAll('.screenplay-scene').length === headings.length;
  if (!alreadyGrouped) {
    const selection = surface.ownerDocument.defaultView.getSelection();
    const saved =
      selection?.rangeCount && surface.contains(selection.anchorNode)
        ? {
            anchor: selection.anchorNode,
            anchorOffset: selection.anchorOffset,
            focus: selection.focusNode,
            focusOffset: selection.focusOffset,
          }
        : null;
    for (const shell of [...surface.querySelectorAll('.screenplay-scene')]) {
      const heading = shell.querySelector('h2');
      const body = shell.querySelector('.screenplay-scene__body');
      releaseSelects(shell.querySelector('.screenplay-scene__slugline') || shell);
      shell.replaceWith(...(heading ? [heading] : []), ...(body ? screenplayProjectionNodes(body) : []));
    }
    const doc = surface.ownerDocument;
    const model = context.screenplayDocument;
    surface.contentEditable = 'false';
    for (const block of surface.children)
      block.contentEditable = block.matches('[data-screenplay-controls], h2, h3, h6')
        ? 'false'
        : String(editable);
    for (const [index, group] of screenplayGroups(surface).entries()) {
      const scene = model.scenes.find((item) => item.id === group.id);
      if (!scene) continue;
      const shell = doc.createElement('section');
      shell.className = 'screenplay-scene';
      shell.dataset.sceneId = group.id;
      shell.contentEditable = 'false';
      shell.setAttribute('aria-label', `Escena ${index + 1}`);
      group.heading.before(shell);
      shell.append(group.heading);
      group.heading.contentEditable = 'false';
      if (editable) mountSceneHeading(shell, group, scene, index, context);
      const body = doc.createElement('div');
      body.className = 'screenplay-scene__body';
      body.contentEditable = 'false';
      body.append(...group.nodes.slice(1));
      shell.append(body);
      if (editable) {
        const add = doc.createElement('button');
        add.type = 'button';
        add.className = 'screenplay-scene__add-shot';
        add.dataset.screenplayControls = '';
        add.contentEditable = 'false';
        add.setAttribute('aria-label', 'Añadir plano al final de la escena');
        add.title = 'Añadir plano con dirección, acción, personaje, acotación, diálogo y transición';
        add.innerHTML = safeHTML(renderIcon('plus'));
        const label = doc.createElement('span');
        label.textContent = 'Añadir plano';
        add.append(label);
        add.addEventListener('click', () => appendScreenplayShot(shell, context));
        shell.append(add);
      }
    }
    if (saved && surface.contains(saved.anchor) && surface.contains(saved.focus)) {
      try {
        selection.setBaseAndExtent(saved.anchor, saved.anchorOffset, saved.focus, saved.focusOffset);
      } catch {
        /* The selection was removed by an explicit edit. */
      }
    }
  }
  if (editable) {
    let footer = [...surface.children].find((node) => node.matches('.screenplay-editor__add-scene'));
    if (!footer) {
      footer = surface.ownerDocument.createElement('button');
      footer.type = 'button';
      footer.className = 'screenplay-editor__add-scene';
      footer.dataset.screenplayControls = '';
      footer.contentEditable = 'false';
      footer.textContent = 'Añadir escena';
      footer.title = 'Añadir una escena con su primer plano y campos cinematográficos vacíos.';
      footer.addEventListener('click', () => appendScreenplayScene(surface, context));
    }
    if (surface.lastElementChild !== footer) surface.append(footer);
    for (const [index, shell] of [...surface.querySelectorAll('.screenplay-scene')].entries()) {
      const label = shell.querySelector('[data-scene-number]');
      if (label && label.textContent !== `ESCENA ${index + 1}:`) label.textContent = `ESCENA ${index + 1}:`;
      shell.setAttribute('aria-label', `Escena ${index + 1}`);
    }
  }
  if (editable)
    for (const [sceneIndex, body] of [...surface.querySelectorAll('.screenplay-scene__body')].entries()) {
      const legacyPicker = body
        .closest('.screenplay-scene')
        ?.querySelector('[data-scene-heading="shot"]')
        ?.closest('.kai-select');
      if (legacyPicker) legacyPicker.hidden = Boolean(body.querySelector('h6'));
      let shotNumber = 0;
      for (const block of screenplayProjectionNodes(body).filter((node) => node.nodeType === 1)) {
        if (block.matches('[data-screenplay-controls]')) continue;
        if (block.tagName === 'H6') mountScreenplayShot(block, ++shotNumber, () => context.emitChange());
        else if (block.tagName === 'H5')
          mountScreenplayTransition(
            block,
            () => context.emitChange(),
            sceneIndex === 0 && shotNumber <= 1,
            sceneIndex > 0 && shotNumber <= 1,
          );
        else if (block.tagName === 'H3') mountScreenplayCharacter(block, editable);
        else {
          block.contentEditable = 'true';
          block.dataset.placeholder =
            {
              P: 'Acción',
              BLOCKQUOTE: 'Diálogo',
              H4: 'Acotación',
              H5: 'Transición',
              H6: 'PLANO — encuadre; movimiento; duración',
            }[block.tagName] || '';
          block.title =
            {
              H6: 'Plano: una toma continua de esta escena. Se elige su encuadre, su movimiento de cámara y su duración; el metraje los hereda.',
              P: 'Acción: describe lo que se ve y sucede en la escena, en presente.',
              BLOCKQUOTE: 'Diálogo: lo que dice el personaje indicado justo encima.',
              H4: 'Acotación: indicación breve entre paréntesis sobre cómo se dice el diálogo.',
              H5: 'Transición: cómo se une este plano al anterior en el metraje.',
            }[block.tagName] || '';
        }
      }
      syncShotDialogueActions(body, context);
      arrangeScreenplayBlocks(body);
    }
  if (editable) placeSceneTransitions(surface);
  if (editable)
    syncScreenplayRemoval(surface, {
      changed: () => {
        renumberSceneHeadings(surface);
        context.emitChange();
      },
      releaseSelects,
    });
}

export function moveScreenplayScene(surface, sourceId, targetId) {
  const groups = screenplayGroups(surface),
    from = groups.findIndex((group) => group.id === sourceId),
    to = groups.findIndex((group) => group.id === targetId);
  if (from < 0 || to < 0 || from === to) return false;
  const destination =
    from < to
      ? (groups[to].container || groups[to].nodes.at(-1)).nextSibling
      : groups[to].container || groups[to].heading;
  for (const block of groups[from].container ? [groups[from].container] : groups[from].nodes)
    surface.insertBefore(block, destination);
  return true;
}

/**
 * Moves a whole shot (its heading, action, speeches and transition) inside its scene or into another scene, before the
 * shot `beforeShotId` or last. A scene that is left without shots is removed: it cannot exist empty.
 * Returns { moved, removed }.
 */
export function moveScreenplayShot(
  surface,
  shotId,
  targetSceneId,
  beforeShotId = null,
  releaseSelects = () => {},
) {
  const shotsOf = (container) => [
    ...container.querySelectorAll(':scope > .screenplay-scene__body > .screenplay-shot'),
  ];
  const shot = [...surface.querySelectorAll('.screenplay-shot')].find(
    (item) => item.dataset.shotId === shotId,
  );
  const target = screenplayGroups(surface).find((group) => group.id === targetSceneId)?.container;
  const source = shot?.closest('.screenplay-scene');
  if (!shot || !target || !source) return { moved: false, removed: false };
  const body = target.querySelector(':scope > .screenplay-scene__body');
  const before = beforeShotId ? shotsOf(target).find((item) => item.dataset.shotId === beforeShotId) : null;
  if (beforeShotId && !before) return { moved: false, removed: false };
  const last =
    shotsOf(target)
      .filter((item) => item !== shot)
      .at(-1) || null;
  // Dropped where it already is: nothing to do.
  if (
    source === target &&
    (before
      ? before === shot.nextElementSibling || before === shot
      : last === shot.previousElementSibling && !shot.nextElementSibling)
  )
    return { moved: false, removed: false };
  if (before) body.insertBefore(shot, before);
  else if (last) last.after(shot);
  else body.append(shot);
  let removed = false;
  if (source !== target && !shotsOf(source).length) {
    releaseSelects(source);
    source.remove();
    removed = true;
  }
  return { moved: true, removed };
}

export function mountScreenplayNavigation(node, surface, context, editable) {
  const doc = surface.ownerDocument;
  const nav = doc.createElement('nav');
  nav.className = 'editor-index-container screenplay-navigation';
  nav.contentEditable = 'false';
  nav.setAttribute('aria-label', 'Índice de escenas');
  const details = doc.createElement('details');
  details.open = true;
  const summary = doc.createElement('summary');
  summary.textContent = 'Índice de escenas';
  const search = doc.createElement('input');
  search.type = 'search';
  search.placeholder = 'Buscar escena';
  search.setAttribute('aria-label', 'Buscar escena');
  search.title = 'Buscar escena: filtra el índice por el texto del encabezado de cada escena.';
  const list = doc.createElement('ol');
  list.className = 'screenplay-navigation__list';
  details.append(summary, search, list);
  nav.append(details);
  node.insertBefore(nav, surface);
  context.indexNode = nav;
  const collapsed = new Set(),
    cleanups = new Set();
  let disposed = false,
    queued = false,
    fingerprint = '';
  /**
   * A drag with the pointer inside the index, visible: the item follows the pointer as a floating copy, the place it
   * leaves is dimmed and a line shows where it will land. `locate(y)` says the slot under the pointer, `show(slot)`
   * draws the line there, `clear()` removes it and `drop(slot)` is the only thing that edits the screenplay. Escape,
   * losing the pointer or cancelling puts everything back.
   */
  const dragWithPointer = (event, grip, item, { locate, show, clear, drop }) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    event.preventDefault();
    event.stopPropagation();
    const win = doc.defaultView;
    const pointerId = event.pointerId;
    const start = { x: event.clientX, y: event.clientY };
    let ghost = null,
      started = false,
      slot = null,
      offset = { x: 0, y: 0 };
    const follow = (x, y) => {
      if (!ghost) return;
      ghost.style.left = x - offset.x + 'px';
      ghost.style.top = y - offset.y + 'px';
    };
    const begin = (x, y) => {
      started = true;
      const box = item.getBoundingClientRect();
      const scale = item.offsetWidth ? box.width / item.offsetWidth : 1;
      offset = { x: start.x - box.left, y: start.y - box.top };
      // The copy lives in the body, outside the scaled canvas, so that it is drawn at the size of the item.
      ghost = item.cloneNode(true);
      ghost.className = 'screenplay-navigation__ghost';
      ghost.classList.toggle('is-shot', item.matches('.screenplay-navigation__shot'));
      for (const key of ['sceneId', 'shotId']) delete ghost.dataset[key];
      ghost.setAttribute('aria-hidden', 'true');
      ghost.style.width = item.offsetWidth + 'px';
      ghost.style.transform = 'scale(' + scale + ')';
      doc.body.append(ghost);
      item.classList.add('is-dragging');
      list.classList.add('is-sorting');
      follow(x, y);
    };
    const place = (y) => {
      slot = locate(y);
      show(slot);
    };
    const finish = (dropIt) => {
      win.removeEventListener('pointermove', move);
      win.removeEventListener('pointerup', up, true);
      win.removeEventListener('pointercancel', cancel);
      win.removeEventListener('blur', cancel);
      win.removeEventListener('keydown', key, true);
      try {
        grip.releasePointerCapture?.(pointerId);
      } catch {
        /* A detached control has nothing to release. */
      }
      ghost?.remove();
      clear();
      item.classList.remove('is-dragging');
      list.classList.remove('is-sorting');
      if (started && dropIt && slot) drop(slot);
    };
    const move = (e) => {
      if (e.pointerId !== pointerId) return;
      e.preventDefault();
      if (!started && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 4) return;
      if (!started) begin(e.clientX, e.clientY);
      follow(e.clientX, e.clientY);
      place(e.clientY);
    };
    const up = (e) => {
      if (e.pointerId !== pointerId) return;
      e.preventDefault();
      e.stopPropagation();
      if (started) place(e.clientY);
      finish(true);
    };
    const cancel = () => finish(false);
    const key = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    };
    win.addEventListener('pointermove', move, { passive: false });
    win.addEventListener('pointerup', up, true);
    win.addEventListener('pointercancel', cancel);
    win.addEventListener('blur', cancel);
    win.addEventListener('keydown', key, true);
    try {
      grip.setPointerCapture?.(pointerId);
    } catch {
      /* A detached control cannot capture. */
    }
  };
  const boxOf = (element) => {
    const box = element.getBoundingClientRect();
    return { element, top: box.top, bottom: box.top + box.height, middle: box.top + box.height / 2 };
  };
  /** A whole scene of the index: it ends where the line was, before the row that follows it or last. */
  const beginSceneDrag = (event, grip, row, sourceId) => {
    const marker = doc.createElement('li');
    marker.className = 'screenplay-navigation__drop';
    marker.setAttribute('aria-hidden', 'true');
    // The rows are measured once, before the line shifts them.
    const rows = [...list.children]
      .filter((item) => item !== row && item.dataset.sceneId && !item.hidden)
      .map(boxOf);
    dragWithPointer(event, grip, row, {
      locate: (y) => {
        let at = rows.findIndex((item) => y < item.middle);
        if (at < 0) at = rows.length;
        return { at, before: rows[at]?.element || null };
      },
      show: (slot) => list.insertBefore(marker, slot.before),
      clear: () => marker.remove(),
      drop: (slot) => {
        const groups = screenplayGroups(surface);
        const from = groups.findIndex((group) => group.id === sourceId);
        const at = slot.before
          ? groups.findIndex((group) => group.id === slot.before.dataset.sceneId)
          : groups.length;
        const to = from < at ? at - 1 : at;
        if (from < 0 || to === from || to < 0 || to >= groups.length) return;
        if (moveScreenplayScene(surface, sourceId, groups[to].id)) {
          context.emitChange();
          render();
          refocus(sourceId, 'Arrastrar escena completa');
        }
      },
    });
  };
  /**
   * A shot of the index: inside its scene or into another one. The slots are the places between the shots of every
   * scene; the nearest one to the pointer wins. A scene left without shots is removed, as a scene cannot exist empty.
   */
  const beginShotDrag = (event, grip, item, shotId) => {
    const marker = doc.createElement('div');
    marker.className = 'screenplay-navigation__drop';
    marker.setAttribute('aria-hidden', 'true');
    const slots = [];
    for (const container of list.querySelectorAll('.screenplay-navigation__shots')) {
      const items = [...container.querySelectorAll('.screenplay-navigation__shot')].filter(
        (entry) => entry !== item,
      );
      const boxes = items.map(boxOf);
      const own = container.getBoundingClientRect();
      boxes.forEach((box) =>
        slots.push({ y: box.top, container, sceneId: container.dataset.sceneId, before: box.element }),
      );
      slots.push({
        y: boxes.length ? boxes.at(-1).bottom : own.top,
        container,
        sceneId: container.dataset.sceneId,
        before: null,
      });
    }
    dragWithPointer(event, grip, item, {
      locate: (y) =>
        slots.reduce((best, slot) => (Math.abs(slot.y - y) < Math.abs(best.y - y) ? slot : best), slots[0]),
      show: (slot) => slot && slot.container.insertBefore(marker, slot.before),
      clear: () => marker.remove(),
      drop: (slot) => {
        const result = moveScreenplayShot(
          surface,
          shotId,
          slot.sceneId,
          slot.before?.dataset.shotId ?? null,
          releaseSelects,
        );
        if (!result.moved) return;
        context.emitChange();
        render();
        refocus(shotId, 'Arrastrar plano');
      },
    });
  };
  const button = (label, icon, action) => {
    const el = doc.createElement('button');
    el.type = 'button';
    el.className = 'screenplay-navigation__control';
    el.setAttribute('aria-label', label);
    el.title = label;
    el.innerHTML = safeHTML(renderIcon(icon));
    el.addEventListener('click', action);
    return el;
  };
  const refocus = (id, label) => {
    const row = [...list.children].find((item) => item.dataset.sceneId === id);
    const control = [...(row?.querySelectorAll('button') || [])].find(
      (item) => item.getAttribute('aria-label') === label,
    );
    (control?.disabled ? row?.querySelector('[data-jump]') : control)?.focus();
  };
  const active = () => {
    const selection = doc.defaultView.getSelection();
    const current = selection?.anchorNode;
    let id = null;
    const groups = screenplayGroups(surface);
    if (current && surface.contains(current)) {
      const block = (current.nodeType === 1 ? current : current.parentElement)?.closest(
        'h2,h3,h4,h5,h6,p,blockquote',
      );
      id = groups.find((group) => group.nodes.some((node) => node === block || node.contains(block)))?.id;
    } else
      id = groups.find(
        (group) =>
          (group.container || group.heading).getBoundingClientRect().bottom >=
          surface.getBoundingClientRect().top,
      )?.id;
    for (const row of list.children) {
      const jump = row.querySelector('[data-jump]');
      if (row.dataset.sceneId === id) jump.setAttribute('aria-current', 'location');
      else jump.removeAttribute('aria-current');
    }
  };
  const filter = () => {
    for (const row of list.children)
      row.hidden = !row.dataset.label.includes(search.value.toLocaleLowerCase());
  };
  const setCollapsed = (group, value) => {
    if (value) collapsed.add(group.id);
    else collapsed.delete(group.id);
    for (const block of group.nodes.slice(1)) {
      block.hidden = value;
      block.inert = value;
    }
    fingerprint = '';
    render();
  };
  const render = () => {
    if (disposed) return;
    organizeScreenplayScenes(surface, context, editable);
    const groups = screenplayGroups(surface);
    for (const group of groups)
      for (const block of [
        ...group.nodes.slice(1),
        ...(group.container ? [...group.container.querySelectorAll('[data-scene-properties]')] : []),
      ]) {
        block.hidden = collapsed.has(group.id);
        block.inert = collapsed.has(group.id);
      }
    for (const group of groups) {
      const footer = group.container?.querySelector('.screenplay-scene__add-shot');
      if (footer) footer.hidden = collapsed.has(group.id);
    }
    const key = groups
      .map(
        (group) =>
          group.id +
          screenplayCaption(group.heading) +
          collapsed.has(group.id) +
          (group.container
            ? [...group.container.querySelectorAll('h6[data-kai-id]')]
            : group.nodes.filter((block) => block.tagName === 'H6')
          )
            .map(
              (block) =>
                block.dataset.kaiId +
                (block.querySelector('[data-screenplay-shot-text]')?.textContent || block.textContent),
            )
            .join('|'),
      )
      .join('|');
    if (key === fingerprint) {
      active();
      return;
    }
    fingerprint = key;
    const scenes = new Map(context.screenplayDocument.scenes.map((scene) => [scene.id, scene]));
    for (const group of groups) {
      const scene = scenes.get(group.id);
      for (const input of group.container?.querySelectorAll('[data-scene-heading]') || []) {
        if (doc.activeElement !== input && scene) {
          const value = scene.heading[input.dataset.sceneHeading] || '';
          input.value =
            input.tagName === 'SELECT'
              ? [...input.options].find(
                  (option) => option.value.toLocaleLowerCase() === value.toLocaleLowerCase(),
                )?.value || ''
              : value;
        }
      }
    }
    list.replaceChildren();
    const characters = linkedProjects('character');
    const stages = linkedProjects('stage');
    groups.forEach((group, index) => {
      const row = doc.createElement('li');
      row.dataset.sceneId = group.id;
      row.dataset.label = screenplayCaption(group.heading).toLocaleLowerCase();
      const jump = doc.createElement('button');
      jump.type = 'button';
      jump.dataset.jump = '';
      jump.className = 'screenplay-navigation__jump';
      jump.textContent = `${index + 1}. ${screenplayCaption(group.heading) || 'Sin encabezado'}`;
      jump.addEventListener('click', () => {
        setCollapsed(group, false);
        const surfaceRect = surface.getBoundingClientRect();
        const scale = surfaceRect.height / surface.offsetHeight || 1;
        surface.scrollTop = Math.max(
          0,
          surface.scrollTop +
            ((
              group.container?.querySelector('.screenplay-scene__slugline') || group.heading
            ).getBoundingClientRect().top -
              surfaceRect.top) /
              scale -
            surface.clientTop,
        );
        if (editable) {
          const control = group.container?.querySelector('.screenplay-scene__slugline select');
          if (control) {
            control.focus({ preventScroll: true });
            return;
          }
          surface.focus({ preventScroll: true });
          const range = doc.createRange();
          range.selectNodeContents(group.heading);
          range.collapse(true);
          const selection = doc.defaultView.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        }
      });
      const collapse = button(
        collapsed.has(group.id) ? 'Expandir escena' : 'Colapsar escena',
        collapsed.has(group.id) ? 'chevron-right' : 'chevron-down',
        () => {
          const value = !collapsed.has(group.id);
          setCollapsed(group, value);
          refocus(group.id, value ? 'Expandir escena' : 'Colapsar escena');
        },
      );
      collapse.setAttribute('aria-expanded', String(!collapsed.has(group.id)));
      row.append(collapse, jump);
      const modelScene = context.screenplayDocument.scenes.find((item) => item.id === group.id);
      const stage = modelScene?.locationId && stages.find((item) => item.id === modelScene.locationId);
      if (stage)
        row.append(
          portraitDisc(doc, stage, `Escenario: ${stage.name}`, 'screenplay-navigation__disc--stage'),
        );
      const shotLinks = doc.createElement('div');
      shotLinks.className = 'screenplay-navigation__shots';
      shotLinks.dataset.sceneId = group.id;
      for (const [shotIndex, shot] of screenplayShots(modelScene).entries()) {
        if (!shot.explicit) continue;
        const item = doc.createElement('div');
        item.className = 'screenplay-navigation__shot';
        item.dataset.shotId = shot.markerId || shot.id;
        if (editable) {
          const handle = button('Arrastrar plano', 'grip', () => {});
          handle.title = 'Arrastrar plano: colócalo en otro lugar de esta escena o en otra escena.';
          handle.addEventListener('pointerdown', (event) =>
            beginShotDrag(event, handle, item, item.dataset.shotId),
          );
          item.append(handle);
        }
        const link = button(`Ir al plano ${shotIndex + 1}`, 'video', () => {
          setCollapsed(group, false);
          const heading = [...group.container.querySelectorAll('h6')].find(
            (item) => item.dataset.kaiId === (shot.markerId || shot.id),
          );
          heading?.scrollIntoView?.({ block: 'nearest' });
        });
        link.classList.add('screenplay-navigation__shot-link');
        link.textContent = `${shotIndex + 1}. ${shot.title}`;
        item.append(link);
        // Who speaks in the shot: a round picture each, a character with a line of dialogue and no more.
        const speakers = new Map();
        for (const block of shot.blocks) {
          if (block.type !== 'dialogue' || !block.text.trim() || !block.speakerId) continue;
          const speaker = shot.blocks.find((item) => item.id === block.speakerId);
          if (!speaker || speakers.has(speaker.id)) continue;
          const name = screenplayCharacter(speaker.text).name || speaker.text;
          const linked = speaker.characterId && characters.find((item) => item.id === speaker.characterId);
          speakers.set(speaker.id, linked || { name });
        }
        if (speakers.size) {
          const faces = doc.createElement('span');
          faces.className = 'screenplay-navigation__faces';
          for (const person of speakers.values())
            faces.append(
              portraitDisc(doc, person, `Habla: ${person.name}`, 'screenplay-navigation__disc--character'),
            );
          item.append(faces);
        }
        shotLinks.append(item);
      }
      if (shotLinks.childNodes.length) row.append(shotLinks);
      if (editable) {
        const grip = button('Arrastrar escena completa', 'grip', () => {});
        grip.title = 'Arrastrar escena completa: suéltala donde quieras colocarla.';
        grip.addEventListener('pointerdown', (event) => beginSceneDrag(event, grip, row, group.id));
        row.append(grip);
      }
      list.append(row);
    });
    filter();
    active();
  };
  const preserveField = (event) => {
    if (!editable || !event.inputType?.startsWith('delete')) return;
    const selection = doc.defaultView.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    const element =
      range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    const field =
      element?.closest('[contenteditable="true"]') ||
      element?.closest('h1,p,blockquote,h4,h5,h6,[data-screenplay-name]');
    if (!field || !surface.contains(field) || field === surface || !field.contains(range.endContainer))
      return;
    if (range.toString().length < field.textContent.length) return;
    event.preventDefault();
    field.replaceChildren(doc.createElement('br'));
    const cursor = doc.createRange();
    cursor.selectNodeContents(field);
    cursor.collapse(true);
    selection.removeAllRanges();
    selection.addRange(cursor);
    context.emitChange();
  };
  const positionEmptyCaret = (event) => {
    if (!editable || event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey) return;
    const field = event.target.closest?.('[contenteditable="true"][data-placeholder]');
    if (!field || !surface.contains(field) || field.textContent !== '') return;
    event.preventDefault();
    field.focus({ preventScroll: true });
    const range = doc.createRange();
    range.selectNodeContents(field);
    range.collapse(true);
    const selection = doc.defaultView.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  };
  surface.addEventListener('pointerdown', positionEmptyCaret);
  surface.addEventListener('beforeinput', preserveField);
  search.addEventListener('input', filter);
  const observer = new doc.defaultView.MutationObserver(() => {
    if (!queued) {
      queued = true;
      queueMicrotask(() => {
        queued = false;
        render();
      });
    }
  });
  observer.observe(surface, { childList: true, subtree: true, characterData: true });
  // The scene-change buttons depend on the width of the surface (the slugline wraps): they follow it.
  const resize =
    typeof doc.defaultView.ResizeObserver === 'function'
      ? new doc.defaultView.ResizeObserver(() => placeSceneTransitions(surface))
      : null;
  resize?.observe(surface);
  doc.addEventListener('selectionchange', active);
  surface.addEventListener('scroll', active);
  render();
  const disposeInsertion = editable
    ? mountScreenplayInsertion(node, surface, (kind, _before, after) => {
        if (kind === 'scene') appendScreenplayScene(surface, context, after);
        else if (kind === 'shot') appendScreenplayShot(after.closest('.screenplay-scene'), context, after);
        else appendScreenplayDialogue(after, context);
        render();
        // Shot mounting updates the canonical numbering before the final autosave snapshot.
        context.emitChange();
      })
    : null;
  return () => {
    disposed = true;
    disposeInsertion?.();
    for (const cancel of [...cleanups]) cancel();
    releaseSelects(surface);
    observer.disconnect();
    resize?.disconnect();
    surface.removeEventListener('beforeinput', preserveField);
    surface.removeEventListener('pointerdown', positionEmptyCaret);
    doc.removeEventListener('selectionchange', active);
    surface.removeEventListener('scroll', active);
    nav.remove();
    if (context.indexNode === nav) context.indexNode = null;
  };
}
