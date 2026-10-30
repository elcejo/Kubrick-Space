import { API } from '../../api-service.js';
import { Modal } from '../../ui-components.js';
import { AppState } from '../../app-state.js';
import { EventBus } from '../../event-bus.js';
import { renderIcon } from '../../icons.js';
import { safeHTML } from '../../safe-html.js';
import { mediaSelectionMarker, mediaAssetCode } from '../../media-selection.js';
import { characterAssetSectionName } from '../../contracts/character-visual-library.js';
import { enhanceSelect } from '../../custom-select.js';

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

/** Project-independent browser. Selection is always enabled in the library and its own recycle bin. */
export function openUniversalProps() {
  const controller = new AbortController(),
    signal = controller.signal,
    root = el('div', 'universal-props');
  const selected = new Set();
  let filterControls = [];
  let items = [],
    busy = false,
    epoch = 0,
    next = null;
  const tabs = el('div', 'universal-props__tabs'),
    filters = el('div', 'universal-props__filters'),
    tools = el('div', 'universal-props__tools'),
    grid = el('div', 'universal-props__grid'),
    status = el('p', 'universal-props__status');
  status.setAttribute('role', 'status');
  let category = '',
    kind = '',
    character = '',
    state = 'active';
  const button = (label, icon, callback, className = 'btn btn-secondary') => {
    const node = el('button', className);
    node.type = 'button';
    node.innerHTML = safeHTML(renderIcon(icon));
    node.append(document.createTextNode(label));
    node.addEventListener('click', callback);
    return node;
  };
  for (const [key, label] of [
    ['', 'Todo'],
    ['traits', 'Rasgos'],
    ['clothing', 'Ropa'],
    ['props', 'Props'],
  ]) {
    const node = button(
      label,
      key === 'traits'
        ? 'traits'
        : key === 'clothing'
          ? 'layers'
          : key === 'props'
            ? 'props'
            : 'prop-library',
      () => {
        category = key;
        kind = '';
        void load();
      },
    );
    node.dataset.category = key;
    tabs.append(node);
  }
  const select = (label, onChange) => {
    const wrap = el('label', null, label),
      node = el('select', 'select');
    node.setAttribute('aria-label', label);
    wrap.append(node);
    filters.append(wrap);
    node.addEventListener('change', () => {
      onChange(node.value);
      void load();
    });
    return node;
  };
  const groupSelect = select('Grupo', (value) => {
      if (value) {
        [category, kind] = value.split('.');
      } else kind = '';
    }),
    characterSelect = select('Personaje', (value) => (character = value));
  const switchBin = button('Papelera de biblioteca', 'trash', () => {
    state = state === 'active' ? 'trash' : 'active';
    kind = '';
    character = '';
    void load();
  });
  const count = el('span', 'universal-props__count');
  count.setAttribute('role', 'status');
  const all = button('Seleccionar visibles', 'check', () => {
    if (selected.size === items.length) selected.clear();
    else items.forEach((i) => selected.add(i.id));
    render();
  });
  const remove = button('Mover a papelera', 'trash', () => void change('trash'));
  const restore = button('Restaurar', 'refresh', () => void change('restore'));
  const purge = button('Eliminar definitivamente', 'trash', () => void change('purge'), 'btn btn-danger');
  tools.append(count, all, remove, restore, purge);
  const more = button('Cargar más', 'chevron-down', () => void load(true));
  root.append(tabs, filters, switchBin, tools, status, grid, more);
  function options(node, values, current, initial) {
    node.replaceChildren();
    for (const [value, label] of [['', initial], ...values]) {
      const option = el('option', null, label);
      option.value = value;
      node.append(option);
    }
    node.value = current;
  }
  function render() {
    count.textContent = `${selected.size} seleccionadas`;
    root.setAttribute('aria-busy', String(busy));
    for (const node of tabs.querySelectorAll('button'))
      node.setAttribute('aria-pressed', String(node.dataset.category === category));
    for (const node of root.querySelectorAll('button,select')) node.disabled = busy;
    remove.hidden = state !== 'active';
    restore.hidden = purge.hidden = state !== 'trash';
    remove.disabled = restore.disabled = purge.disabled = busy || !selected.size;
    all.disabled = busy || !items.length;
    more.hidden = next === null;
    switchBin.lastChild.textContent = state === 'active' ? 'Papelera de biblioteca' : 'Volver a biblioteca';
    grid.replaceChildren();
    for (const item of items) {
      const tile = el('article', 'universal-props__tile');
      tile.classList.toggle('is-selected', selected.has(item.id));
      const pick = el('button', 'universal-props__pick');
      pick.type = 'button';
      pick.disabled = busy;
      pick.setAttribute('aria-label', 'Seleccionar ' + item.label + ' de ' + item.sourceName);
      pick.setAttribute('aria-pressed', String(selected.has(item.id)));
      const image = el('img');
      image.src = item.image;
      image.alt = '';
      image.loading = 'lazy';
      pick.append(image);
      pick.addEventListener('click', () => {
        selected.has(item.id) ? selected.delete(item.id) : selected.add(item.id);
        render();
      });
      if (selected.has(item.id)) pick.append(mediaSelectionMarker());
      const preview = button(
        '',
        'eye',
        () => {
          const content = el('img', 'universal-props__preview');
          content.src = item.image;
          content.alt = item.label;
          Modal.show({ title: item.label, content, preserveCurrent: true });
        },
        'universal-props__preview-button',
      );
      preview.setAttribute('aria-label', 'Vista previa de ' + item.label);
      preview.title = 'Vista previa';
      const media = el('div', 'universal-props__media');
      media.append(pick, preview);
      if (state === 'active') {
        const trash = button(
          '',
          'trash',
          () => void change('trash', [item.id]),
          'universal-props__preview-button universal-props__trash-button',
        );
        trash.setAttribute('aria-label', 'Mover ' + item.label + ' a papelera de biblioteca');
        trash.title = 'Mover a papelera';
        trash.disabled = busy;
        media.append(trash);
      }
      tile.append(
        media,
        mediaAssetCode(item.code, {
          onRename: async (code, expectedCode) => {
            const result = await API.renamePropCode({ libraryId: item.id, code, expectedCode }, { signal });
            await refreshCurrent();
            item.code = result.code;
            return result;
          },
        }),
        el('strong', null, characterAssetSectionName(item)),
        el('small', null, item.sourceName),
      );
      grid.append(tile);
    }
  }
  async function load(append = false) {
    const token = ++epoch;
    busy = true;
    status.textContent = 'Cargando biblioteca…';
    if (!append) {
      selected.clear();
      items = [];
    }
    render();
    try {
      const result = await API.universalProps(
        {
          state,
          ...(category ? { category } : {}),
          ...(kind ? { kind } : {}),
          ...(character ? { character } : {}),
          offset: String(append ? next || 0 : 0),
        },
        { signal },
      );
      if (signal.aborted || token !== epoch) return;
      items.push(...result.items);
      next = result.nextOffset;
      filterControls.forEach((control) => control.destroy());
      options(
        groupSelect,
        result.groups.map((g) => [
          g.category + '.' + g.kind,
          characterAssetSectionName({ ...g, label: g.kind, fieldKeys: [] }),
        ]),
        kind ? category + '.' + kind : '',
        'Todos los grupos',
      );
      options(
        characterSelect,
        result.characters.map((c) => [c.id, c.name]),
        character,
        'Todos los personajes',
      );
      filterControls = [
        enhanceSelect(groupSelect, { searchable: true, allowEmpty: true }),
        enhanceSelect(characterSelect, { searchable: true, allowEmpty: true }),
      ];
      status.textContent = result.total
        ? `${result.total} piezas · ${state === 'trash' ? 'Papelera independiente de los personajes' : 'La selección no modifica al personaje'}`
        : 'No hay piezas en esta vista.';
    } catch (error) {
      if (!signal.aborted) {
        status.textContent = error.message || 'No se pudo cargar la biblioteca.';
        next = null;
      }
    } finally {
      if (!signal.aborted && token === epoch) {
        busy = false;
        render();
      }
    }
  }
  async function refreshCurrent() {
    const id = AppState.currentProject?.id;
    if (id) {
      const [project, draft] = await Promise.all([API.getProject(id), API.getProjectDraft(id)]);
      if (AppState.currentProject?.id === id) {
        AppState.currentProject.characterVisualLibrary = (draft?.payload || project).characterVisualLibrary;
        EventBus.emit('editor:change');
      }
    }
  }
  async function change(action, singleIds) {
    if (busy || (!singleIds && !selected.size)) return;
    const ids = singleIds || [...selected];
    if (
      action === 'purge' &&
      !(await Modal.confirm({
        title: 'Eliminar piezas de biblioteca',
        message: `Se eliminarán definitivamente ${ids.length} piezas de la biblioteca universal. Las fotos de personaje se conservan; las referencias retiradas podrán regenerarse desde el retrato.`,
        confirmLabel: 'Eliminar definitivamente',
        type: 'danger',
        preserveCurrent: true,
        signal,
      }))
    )
      return;
    if (signal.aborted) return;
    busy = true;
    render();
    try {
      await EventBus.emitAsync?.('autosave:flush');
      await API.changeUniversalProps(action, ids, action === 'purge', { signal });
      await refreshCurrent();
      if (!signal.aborted) await load();
    } catch (error) {
      if (!signal.aborted) status.textContent = error.message || 'No se pudo actualizar la biblioteca.';
    } finally {
      if (!signal.aborted) {
        busy = false;
        render();
      }
    }
  }
  const dispose = () => {
    controller.abort();
    filterControls.forEach((control) => control.destroy());
  };
  const dialog = Modal.show({
    title: 'Biblioteca universal',
    content: root,
    onDismiss: dispose,
  });
  dialog.classList.add('modal-content--universal-props');
  void load();
  return () => {
    dispose();
    if (root.isConnected) Modal.hide();
  };
}
