import { versionPresentation } from './workspace-presentation.js';
import { prepareAssistantStoryBook } from '../story-book/story-book-document.js';
import { parseCharacterDocument } from '../characters/character-model.js';
import { characterDocumentToHTML } from '../characters/character-workspace.js';
import { prepareCharacterProject } from '../characters/character-document.js';
import { prepareScenarioProject, scenarioDocumentToHTML } from '../scenarios/scenario-workspace.js';
import { parseScenarioDocument } from '../../contracts/scenario.js';
import { filmDocumentToHTML } from '../film/film-workspace.js';
import { isFilmProject, parseFilmDocument, prepareFilmProject } from '../../contracts/film.js';
import { productionHTML, imageToPNG } from '../media/export-content.js';
import { parseScreenplayContent, screenplayToHTML } from '../screenplay/screenplay-document.js';
import { screenplayDocx, screenplayPrintDocument } from '../screenplay/screenplay-export.js';
import { recoverGeneratedImages } from '../media/generated-media.js';
import { recoverDrafts } from '../documents/drafts.js';
import { mergeProjectDraft } from '../documents/document-draft.js';
import { safeHTML, escapeHTML } from '../../safe-html.js';
/**
 * @module workspace
 * @description Master Workspace Controller — mounts and coordinates the full
 * editing workspace (canvas, editor, chat, toolbar, sidebars, autosave, drag-drop).
 */

import { EventBus } from '../../event-bus.js';
import { AppState, setActiveProject, setActiveModuleConfig, renameProjectSummary } from '../../app-state.js';
import { getModuleByType } from './project-module-registry.js';
import { API } from '../../api-service.js';
import { Canvas } from '../../canvas.js';
import { Editor } from './editor.js';
import { Chat } from '../ai/chat.js?v=chat-saved-library-6';
import { Toolbar } from './toolbar.js?v=document-versions-1';
import { SidebarLeft } from '../ingredients/sidebar-left.js';
import { Autosave } from '../documents/autosave.js';
import { DragDrop } from '../../drag-drop.js';
import { Convert } from '../ui/convert.js';
import { parseStoryBookContent, storyBookDocumentToHTML } from '../story-book/story-book-document.js';
import { Toast } from '../../ui-components.js';
import { VideoBoard } from './video-board.js';

/**
 * @typedef {Object} ModuleConfig
 * @property {string}   type
 * @property {string}   label
 * @property {string}   icon
 * @property {Array}    subcategories
 * @property {Array}    ingredients
 * @property {Array}    exportFormats
 * @property {Function} getSidebarConfig
 */

/**
 * Creates the static DOM skeleton for the workspace.
 * ┌─────────────────────────────────────────────┐
 * │                  toolbar                    │
 * ├──────┬───────────────────────────┬─────────┤
 * │ left │          canvas            │  chat   │
 * │ side │                           │ lateral │
 * └──────┴───────────────────────────┴─────────┘
 * @param {HTMLElement} root
 * @returns {{ toolbar: HTMLElement, sidebarLeft: HTMLElement, canvas: HTMLElement, chat: HTMLElement }}
 */
function createLayout(root) {
  const wrapper = root.querySelector('.workspace');
  if (!wrapper) {
    throw new Error('[Workspace] .workspace container not found in loaded HTML');
  }

  return {
    toolbar: wrapper.querySelector('.workspace__toolbar'),
    navigator: wrapper.querySelector('.workspace__navigator'),
    sidebarLeft: wrapper.querySelector('.workspace__sidebar-left'),
    canvas: wrapper.querySelector('.workspace__canvas'),
    chat: wrapper.querySelector('.workspace__chat'),
  };
}

/** Convert the editor's cleaned HTML to a portable Markdown document. */
function htmlToExportMarkdown(html) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  doc.querySelectorAll('.kai-remove-btn').forEach((button) => button.remove());

  const inline = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const value = Array.from(node.childNodes).map(inline).join('');
    switch (node.tagName.toLowerCase()) {
      case 'strong':
      case 'b':
        return `**${value}**`;
      case 'em':
      case 'i':
        return `*${value}*`;
      case 'u':
        return `<u>${value}</u>`;
      case 'br':
        return '\n';
      case 'code':
        return `\`${value}\``;
      default:
        return value;
    }
  };

  const blocks = Array.from(doc.body.children)
    .map((element) => {
      const text = inline(element)
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      if (!text) return '';
      switch (element.tagName.toLowerCase()) {
        case 'h1':
          return `# ${text}`;
        case 'h2':
          return `## ${text}`;
        case 'h3':
          return `### ${text}`;
        case 'h4':
          return `#### ${text}`;
        case 'blockquote':
          return text
            .split('\n')
            .map((line) => `> ${line}`)
            .join('\n');
        case 'ul':
          return Array.from(element.children)
            .filter((item) => item.tagName === 'LI')
            .map((item) => `- ${inline(item).trim()}`)
            .join('\n');
        case 'ol':
          return Array.from(element.children)
            .filter((item) => item.tagName === 'LI')
            .map((item, index) => `${index + 1}. ${inline(item).trim()}`)
            .join('\n');
        default:
          return text;
      }
    })
    .filter(Boolean);

  return `${blocks.join('\n\n').trim()}\n`;
}

function exportFileName(name, extension) {
  const base =
    String(name || 'documento')
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100) || 'documento';
  return `${base}${extension}`;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Master Workspace Controller.
 *
 * Usage:
 * ```js
 * const ws = new Workspace();
 * await ws.mount(document.getElementById('app'), 'project-123');
 * // …later…
 * ws.unmount();
 * ```
 */
export class Workspace {
  #releaseAIContext = null;
  /** @type {Canvas|null} */ #canvas = null;
  /** @type {Editor|null} */ #editor = null;
  /** @type {Chat|null} */ #chat = null;
  /** @type {Toolbar|null} */ #toolbar = null;
  /** @type {import('./workspace-navigator.js').WorkspaceNavigator|null} */ #navigator = null;
  /** @type {SidebarLeft|null} */ #sidebarLeft = null;
  /** @type {Autosave|null} */ #autosave = null;
  /** @type {DragDrop|null} */ #dragDrop = null;
  /** @type {VideoBoard|null} */ #videoBoard = null;
  /** @type {HTMLElement|null} */ #root = null;
  /** @type {string|null} */ #projectId = null;
  /** @type {boolean} */ #mounted = false;
  /** @type {boolean} */ #exporting = false;

  // --- Internal EventBus wiring handlers (stored so we can `.off()` them) ---
  /** @type {Record<string, Function>} */
  #handlers = {};

  /**
   * Mount the workspace into `container` for `projectId`.
   *
   * @param {HTMLElement} container — the DOM element to render into
   * @param {string}      projectId
   * @returns {Promise<void>}
   */
  async mount(container, projectId, isCurrent = () => true) {
    if (this.#mounted) {
      this.unmount();
    }

    this.#root = container;
    this.#projectId = projectId;

    // 1. Fetch project data --------------------------------------------------
    let projectData;
    let documentDraft = null;
    try {
      projectData = await API.openProject(projectId);
      if (!isCurrent()) return;
      documentDraft = await recoverDrafts(projectId);
      if (!isCurrent()) return;
      const recoveredImages = await recoverGeneratedImages(projectId);
      if (recoveredImages && !documentDraft?.localOnly) documentDraft = await API.getProjectDraft(projectId);
      if (!isCurrent()) return;
      projectData = await API.getProject(projectId);
      if (!isCurrent()) return;
      projectData = mergeProjectDraft(projectData, documentDraft);
    } catch (err) {
      if (!isCurrent()) return;
      console.error('[Workspace] Failed to fetch project:', err);
      container.innerHTML = safeHTML(`<div class="workspace-error">
           <h2>Error loading project</h2>
           <p>${err.message ?? 'Unknown error'}</p>
         </div>`);
      return;
    }

    // 2. Import the project-type module --------------------------------------
    /** @type {ModuleConfig} */
    let moduleConfig;
    try {
      moduleConfig = await getModuleByType(projectData.type);
    } catch (err) {
      console.error('[Workspace] Failed to load module for type:', projectData.type, err);
      container.innerHTML = safeHTML(`<div class="workspace-error">
           <h2>Unknown project type: ${projectData.type}</h2>
         </div>`);
      return;
    }

    if (!isCurrent()) return;
    const { WorkspaceNavigator } = await import('./workspace-navigator.js?v=workspace-nav-icons-1');
    if (!isCurrent()) return;

    // Initialize without inventing biography or rewriting existing prose.
    if (projectData.type === 'character') prepareCharacterProject(projectData);
    if (projectData.type === 'stage') prepareScenarioProject(projectData);
    if (isFilmProject(projectData)) prepareFilmProject(projectData);

    // 2.6. Book dynamic initialization ---------------------------------------
    if (projectData.type === 'book') {
      if (!documentDraft && (!projectData.content || projectData.content.trim() === '')) {
        const category = projectData.category || 'story-book';
        if (category === 'screenplay') {
          // Editable placeholders belong to the UI, never to the manuscript sent to AI.
          projectData.content = JSON.stringify(
            parseScreenplayContent(
              '<h1>' +
                escapeHTML(projectData.name || 'Guión sin título') +
                '</h1><h2><br></h2><p><br></p><h3><br></h3><blockquote><br></blockquote>',
            ),
          );
        } else if (category === 'theater') {
          projectData.content = '<h2>ESCENA I</h2>\n<p>Descripción de la escena y personajes...</p>';
        } else if (category === 'comic') {
          projectData.content = '<h2>PÁGINA 1 - VIÑETA 1</h2>\n<p>Descripción de la imagen...</p>';
        } else if (category === 'digital') {
          projectData.content =
            '<h1>Título de la Publicación</h1>\n<p>Escribe tu contenido digital aquí...</p>';
        } else {
          projectData.content =
            '<h1>Título</h1>\n<h2>Capítulo</h2>\n<h3>Subcapítulo / Tema</h3>\n<p>Párrafo</p>';
        }
      }
    }

    // 2.7. Song dynamic initialization ---------------------------------------
    if (projectData.type === 'song') {
      if (!documentDraft && (!projectData.content || projectData.content.trim() === '')) {
        const category = projectData.category || 'single';
        if (category === 'single') {
          projectData.content =
            '<h1>Letra del Sencillo</h1>\n<h2>Intro</h2>\n<p>[Instrumental]</p>\n<h2>Verso 1</h2>\n<p>Escribe la primera estrofa del sencillo...</p>\n<h2>Coro</h2>\n<p>Escribe el estribillo principal...</p>';
        } else if (category === 'album') {
          projectData.content =
            '<h1>Estructura del Álbum</h1>\n<h2>Concepto Artístico</h2>\n<p>Escribe la temática global...</p>\n<h2>Lista de Pistas</h2>\n<p>1. Track 1<br>2. Track 2</p>';
        } else if (category === 'soundtrack') {
          projectData.content =
            '<h1>Cues de la Banda Sonora</h1>\n<h2>Tema Central</h2>\n<p>[00:00 - 02:00] Descripción de la orquestación y tempo...</p>\n<h2>Tema de Suspenso</h2>\n<p>[02:00 - 04:00] Texturas oscuras y sintetizadores...</p>';
        } else {
          projectData.content = '<h1>Nueva Canción</h1>\n<p>Comienza a escribir aquí...</p>';
        }
      }
    }

    // 2.8. Video dynamic initialization --------------------------------------
    if (projectData.type === 'video') {
      if (!documentDraft && (!projectData.content || projectData.content.trim() === '')) {
        const category = projectData.category || 'short-film';
        if (category === 'short-film') {
          projectData.content =
            '<h2>ESCENA 1 - INT. UBICACIÓN - DÍA</h2>\n<p>Escribe la descripción o diálogos aquí...</p>';
        } else if (category === 'feature') {
          projectData.content =
            '<h1>Largometraje: Sinopsis</h1>\n<p>Escribe el argumento general aquí...</p>\n<h2>Estructura de Actos</h2>\n<p>Describe las secuencias clave de cada acto...</p>';
        } else if (category === 'documentary') {
          projectData.content =
            '<h1>Guión de Documental</h1>\n<h2>Tema / Tesis</h2>\n<p>Escribe el núcleo narrativo del documental...</p>\n<h2>Preguntas de Entrevista</h2>\n<p>Formula las preguntas principales aquí...</p>';
        } else if (category === 'music-video') {
          projectData.content =
            '<h1>Tratamiento del Videoclip</h1>\n<h2>Concepto Visual</h2>\n<p>Describe el estilo visual del videoclip...</p>\n<h2>Escena / Ritmo de Edición</h2>\n<p>[00:00 - 00:30] Compases rápidos...</p>';
        } else if (category === 'animation') {
          projectData.content =
            '<h1>Diseño de Animación</h1>\n<h2>Hojas de Personajes (Model Sheet)</h2>\n<p>Dibuja y describe los personajes de la animación...</p>\n<h2>Planificación de Keyframes</h2>\n<p>Detalla los cuadros clave del animático aquí...</p>';
        } else {
          projectData.content = '<h1>Título del Video</h1>\n<p>Comienza a escribir aquí...</p>';
        }
      }
    }

    if (!isCurrent()) return;
    // 3. Publish the active project and its module config --------------------
    setActiveProject(projectData);
    setActiveModuleConfig(moduleConfig);

    // 4. Build DOM layout ----------------------------------------------------
    const layout = createLayout(container);
    const wrapper = container.querySelector('.workspace');
    wrapper.dataset.projectType = projectData.type;
    wrapper.dataset.projectCategory = projectData.category || '';

    // 5. Initialise sub-modules in order -------------------------------------
    try {
      this.#canvas = new Canvas();
      this.#canvas.init(layout.canvas);
      this.#canvas.setEffects(AppState.canvasEffects);

      this.#editor = new Editor();
      this.#editor.init(this.#canvas.getContainer(), projectData, {
        onBackgroundState: (state) => {
          this.#autosave?.acceptBackgroundState(state);
          this.#toolbar?.setBackgroundBusy(state.busy);
        },
      });
      this.#releaseAIContext = API.setAIContextProvider(() => ({
        projectId: this.#projectId,
        context: this.#editor.getContext(),
      }));

      if (projectData.type === 'video' && !isFilmProject(projectData)) {
        this.#videoBoard = new VideoBoard();
        this.#videoBoard.init(this.#canvas.getContainer(), projectData);
      }

      // Editing modes now live in the stable project navigator. Keep the
      // legacy rail container empty so it does not duplicate those controls.

      this.#sidebarLeft = new SidebarLeft();
      this.#sidebarLeft.init(layout.sidebarLeft, moduleConfig);

      this.#toolbar = new Toolbar();
      this.#toolbar.init(layout.toolbar, projectData, {
        ...moduleConfig,
        versionPresentation: versionPresentation(projectData),
      });

      this.#navigator = new WorkspaceNavigator();
      this.#navigator.init(layout.navigator, projectData, moduleConfig, this.#canvas);

      this.#chat = new Chat();
      this.#chat.init(layout.chat, {
        acceptBookJob: (response, expected) => {
          const busy = ['queued', 'running'].includes(response.job.status);
          const content = response.draft?.payload.content || expected;
          this.#autosave?.acceptBackgroundState({ busy, draft: response.draft });
          return this.#editor.acceptBackgroundBook(content, expected, busy);
        },
        prepareProjectContent: (project, content) =>
          project.type === 'book' && project.category === 'story-book'
            ? prepareAssistantStoryBook(
                safeHTML(
                  /<h1\b/i.test(content)
                    ? content
                    : '<h1>' + escapeHTML(project.name || 'Título') + '</h1>' + content,
                ),
              )
            : content,
        applyDocumentChange: async (proposal, expectedContent) => {
          const result = this.#editor.applyAssistantDocument(proposal, expectedContent);
          await this.#autosave.forceSave();
          return { ...result, saved: true };
        },
        executeCharacterAction: (action, transport) => this.#editor.executeCharacterAction(action, transport),
        attachCharacterPhoto: (file) => this.#editor.attachCharacterPhoto(file),
      });

      this.#autosave = new Autosave();
      this.#autosave.init(projectId, documentDraft?.revision || 0);

      this.#dragDrop = new DragDrop();
      this.#dragDrop.init(this.#canvas);
    } catch (err) {
      console.error('[Workspace] Failed to initialise sub-modules:', err);
      this.unmount();
      return;
    }

    // 6. Cross-module coordination via EventBus ------------------------------
    this.#wireEvents();
    EventBus.emit('workspace:context:ready');

    this.#mounted = true;
    if (this.#canvas) {
      this.#canvas.fitToViewport();
    }
    EventBus.emit('workspace:mounted', { projectId });
  }

  /**
   * Tear down the workspace: destroy all sub-modules, remove listeners,
   * and clear the container.
   */
  async beforeLeave() {
    return this.#autosave ? this.#autosave.beforeLeave() : true;
  }

  unmount() {
    this.#releaseAIContext?.();
    this.#releaseAIContext = null;
    this.#unwireEvents();

    [
      this.#autosave,
      this.#dragDrop,
      this.#videoBoard,
      this.#chat,
      this.#sidebarLeft,
      this.#toolbar,
      this.#navigator,
      this.#editor,
      this.#canvas,
    ].forEach((mod) => {
      try {
        mod?.destroy?.();
      } catch (e) {
        console.warn('[Workspace] Cleanup error:', e);
      }
    });

    this.#canvas = null;
    this.#editor = null;
    this.#chat = null;
    this.#toolbar = null;
    this.#navigator = null;
    this.#sidebarLeft = null;
    this.#autosave = null;
    this.#dragDrop = null;
    this.#videoBoard = null;

    if (this.#root) {
      this.#root.innerHTML = safeHTML('');
    }

    setActiveProject(null);
    setActiveModuleConfig(null);
    this.#mounted = false;

    EventBus.emit('workspace:unmounted', { projectId: this.#projectId });
    this.#projectId = null;
  }

  // ─── Private helpers ─────────────────────────────────────────────────

  /**
   * Wire cross-module EventBus coordination handlers.
   * Stored in `#handlers` so they can be cleaned up later.
   */
  #wireEvents() {
    // Editor requests context → editor supplies it via callback pattern
    this.#handlers['editor:getContext'] = () => {
      if (this.#editor) {
        const ctx = this.#editor.getContext();
        EventBus.emit('editor:context', ctx);
      }
    };

    // Format commands from left sidebar → editor
    this.#handlers['editor:applyFormat'] = (cmd) => this.#editor?.applyFormat(cmd);
    this.#handlers['editor:applyHeading'] = (lvl) => this.#editor?.applyHeading(lvl);
    this.#handlers['editor:applyColor'] = (c) => this.#editor?.applyColor(c);
    this.#handlers['editor:applyTag'] = () => this.#editor?.applyTag();
    this.#handlers['editor:applyBlock'] = () => this.#editor?.applyBlock();
    this.#handlers['editor:removeTag'] = () => this.#editor?.removeTag();
    this.#handlers['editor:removeBlock'] = () => this.#editor?.removeBlock();
    this.#handlers['editor:getContent'] = () => {
      if (this.#editor) {
        const content = this.#editor.getContent();
        EventBus.emit('editor:content', content);
      }
    };

    this.#handlers['canvas:fit'] = () => this.#canvas?.fitToViewport();
    this.#handlers['state:change'] = ({ key, value }) => {
      if (key === 'canvasEffects') this.#canvas?.setEffects(value);
    };
    this.#handlers['workspace:chat:toggle'] = () => {
      // The side panel changes the usable horizontal canvas area. Refit after
      // the CSS transition starts and once it finishes so the book is not
      // left underneath a panel measured halfway through its animation.
      requestAnimationFrame(() => this.#canvas?.fitToViewport());
      setTimeout(() => this.#canvas?.fitToViewport(), 360);
    };

    this.#handlers['export:request'] = (format) => this.#exportProject(format);
    this.#handlers['document:save-permanent'] = () => this.#savePermanentVersion();
    this.#handlers['document:restore-version'] = async ({ projectId, versionId, expectedContent }) => {
      const project = AppState.currentProject;
      if (
        projectId !== this.#projectId ||
        project?.category !== 'screenplay' ||
        this.#editor.getContent() !== expectedContent
      )
        throw new Error('El guión cambió. Revisa la versión antes de recuperar.');
      const ingredients = JSON.stringify(project.ingredients);
      const version = await API.getDocumentVersion(projectId, versionId);
      parseScreenplayContent(version.snapshot.content || '');
      if (
        AppState.currentProject !== project ||
        this.#editor.getContent() !== expectedContent ||
        JSON.stringify(project.ingredients) !== ingredients
      )
        throw new Error('El documento cambió durante la recuperación.');
      await this.#autosave.forceSave();
      if (
        AppState.currentProject !== project ||
        this.#editor.getContent() !== expectedContent ||
        JSON.stringify(project.ingredients) !== ingredients
      )
        throw new Error('El documento cambió durante el guardado.');
      localStorage.setItem(
        `kai-before-version-recovery:${projectId}`,
        JSON.stringify({
          savedAt: new Date().toISOString(),
          payload: { ...project, content: expectedContent },
        }),
      );
      this.#editor.destroy();
      Object.assign(project, version.snapshot);
      renameProjectSummary(projectId, project.name);
      const nameInput = document.querySelector('#toolbar-project-name');
      if (nameInput) nameInput.value = project.name;
      this.#editor = new Editor();
      this.#editor.init(this.#canvas.getContainer(), project);
      EventBus.emit('editor:change');
      await this.#autosave.forceSave();
      EventBus.emit('canvas:fit');
      Toast.show('Versión recuperada como borrador.', 'success');
      return true;
    };

    for (const [event, handler] of Object.entries(this.#handlers)) {
      EventBus.on(event, handler);
    }
  }

  /** Remove all EventBus handlers we attached. */
  #unwireEvents() {
    for (const [event, handler] of Object.entries(this.#handlers)) {
      EventBus.off(event, handler);
    }
    this.#handlers = {};
  }

  /** Promote the current temporary draft into the next permanent version. */
  async #savePermanentVersion() {
    try {
      const version = await this.#autosave?.savePermanent();
      if (version) Toast.show(`Versión ${version.number} guardada permanentemente.`, 'success');
    } catch (error) {
      console.error('[Workspace] Permanent document save failed:', error);
      Toast.show(
        `No se pudo guardar la versión permanente: ${error.message || 'error desconocido'}`,
        'error',
      );
    }
  }

  /** Save the current draft, then prepare a truthful export for its format. */
  async #exportProject(format) {
    if (this.#exporting) return;
    this.#exporting = true;
    EventBus.emit('export:started');

    try {
      await this.#autosave?.forceSave();
      const project = AppState.currentProject;
      const content =
        project?.type === 'video' && !isFilmProject(project)
          ? productionHTML(project)
          : this.#editor?.getContent() || '';
      const projectName = AppState.currentProject?.name || 'documento';
      const isStoryBook =
        project?.type === 'book' && (project?.category === 'story-book' || !project?.category);
      const isScreenplay = project?.type === 'book' && project?.category === 'screenplay';
      const exportHtml =
        project?.type === 'character'
          ? characterDocumentToHTML(parseCharacterDocument(content))
          : isFilmProject(project)
            ? filmDocumentToHTML(parseFilmDocument(content))
            : project?.type === 'stage'
              ? scenarioDocumentToHTML(parseScenarioDocument(content))
              : isStoryBook
                ? storyBookDocumentToHTML(parseStoryBookContent(content))
                : isScreenplay
                  ? screenplayToHTML(parseScreenplayContent(content))
                  : content;
      const cleanHtml = ['video', 'character', 'stage'].includes(project?.type)
        ? exportHtml
        : Convert.htmlToMarkdown(exportHtml);

      if (isScreenplay && format === 'docx') {
        downloadBlob(screenplayDocx(content), exportFileName(projectName, '.docx'));
        Toast.show('Guión DOCX exportado.', 'success');
      } else if (format === 'md') {
        downloadBlob(
          new Blob([htmlToExportMarkdown(cleanHtml)], { type: 'text/markdown;charset=utf-8' }),
          exportFileName(projectName, '.md'),
        );
        Toast.show('Markdown exportado.', 'success');
      } else if (format === 'docx' || format === 'doc') {
        const documentHtml = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHTML(projectName)}</title><style>body{font-family:Georgia,serif;max-width:760px;margin:48px auto;line-height:1.65;color:#111}h1,h2,h3{font-family:Arial,sans-serif;page-break-after:avoid}blockquote{margin:1em 2em}tag{font-weight:600}</style></head><body>${cleanHtml}</body></html>`;
        downloadBlob(
          new Blob([documentHtml], { type: 'application/msword' }),
          exportFileName(projectName, '.doc'),
        );
        Toast.show('Documento de Word exportado.', 'success');
      } else if (['pdf', 'pdf-sheet', 'script-pdf'].includes(format)) {
        const printWindow = window.open('', '_blank');
        if (!printWindow) throw new Error('El navegador bloqueó la ventana de impresión.');
        const printDocument = isScreenplay
          ? screenplayPrintDocument(content, projectName)
          : `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHTML(projectName)}</title><style>@page{margin:20mm}body{font-family:Georgia,serif;max-width:760px;margin:0 auto;line-height:1.65;color:#111}h1,h2,h3{font-family:Arial,sans-serif;page-break-after:avoid}h1{font-size:25pt}h2{font-size:16pt;margin-top:1.8em}blockquote{margin:1em 2em}tag{font-weight:600}</style></head><body>${cleanHtml}</body></html>`;
        printWindow.document.write(safeHTML(printDocument, true));
        printWindow.document.close();
        printWindow.focus();
        printWindow.onafterprint = () => printWindow.close();
        window.setTimeout(() => printWindow.print(), 250);
        Toast.show('Abriendo impresión: selecciona “Guardar como PDF”.', 'success');
      } else if (format === 'png-card') {
        const covers = AppState.currentProject?.covers || [];
        const index = AppState.currentProject?.currentCoverIndex;
        const imageUrl = covers[index] || covers[covers.length - 1];
        if (!imageUrl) throw new Error('Genera o sube un retrato antes de exportar una tarjeta PNG.');
        const response = await fetch(imageUrl);
        if (!response.ok) throw new Error('No se pudo recuperar el retrato actual.');
        downloadBlob(await imageToPNG(await response.blob()), exportFileName(projectName, '.png'));
        Toast.show('Retrato PNG exportado.', 'success');
      } else if (format === 'mp4' || format === 'mov') {
        Toast.show('El render final de video aún no está disponible; tu guión ya quedó guardado.', 'warning');
      } else {
        downloadBlob(
          new Blob([htmlToExportMarkdown(cleanHtml)], { type: 'text/plain;charset=utf-8' }),
          exportFileName(projectName, '.txt'),
        );
        Toast.show('Documento exportado.', 'success');
      }
      EventBus.emit('export:completed');
    } catch (err) {
      console.error('[Workspace] Export failed:', err);
      Toast.show(`No se pudo exportar: ${err.message || 'error desconocido'}`, 'error');
      EventBus.emit('export:error', err);
    } finally {
      this.#exporting = false;
    }
  }
}
