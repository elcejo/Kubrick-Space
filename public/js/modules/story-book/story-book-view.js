import { safeContent } from '../../safe-html.js';
import { storyBookDocumentFromHTML, storyBookDocumentToHTML } from './story-book-document.js';
import { AppState } from '../../app-state.js';
import { Mode } from '../../contracts/editor-mode.js';
import { createDocumentPreviewSurface, createEditableDocumentSurface } from '../ui/document-surfaces.js';
import { ensureStoryBookRows } from './story-book-rows.js';
import { mountStoryBookInsertion } from './story-book-insertion.js';

export function renderStoryBookMode(view, mode) {
  const node = view.context.node;
  if (!node) return;

  switch (mode) {
    case Mode.PREVIEW: {
      const isStoryBook =
        AppState.currentProject?.type === 'book' &&
        (AppState.currentProject?.category === 'story-book' || !AppState.currentProject?.category);
      if (isStoryBook) {
        view.context.indexNode = document.createElement('div');
        view.context.indexNode.className = 'editor-index-container';
        view.context.indexNode.contentEditable = 'false';
        node.appendChild(view.context.indexNode);
      }

      if (isStoryBook) {
        view.context.storyBookDocument = storyBookDocumentFromHTML(
          view.context.htmlContent,
          view.context.storyBookDocument,
        );
        view.context.htmlContent = safeContent(storyBookDocumentToHTML(view.context.storyBookDocument));
      }
      const div = createDocumentPreviewSurface({
        htmlContent: view.context.htmlContent || '<p class="editor-empty-placeholder">Sin contenido</p>',
      });
      view.context.surface = div;
      if (isStoryBook) ensureStoryBookRows(div, { editable: false });
      break;
    }

    case Mode.WYSIWYG: {
      const isStoryBook =
        AppState.currentProject?.type === 'book' &&
        (AppState.currentProject?.category === 'story-book' || !AppState.currentProject?.category);
      if (isStoryBook) {
        view.context.indexNode = document.createElement('div');
        view.context.indexNode.className = 'editor-index-container';
        view.context.indexNode.contentEditable = 'false';
        node.appendChild(view.context.indexNode);
      }

      if (isStoryBook) {
        // Always start from the flat, canonical projection. Tree wrappers
        // are editor-only and must never accumulate between mode switches.
        view.context.storyBookDocument = storyBookDocumentFromHTML(
          view.context.htmlContent,
          view.context.storyBookDocument,
        );
        view.context.htmlContent = safeContent(storyBookDocumentToHTML(view.context.storyBookDocument));
      }
      const div = createEditableDocumentSurface({
        htmlContent: view.context.htmlContent,
        placeholder: 'Empieza a escribir...',
        onInput: () => view.context.emitChange(),
      });
      view.context.surface = div;
      if (isStoryBook) view.context.prepareStoryBookTree(div);
      break;
    }

    case Mode.MARKDOWN: {
      view.renderMarkdownEditorSurface();
      break;
    }
  }

  if (view.context.surface && view.context.node) {
    view.context.node.appendChild(view.context.surface);
    if (mode === Mode.WYSIWYG || mode === Mode.PREVIEW) {
      const isStoryBook =
        AppState.currentProject?.type === 'book' &&
        (AppState.currentProject?.category === 'story-book' || !AppState.currentProject?.category);
      if (isStoryBook) {
        if (mode === Mode.WYSIWYG) {
          view.context.enforceH1Limit();
          view.context.autoTagCharacters();
          view.context.autoTagDefinitions();
          view.previewCleanup = mountStoryBookInsertion(node, view.context.surface, () =>
            view.context.emitChange(),
          );
        }
        view.context.updateIndex();
      }
      view.context.updateAllInlineTagStyles();
    }
  }
}
