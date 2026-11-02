import { mountScreenplayInsertion } from './screenplay-insertion.js';
import { syncScreenplayRemoval } from './screenplay-removal.js';
import { screenplayProjectionNodes, arrangeScreenplayBlocks } from './screenplay-layout.js';
import { mountScreenplayShot, SHOT_HELP } from './screenplay-shot-controls.js';
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
import { editSceneOrigin } from './screenplay-sources.js';
import { AppState } from '../../app-state.js';
import { Toast } from '../../ui-components.js';
import { enhanceSelect } from '../../custom-select.js';
import { versionDialog } from '../ingredients/ingredient-version-dialogs.js';
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
    initial.textContent = `PLANO 1 — ${scene.heading.shot || 'Plano general'}; cámara fija; 8 s`;
    body.prepend(initial);
  }
  const number = (explicit.length || (scene.blocks.length ? 1 : 0)) + 1;
  const heading = doc.createElement('h6');
  heading.dataset.kaiId = screenplayId();
  heading.contentEditable = 'true';
  heading.textContent = `PLANO ${number} — Plano general; cámara fija; 8 s`;
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
    for (const body of surface.querySelectorAll('.screenplay-scene__body')) {
      const legacyPicker = body
        .closest('.screenplay-scene')
        ?.querySelector('[data-scene-heading="shot"]')
        ?.closest('.kai-select');
      if (legacyPicker) legacyPicker.hidden = Boolean(body.querySelector('h6'));
      let shotNumber = 0;
      for (const block of screenplayProjectionNodes(body).filter((node) => node.nodeType === 1)) {
        if (block.matches('[data-screenplay-controls]')) continue;
        if (block.tagName === 'H6') mountScreenplayShot(block, ++shotNumber, () => context.emitChange());
        else if (block.tagName === 'H3') mountScreenplayCharacter(block, editable);
        else {
          block.contentEditable = 'true';
          block.dataset.placeholder =
            {
              P: 'Acción',
              BLOCKQUOTE: 'Diálogo',
              H4: 'Acotación',
              H5: 'Transición',
              H6: 'PLANO — encuadre; ángulo; movimiento; duración',
            }[block.tagName] || '';
          block.title =
            {
              H6: 'Plano: una toma continua de esta escena. Indica encuadre, ángulo, movimiento y segundos; Enter añade su acción.',
              P: 'Acción: describe lo que se ve y sucede en la escena, en presente.',
              BLOCKQUOTE: 'Diálogo: lo que dice el personaje indicado justo encima.',
              H4: 'Acotación: indicación breve entre paréntesis sobre cómo se dice el diálogo.',
              H5: 'Transición: cómo pasa la película a la siguiente escena, por ejemplo CORTE A.',
            }[block.tagName] || '';
        }
      }
      syncShotDialogueActions(body, context);
      arrangeScreenplayBlocks(body);
    }
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
  if (editable) {
    const add = doc.createElement('button');
    add.type = 'button';
    add.className = 'screenplay-navigation__add';
    add.textContent = 'Añadir escena';
    add.title =
      'Añadir escena: crea un primer plano con acción, personaje/voz, acotación, diálogo y transición vacíos.';
    add.addEventListener('click', () => {
      appendScreenplayScene(surface, context);
      render();
    });
    nav.append(add);
  }
  node.insertBefore(nav, surface);
  context.indexNode = nav;
  const collapsed = new Set(),
    cleanups = new Set();
  let disposed = false,
    queued = false,
    dragged = null,
    fingerprint = '';
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
  const chooseLocation = async (scene) => {
    const baseline = JSON.stringify(context.screenplayDocument);
    const ingredientBaseline = JSON.stringify(AppState.currentProject?.ingredients);
    const stages = (AppState.currentProject?.ingredients || []).filter(
      (item) => item.type === 'stage' && item.importedProjectId,
    );
    const select = doc.createElement('select');
    select.setAttribute('aria-label', 'Escenario de la escena');
    for (const stage of [{ importedProjectId: '', importedProjectName: 'Sin escenario' }, ...stages]) {
      const option = doc.createElement('option');
      option.value = stage.importedProjectId;
      option.textContent = stage.importedProjectName || stage.label;
      select.append(option);
    }
    select.value = scene.locationId || '';
    const content = doc.createElement('div');
    content.append(select);
    let control;
    const pending = versionDialog({
      title: 'Escenario de la escena',
      content,
      cleanups,
      dispose: () => control?.destroy({ restore: false }),
      options: [
        { label: 'Cancelar', value: null },
        { label: 'Vincular escenario', primary: true, value: () => select.value },
      ],
    });
    control = enhanceSelect(select);
    const value = await pending;
    if (value !== null && !disposed) {
      if (
        JSON.stringify(context.screenplayDocument) !== baseline ||
        JSON.stringify(AppState.currentProject?.ingredients) !== ingredientBaseline
      )
        throw new Error('El guión o sus ingredientes cambiaron. Abre de nuevo el escenario.');
      context.setScreenplayMetadata(scene.id, { locationId: value });
    }
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
      const shotLinks = doc.createElement('div');
      shotLinks.className = 'screenplay-navigation__shots';
      const modelScene = context.screenplayDocument.scenes.find((item) => item.id === group.id);
      for (const [shotIndex, shot] of screenplayShots(modelScene).entries()) {
        if (!shot.explicit) continue;
        const link = button(`Ir al plano ${shotIndex + 1}`, 'video', () => {
          setCollapsed(group, false);
          const heading = [...group.container.querySelectorAll('h6')].find(
            (item) => item.dataset.kaiId === (shot.markerId || shot.id),
          );
          heading?.scrollIntoView?.({ block: 'nearest' });
        });
        link.textContent = `${shotIndex + 1}. ${shot.title}`;
        shotLinks.append(link);
      }
      if (shotLinks.childNodes.length) row.append(shotLinks);
      if (editable) {
        row.append(
          button('Añadir plano a esta escena', 'plus', () => {
            appendScreenplayShot(group.container, context);
            render();
          }),
        );
        for (const [delta, label, icon] of [
          [-1, 'Subir escena', 'chevron-up'],
          [1, 'Bajar escena', 'chevron-down'],
        ]) {
          const move = button(label, icon, () => {
            if (moveScreenplayScene(surface, group.id, groups[index + delta]?.id)) {
              context.emitChange();
              render();
              refocus(group.id, label);
            }
          });
          move.disabled = !groups[index + delta];
          row.append(move);
        }
        const origin = button('Vincular origen del libro', 'link', async () => {
          try {
            const scene = context.screenplayDocument.scenes.find((item) => item.id === group.id);
            const baseline = JSON.stringify(context.screenplayDocument);
            const result = await editSceneOrigin(
              scene,
              AppState.currentProject?.ingredients || [],
              cleanups,
              () => !disposed,
            );
            if (result && !disposed) {
              if (JSON.stringify(context.screenplayDocument) !== baseline)
                throw new Error('La escena cambió. Abre de nuevo su origen.');
              context.setScreenplayMetadata(group.id, {
                origins: [
                  ...(scene.origins || []).filter((origin) => origin.projectId !== result.projectId),
                  result,
                ],
              });
              Toast.show('Origen vinculado.', 'success');
            }
          } catch (error) {
            if (!disposed) Toast.show(error.message, 'error');
          }
        });
        row.append(
          origin,
          button('Vincular escenario', 'stage', () =>
            chooseLocation(context.screenplayDocument.scenes.find((item) => item.id === group.id)).catch(
              (error) => Toast.show(error.message, 'error'),
            ),
          ),
        );
        const grip = button('Arrastrar escena completa', 'grip', () => {});
        grip.draggable = true;
        grip.addEventListener('dragstart', (event) => {
          dragged = group.id;
          event.dataTransfer.setData('application/x-kubrick-space-scene', group.id);
          event.dataTransfer.effectAllowed = 'move';
        });
        grip.addEventListener('dragend', () => {
          dragged = null;
        });
        row.append(grip);
        row.addEventListener('dragover', (event) => {
          if (dragged) {
            event.preventDefault();
            event.stopPropagation();
          }
        });
        row.addEventListener('drop', (event) => {
          if (!dragged) return;
          event.preventDefault();
          event.stopPropagation();
          if (moveScreenplayScene(surface, dragged, group.id)) {
            context.emitChange();
            render();
          }
          dragged = null;
        });
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
    surface.removeEventListener('beforeinput', preserveField);
    surface.removeEventListener('pointerdown', positionEmptyCaret);
    doc.removeEventListener('selectionchange', active);
    surface.removeEventListener('scroll', active);
    nav.remove();
    if (context.indexNode === nav) context.indexNode = null;
  };
}
