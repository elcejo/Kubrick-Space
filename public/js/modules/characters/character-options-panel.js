import { characterElement as el } from './character-ui.js';
import { characterOptionGroups } from '../../contracts/character-options.js';
import { renderIcon } from '../../icons.js';
import { safeHTML } from '../../safe-html.js';

/** Visual input adapter: values are still ordinary typed character fields. */
export function createCharacterOptionsPanel(host) {
  const root = el('div', 'character-options');
  const groups = characterOptionGroups(host.document.identity.base, host.document.identity.nature);
  root.append(el('p', 'character-options__intro', 'Elige solo los rasgos que quieras definir.'));
  for (const spec of groups) {
    const details = el('details', 'character-option-group');
    const summary = el('summary');
    summary.append(el('span', null, spec.label));
    const selected = el('span', 'character-option-group__selection');
    summary.append(selected);
    const chevron = el('span', 'character-option-group__chevron');
    chevron.innerHTML = safeHTML(renderIcon('chevron-down', 16));
    summary.append(chevron);
    const grid = el('div', 'character-option-grid');
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-label', spec.label);
    const buttons = [];
    const refresh = () => {
      const value = host.document.fields.find((field) => field.key === spec.key)?.value;
      const chosen = spec.choices.filter((choice) =>
        spec.multiple
          ? String(value || '')
              .split('; ')
              .includes(choice.value)
          : value === choice.value,
      );
      selected.textContent = chosen.length
        ? chosen.map((choice) => choice.label).join(', ')
        : `${spec.choices.length} opciones`;
      buttons.forEach(([button, choice]) =>
        button.setAttribute('aria-pressed', String(chosen.includes(choice))),
      );
    };
    for (const choice of spec.choices) {
      const button = el('button', 'character-option');
      button.type = 'button';
      button.setAttribute('aria-label', `${spec.label}: ${choice.label}`);
      const preview = el('span', 'character-option__preview');
      if (choice.color) {
        preview.classList.add('character-option__swatch');
        preview.style.backgroundColor = choice.color;
      } else preview.innerHTML = safeHTML(renderIcon(`${choice.icon}-${choice.id}`, 96));
      button.append(preview, el('span', 'character-option__label', choice.label));
      button.addEventListener('click', () => {
        host.chooseOption(spec.id, choice.id);
        refresh();
      });
      buttons.push([button, choice]);
      grid.append(button);
    }
    refresh();
    buttons.forEach(([button], index) => {
      button.tabIndex = index === 0 ? 0 : -1;
      button.addEventListener('focus', () =>
        buttons.forEach(([candidate]) => {
          candidate.tabIndex = candidate === button ? 0 : -1;
        }),
      );
      button.addEventListener('keydown', (event) => {
        let target;
        if (event.key === 'ArrowRight') target = (index + 1) % buttons.length;
        else if (event.key === 'ArrowLeft') target = (index - 1 + buttons.length) % buttons.length;
        else if (event.key === 'ArrowDown') target = Math.min(index + 3, buttons.length - 1);
        else if (event.key === 'ArrowUp') target = Math.max(index - 3, 0);
        else if (event.key === 'Home') target = 0;
        else if (event.key === 'End') target = buttons.length - 1;
        if (target === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        buttons[target][0].focus();
      });
    });
    details.append(summary, grid);
    root.append(details);
  }
  return root;
}
