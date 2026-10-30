import { API } from '../../api-service.js';
import { Modal } from '../../ui-components.js';
import { mediaAssetCode } from '../../media-selection.js';
import { characterElement as el, characterAction as action } from './character-ui.js';

/** A type-scoped catalogue; Media owns copying and adopting the selected piece. */
export function openCharacterAssetCatalog(host, section) {
  const controller = new AbortController(),
    signal = controller.signal;
  const root = el('div', 'character-asset-catalog');
  const search = el('input', 'input');
  search.type = 'search';
  search.placeholder = 'Buscar personaje o pieza…';
  search.setAttribute('aria-label', 'Buscar en biblioteca universal');
  const status = el('p', 'character-empty', 'Cargando biblioteca…');
  status.setAttribute('role', 'status');
  const grid = el('div', 'character-asset-catalog__grid');
  const more = action('Cargar más', 'chevron-down', () => void load(), 'btn btn-secondary');
  more.hidden = true;
  const items = [];
  let offset = 0,
    busy = false,
    message = '';
  function render() {
    grid.replaceChildren();
    const term = search.value.trim().toLocaleLowerCase('es');
    const visible = items.filter((item) =>
      `${item.sourceName} ${item.label}`.toLocaleLowerCase('es').includes(term),
    );
    for (const item of visible) {
      const button = el('button', 'character-asset-catalog__item');
      button.type = 'button';
      button.disabled = busy;
      button.title = `${item.label} · ${item.sourceName}`;
      button.setAttribute('aria-label', `Añadir ${item.label} de ${item.sourceName}`);
      const image = el('img');
      image.src = item.image;
      image.alt = '';
      image.loading = 'lazy';
      button.append(image, el('span', null, item.sourceName));
      button.addEventListener('click', async () => {
        if (busy || !host.current()) return;
        busy = true;
        status.textContent = 'Añadiendo pieza…';
        more.disabled = true;
        render();
        try {
          const added = await host.visualAssetAction({ type: 'import', ...item, signal });
          if (signal.aborted) return;
          if (added) {
            controller.abort();
            Modal.hide();
            return;
          }
          message = 'No se pudo añadir la pieza. Puedes reintentar.';
        } finally {
          if (!signal.aborted) {
            busy = false;
            more.disabled = false;
            render();
          }
        }
      });
      const card = el('div', 'character-asset-catalog__card');
      card.append(
        button,
        mediaAssetCode(item.code, {
          onRename: async (code, expectedCode) => {
            const changed = await host.visualAssetAction({
              type: 'rename-code',
              libraryId: item.libraryId,
              code,
              expectedCode,
            });
            if (changed) item.code = code;
            return changed;
          },
        }),
      );
      grid.append(card);
    }
    if (!busy)
      status.textContent =
        message ||
        (visible.length
          ? `${visible.length} piezas disponibles. Se copiarán al personaje actual; la foto cambia al aplicar cambios.`
          : items.length
            ? 'Sin coincidencias.'
            : 'No hay piezas de este grupo en la biblioteca universal.');
  }
  async function load() {
    more.disabled = true;
    try {
      const result = await API.listCharacterAssets(
        { projectId: host.projectId, category: section.category, kind: section.key.split('.')[1], offset },
        { signal },
      );
      if (signal.aborted || !host.current()) return;
      items.push(...result.items);
      offset = result.nextOffset;
      more.hidden = offset === null;
      more.lastChild.textContent = 'Cargar más';
      render();
    } catch (error) {
      if (!signal.aborted) {
        status.textContent = error.message || 'No se pudo cargar la biblioteca.';
        more.hidden = false;
        more.lastChild.textContent = 'Reintentar';
      }
    } finally {
      if (!signal.aborted) more.disabled = false;
    }
  }
  search.addEventListener('input', render);
  root.append(search, status, grid, more);
  Modal.show({
    title: `Biblioteca universal · ${section.label}`,
    content: root,
    initialFocus: search,
    onDismiss: () => controller.abort(),
    actions: [
      {
        label: 'Cerrar',
        class: 'btn-ghost',
        onClick: () => {
          controller.abort();
          Modal.hide();
        },
      },
    ],
  });
  void load();
  return () => {
    controller.abort();
    if (root.isConnected) Modal.hide();
  };
}
