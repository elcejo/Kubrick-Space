import { Mode } from '../../contracts/editor-mode.js';
import { safeHTML, safeContent } from '../../safe-html.js';
import { Convert } from './convert.js';

const SURFACE_TEMPLATES = {
  preview: 'editor-surface-preview-template',
  wysiwyg: 'editor-surface-wysiwyg-template',
};

/** Clone a shared, semantic workspace surface and add feature-specific classes. */
export function createEditorSurface(kind, classNames = '') {
  const templateId = SURFACE_TEMPLATES[kind];
  if (!templateId) throw new TypeError(`Unknown editor surface: ${kind}`);

  const template = document.getElementById(templateId);
  const surface = template?.content?.firstElementChild?.cloneNode(true) || document.createElement('div');
  if (!template) {
    surface.className = `editor-surface editor-surface--${kind}`;
  }
  if (kind === 'wysiwyg') surface.contentEditable = 'true';
  for (const className of String(classNames).split(/\s+/).filter(Boolean)) surface.classList.add(className);
  return surface;
}

export function createDocumentPreviewSurface({ htmlContent = '', fallbackHTML = '', classNames = '' } = {}) {
  const surface = createEditorSurface('preview', classNames);
  surface.innerHTML = safeContent(htmlContent || fallbackHTML);
  return surface;
}

export function createEditableDocumentSurface({
  htmlContent = '',
  fallbackHTML = '',
  placeholder = '',
  classNames = '',
  onInput = () => {},
} = {}) {
  const surface = createEditorSurface('wysiwyg', classNames);
  surface.innerHTML = safeContent(htmlContent || fallbackHTML);
  surface.addEventListener('input', onInput);
  if (!htmlContent && placeholder) surface.dataset.placeholder = placeholder;
  return surface;
}

/**
 * Build the shared HTML-source editor used by project renderers.
 * User-authored document content is converted to plain text before formatting;
 * only parser-generated highlighting is placed back into the DOM.
 */
export function createCodeEditorSurface({
  htmlContent = '',
  placeholder = 'Escribe código HTML limpio...',
  onChange = () => {},
} = {}) {
  const template = document.getElementById('editor-code-surface-template');
  let container = template?.content?.firstElementChild?.cloneNode(true);
  if (!container) {
    container = document.createElement('div');
    container.className = 'code-editor-container';
    const pre = document.createElement('pre');
    pre.className = 'code-editor-highlight';
    pre.setAttribute('aria-hidden', 'true');
    const code = document.createElement('code');
    code.className = 'language-html';
    pre.appendChild(code);
    const textarea = document.createElement('textarea');
    textarea.className = 'code-editor-textarea';
    textarea.spellcheck = false;
    textarea.setAttribute('aria-label', 'Código HTML del documento');
    container.append(pre, textarea);
  }

  const pre = container.querySelector('.code-editor-highlight');
  const code = container.querySelector('.code-editor-highlight code');
  const textarea = container.querySelector('.code-editor-textarea');
  textarea.placeholder = placeholder;

  const updateHighlight = () => {
    code.innerHTML = safeHTML(`${Convert.highlightHTML(textarea.value)}\n`);
  };

  textarea.addEventListener('input', () => {
    updateHighlight();
    onChange();
  });
  textarea.addEventListener('scroll', () => {
    pre.scrollTop = textarea.scrollTop;
    pre.scrollLeft = textarea.scrollLeft;
  });
  textarea.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    textarea.value = `${textarea.value.substring(0, start)}  ${textarea.value.substring(end)}`;
    textarea.selectionStart = textarea.selectionEnd = start + 2;
    updateHighlight();
    onChange();
  });

  textarea.value = Convert.formatHTML(Convert.htmlToMarkdown(htmlContent));
  updateHighlight();
  return container;
}

export function renderStructuredDocument(
  view,
  mode,
  { previewClass, editorClass, emptyText, placeholder, enforceH1 = false },
) {
  const node = view.context.node;
  if (!node) return;

  if (mode === Mode.PREVIEW) {
    const surface = createDocumentPreviewSurface({
      htmlContent: view.context.htmlContent,
      fallbackHTML: `<p class="editor-empty-placeholder">${emptyText}</p>`,
      classNames: previewClass,
    });
    view.context.surface = surface;
  } else if (mode === Mode.WYSIWYG) {
    const surface = createEditableDocumentSurface({
      htmlContent: view.context.htmlContent,
      placeholder,
      classNames: editorClass,
      onInput: () => view.context.emitChange(),
    });
    view.context.surface = surface;
  } else if (mode === Mode.MARKDOWN) {
    view.renderMarkdownEditorSurface();
  }

  if (!view.context.surface) return;
  node.appendChild(view.context.surface);
  if (mode === Mode.WYSIWYG || mode === Mode.PREVIEW) {
    if (mode === Mode.WYSIWYG && enforceH1) view.context.enforceH1Limit();
    view.context.updateAllInlineTagStyles();
  }
}
