import { Modal } from '../../ui-components.js';
import { ingredientTypeLabel } from './ingredient-related.js';

/**
 * Offers the ingredients of a just-linked project that the receiving project lacks. Everything is selected by
 * default; the author keeps the ones he wants. Resolves with the chosen project ids, or [] if none / dismissed.
 */
export function reviewRelatedIngredients({ sourceName, targetName, items, cleanups }) {
  return new Promise((resolve) => {
    let dialog;
    let settled = false;
    const selected = new Set(items.map((item) => item.id));
    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanups.delete(dismiss);
      if (dialog && Modal._el?.contains(dialog)) Modal.hide();
      resolve(value);
    };
    const dismiss = () => finish([]);
    cleanups.add(dismiss);

    const content = document.createElement('div');
    content.className = 'check-panel';
    const intro = document.createElement('p');
    intro.className = 'check-panel__intro';
    intro.textContent =
      items.length === 1
        ? '«' +
          sourceName +
          '» tiene 1 ingrediente vinculado que «' +
          targetName +
          '» aún no incluye. ¿Quieres incorporarlo?'
        : '«' +
          sourceName +
          '» tiene ' +
          items.length +
          ' ingredientes vinculados que «' +
          targetName +
          '» aún no incluye. ¿Quieres incorporarlos?';
    const toolbar = document.createElement('div');
    toolbar.className = 'check-panel__toolbar';
    const all = document.createElement('input');
    all.type = 'checkbox';
    all.id = 'related-select-all';
    const allLabel = document.createElement('label');
    allLabel.className = 'check-panel__all';
    allLabel.htmlFor = all.id;
    allLabel.append(all, document.createTextNode('Seleccionar todos'));
    const count = document.createElement('span');
    count.className = 'check-panel__count';
    count.setAttribute('aria-live', 'polite');
    toolbar.append(allLabel, count);
    const list = document.createElement('ul');
    list.className = 'check-panel__list';
    const boxes = new Map();
    for (const item of items) {
      const row = document.createElement('li');
      const label = document.createElement('label');
      label.className = 'check-panel__row';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = true;
      box.setAttribute('aria-label', 'Incorporar ' + item.name);
      boxes.set(item.id, box);
      const text = document.createElement('span');
      text.className = 'check-panel__text';
      const name = document.createElement('strong');
      name.textContent = item.name;
      const meta = document.createElement('small');
      // A role is a short label (Protagonista); a long text there is a description, not worth the line.
      const role =
        item.role && item.role.length <= 28 && item.role !== ingredientTypeLabel(item.type) ? item.role : '';
      meta.textContent = [ingredientTypeLabel(item.type), role].filter(Boolean).join(' · ');
      text.append(name, meta);
      label.append(box, text);
      row.append(label);
      list.append(row);
    }
    content.append(intro, toolbar, list);

    dialog = Modal.show({
      title: 'Ingredientes relacionados',
      content,
      preserveCurrent: true,
      onDismiss: dismiss,
      actions: [
        { label: 'Ahora no', class: 'btn-secondary btn-md', onClick: dismiss },
        { label: 'Incorporar', class: 'btn-primary btn-md', onClick: () => finish([...selected]) },
      ],
    });
    dialog.classList.add('modal-content--check');
    const incorporate = dialog.querySelector('.modal-footer .btn-primary');
    const update = () => {
      const n = selected.size;
      all.checked = n === items.length;
      all.indeterminate = n > 0 && n < items.length;
      count.textContent = n === 1 ? '1 seleccionado' : n + ' seleccionados';
      incorporate.textContent = n > 1 ? 'Incorporar (' + n + ')' : 'Incorporar';
      incorporate.disabled = n === 0;
    };
    for (const [id, box] of boxes)
      box.addEventListener('change', () => {
        box.checked ? selected.add(id) : selected.delete(id);
        update();
      });
    all.addEventListener('change', () => {
      for (const [id, box] of boxes) {
        box.checked = all.checked;
        all.checked ? selected.add(id) : selected.delete(id);
      }
      update();
    });
    update();
  });
}
