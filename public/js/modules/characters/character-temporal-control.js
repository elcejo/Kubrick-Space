import { Modal } from '../../ui-components.js';
import { enhanceSelect } from '../../custom-select.js';
import { characterDate, characterTime } from './character-model.js';
import { calendarDateToDate } from '../story-book/calendar-date.js';
import { characterElement as el, characterAction as action } from './character-ui.js';

const months = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];
const pad = (value) => String(value).padStart(2, '0');

/** Custom date/time controls: no native browser popup, validated before committing. */
export function createCharacterTemporalControl(field, onChange) {
  const valid = field.type === 'date' ? characterDate : characterTime;
  const root = el('div', 'character-field');
  const label = el('label', 'character-field__label', field.label);
  const input = el('input', 'input');
  input.id = `character-temporal-${field.id}`;
  input.type = 'text';
  input.value = field.value || '';
  input.maxLength = field.type === 'date' ? 11 : 5;
  input.placeholder = field.type === 'date' ? 'AAAA-MM-DD' : 'HH:mm';
  input.setAttribute('aria-haspopup', 'dialog');
  label.htmlFor = input.id;
  const error = el('span', 'character-temporal-error');
  error.id = input.id + '-error';
  error.setAttribute('aria-live', 'polite');
  input.setAttribute('aria-describedby', error.id);
  const row = el('div', 'character-temporal-input');
  let popup = null;
  let controls = [];
  const close = () => {
    controls.forEach((control) => control.destroy());
    controls = [];
    popup = null;
  };
  const commit = () => {
    const value = input.value.trim();
    const ok = !value || valid(value);
    input.setAttribute('aria-invalid', String(!ok));
    error.textContent = ok
      ? ''
      : field.type === 'date'
        ? 'Introduce una fecha real: AAAA-MM-DD.'
        : 'Introduce una hora entre 00:00 y 23:59.';
    if (ok) onChange(value || null);
  };
  input.addEventListener('change', commit);
  input.addEventListener('blur', () => {
    if (input.value && !valid(input.value)) commit();
  });
  const select = (labelText, options, value, onSelect) => {
    const wrapper = el('label', 'character-field');
    const native = el('select', 'input');
    native.setAttribute('aria-label', labelText);
    for (const [key, name] of options) {
      const option = el('option', null, name);
      option.value = String(key);
      native.append(option);
    }
    native.value = String(value);
    native.addEventListener('change', () => onSelect(native.value));
    wrapper.append(el('span', 'character-field__label', labelText), native);
    controls.push(enhanceSelect(native));
    return wrapper;
  };
  const open = () => {
    let selected = valid(input.value) || null;
    popup = el('div', 'character-temporal-picker');
    const selection = el('p', 'character-temporal-selection', selected || '');
    if (field.type === 'time') {
      let hour = selected?.slice(0, 2) || '00';
      let minute = selected?.slice(3) || '00';
      const choose = () => {
        selected = `${hour}:${minute}`;
        selection.textContent = selected;
      };
      const times = el('div', 'character-temporal-time');
      times.append(
        select(
          'Hora',
          Array.from({ length: 24 }, (_, i) => [pad(i), pad(i)]),
          hour,
          (value) => {
            hour = value;
            choose();
          },
        ),
        select(
          'Minutos',
          Array.from({ length: 60 }, (_, i) => [pad(i), pad(i)]),
          minute,
          (value) => {
            minute = value;
            choose();
          },
        ),
      );
      choose();
      popup.append(times);
    } else {
      const initial = selected ? calendarDateToDate(selected) : new Date();
      let year = selected ? Number(selected.replace(/^-/, '').slice(0, 4)) : initial.getFullYear();
      let month = selected ? Number(selected.replace(/^-/, '').slice(5, 7)) : initial.getMonth() + 1;
      let era = selected?.startsWith('-') ? 'AC' : 'DC';
      const header = el('div', 'character-temporal-calendar-header');
      const grid = el('div', 'character-temporal-days');
      const yearInput = el('input', 'input');
      yearInput.type = 'text';
      yearInput.inputMode = 'numeric';
      yearInput.maxLength = 4;
      yearInput.value = String(year);
      yearInput.setAttribute('aria-label', 'Año');
      const dateString = (day) =>
        `${era === 'AC' ? '-' : ''}${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;
      const render = () => {
        grid.replaceChildren();
        for (const name of ['L', 'M', 'X', 'J', 'V', 'S', 'D'])
          grid.append(el('span', 'character-temporal-weekday', name));
        if (!Number.isInteger(year) || year < 1 || year > 9999) {
          selection.textContent = 'El año debe estar entre 1 y 9999.';
          return;
        }
        selection.textContent = selected || '';
        const date = calendarDateToDate(dateString(1));
        for (let i = 0; i < (date.getUTCDay() + 6) % 7; i++) grid.append(el('span'));
        for (let day = 1; day <= 31; day++) {
          const value = dateString(day);
          if (!characterDate(value)) continue;
          const button = action(
            String(day),
            null,
            () => {
              selected = value;
              render();
            },
            'btn btn-ghost character-temporal-day',
          );
          button.setAttribute('aria-label', `${day} de ${months[month - 1]} de ${year} ${era}`);
          button.setAttribute('aria-pressed', String(selected === value));
          grid.append(button);
        }
      };
      yearInput.addEventListener('input', () => {
        year = /^\d{1,4}$/.test(yearInput.value) ? Number(yearInput.value) : NaN;
        selected = null;
        render();
      });
      header.append(
        select(
          'Mes',
          months.map((name, i) => [i + 1, name]),
          month,
          (value) => {
            month = Number(value);
            selected = null;
            render();
          },
        ),
        yearInput,
        select(
          'Era',
          [
            ['DC', 'DC'],
            ['AC', 'AC'],
          ],
          era,
          (value) => {
            era = value;
            selected = null;
            render();
          },
        ),
      );
      popup.append(header, grid);
      render();
    }
    popup.append(selection);
    Modal.show({
      title: field.label,
      content: popup,
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
          label: 'Aceptar',
          class: 'btn-primary',
          onClick: () => {
            if (!selected || !valid(selected)) {
              selection.textContent = 'Selecciona un valor válido.';
              return;
            }
            input.value = selected;
            commit();
            close();
            Modal.hide();
          },
        },
      ],
    });
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' && event.altKey) {
      event.preventDefault();
      open();
    }
  });
  const pickerButton = action(
    `Elegir ${field.type === 'date' ? 'fecha' : 'hora'}: ${field.label}`,
    'clock',
    open,
    'btn btn-ghost character-temporal-trigger',
  );
  pickerButton.title = pickerButton.getAttribute('aria-label');
  pickerButton.lastChild.remove();
  row.append(input, pickerButton);
  root.append(label, row, error);
  return {
    element: root,
    destroy() {
      if (popup?.isConnected) Modal.hide();
      close();
    },
  };
}
