import { Mode } from '../../contracts/editor-mode.js';

import { mountScreenplayNavigation } from './screenplay-navigation.js';
import { renderStructuredDocument } from '../ui/document-surfaces.js';

export function renderScreenplayBookMode(view, mode) {
  renderStructuredDocument(view, mode, {
    previewClass: 'screenplay-preview',
    editorClass: 'screenplay-wysiwyg',
    emptyText: 'Sin contenido de guión',
    placeholder: 'Comienza a escribir tu guión cinematográfico...',
    enforceH1: true,
  });
  if (mode === Mode.WYSIWYG || mode === Mode.PREVIEW) {
    view.previewCleanup = mountScreenplayNavigation(
      view.context.node,
      view.context.surface,
      view.context,
      mode === Mode.WYSIWYG,
    );
  }
}
