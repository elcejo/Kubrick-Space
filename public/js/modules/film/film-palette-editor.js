/**
 * The editor of a custom palette: the colours are typed as hexadecimal values (#aabbcc, three or six digits) and shown
 * as a strip of swatches before they are used. The choice of the palette itself is a list select of the film board.
 */
import { filmPaletteColors, parseFilmPaletteInput } from '../../contracts/film-palettes.js';

const make = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** The colours of a palette as a strip of swatches (decorative: the name lives in the control that shows it). */
export function paletteStrip(colors) {
  const bar = make('span', 'film-palette__strip');
  bar.setAttribute('aria-hidden', 'true');
  for (const color of colors) {
    const swatch = make('span', 'film-palette__swatch');
    swatch.style.background = color;
    bar.append(swatch);
  }
  return bar;
}

/**
 * @param {{colors?:string[], disabled?:boolean, onApply:(colors:string[])=>void}} config
 * @returns {HTMLElement}
 */
export function createPaletteEditor({ colors = [], disabled = false, onApply }) {
  const editor = make('div', 'film-palettes__editor');
  const field = make('label', 'film-field film-palettes__field');
  field.append(make('span', 'film-field__label', 'Colores de la paleta (hexadecimal, hasta 12)'));
  const input = make('input', 'input film-palettes__input');
  input.type = 'text';
  input.value = (filmPaletteColors(colors) || []).join(' ');
  input.placeholder = '#1b1410 #a35d2b #efe6d2 …';
  input.spellcheck = false;
  input.disabled = disabled;
  field.append(input);
  const preview = make('div', 'film-palettes__preview');
  const apply = make('button', 'btn btn-ghost film-palettes__apply', 'Usar esta paleta');
  apply.type = 'button';
  const refresh = () => {
    const parsed = parseFilmPaletteInput(input.value);
    preview.replaceChildren(...(parsed.length ? [paletteStrip(parsed)] : []));
    apply.disabled = disabled || !parsed.length;
    return parsed;
  };
  input.addEventListener('input', refresh);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      apply.click();
    }
  });
  apply.addEventListener('click', () => {
    const parsed = refresh();
    if (parsed.length) onApply(parsed);
  });
  editor.append(field, preview, apply);
  refresh();
  return editor;
}
