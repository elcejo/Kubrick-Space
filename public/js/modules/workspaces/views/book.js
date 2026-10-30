export { renderStoryBookMode } from '../../story-book/editing.js';
export { renderScreenplayBookMode } from '../../screenplay/workspace.js';
import { renderStructuredDocument } from '../../ui/document-surfaces.js';

export function renderTheaterBookMode(view, mode) {
  renderStructuredDocument(view, mode, {
    previewClass: 'theater-preview',
    editorClass: 'theater-wysiwyg',
    emptyText: 'Sin contenido de libreto',
    placeholder: 'Comienza a escribir tu libreto teatral...',
  });
}

export function renderComicBookMode(view, mode) {
  renderStructuredDocument(view, mode, {
    previewClass: 'comic-preview',
    editorClass: 'comic-wysiwyg',
    emptyText: 'Sin contenido de cómic',
    placeholder: 'Comienza a escribir tu guión de cómic...',
  });
}

export function renderDigitalBookMode(view, mode) {
  renderStructuredDocument(view, mode, {
    previewClass: 'digital-preview',
    editorClass: 'digital-wysiwyg',
    emptyText: 'Sin contenido digital',
    placeholder: 'Comienza a escribir tu contenido digital...',
  });
}
