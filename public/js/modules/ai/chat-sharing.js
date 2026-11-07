import { API } from '../../api-service.js';
import { Modal } from '../../ui-components.js';

/** Share one saved history by reference. Folder membership is resolved by the server on every read. */
export async function shareSavedChat(projectId, chat, alive = () => true, signal) {
  const [library, assets] = await Promise.all([API.getLibrarySpace(), API.getProjects()]);
  if (!alive() || signal?.aborted) return null;
  const assetIds = new Set(chat.sharing?.assetIds || []),
    folderIds = new Set(chat.sharing?.folderIds || []);
  const content = document.createElement('div');
  content.className = 'chat-sharing';
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'chat-sharing__search';
  search.placeholder = 'Buscar assets o proyectos…';
  search.setAttribute('aria-label', 'Buscar dónde compartir el chat');
  const summary = document.createElement('p');
  summary.className = 'chat-sharing__summary';
  summary.setAttribute('role', 'status');
  const lists = document.createElement('div');
  lists.className = 'chat-sharing__groups';
  const allAssets = assets.projects || [],
    ownerId = chat.ownerProjectId || projectId;
  const updateSummary = () => {
    const selected = new Set(assetIds);
    for (const folder of library.folders || [])
      if (folderIds.has(folder.id)) for (const id of folder.assetIds) selected.add(id);
    selected.add(ownerId);
    summary.textContent = `Un historial · ${selected.size} ${selected.size === 1 ? 'asset' : 'assets'}`;
  };
  function group(title, items, selected, kind) {
    const section = document.createElement('section'),
      heading = document.createElement('h3'),
      list = document.createElement('div');
    heading.textContent = title;
    list.className = 'chat-sharing__list';
    for (const item of items) {
      const label = document.createElement('label'),
        checkbox = document.createElement('input'),
        copy = document.createElement('span'),
        name = document.createElement('b'),
        hint = document.createElement('small');
      label.className = 'chat-sharing__option';
      label.dataset.search = item.name.toLocaleLowerCase('es');
      checkbox.type = 'checkbox';
      checkbox.checked = selected.has(item.id) || (kind === 'asset' && item.id === ownerId);
      checkbox.disabled = kind === 'asset' && item.id === ownerId;
      checkbox.dataset.shareKind = kind;
      checkbox.dataset.shareId = item.id;
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) selected.add(item.id);
        else selected.delete(item.id);
        updateSummary();
      });
      name.textContent = item.name;
      hint.textContent =
        kind === 'folder'
          ? `Todos sus assets · ${item.assetIds.length}`
          : item.id === ownerId
            ? 'Origen'
            : {
                'story-book': 'Story Book',
                screenplay: 'Guión',
                character: 'Personaje',
                stage: 'Escenario',
                video: 'Video',
                song: 'Música',
                film: 'Largometraje',
              }[item.category] ||
              { book: 'Libro', character: 'Personaje', stage: 'Escenario', video: 'Video', song: 'Música' }[
                item.type
              ] ||
              'Asset';
      copy.append(name, hint);
      label.append(checkbox, copy);
      list.append(label);
    }
    if (!items.length) {
      const empty = document.createElement('p');
      empty.textContent = 'Sin proyectos de assets.';
      list.append(empty);
    }
    section.append(heading, list);
    lists.append(section);
  }
  group(
    'Assets',
    allAssets.filter((asset) => !asset.deletedAt),
    assetIds,
    'asset',
  );
  group('Proyectos', library.folders || [], folderIds, 'folder');
  search.addEventListener('input', () => {
    const term = search.value.trim().toLocaleLowerCase('es');
    for (const row of lists.querySelectorAll('[data-search]'))
      row.hidden = !row.dataset.search.includes(term);
  });
  const error = document.createElement('p');
  error.className = 'chat-sharing__error';
  error.setAttribute('role', 'alert');
  error.hidden = true;
  content.append(search, summary, lists, error);
  updateSummary();
  return new Promise((resolve) => {
    let saving = false;
    const abort = () => close(null);
    const close = (value) => {
      signal?.removeEventListener('abort', abort);
      resolve(value);
      if (dialog.isConnected) Modal.hide();
    };
    const dialog = Modal.show({
      title: 'Compartir chat',
      content,
      onDismiss: () => {
        signal?.removeEventListener('abort', abort);
        resolve(null);
      },
      actions: [
        {
          label: 'Cancelar',
          class: 'btn-secondary',
          onClick: () => {
            if (!saving) close(null);
          },
        },
        {
          label: 'Guardar',
          class: 'btn-primary',
          onClick: async () => {
            if (saving || !alive()) return;
            saving = true;
            const controls = [...dialog.querySelectorAll('button, input')];
            const previous = controls.map((control) => control.disabled);
            controls.forEach((control) => {
              control.disabled = true;
            });
            try {
              const saved = await API.shareChat(projectId, chat.id, {
                revision: chat.revision,
                assetIds: [...assetIds],
                folderIds: [...folderIds],
              });
              close(saved);
            } catch (failure) {
              error.textContent = failure.message;
              error.hidden = false;
            } finally {
              saving = false;
              controls.forEach((control, index) => {
                control.disabled = previous[index];
              });
            }
          },
        },
      ],
    });
    dialog.classList.add('chat-sharing-dialog');
    signal?.addEventListener('abort', abort, { once: true });
  });
}
