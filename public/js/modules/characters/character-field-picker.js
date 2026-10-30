import { Modal, Toast } from '../../ui-components.js';
import { characterElement as el } from './character-ui.js';
import {
  CHARACTER_NARRATIVE,
  CHARACTER_SECTIONS,
  newCharacterFieldId,
  characterFieldVisible,
  characterNarrativeVisible,
  validateCharacterDocument,
} from './character-model.js';

const types = [
  ['text', 'Texto'],
  ['multiline', 'Texto largo'],
  ['number', 'Número'],
  ['color', 'Color'],
  ['date', 'Fecha'],
  ['time', 'Hora'],
  ['select', 'Lista'],
  ['boolean', 'Sí / no'],
];

/** Adding a control is explicit and persisted; cancelling never changes the sheet. */
export function showCharacterFieldPicker(host, narrative = false) {
  const content = el('div', 'character-field-picker');
  host.addDialog = content;
  const disposers = [];
  const close = () => {
    disposers.splice(0).forEach((dispose) => dispose());
  };
  const options = [];
  const available = new Map();
  if (narrative) {
    for (const [key, label] of Object.entries(CHARACTER_NARRATIVE))
      if (!characterNarrativeVisible(host.document, key)) options.push([key, label]);
    for (const field of host.document.fields)
      if (field.section !== 'appearance' && !characterFieldVisible(field)) available.set(field.key, field);
    if (
      !host.document.fields.some(
        (field) =>
          field.key === 'custom.occupation' || /^(ocupaci[oó]n|profesi[oó]n|oficio)$/i.test(field.label),
      )
    )
      available.set('custom.occupation', {
        key: 'custom.occupation',
        label: 'Ocupación',
        type: 'text',
        section: 'performance',
        options: [],
      });
    for (const field of available.values()) options.push([field.key, field.label]);
    options.push(['custom', 'Campo narrativo personalizado']);
  } else {
    for (const field of host.document.fields)
      if (field.section === 'appearance' && !characterFieldVisible(field)) available.set(field.key, field);
    const prefix =
      host.document.identity.base === 'humanoid'
        ? 'human'
        : host.document.identity.base === 'animal'
          ? 'animal'
          : 'custom';
    for (const [name, label, type] of [
      ['age', 'Edad', 'number'],
      ['hair', 'Cabello', 'text'],
      ['build', 'Complexión', 'text'],
      ['skin', 'Piel', 'text'],
      ['eyes', 'Ojos', 'text'],
      ['clothing', 'Vestimenta', 'multiline'],
    ]) {
      const key = `${prefix}.${name}`;
      if (!host.document.fields.some((field) => field.key === key || field.label === label))
        available.set(key, { key, label, type, section: 'appearance', options: [] });
    }
    for (const field of available.values()) options.push([field.key, field.label]);
    options.push(['custom', 'Característica personalizada']);
  }
  if (!options.length) {
    Toast.show('Todos los campos narrativos ya están añadidos.', 'info');
    return;
  }
  let selected = '',
    type = 'text',
    section = narrative ? 'performance' : 'appearance';
  const custom = el('div', 'character-field-picker__custom');
  custom.hidden = true;
  const name = el('input', 'input');
  name.type = 'text';
  name.maxLength = 100;
  const choices = el('textarea', 'input');
  choices.rows = 3;
  choices.maxLength = 5000;
  choices.placeholder = 'Una opción por línea';
  const choiceField = host.labelled('Opciones', choices);
  choiceField.hidden = true;
  custom.append(
    host.labelled('Nombre', name),
    host.select(
      'Tipo',
      types,
      type,
      (value) => {
        type = value;
        choiceField.hidden = type !== 'select';
      },
      disposers,
    ),
    host.select(
      'Sección',
      Object.entries(CHARACTER_SECTIONS).filter(([key]) =>
        narrative ? key !== 'appearance' : key === 'appearance',
      ),
      section,
      (value) => {
        section = value;
      },
      disposers,
    ),
    choiceField,
  );
  content.append(
    host.select(
      'Campo',
      [['', 'Selecciona un campo'], ...options],
      selected,
      (value) => {
        selected = value;
        custom.hidden = selected !== 'custom';
        if (!custom.hidden) name.focus();
      },
      disposers,
    ),
    custom,
  );
  Modal.show({
    title: narrative ? 'Añadir campo narrativo' : 'Añadir característica',
    content,
    onDismiss: close,
    actions: [
      {
        label: 'Cancelar',
        class: 'btn-ghost',
        onClick: () => {
          close();
          Modal.hide();
        },
      },
      {
        label: 'Añadir',
        class: 'btn-primary',
        onClick: () => {
          if (!host.current()) {
            close();
            Modal.hide();
            return;
          }
          if (!selected) {
            Toast.show('Selecciona un campo.', 'warning');
            return;
          }
          try {
            const next = structuredClone(host.document);
            const standardNarrative = narrative && Object.hasOwn(CHARACTER_NARRATIVE, selected);
            if (standardNarrative) {
              next.narrative[selected] = '';
              if (!next.enabledNarrative.includes(selected)) next.enabledNarrative.push(selected);
            } else {
              const existing = next.fields.find((field) => field.key === selected);
              if (existing) {
                existing.explicit = true;
                existing.value = null;
                existing.origin = 'user';
              } else {
                const spec =
                  selected === 'custom'
                    ? {
                        key: `custom.manual_${globalThis.crypto.randomUUID().replaceAll('-', '')}`,
                        label: name.value.trim(),
                        type,
                        section,
                        options:
                          type === 'select'
                            ? choices.value
                                .split('\n')
                                .map((value) => value.trim())
                                .filter(Boolean)
                            : [],
                      }
                    : available.get(selected);
                if (!spec) throw Error('Característica inválida.');
                next.fields.push({
                  ...spec,
                  id: newCharacterFieldId(),
                  value: null,
                  required: false,
                  origin: 'user',
                  explicit: true,
                });
              }
            }
            const checked = validateCharacterDocument(next);
            host.change((doc) => {
              doc.fields = checked.fields;
              doc.enabledNarrative = checked.enabledNarrative;
              doc.narrative = checked.narrative;
            });
            close();
            Modal.hide();
            if (narrative) {
              const field = host.document.fields.find(
                (item) =>
                  item.key === selected || (selected === 'custom' && item.id === checked.fields.at(-1)?.id),
              );
              host.narrativeSection =
                field?.section === 'continuity'
                  ? 'notes'
                  : ['arc', 'relationships', 'backstory'].includes(selected)
                    ? 'journey'
                    : ['personality', 'notes'].includes(selected)
                      ? 'notes'
                      : 'essentials';
              host.narrativeNode.render();
              host.narrativeNode.element
                .querySelector(
                  field
                    ? `[data-character-field="${field.id}"] input, [data-character-field="${field.id}"] textarea, [data-character-field="${field.id}"] button`
                    : selected === 'role'
                      ? '.kai-select__trigger'
                      : `#character-narrative-${selected} .kai-select__trigger, #character-narrative-${selected} input, #character-narrative-${selected} textarea`,
                )
                ?.focus();
            } else {
              host.activeSection =
                host.document.fields.find((field) => field.key === selected)?.section || section;
              host.renderFields();
            }
          } catch (error) {
            Toast.show(error.message, 'warning');
          }
        },
      },
    ],
  });
}
