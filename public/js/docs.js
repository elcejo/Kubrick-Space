import { initBrand } from './brand.js';
import { renderIcon } from './icons.js';
import { safeHTML } from './safe-html.js';
import { initLiquidGlass } from './liquid-glass.js';
initLiquidGlass();
const themeKey = 'kai-theme';
const root = document.documentElement;
const savedTheme = (() => {
  try {
    return localStorage.getItem(themeKey);
  } catch {
    return null;
  }
})();
if (savedTheme === 'light' || savedTheme === 'dark') root.dataset.theme = savedTheme;
initBrand();
const toggle = document.querySelector('[data-theme-toggle]');
const updateToggle = () => {
  const light = root.dataset.theme === 'light';
  toggle?.setAttribute('aria-pressed', String(light));
  if (toggle) {
    const label = toggle.querySelector('span');
    toggle.querySelector('svg')?.remove();
    toggle.insertAdjacentHTML('afterbegin', safeHTML(renderIcon(light ? 'moon' : 'sun')));
    if (label) label.textContent = light ? 'Tema oscuro' : 'Tema claro';
  }
};
updateToggle();
toggle?.addEventListener('click', () => {
  const next = root.dataset.theme === 'light' ? 'dark' : 'light';
  root.dataset.theme = next;
  try {
    localStorage.setItem(themeKey, next);
  } catch {
    /* The guide remains usable without persistence. */
  }
  updateToggle();
});

// The full specification stays readable without JavaScript. Search opens only
// the relevant native disclosure; source examples never become executable DOM.
const search = document.getElementById('spec-search');
if (search) {
  const content = document.getElementById('specification-content');
  const status = document.getElementById('spec-search-status');
  const next = document.querySelector('[data-spec-next]');
  const previous = document.querySelector('[data-spec-previous]');
  const normalize = (value) =>
    value
      .toLocaleLowerCase('es')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  const entries = [...content.querySelectorAll('h2,h3,h4,p,pre,li,td')].map((node) => ({
    node,
    text: normalize(node.textContent),
  }));
  let matches = [];
  let current = -1;
  let timer;
  let opened = null;
  const refreshStatus = () => {
    next.disabled = previous.disabled = !matches.length;
    status.textContent = matches.length
      ? `${current + 1} de ${matches.length} bloques encontrados`
      : search.value.trim()
        ? 'Sin coincidencias'
        : 'Busca por texto o identificador CK-';
  };
  const move = (direction) => {
    if (!matches.length) return;
    matches[current]?.classList.remove('is-current');
    if (opened) opened.open = false;
    opened = null;
    current =
      current === -1
        ? direction < 0
          ? matches.length - 1
          : 0
        : (current + direction + matches.length) % matches.length;
    const node = matches[current];
    node.classList.add('is-current');
    const disclosure = node.closest('details');
    if (disclosure && !disclosure.open) {
      disclosure.open = true;
      opened = disclosure;
    }
    node.scrollIntoView({ block: 'center', behavior: 'auto' });
    refreshStatus();
  };
  const updateSearch = () => {
    for (const node of matches) node.classList.remove('spec-match', 'is-current');
    if (opened) opened.open = false;
    opened = null;
    const query = normalize(search.value.trim());
    matches =
      query.length > 1
        ? entries.filter((entry) => entry.text.includes(query)).map((entry) => entry.node)
        : [];
    for (const node of matches) node.classList.add('spec-match');
    current = -1;
    refreshStatus();
    if (matches.length) status.textContent = `${matches.length} bloques encontrados · Enter para navegar`;
  };
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(updateSearch, 180);
  });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      clearTimeout(timer);
      if (current === -1) updateSearch();
      move(event.shiftKey ? -1 : 1);
    }
    if (event.key === 'Escape') {
      clearTimeout(timer);
      search.value = '';
      updateSearch();
    }
  });
  next.addEventListener('click', () => move(1));
  previous.addEventListener('click', () => move(-1));
  window.addEventListener('pagehide', () => clearTimeout(timer));
  refreshStatus();
}
