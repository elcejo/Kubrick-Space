// Preserve Kubrick Space semantic tags and SVG icons while removing executable HTML.
export function safeHTML(value, wholeDocument = false) {
  if (!globalThis.DOMPurify) throw new Error('HTML sanitizer could not be loaded');
  return globalThis.DOMPurify.sanitize(String(value ?? ''), {
    ADD_TAGS: [
      'tag',
      'lock',
      'age',
      'skin',
      'complexion',
      'voice',
      'pitch',
      'lore',
      'psychology',
      'pseudonyms',
      'clothing',
    ],
    ADD_ATTR: ['definition', 'focusable'],
    ADD_URI_SAFE_ATTR: ['definition'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'base', 'link', 'meta'],
    FORBID_ATTR: ['srcdoc'],
    WHOLE_DOCUMENT: wholeDocument,
  });
}

export function escapeHTML(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
}

// Replaces inline image-error JavaScript, which CSP deliberately blocks.
if (typeof document !== 'undefined')
  document.addEventListener(
    'error',
    (event) => {
      const img = event.target;
      if (!(img instanceof HTMLImageElement)) return;
      const fallback = img.dataset.fallback;
      if (fallback && !img.dataset.triedFallback) {
        img.dataset.triedFallback = 'true';
        img.src = fallback;
      } else {
        img.hidden = true;
        const icon = img.parentElement?.querySelector('.bubble-icon-span');
        if (icon) {
          icon.classList.remove('is-hidden');
          icon.classList.add('is-fallback-visible');
        }
        img.parentElement?.classList.add('project-thumbnail-fallback');
      }
    },
    true,
  );

// User documents have a stricter boundary than trusted application templates.
export function safeContent(value) {
  if (!globalThis.DOMPurify) throw new Error('HTML sanitizer could not be loaded');
  const fragment = globalThis.DOMPurify.sanitize(String(value ?? ''), {
    ALLOWED_TAGS: [
      'p',
      'div',
      'span',
      'br',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'strong',
      'b',
      'em',
      'i',
      'u',
      's',
      'strike',
      'ul',
      'ol',
      'li',
      'blockquote',
      'pre',
      'code',
      'a',
      'font',
      'table',
      'thead',
      'tbody',
      'tr',
      'td',
      'th',
      'hr',
      'tag',
      'lock',
      'age',
      'skin',
      'complexion',
      'voice',
      'pitch',
      'lore',
      'psychology',
      'pseudonyms',
      'clothing',
    ],
    ALLOWED_ATTR: [
      'title',
      'style',
      'class',
      'href',
      'color',
      'definition',
      'data-tag',
      'data-definition',
      'data-kai-id',
      'contenteditable',
      'spellcheck',
    ],
    ALLOW_DATA_ATTR: false,
    // Opaque document metadata, never navigation URLs. Otherwise a value
    // such as character:UUID is rejected as an unknown URI scheme.
    ADD_URI_SAFE_ATTR: ['definition', 'data-definition', 'data-tag', 'data-kai-id'],
    RETURN_DOM_FRAGMENT: true,
  });
  const styles = {
    color: /^(#[\da-f]{3,8}|[a-z]+|rgba?\([\d\s.,%]+\))$/i,
    'background-color': /^(#[\da-f]{3,8}|[a-z]+|rgba?\([\d\s.,%]+\))$/i,
    'text-align': /^(left|right|center|justify)$/,
    'font-weight': /^(normal|bold|[1-9]00)$/,
    'font-style': /^(normal|italic|oblique)$/,
    'text-decoration': /^(none|underline|line-through)$/,
  };
  fragment.querySelectorAll('*').forEach((element) => {
    const kept = [];
    for (const name of Object.keys(styles)) {
      const val = element.style.getPropertyValue(name).trim();
      if (styles[name].test(val)) kept.push(`${name}:${val}`);
    }
    element.removeAttribute('style');
    if (kept.length) element.setAttribute('style', kept.join(';'));
    // Keep the character marker so the editor can resolve a tag to its
    // ingredient and render the portrait in the hover tooltip. It is a
    // presentation marker only; all other user classes remain stripped.
    const classes = [...element.classList].filter((name) =>
      ['kai-tag', 'kai-character-tag', 'kai-block'].includes(name),
    );
    element.removeAttribute('class');
    if (classes.length) element.className = classes.join(' ');
    const href = element.getAttribute('href');
    if (href && !/^https?:\/\//i.test(href)) element.removeAttribute('href');
  });
  const container = fragment.ownerDocument.createElement('div');
  container.appendChild(fragment);
  return container.innerHTML;
}
