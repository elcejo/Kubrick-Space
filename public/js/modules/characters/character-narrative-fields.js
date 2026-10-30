import { characterElement as el, characterAction as action } from './character-ui.js';

/** Suggestions are presentation choices, never facts selected implicitly. Values stay plain strings. */
export const CHARACTER_NARRATIVE_CHOICES = Object.freeze({
  profile: ['Héroe', 'Antihéroe', 'Mentor', 'Inocente', 'Rebelde', 'Embaucador', 'Cuidador', 'Explorador'],
  desire: [
    'Sobrevivir',
    'Proteger',
    'Pertenecer',
    'Ser libre',
    'Triunfar',
    'Descubrir la verdad',
    'Vengarse',
    'Reconciliarse',
  ],
  motivation: ['Amor', 'Deber', 'Miedo', 'Ambición', 'Justicia', 'Lealtad', 'Culpa', 'Curiosidad'],
  conflict: [
    'Interno',
    'Con otra persona',
    'Con la sociedad',
    'Con la naturaleza',
    'Con el destino',
    'Con la tecnología',
  ],
});

export function characterNarrativeChoice(owner, key, label) {
  const host = owner.host,
    choices = CHARACTER_NARRATIVE_CHOICES[key];
  const value = host.document.narrative[key];
  const customMode = owner.customFields.has(key) || (!!value && !choices.includes(value));
  const container = el('div', 'character-narrative-choice');
  const custom = host.input(
    'Texto personalizado',
    customMode ? value : '',
    (doc, text) => {
      doc.narrative[key] = text;
      if (!doc.enabledNarrative.includes(key)) doc.enabledNarrative.push(key);
    },
    { multiline: true, collection: owner.cleanups },
  );
  const text = custom.querySelector('textarea');
  text.setAttribute('aria-label', `${label}: texto personalizado`);
  custom.hidden = !customMode;
  const select = host.select(
    label,
    [['', 'Sin definir'], ...choices.map((choice) => [choice, choice]), ['__custom__', 'Personalizado']],
    customMode ? '__custom__' : value,
    (selected) => {
      const personalized = selected === '__custom__';
      if (personalized) owner.customFields.add(key);
      else owner.customFields.delete(key);
      host.change((doc) => {
        doc.narrative[key] = personalized ? '' : selected;
        if (!doc.enabledNarrative.includes(key)) doc.enabledNarrative.push(key);
      });
      text.value = '';
      custom.hidden = !personalized;
      if (personalized) text.focus();
    },
    owner.cleanups,
  );
  container.append(select, custom);
  return container;
}

/** Delete is a reset of the live field, preserving only its schema for the Add picker. */
export function characterNarrativeRow(owner, label, content, { key, field, wide = false } = {}) {
  const row = el('div', 'character-narrative-row');
  row.classList.toggle('character-field--wide', wide || content.classList.contains('character-field--wide'));
  row.id = key ? `character-narrative-${key}` : `character-narrative-field-${field.id}`;
  const controls = el('div', 'character-narrative-control');
  controls.append(content);
  const remove = action(
    '',
    'trash',
    () => {
      if (!owner.host.current()) return;
      owner.host.change((doc) => {
        if (key) {
          doc.narrative[key] = '';
          doc.enabledNarrative = doc.enabledNarrative.filter((entry) => entry !== key);
          owner.customFields.delete(key);
        } else {
          const target = doc.fields.find((entry) => entry.id === field.id);
          if (target) {
            target.value = null;
            target.explicit = false;
            target.origin = 'user';
          }
        }
      });
      owner.render();
      owner.element.querySelector('.character-add-field')?.focus({ preventScroll: true });
    },
    'btn btn-ghost character-narrative-remove',
  );
  remove.title = `Eliminar ${label}`;
  remove.setAttribute('aria-label', remove.title);
  row.append(controls, remove);
  return row;
}
