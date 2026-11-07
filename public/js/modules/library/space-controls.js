import { API } from '../../api-service.js';
import { AppState } from '../../app-state.js';
import { Modal, Toast } from '../../ui-components.js';
import { renderIcon } from '../../icons.js';
import { safeHTML, escapeHTML as esc } from '../../safe-html.js';
/** Personal library metadata is shared across browser sessions; assets remain in their existing stores. */
export class SpaceControls {
  constructor({ getSpace, onSpace, artwork }) {
    this.active = true;
    this.abort = new AbortController();
    this.getSpace = getSpace;
    this.onSpace = onSpace;
    this.artwork = artwork;
  }
  async save(operation) {
    if (!this.active || this.saving) return false;
    this.saving = true;
    try {
      const result = await operation();
      if (!this.active) return false;
      this.onSpace(result);
      return true;
    } catch (error) {
      if (!this.active) return false;
      Toast.show(error.message, 'error');
      if (error.status === 409) {
        try {
          const latest = await API.getLibrarySpace();
          if (this.active) this.onSpace(latest);
        } catch {
          /* Retry remains available from the page. */
        }
      }
      return false;
    } finally {
      this.saving = false;
    }
  }
  show(options) {
    if (!this.active) return;
    this.dialogContent = options.content;
    return Modal.show(options);
  }
  dismiss() {
    const overlay = this.dialogContent?.closest('[data-modal-overlay]');
    if (this.dialogContent?.isConnected && !overlay?.inert) Modal.hide();
  }
  destroy() {
    this.dismiss();
    this.active = false;
    this.abort.abort();
  }
  field(form, label, value, max = 100, multiline = false) {
    const row = document.createElement('label');
    row.className = 'space-form-field';
    const title = document.createElement('span');
    title.textContent = label;
    const input = document.createElement(multiline ? 'textarea' : 'input');
    input.value = value;
    input.maxLength = max;
    if (multiline) {
      input.rows = 3;
      input.style.resize = 'none';
    }
    row.append(title, input);
    form.append(row);
    return input;
  }
  createFolder(assetId) {
    const form = document.createElement('form');
    form.className = 'space-form';
    const input = this.field(form, 'Nombre del proyecto', '', 100);
    input.placeholder = 'Por ejemplo, mi próxima película';
    const submit = async () => {
      if (!form.reportValidity()) return;
      if (
        await this.save(() =>
          API.createProjectFolder({
            revision: this.getSpace().revision,
            name: input.value,
            assetIds: assetId ? [assetId] : [],
          }),
        )
      )
        this.dismiss();
    };
    input.required = true;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void submit();
    });
    this.show({
      title: 'Nuevo proyecto',
      content: form,
      actions: [
        { label: 'Cancelar', class: 'btn-secondary', onClick: () => this.dismiss() },
        { label: 'Crear carpeta', class: 'btn-primary', onClick: submit },
      ],
    });
  }
  editFolder(folder) {
    const form = document.createElement('form');
    form.className = 'space-form';
    const name = this.field(form, 'Nombre del proyecto', folder.name, 100);
    name.required = true;
    const submit = async () => {
      if (
        form.reportValidity() &&
        (await this.save(() =>
          API.updateProjectFolder(folder.id, { revision: this.getSpace().revision, name: name.value }),
        ))
      )
        this.dismiss();
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void submit();
    });
    this.show({
      title: 'Renombrar proyecto',
      content: form,
      actions: [
        { label: 'Cancelar', class: 'btn-secondary', onClick: () => this.dismiss() },
        { label: 'Guardar', class: 'btn-primary', onClick: submit },
      ],
    });
  }
  async removeFolder(folder) {
    if (
      await Modal.confirm({
        title: 'Eliminar carpeta',
        message: `¿Eliminar “${folder.name}”? Sus assets seguirán en Mi espacio.`,
        confirmLabel: 'Eliminar carpeta',
        cancelLabel: 'Cancelar',
        type: 'danger',
        signal: this.abort.signal,
      })
    )
      await this.save(() => API.deleteProjectFolder(folder.id, this.getSpace().revision));
  }
  editProfile() {
    const profile = this.getSpace().profile,
      form = document.createElement('form');
    form.className = 'space-form';
    const name = this.field(form, 'Nombre', profile.displayName, 80),
      handle = this.field(form, 'Nombre de usuario', profile.handle, 40),
      bio = this.field(form, 'Sobre tu trabajo', profile.bio, 500, true);
    name.required = true;
    handle.required = true;
    const submit = async () => {
      if (
        form.reportValidity() &&
        (await this.save(() =>
          API.saveLibraryProfile({
            revision: this.getSpace().revision,
            displayName: name.value,
            handle: handle.value,
            bio: bio.value,
          }),
        ))
      )
        this.dismiss();
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void submit();
    });
    this.show({
      title: 'Editar perfil',
      content: form,
      actions: [
        { label: 'Cancelar', class: 'btn-secondary', onClick: () => this.dismiss() },
        { label: 'Guardar perfil', class: 'btn-primary', onClick: submit },
      ],
    });
  }
  pickAssets(folder) {
    const selected = new Set(folder.assetIds),
      content = document.createElement('div');
    content.className = 'space-picker';
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'space-picker-search';
    search.placeholder = 'Buscar assets…';
    search.setAttribute('aria-label', 'Buscar assets para el proyecto');
    const count = document.createElement('p');
    count.className = 'space-picker-count';
    count.setAttribute('role', 'status');
    const grid = document.createElement('div');
    grid.className = 'space-picker-grid';
    const render = () => {
      const projects = AppState.projects.filter((p) =>
        String(p.name || '')
          .toLocaleLowerCase('es')
          .includes(search.value.toLocaleLowerCase('es')),
      );
      grid.innerHTML = safeHTML(
        projects
          .map(
            (p) =>
              `<button type="button" class="space-picker-asset" data-pick-asset="${esc(p.id)}" aria-pressed="${selected.has(p.id)}"><span class="space-picker-art">${this.artwork(p)}<span class="space-picker-check">${renderIcon('check', 14)}</span></span><span>${esc(p.name)}</span></button>`,
          )
          .join(''),
      );
      count.textContent = `${selected.size} assets seleccionados`;
    };
    search.addEventListener('input', render);
    grid.addEventListener('click', (event) => {
      const button = event.target.closest('[data-pick-asset]');
      if (!button) return;
      const id = button.dataset.pickAsset;
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      button.setAttribute('aria-pressed', String(selected.has(id)));
      count.textContent = `${selected.size} assets seleccionados`;
    });
    content.append(search, count, grid);
    render();
    this.show({
      title: 'Assets de ' + folder.name,
      content,
      actions: [
        { label: 'Cancelar', class: 'btn-secondary', onClick: () => this.dismiss() },
        {
          label: 'Guardar selección',
          class: 'btn-primary',
          onClick: async () => {
            if (
              await this.save(() =>
                API.updateProjectFolder(folder.id, {
                  revision: this.getSpace().revision,
                  assetIds: [...selected],
                }),
              )
            )
              this.dismiss();
          },
        },
      ],
    });
  }
  assignAsset(asset) {
    const space = this.getSpace();
    if (!space.folders.length) {
      this.createFolder(asset.id);
      return;
    }
    const selected = new Set(space.folders.filter((f) => f.assetIds.includes(asset.id)).map((f) => f.id)),
      content = document.createElement('div');
    content.className = 'space-folder-picker';
    content.innerHTML = safeHTML(
      space.folders
        .map(
          (f) =>
            `<button type="button" data-pick-folder="${esc(f.id)}" aria-pressed="${selected.has(f.id)}">${renderIcon('folder', 22)}<span>${esc(f.name)}</span><span class="space-folder-check">${renderIcon('check', 16)}</span></button>`,
        )
        .join(''),
    );
    content.addEventListener('click', (event) => {
      const button = event.target.closest('[data-pick-folder]');
      if (!button) return;
      const id = button.dataset.pickFolder;
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      button.setAttribute('aria-pressed', String(selected.has(id)));
    });
    this.show({
      title: 'Proyectos de ' + asset.name,
      content,
      actions: [
        { label: 'Cancelar', class: 'btn-secondary', onClick: () => this.dismiss() },
        {
          label: 'Guardar',
          class: 'btn-primary',
          onClick: async () => {
            if (
              await this.save(() =>
                API.assignAssetFolders(asset.id, {
                  revision: this.getSpace().revision,
                  folderIds: [...selected],
                }),
              )
            )
              this.dismiss();
          },
        },
      ],
    });
  }
}
