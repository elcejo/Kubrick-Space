import { Modal } from '../../ui-components.js';
import { enhanceSelect } from '../../custom-select.js';
import { ingredientVersionLabel } from './ingredient-versions.js';

/** Every close path settles the pending import, including workspace teardown. */
export function versionDialog({ title, content, options, cleanups, initialFocus, dispose = () => {} }) {
  return new Promise((resolve) => {
    let dialog;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanups.delete(cancel);
      dispose();
      if (dialog && Modal._el?.contains(dialog)) Modal.hide();
      resolve(value);
    };
    const cancel = () => finish(null);
    cleanups.add(cancel);
    dialog = Modal.show({
      title,
      content,
      preserveCurrent: true,
      initialFocus,
      onDismiss: cancel,
      actions: options.map(({ label, primary, value }) => ({
        label,
        class: primary ? 'btn-primary' : 'btn-secondary',
        onClick: () => finish(typeof value === 'function' ? value() : value),
      })),
    });
  });
}

export function chooseIngredientVersion(catalogue, cleanups) {
  if (catalogue.versions.length < 2) return Promise.resolve(catalogue.versions[0]?.id || 'draft');
  const content = document.createElement('div');
  content.className = 'ingredient-version-dialog';
  const name = document.createElement('p');
  name.className = 'modal-message';
  name.textContent = catalogue.project.name;
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Versión del ingrediente');
  for (const entry of catalogue.versions) {
    const option = document.createElement('option');
    option.value = entry.id;
    option.textContent = `Versión ${entry.number} · ${new Date(entry.savedAt).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}`;
    select.append(option);
  }
  content.append(name, select);
  let control;
  const result = versionDialog({
    title: 'Seleccionar versión',
    content,
    cleanups,
    initialFocus: '.kai-select__trigger',
    dispose: () => control?.destroy({ restore: false }),
    options: [
      { label: 'Cancelar', value: null },
      { label: 'Usar versión', primary: true, value: () => select.value },
    ],
  });
  control = enhanceSelect(select, { searchable: false });
  return result;
}

export function confirmIngredientUpdates(items, cleanups) {
  const content = document.createElement('div');
  content.className = 'ingredient-version-dialog';
  const message = document.createElement('p');
  message.className = 'modal-message';
  message.textContent = 'Hay ingredientes con nuevas versiones guardadas. ¿Cómo quieres actualizarlos?';
  const list = document.createElement('ul');
  list.className = 'ingredient-version-updates';
  for (const { ingredient, catalogue } of items) {
    const row = document.createElement('li');
    const name = document.createElement('strong');
    name.textContent = ingredient.importedProjectName || catalogue.project.name;
    const versions = document.createElement('span');
    versions.textContent = `${ingredientVersionLabel(ingredient)} → Versión ${catalogue.versions[0].number}`;
    row.append(name, versions);
    list.append(row);
  }
  content.append(message, list);
  return versionDialog({
    title: 'Ingredientes desactualizados',
    content,
    cleanups,
    initialFocus: '.modal-footer .btn-secondary',
    options: [
      { label: 'Actualizar manualmente', value: false },
      { label: 'Actualizar todos', primary: true, value: true },
    ],
  });
}
