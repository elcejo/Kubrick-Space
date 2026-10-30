/** Theme-aware brand assets. Uses the application theme without owning its preference. */
let initialized = false;

export function initBrand() {
  if (initialized) return;
  initialized = true;
  const root = document.documentElement;
  let favicon = document.querySelector('link[rel="icon"]');
  if (!favicon) {
    favicon = document.createElement('link');
    favicon.rel = 'icon';
    document.head.appendChild(favicon);
  }
  favicon.type = 'image/svg+xml';
  const update = () => {
    const variant = root.dataset.theme === 'light' ? 'light' : 'dark';
    favicon.setAttribute('href', `/icons/kubrick-${variant}.svg`);
  };
  update();
  new MutationObserver(update).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
}
