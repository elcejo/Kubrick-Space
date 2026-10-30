import { renderIcon } from './icons.js';
import { safeHTML } from './safe-html.js';
import { Modal, Toast } from './ui-components.js';
import { normalizeCharacterAssetCode } from './contracts/character-visual-library.js';

export function mediaAssetCode(code, { onRename } = {}) {
  if (!normalizeCharacterAssetCode(code)) return document.createDocumentFragment();
  let current = code,
    timer;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'media-asset-code';
  const label = () => {
    button.textContent = '#' + current;
    button.setAttribute('aria-label', 'Copiar código #' + current);
  };
  label();
  button.title = onRename ? 'Clic para copiar · Doble clic para editar' : 'Copiar código';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText('#' + current);
      Toast.show('Código #' + current + ' copiado', 'success');
    } catch {
      Toast.show('No se pudo copiar #' + current + '. Puedes seleccionarlo y copiarlo.', 'error');
    }
  };
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    clearTimeout(timer);
    if (event.detail === 0 || !onRename) void copy();
    else if (event.detail === 1)
      timer = setTimeout(() => {
        if (button.isConnected) void copy();
      }, 400);
  });
  if (onRename)
    button.addEventListener('dblclick', (event) => {
      event.preventDefault();
      event.stopPropagation();
      clearTimeout(timer);
      const input = document.createElement('input');
      input.className = 'media-asset-code media-asset-code--input';
      input.value = '#' + current;
      input.maxLength = 65;
      input.spellcheck = false;
      input.setAttribute('aria-label', 'Editar código #' + current);
      let finished = false;
      const finish = async (save) => {
        if (finished) return;
        finished = true;
        const next = normalizeCharacterAssetCode(input.value);
        if (save && next && next !== current) {
          input.disabled = true;
          try {
            const result = await onRename(next, current);
            if (result === false) throw Error('No se cambió el tag.');
            current =
              normalizeCharacterAssetCode(result?.code || (typeof result === 'string' ? result : next)) ||
              current;
          } catch (error) {
            Toast.show(
              error.message?.replace(/^API \d+:\s*/, '') ||
                'No se pudo cambiar el tag. Se conserva el anterior.',
              'error',
            );
          }
        } else if (save && !next) Toast.show('Tag inválido. Se conserva el anterior.', 'error');
        label();
        if (input.isConnected) {
          input.replaceWith(button);
          button.focus({ preventScroll: true });
        }
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          void finish(e.key === 'Enter');
        }
      });
      input.addEventListener('blur', () => void finish(true));
      button.replaceWith(input);
      input.focus();
      input.select();
    });
  return button;
}

export function mediaSelectionMarker() {
  const marker = document.createElement('span');
  marker.className = 'media-selection-marker';
  marker.setAttribute('aria-hidden', 'true');
  marker.innerHTML = safeHTML(renderIcon('check'));
  return marker;
}
/** Presentation-only multi-selection shared by the two independent recycle bins. */
export class MediaTrashSelection {
  constructor(render, { alwaysSelecting = false } = {}) {
    this.render = render;
    this.selected = new Set();
    this.alwaysSelecting = alwaysSelecting;
    this.selecting = alwaysSelecting;
    this.busy = false;
    this.controller = new AbortController();
  }
  toggle(id) {
    this.selected.has(id) ? this.selected.delete(id) : this.selected.add(id);
    this.selecting = true;
    this.render();
  }
  controls(ids, { restore, remove, pending = false, retry }) {
    if (this.alwaysSelecting) this.selecting = true;
    this.selected = new Set([...this.selected].filter((id) => ids.includes(id)));
    const root = document.createElement('div');
    root.className = 'media-trash-controls';
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Acciones de la papelera');
    const button = (label, callback, danger = false, key = '') => {
      const node = document.createElement('button');
      node.type = 'button';
      node.className = danger ? 'btn btn-danger' : 'btn btn-secondary';
      node.textContent = label;
      if (key) node.dataset.assetFocus = 'trash-' + key;
      node.disabled = this.busy;
      node.addEventListener('click', callback);
      root.append(node);
      return node;
    };
    if (!this.alwaysSelecting)
      button(this.selecting ? 'Cancelar selección' : 'Seleccionar', () => {
        this.selecting = !this.selecting;
        this.selected.clear();
        this.render();
      }).disabled = this.busy || (!this.selecting && !ids.length);
    if (pending) button('Reintentar eliminación pendiente', () => void this.run(retry));
    if (this.selecting) {
      if (this.alwaysSelecting) {
        const count = document.createElement('span');
        count.className = 'media-trash-controls__count';
        count.textContent = `${this.selected.size} de ${ids.length} seleccionadas`;
        count.setAttribute('role', 'status');
        root.append(count);
      }
      button(
        ids.length && this.selected.size === ids.length ? 'Deseleccionar todo' : 'Seleccionar todo',
        () => {
          this.selected = new Set(this.selected.size === ids.length ? [] : ids);
          this.render();
        },
        false,
        'all',
      ).disabled = this.busy || !ids.length;
      button(
        this.alwaysSelecting ? 'Restaurar seleccionadas' : 'Restaurar selección',
        () => void this.run(() => restore([...this.selected])),
        false,
        'restore',
      ).disabled = this.busy || !this.selected.size;
      button(
        'Eliminar definitivamente',
        async () => {
          const chosen = [...this.selected];
          const confirmed = await Modal.confirm({
            title: 'Eliminar imágenes definitivamente',
            message: `Se eliminarán ${chosen.length} ${chosen.length === 1 ? 'imagen de esta papelera' : 'imágenes de esta papelera'}. Esta acción no se puede deshacer. Los archivos que todavía utilicen versiones guardadas o referencias existentes se conservarán para no dañarlas.`,
            confirmLabel: 'Eliminar definitivamente',
            type: 'danger',
            signal: this.controller.signal,
          });
          if (confirmed && !this.controller.signal.aborted) await this.run(() => remove(chosen));
        },
        true,
        'delete',
      ).disabled = this.busy || !this.selected.size;
    }
    return root;
  }
  async run(operation) {
    if (this.busy || this.controller.signal.aborted) return;
    this.busy = true;
    this.render();
    try {
      if ((await operation()) !== false) this.selected.clear();
    } finally {
      this.busy = false;
      if (!this.controller.signal.aborted) this.render();
    }
  }
  destroy() {
    this.controller.abort();
  }
}
