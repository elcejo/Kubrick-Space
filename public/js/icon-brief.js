import { ICONS, renderIcon } from './icons.js';
import { safeHTML, escapeHTML } from './safe-html.js';

const catalog = document.querySelector('#icons-catalog');
const search = document.querySelector('#icons-search');
const count = document.querySelector('#icons-count');
const normalize = (value) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es');
const render = () => {
  const words = normalize(search.value).split(/\s+/).filter(Boolean);
  const entries = Object.entries(ICONS).filter(([id, [name, usage]]) =>
    words.every((word) => normalize(`${id} ${name} ${usage}`).includes(word)),
  );
  catalog.innerHTML = safeHTML(
    entries
      .map(
        ([id, [name, usage]]) =>
          `<article class="icon-specimen${id.startsWith('option-') ? ' icon-specimen--illustration' : ''}"><div class="icon-specimen__samples">${id.startsWith('option-') ? renderIcon(id, 96) : renderIcon(id, 16) + renderIcon(id, 24) + renderIcon(id, 40)}</div><h2>${escapeHTML(name)}</h2><code>${escapeHTML(id)}</code><p>${escapeHTML(usage)}</p><a href="/icons/${encodeURIComponent(id)}.svg" download="kubrick-space-${escapeHTML(id)}.svg">Descargar SVG</a></article>`,
      )
      .join(''),
  );
  count.textContent = `${entries.length} de ${Object.keys(ICONS).length} iconos`;
};
search.addEventListener('input', render);
render();
