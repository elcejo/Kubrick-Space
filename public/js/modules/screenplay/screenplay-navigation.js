import {
  SCREENPLAY_SHOTS,
  SCREENPLAY_VOICES,
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
        nodes.push(next);
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
  const interior = select(
    'Interior / exterior',
    ['', 'INT', 'EXT', 'INT/EXT', 'EXT/INT'].map((value) => [value, value ? value + '.' : 'INT./EXT.']),
    scene.heading.interiorExterior,
  );
  interior.dataset.sceneHeading = 'interiorExterior';
  const stages = (AppState.projects || []).filter(
    (project) => project.type === 'stage' && !project.deletedAt && !project.trashedAt,
  );
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
  const custom = text('Escenario personalizado', scene.heading.location, 'Nombre del escenario');
  custom.dataset.sceneHeading = 'location';
  custom.hidden = stage.value !== 'custom';
  const time = text('Momento del día', scene.heading.time, 'DÍA / NOCHE');
  time.dataset.sceneHeading = 'time';
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
      time: time.value,
      shot: shotControl.value,
    };
    const prefix = /^\s*ESCENA\s+\d+\s*[:.\-]/i.test(current.heading.text) ? `ESCENA ${index + 1}: ` : '';
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
  for (const control of [shotControl, interior, stage, custom, time]) {
    control.addEventListener(control.tagName === 'SELECT' ? 'change' : 'input', (event) => {
      event.stopPropagation();
      custom.hidden = stage.value !== 'custom';
      commit();
    });
    control.addEventListener('keydown', (event) => event.stopPropagation());
  }
  row.append(number, shotControl, interior, stage, custom, time);
  shell.append(row);
}

function mountScreenplayCharacter(block, editable) {
  if (block.dataset.screenplayVoice !== undefined) {
    block.contentEditable = 'false';
    const name = block.querySelector('[data-screenplay-name]');
    if (name) name.contentEditable = String(editable);
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
  name.contentEditable = String(editable);
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
  block.dataset.screenplayVoice = parsed.voice;
  block.contentEditable = 'false';
  voice.addEventListener('change', (event) => {
    event.stopPropagation();
    block.dataset.screenplayVoice = voice.value;
    block.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
  });
  voice.addEventListener('keydown', (event) => event.stopPropagation());
  controls.append(voice);
  block.append(name, controls);
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
      shell.replaceWith(...(heading ? [heading] : []), ...(body ? [...body.childNodes] : []));
    }
    const doc = surface.ownerDocument;
    const model = context.screenplayDocument;
    surface.contentEditable = 'false';
    for (const block of surface.children) block.contentEditable = String(editable);
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
    }
    if (saved && surface.contains(saved.anchor) && surface.contains(saved.focus)) {
      try {
        selection.setBaseAndExtent(saved.anchor, saved.anchorOffset, saved.focus, saved.focusOffset);
      } catch {
        /* The selection was removed by an explicit edit. */
      }
    }
  }
  if (editable)
    for (const body of surface.querySelectorAll('.screenplay-scene__body')) {
      for (const block of body.children) {
        if (block.tagName === 'H3') mountScreenplayCharacter(block, editable);
        else {
          block.contentEditable = 'true';
          block.dataset.placeholder =
            { P: 'Acción', BLOCKQUOTE: 'Diálogo', H4: 'Acotación', H5: 'Transición' }[block.tagName] || '';
        }
      }
    }
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
  const list = doc.createElement('ol');
  list.className = 'screenplay-navigation__list';
  details.append(summary, search, list);
  nav.append(details);
  if (editable) {
    const add = doc.createElement('button');
    add.type = 'button';
    add.className = 'screenplay-navigation__add';
    add.textContent = 'Añadir escena';
    add.addEventListener('click', () => {
      const scene = {
        id: screenplayId(),
        heading: screenplayHeading(''),
        blocks: [
          { id: screenplayId(), type: 'action', text: '', html: '' },
          { id: screenplayId(), type: 'character', text: '', html: '', voice: '' },
          { id: screenplayId(), type: 'dialogue', text: '', html: '' },
        ],
      };
      const model = context.screenplayDocument;
      const fragment = doc.createElement('div');
      fragment.innerHTML = safeHTML(screenplayToHTML({ ...model, scenes: [scene], preamble: [] }));
      fragment.querySelector('h1').remove();
      surface.append(...fragment.childNodes);
      context.emitChange();
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
        'h2,h3,h4,h5,p,blockquote',
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
    const key = groups
      .map((group) => group.id + screenplayCaption(group.heading) + collapsed.has(group.id))
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
      if (editable) {
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
      element?.closest('h1,p,blockquote,h4,h5,[data-screenplay-name]');
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
  return () => {
    disposed = true;
    for (const cancel of [...cleanups]) cancel();
    observer.disconnect();
    surface.removeEventListener('beforeinput', preserveField);
    doc.removeEventListener('selectionchange', active);
    surface.removeEventListener('scroll', active);
    nav.remove();
    if (context.indexNode === nav) context.indexNode = null;
  };
}
