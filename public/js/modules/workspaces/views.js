import { safeHTML } from '../../safe-html.js';
import { serializeStoryBookDocument, storyBookDocumentFromHTML } from '../story-book/story-book-document.js';
import { screenplayFromHTML } from '../screenplay/screenplay-document.js';
import { AppState } from '../../app-state.js';
import { Toast } from '../../ui-components.js';
import { Mode } from '../../contracts/editor-mode.js';
import { createCodeEditorSurface } from '../ui/document-surfaces.js';
import { renderCharacterMode } from './views/character.js';
import { renderStageMode } from './views/stage.js';
import { renderFilmMode } from './views/film.js';
import { renderSingleSongMode, renderAlbumSongMode, renderSoundtrackSongMode } from './views/song.js';
import {
  renderShortFilmVideoMode,
  renderDocumentaryVideoMode,
  renderMusicVideoVideoMode,
  renderAnimationVideoMode,
} from './views/video.js';
import {
  renderStoryBookMode,
  renderScreenplayBookMode,
  renderTheaterBookMode,
  renderComicBookMode,
  renderDigitalBookMode,
} from './views/book.js';

/** Owns views DOM and lifecycle; context is the explicit editor integration contract. */
export class EditorViews {
  previewCleanup = null;
  layoutTimer = null;
  renderVersion = 0;
  constructor(context) {
    this.context = context;
  }

  destroy() {
    this.renderVersion++;
    clearTimeout(this.layoutTimer);
    this.previewCleanup?.();
    this.previewCleanup = null;
  }

  renderMode(mode) {
    const version = ++this.renderVersion;
    this.context.closeTimelinePopover?.();
    clearTimeout(this.layoutTimer);
    this.previewCleanup?.();
    this.previewCleanup = null;
    // Timeline cables are rendered in a layer that lives outside the editor
    // surface. Clear them before replacing the surface so a preview/JSON
    // transition can never leave paths attached to a detached DOM node.
    if (this.context.isStoryBook() && mode !== Mode.WYSIWYG) {
      this.context.clearStoryBookTimelineLinks({ hide: true });
      this.context.requestTimelineGeometry?.();
    }
    if (this.context.indexNode) {
      this.context.indexNode.remove();
      this.context.indexNode = null;
    }
    if (this.context.node) this.context.node.innerHTML = safeHTML('');

    const projectType = AppState.currentProject?.type || 'book';

    switch (projectType) {
      case 'character': {
        this.renderCharacterMode(mode);
        break;
      }
      case 'stage': {
        this.renderStageMode(mode);
        break;
      }
      case 'song': {
        const category = AppState.currentProject?.category || 'single';
        switch (category) {
          case 'album':
            this.renderAlbumSongMode(mode);
            break;
          case 'soundtrack':
            this.renderSoundtrackSongMode(mode);
            break;
          case 'single':
          default:
            this.renderSingleSongMode(mode);
            break;
        }
        break;
      }
      case 'video': {
        const category = AppState.currentProject?.category || 'short-film';
        switch (category) {
          case 'feature':
            this.renderFilmMode(mode);
            break;
          case 'documentary':
            this.renderDocumentaryVideoMode(mode);
            break;
          case 'music-video':
            this.renderMusicVideoVideoMode(mode);
            break;
          case 'animation':
            this.renderAnimationVideoMode(mode);
            break;
          case 'short-film':
          default:
            this.renderShortFilmVideoMode(mode);
            break;
        }
        break;
      }
      default: {
        const category = AppState.currentProject?.category || 'story-book';
        switch (category) {
          case 'screenplay':
            this.renderScreenplayBookMode(mode);
            break;
          case 'theater':
            this.renderTheaterBookMode(mode);
            break;
          case 'comic':
            this.renderComicBookMode(mode);
            break;
          case 'digital':
            this.renderDigitalBookMode(mode);
            break;
          case 'story-book':
          default:
            this.renderStoryBookMode(mode);
            break;
        }
        break;
      }
    }

    if (mode === Mode.WYSIWYG) {
      this.context.ensureRemoveButtons();
    }
    if (this.context.isStoryBook()) {
      if (mode === Mode.WYSIWYG) {
        // #prepareStoryBookTree runs before the new surface is appended to
        // #node. Resolve ports once more after insertion, then redraw after
        // layout has settled so getBoundingClientRect() cannot resolve to
        // (0, 0) and produce cables from the upper-left corner.
        this.context.ensureStoryBookTimelinePorts();
        this.context.syncStoryBookTimelineVisualState();
        const redraw = () => {
          if (version === this.renderVersion && this.context.mode === Mode.WYSIWYG)
            this.context.drawStoryBookTimelineConnections();
        };
        if (typeof globalThis.requestAnimationFrame === 'function') globalThis.requestAnimationFrame(redraw);
        else globalThis.setTimeout?.(redraw, 0);
      } else {
        this.context.clearStoryBookTimelineLinks({ hide: true });
      }
    }
    this.layoutTimer = setTimeout(() => {
      if (version === this.renderVersion) this.context.updateStickyOffsets();
    }, 50);
  }

  renderCharacterMode(mode) {
    return renderCharacterMode(this, mode);
  }

  renderStageMode(mode) {
    return renderStageMode(this, mode);
  }

  renderFilmMode(mode) {
    return renderFilmMode(this, mode);
  }

  renderSingleSongMode(mode) {
    return renderSingleSongMode(this, mode);
  }

  renderAlbumSongMode(mode) {
    return renderAlbumSongMode(this, mode);
  }

  renderSoundtrackSongMode(mode) {
    return renderSoundtrackSongMode(this, mode);
  }

  renderShortFilmVideoMode(mode) {
    return renderShortFilmVideoMode(this, mode);
  }

  renderDocumentaryVideoMode(mode) {
    return renderDocumentaryVideoMode(this, mode);
  }

  renderMusicVideoVideoMode(mode) {
    return renderMusicVideoVideoMode(this, mode);
  }

  renderAnimationVideoMode(mode) {
    return renderAnimationVideoMode(this, mode);
  }

  renderMarkdownEditorSurface() {
    if (this.context.isStoryBook()) {
      this.renderStoryBookJsonSurface();
      return;
    }
    if (this.context.isScreenplay?.()) {
      this.renderStoryBookJsonSurface(
        JSON.stringify(
          this.context.screenplayDocument || screenplayFromHTML(this.context.htmlContent),
          null,
          2,
        ),
        'guión',
      );
      return;
    }
    this.context.surface = createCodeEditorSurface({
      htmlContent: this.context.htmlContent,
      onChange: () => this.context.emitChange(),
    });
  }

  renderStoryBookJsonSurface(json = null, labelText = 'libro') {
    const container = document.createElement('div');
    container.className = 'code-editor-container story-book-json-view';
    container.setAttribute('aria-label', 'Estructura JSON del ' + labelText);

    const header = document.createElement('div');
    header.className = 'story-book-json-header';
    const label = document.createElement('span');
    label.textContent = 'JSON del ' + labelText + ' · solo lectura';
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'story-book-json-copy';
    copyButton.textContent = 'Copiar JSON';
    header.append(label, copyButton);

    const pre = document.createElement('pre');
    pre.className = 'story-book-json-code';
    const code = document.createElement('code');
    code.className = 'language-json';
    if (json === null) {
      this.context.storyBookDocument = storyBookDocumentFromHTML(
        this.context.htmlContent,
        this.context.storyBookDocument,
      );
      json = serializeStoryBookDocument(this.context.storyBookDocument);
    }
    code.textContent = json;
    pre.appendChild(code);
    container.append(header, pre);

    copyButton.addEventListener('click', async () => {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(json);
        } else {
          const range = document.createRange();
          range.selectNodeContents(code);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          document.execCommand('copy');
          selection?.removeAllRanges();
        }
        Toast.show('JSON copiado al portapapeles.', 'success');
      } catch (_) {
        Toast.show('Selecciona el JSON y cópialo manualmente.', 'warning');
      }
    });
    this.context.surface = container;
  }

  renderStoryBookMode(mode) {
    return renderStoryBookMode(this, mode);
  }

  renderScreenplayBookMode(mode) {
    return renderScreenplayBookMode(this, mode);
  }

  renderTheaterBookMode(mode) {
    return renderTheaterBookMode(this, mode);
  }

  renderComicBookMode(mode) {
    return renderComicBookMode(this, mode);
  }

  renderDigitalBookMode(mode) {
    return renderDigitalBookMode(this, mode);
  }
}
