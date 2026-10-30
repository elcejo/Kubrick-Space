import { StoryBookEditing } from '../story-book/editing.js';
import { ScreenplayWorkflow } from '../screenplay/workspace.js';
import { CharacterLegacyEditing } from '../characters/editing.js';

import { renderIcon } from '../../icons.js';
import { parseCharacterDocument, characterContextText } from '../characters/character-model.js';
import { prepareCharacterProject } from '../characters/character-document.js';
import { prepareScenarioProject } from '../scenarios/scenario-workspace.js';
import { filmSummary, isFilmProject, parseFilmDocument, prepareFilmProject } from '../../contracts/film.js';
import { parseScenarioDocument, scenarioContextText } from '../../contracts/scenario.js';
import { Mode } from '../../contracts/editor-mode.js';
import { coverArtInstruction } from '../../contracts/text-instructions.js';
import { EditorTimeline } from '../story-book/editing.js';
import { EditorIngredients } from '../ingredients/editor-panel.js';
import { EditorImages } from '../media/editor-media.js';
import { EditorCropper } from '../media/editor-media.js';
import { EditorViews } from './views.js';

import { normalizeAITextRange, applyAITextInBlock } from '../ai/ai-editing.js';
import {
  parseScreenplayContent,
  screenplayToHTML,
  screenplayFromHTML,
  screenplayContext,
} from '../screenplay/screenplay-document.js';
import { handleScreenplayKey, formatScreenplayBlocks } from '../screenplay/screenplay-editor.js';
import { applyScreenplayEdit } from '../screenplay/screenplay-ai.js';

import { safeHTML, safeContent } from '../../safe-html.js';
import {
  parseStoryBookContent,
  serializeStoryBookDocument,
  storyBookDocumentFromHTML,
  storyBookDocumentToHTML,
  prepareAssistantStoryBook,
} from '../story-book/story-book-document.js';
/**
 * @module editor
 * @description WYSIWYG / Markdown / Preview editor with tag and block annotations.
 * Lives inside the canvas transform container. Supports three modes that can be
 * switched via EventBus 'editor:setMode'.
 */

import { EventBus } from '../../event-bus.js';
import {
  storyBookRow,
  storyBookBlockFromTarget,
  storyBookRowsNeedRebuild,
  captureStoryBookSelection,
  restoreStoryBookSelection,
} from '../story-book/editing.js';
import { AppState } from '../../app-state.js';
import { API } from '../../api-service.js';
import { enqueueRemoteCharacterAction, attachCharacterTaskPhoto } from './character-task-client.js';
import { Loader, Toast, Alert } from '../../ui-components.js';
import { Convert } from '../ui/convert.js';

/**
 * WYSIWYG / Markdown / Preview editor.
 *
 * @example
 * const ed = new Editor();
 * ed.init(canvasTransformContainer, projectData);
 */
export class Editor {
  #storyEditing = new StoryBookEditing(this.#storyEditingContext());
  #storyEditingContext() {
    const editor = this;
    return {
      isStoryBook: (...args) => editor.#isStoryBook(...args),
      ensureStoryBookTimelinePorts: (...args) => editor.#ensureStoryBookTimelinePorts(...args),
      syncStoryBookTimelineVisualState: (...args) => editor.#syncStoryBookTimelineVisualState(...args),
      emitChange: (...args) => editor.#emitChange(...args),
      get timeline() {
        return editor.#timeline;
      },
      set timeline(value) {
        editor.#timeline = value;
      },
      beginStoryBookTimelineDrag: (...args) => editor.#beginStoryBookTimelineDrag(...args),
      clearStoryBookTimelineDragPreview: (...args) => editor.#clearStoryBookTimelineDragPreview(...args),
      updateStoryBookTimelineDragPreview: (...args) => editor.#updateStoryBookTimelineDragPreview(...args),
      handleStoryBookTimelineLinkDrop: (...args) => editor.#handleStoryBookTimelineLinkDrop(...args),
      get surface() {
        return editor.#surface;
      },
      set surface(value) {
        editor.#surface = value;
      },
      get mode() {
        return editor.#mode;
      },
      set mode(value) {
        editor.#mode = value;
      },
      get storyBookDocument() {
        return editor.#storyBookDocument;
      },
      set storyBookDocument(value) {
        editor.#storyBookDocument = value;
      },
      get indexNode() {
        return editor.#indexNode;
      },
      set indexNode(value) {
        editor.#indexNode = value;
      },
      get destroyed() {
        return editor.#destroyed;
      },
      set destroyed(value) {
        editor.#destroyed = value;
      },
    };
  }

  #screenplayWorkflow = new ScreenplayWorkflow(this.#screenplayWorkflowContext());
  #screenplayWorkflowContext() {
    const editor = this;
    return {
      get destroyed() {
        return editor.#destroyed;
      },
      set destroyed(value) {
        editor.#destroyed = value;
      },
      isScreenplay: (...args) => editor.#isScreenplay(...args),
      get mode() {
        return editor.#mode;
      },
      set mode(value) {
        editor.#mode = value;
      },
      get ingredients() {
        return editor.#ingredients;
      },
      set ingredients(value) {
        editor.#ingredients = value;
      },
      get projectId() {
        return editor.#projectId;
      },
      set projectId(value) {
        editor.#projectId = value;
      },
      get surface() {
        return editor.#surface;
      },
      set surface(value) {
        editor.#surface = value;
      },
      emitChange: (...args) => editor.#emitChange(...args),
      getContext: (...args) => editor.getContext(...args),
      getContent: (...args) => editor.getContent(...args),
      get screenplayDocument() {
        return editor.#screenplayDocument;
      },
      set screenplayDocument(value) {
        editor.#screenplayDocument = value;
      },
    };
  }

  #characterEditing = new CharacterLegacyEditing(this.#characterEditingContext());
  #characterEditingContext() {
    const editor = this;
    return {
      get projectType() {
        return editor.#projectType;
      },
      set projectType(value) {
        editor.#projectType = value;
      },
      syncContentBeforeSwitch: (...args) => editor.#syncContentBeforeSwitch(...args),
      get htmlContent() {
        return editor.#htmlContent;
      },
      set htmlContent(value) {
        editor.#htmlContent = value;
      },
      renderMode: (...args) => editor.#renderMode(...args),
      get mode() {
        return editor.#mode;
      },
      set mode(value) {
        editor.#mode = value;
      },
      get surface() {
        return editor.#surface;
      },
      set surface(value) {
        editor.#surface = value;
      },
      get destroyed() {
        return editor.#destroyed;
      },
      set destroyed(value) {
        editor.#destroyed = value;
      },
      get projectId() {
        return editor.#projectId;
      },
      set projectId(value) {
        editor.#projectId = value;
      },
      emitChange: (...args) => editor.#emitChange(...args),
      get ingredients() {
        return editor.#ingredients;
      },
      set ingredients(value) {
        editor.#ingredients = value;
      },
    };
  }

  #timeline = new EditorTimeline(this.#timelineContext());
  #ingredientsPanel = new EditorIngredients(this.#ingredientsPanelContext());
  #images = new EditorImages(this.#imagesContext());
  #cropper = new EditorCropper(this.#cropperContext());
  #views = new EditorViews(this.#viewsContext());
  #backgroundState = null;
  #backgroundBusy = false;

  #timelineContext() {
    const editor = this;
    return {
      emitChange: (...args) => editor.#emitChange(...args),
      ensureStoryBookElementIds: (...args) => editor.#ensureStoryBookElementIds(...args),
      isStoryBook: (...args) => editor.#isStoryBook(...args),
      isScreenplay: () => editor.#isScreenplay(),
      get layoutWrapper() {
        return editor.#layoutWrapper;
      },
      set layoutWrapper(value) {
        editor.#layoutWrapper = value;
      },
      get mode() {
        return editor.#mode;
      },
      set mode(value) {
        editor.#mode = value;
      },
      get storyBookDocument() {
        return editor.#storyBookDocument;
      },
      set storyBookDocument(value) {
        editor.#storyBookDocument = value;
      },
      storyBookStructuralId: (...args) => editor.#storyBookStructuralId(...args),
      get surface() {
        return editor.#surface;
      },
      set surface(value) {
        editor.#surface = value;
      },
    };
  }

  #ingredientsPanelContext() {
    const editor = this;
    return {
      canEdit: () => !editor.#backgroundBusy,
      emitChange: (...args) => editor.#emitChange(...args),
      getCharacterMappedTraits: (...args) => editor.#getCharacterMappedTraits(...args),
      get htmlContent() {
        return editor.#htmlContent;
      },
      set htmlContent(value) {
        editor.#htmlContent = value;
      },
      get ingredients() {
        return editor.#ingredients;
      },
      set ingredients(value) {
        editor.#ingredients = value;
      },
      get mode() {
        return editor.#mode;
      },
      set mode(value) {
        editor.#mode = value;
      },
      get node() {
        return editor.#node;
      },
      set node(value) {
        editor.#node = value;
      },
      get projectId() {
        return editor.#projectId;
      },
      set projectId(value) {
        editor.#projectId = value;
      },
      removeTagsForIngredient: (...args) => editor.#removeTagsForIngredient(...args),
      get surface() {
        return editor.#surface;
      },
      set surface(value) {
        editor.#surface = value;
      },
    };
  }

  #imagesContext() {
    const editor = this;
    return {
      coverArtInstruction,
      runCharacterJob: (input) => editor.#views.characterWorkspace?.enqueueBackgroundJob(input),
      setVisualLibraryState: (state) => editor.#views.characterWorkspace?.setVisualLibraryState(state),
      refreshCharacterVisualLibrary: () => editor.#views.characterWorkspace?.refreshVisualLibrary(),
      onCharacterPhotoUploaded: () => editor.#views.characterWorkspace?.acceptUploadedPortrait(),
      get destroyed() {
        return editor.#destroyed;
      },
      set destroyed(value) {
        editor.#destroyed = value;
      },
      getContext: (...args) => editor.getContext(...args),
      get ingredients() {
        return editor.#ingredients;
      },
      set ingredients(value) {
        editor.#ingredients = value;
      },
      get layoutWrapper() {
        return editor.#layoutWrapper;
      },
      set layoutWrapper(value) {
        editor.#layoutWrapper = value;
      },
      parseTraitsFromHtml: (...args) => editor.#parseTraitsFromHtml(...args),
      get projectId() {
        return editor.#projectId;
      },
      set projectId(value) {
        editor.#projectId = value;
      },
      get projectType() {
        return editor.#projectType;
      },
      set projectType(value) {
        editor.#projectType = value;
      },
      showCropperModal: (...args) => editor.#showCropperModal(...args),
      requestTimelineGeometry: () => editor.#timeline.requestGeometryRefresh(),
      get surface() {
        return editor.#surface;
      },
      set surface(value) {
        editor.#surface = value;
      },
      get timelineNode() {
        return editor.#timeline.timelineNode;
      },
      set timelineNode(value) {
        editor.#timeline.timelineNode = value;
      },
    };
  }

  #cropperContext() {
    return {};
  }

  #viewsContext() {
    const editor = this;
    return {
      onBackgroundState: (state) => {
        editor.#backgroundState?.(state);
        editor.#backgroundBusy = state.busy;
        editor.#ingredientsPanel.setBusy(state.busy);
        if (state.mediaChanged) editor.#images.updateCoverVisuals(AppState.currentProject);
      },
      onBackgroundChoice: (job) => editor.#images.chooseBackgroundAppearance(job),
      selectCharacterEngine: () => editor.#images.selectCharacterEngine(),
      refitCanvas: () => EventBus.emit('canvas:fit'),
      uploadCharacterPhoto: () => editor.#images.handleUploadClick(),
      generateCharacterVisualLibrary: () =>
        this.#images.chooseAndGenerateImage(null, { automatic: true, assetsOnly: true }),
      visualAssetAction: (action) => this.#images.visualAssetAction(action),
      setCharacterImageModel: (model) => this.#images.setCharacterImageModel(model),
      generateCharacterPhoto: (options = {}) =>
        this.#images.chooseAndGenerateImage(null, {
          replaceCharacterImage: !options.photoReferences && !options.variation,
          attachmentImage: options.attachmentImage || '',
          automatic: options.automatic === true,
          visualChangeKeys: options.visualChangeKeys || [],
          photoReferences: options.photoReferences,
          variation: options.variation === true,
          signal: options.signal,
          applyAssets: options.applyAssets === true,
        }),
      autoTagCharacters: (...args) => editor.#autoTagCharacters(...args),
      autoTagDefinitions: (...args) => editor.#autoTagDefinitions(...args),
      clearStoryBookTimelineLinks: (...args) => editor.#clearStoryBookTimelineLinks(...args),
      closeTimelinePopover: () => {
        editor.#timeline.closeKeyboardPicker({ restoreFocus: false });
        editor.#timeline.closeStoryBookTimelinePopover({ restoreFocus: false });
      },
      requestTimelineGeometry: () => editor.#timeline.requestGeometryRefresh(),
      drawStoryBookTimelineConnections: (...args) => editor.#drawStoryBookTimelineConnections(...args),
      emitChange: (...args) => editor.#emitChange(...args),
      enforceH1Limit: (...args) => editor.#enforceH1Limit(...args),
      ensureRemoveButtons: (...args) => editor.#ensureRemoveButtons(...args),
      ensureStoryBookTimelinePorts: (...args) => editor.#ensureStoryBookTimelinePorts(...args),
      generateCharacterTraitsFromContext: (...args) => editor.#generateCharacterTraitsFromContext(...args),
      generateCharacterTraitsRandomly: (...args) => editor.#generateCharacterTraitsRandomly(...args),
      get htmlContent() {
        return editor.#htmlContent;
      },
      set htmlContent(value) {
        editor.#htmlContent = value;
      },
      get indexNode() {
        return editor.#indexNode;
      },
      set indexNode(value) {
        editor.#indexNode = value;
      },
      get screenplayDocument() {
        return parseScreenplayContent(editor.getContent());
      },
      setScreenplayMetadata: (id, metadata) => {
        const doc = parseScreenplayContent(editor.getContent());
        const scene = doc.scenes.find((item) => item.id === id);
        if (!scene) throw new Error('La escena ya no existe.');
        Object.assign(scene, metadata);
        if ('locationId' in metadata && !metadata.locationId) delete scene.locationId;
        editor.#screenplayDocument = parseScreenplayContent(doc);
        editor.#emitChange();
      },
      isStoryBook: (...args) => editor.#isStoryBook(...args),
      isScreenplay: () => editor.#isScreenplay(),
      get mode() {
        return editor.#mode;
      },
      set mode(value) {
        editor.#mode = value;
      },
      get node() {
        return editor.#node;
      },
      set node(value) {
        editor.#node = value;
      },
      prepareStoryBookTree: (...args) => editor.#prepareStoryBookTree(...args),
      get storyBookDocument() {
        return editor.#storyBookDocument;
      },
      set storyBookDocument(value) {
        editor.#storyBookDocument = value;
      },
      get surface() {
        return editor.#surface;
      },
      set surface(value) {
        editor.#surface = value;
      },
      syncStoryBookTimelineVisualState: (...args) => editor.#syncStoryBookTimelineVisualState(...args),
      updateAllInlineTagStyles: (...args) => editor.#updateAllInlineTagStyles(...args),
      updateIndex: (...args) => editor.#updateIndex(...args),
      updateStickyOffsets: (...args) => editor.#updateStickyOffsets(...args),
    };
  }

  #destroyed = false;

  /** @type {HTMLElement|null} the root content-node on the canvas */
  #node = null;
  /** @type {HTMLElement|null} the active editing surface (div or textarea) */
  #surface = null;
  /** @type {Mode} */
  #mode = Mode.WYSIWYG;
  /** @type {string} last-known HTML content (source of truth) */
  #htmlContent = '';
  /** @type {Object|null} portable story-book document model */
  #storyBookDocument = null;
  #screenplayDocument = null;
  /** @type {Set<string>} collapsed chapter/theme IDs in the story-book tree */

  /** @type {Function[]} stored EventBus handlers */
  #handlers = {};
  /** @type {HTMLElement|null} selection-based floating format toolbar */
  #floatingToolbar = null;
  /** @type {HTMLElement|null} color palette picker subpanel */
  #colorPanel = null;
  /** @type {HTMLElement|null} highlight colors subpanel */
  #highlightPanel = null;
  /** @type {Range|null} saved text selection range */
  #lastRange = null;
  /** @type {HTMLElement|null} custom right-click context menu */
  #contextMenu = null;
  /** @type {Function|null} document click handler to dismiss context menu */
  #documentClickHandler = null;
  /** @type {Array} ingredients list */
  #ingredients = [];
  /** @type {HTMLElement|null} flex layout wrapper */
  #layoutWrapper = null;
  /** @type {HTMLElement|null} book cover container */

  /** @type {HTMLElement|null} book cover custom context menu */

  /** @type {HTMLElement|null} sidebar for side drawers */

  /** @type {HTMLElement|null} Story-book temporal graph rail */

  /** @type {HTMLElement|null} tooltip layer rendered outside the scroll track */

  /** @type {SVGSVGElement|null} rendered temporal graph links */

  /** @type {HTMLElement|null} active timeline date picker */

  /** @type {{side:string,nodeId?:string,nodeType?:string,entryId?:string}|null} active timeline cable drag */

  /** @type {number} active index in mention dropdown */
  #mentionActiveIndex = 0;
  /** @type {string|null} active project ID */
  #projectId = null;
  /** @type {string|null} active project type ('book' or 'character') */
  #projectType = null;
  /** @type {HTMLElement|null} index container */
  #indexNode = null;
  #enforcingH1 = false;

  /**
   * Initialise the editor.
   * @param {HTMLElement} container — the canvas transform container
   * @param {{ content?: string }} projectData
   */
  init(container, projectData, { onBackgroundState } = {}) {
    this.#backgroundState = onBackgroundState;
    if (projectData?.type === 'character') prepareCharacterProject(projectData);
    if (projectData?.type === 'stage') prepareScenarioProject(projectData);
    if (isFilmProject(projectData)) prepareFilmProject(projectData);
    this.#projectId = projectData?.id || null;
    this.#projectType = projectData?.type || null;
    const isStoryBook =
      projectData?.type === 'book' && (projectData?.category === 'story-book' || !projectData?.category);
    if (isStoryBook) {
      this.#storyBookDocument = parseStoryBookContent(projectData?.content ?? '');
      this.#htmlContent = safeContent(storyBookDocumentToHTML(this.#storyBookDocument));
    } else if (projectData?.type === 'book' && projectData?.category === 'screenplay') {
      this.#screenplayDocument = parseScreenplayContent(projectData?.content ?? '');
      this.#htmlContent = screenplayToHTML(this.#screenplayDocument);
      this.#storyBookDocument = null;
    } else {
      this.#storyBookDocument = null;
      this.#htmlContent =
        ['character', 'stage'].includes(projectData?.type) || isFilmProject(projectData)
          ? ''
          : Convert.markdownToHtml(projectData?.content ?? '');
    }
    this.#ingredients = projectData?.ingredients ?? [];

    // Ensure all characters and definitions have unique colors assigned
    this.#ingredients.forEach((ing) => {
      if ((ing.type === 'character' || ing.type === 'definition') && (!ing.color1 || !ing.color2)) {
        const colors = this.#generateUniqueGradient();
        ing.color1 = colors.color1;
        ing.color2 = colors.color2;
      }
      if (ing.type === 'character' && ing.value) {
        try {
          const data = JSON.parse(ing.value);
          if (data.role) {
            ing.label = data.role;
          }
        } catch (e) {}
      }
    });

    // Create a layout wrapper to contain the editor card and the side drawers
    this.#layoutWrapper = document.createElement('div');
    this.#layoutWrapper.className = 'editor-layout-wrapper';
    this.#layoutWrapper.classList.toggle(
      'editor-layout-wrapper--character',
      this.#projectType === 'character',
    );
    this.#layoutWrapper.classList.toggle('editor-layout-wrapper--scenario', this.#projectType === 'stage');
    container.appendChild(this.#layoutWrapper);

    // ── Prepend Cover Section if project is of type 'book' or 'character' ─
    const isBook = this.#projectType === 'book';
    const isCharacter = this.#projectType === 'character';
    if (isBook || isCharacter) {
      const cover = this.#createCoverSection(projectData);
      this.#layoutWrapper.appendChild(cover);
    }

    if (isStoryBook) {
      this.#timeline.timelineNode = this.#createStoryBookTimeline();
      this.#layoutWrapper.appendChild(this.#timeline.timelineNode);
      this.#renderStoryBookTimeline();
    }

    // ── Content node (positioned card on canvas) ────────────────────────
    this.#node = document.createElement('div');
    const type = projectData?.type || 'book';
    const category = projectData?.category || 'custom';
    this.#node.className = `editor-node editor-node--${type} editor-node--${category}`;

    this.#layoutWrapper.appendChild(this.#node);
    if (isCharacter || this.#projectType === 'stage') this.#layoutWrapper.prepend(this.#node);

    // Create the side drawers panel next to it
    this.#ingredientsPanel.mount(this.#layoutWrapper);

    if (isStoryBook) {
      this.#timeline.mountLinks(this.#layoutWrapper);
    }

    this.syncIngredientsFromTags();
    this.#renderDrawers();

    // ── Set initial mode ────────────────────────────────────────────────
    this.#renderMode(this.#mode);

    // ── Listen for mode-switch events ───────────────────────────────────
    this.#handlers['editor:setMode'] = (mode) => {
      if (['character', 'stage'].includes(this.#projectType) || isFilmProject(AppState.currentProject))
        return;
      if (Object.values(Mode).includes(mode) && mode !== this.#mode) {
        this.#syncContentBeforeSwitch();
        this.#hideFloatingToolbar();
        this.#lastRange = null;
        this.#mode = mode;
        this.#renderMode(mode);
        this.syncIngredientsFromTags();
      }
    };

    EventBus.on('editor:setMode', this.#handlers['editor:setMode']);

    // ── Listen for character trait updates from the sidebar ──────────────
    this.#handlers['editor:updateCharacterTrait'] = ({ key, value }) => {
      this.#updateCharacterTrait(key, value);
    };
    EventBus.on('editor:updateCharacterTrait', this.#handlers['editor:updateCharacterTrait']);

    // ── Create selection-based floating format toolbar ─────────────────
    if (!isCharacter) {
      this.#createFloatingToolbar();
      this.#handlers['document:selectionchange'] = () => this.#handleSelectionChange();
      document.addEventListener('selectionchange', this.#handlers['document:selectionchange']);
    }

    this.#handlers['editor:aiResult'] = ({ action, text }) => {
      this.insertAIResult(action, text);
    };
    EventBus.on('editor:aiResult', this.#handlers['editor:aiResult']);

    // ── Listen for ingredient import requests ────────────────────────────
    this.#handlers['editor:importIngredient'] = ({ id, name, type, category, deferToast }) => {
      return this.importIngredient({ id, name, type, category, deferToast });
    };
    EventBus.on('editor:importIngredient', this.#handlers['editor:importIngredient']);

    // Prevent focus when clicking outside the editable area but inside the editor card padding
    this.#node.addEventListener('mousedown', (e) => {
      const surface = e.target.closest('.editor-surface');
      const interactive = e.target.closest('button, input, select, textarea, a, .kai-remove-btn');
      if (!surface && !interactive) {
        e.preventDefault();
      }
    });

    // ── Event delegation for close buttons on tags/blocks ───────────────
    this.#node.addEventListener('click', (e) => {
      const removeBtn = e.target.closest('.kai-remove-btn');
      if (removeBtn) {
        e.preventDefault();
        e.stopPropagation();
        const element = removeBtn.closest('.kai-tag, .kai-block');
        if (element) {
          if (element.classList.contains('kai-tag')) {
            const definition = element.dataset.definition || '';
            const text = element.textContent.replace(/🔒/g, '').replace(/×/g, '').trim();
            const isCharacter =
              element.classList.contains('kai-character-tag') || definition.startsWith('character:');

            const entityType = isCharacter ? 'el personaje' : 'la definición';
            const entityName = text;

            Alert.confirm({
              title: isCharacter ? 'Desvincular Personaje' : 'Desvincular Definición',
              message: `¿De verdad deseas desvincular ${entityType} <strong>${entityName}</strong> de este proyecto? Se eliminarán todas las etiquetas del contenido manteniendo el texto, y se quitará de los ingredientes.`,
              confirmLabel: 'Confirmar desvinculación',
              cancelLabel: 'Cancelar',
              type: 'danger',
              onConfirm: () => {
                // Remove all matching tags from editor surface content
                const matches = Array.from(this.#surface.querySelectorAll('.kai-tag')).filter((el) => {
                  const elDef = el.dataset.definition || '';
                  return elDef === definition || el.title === definition;
                });

                matches.forEach((el) => this.#unwrapElement(el));

                // Remove from ingredients
                if (isCharacter) {
                  const charId = definition.startsWith('character:')
                    ? definition.substring('character:'.length)
                    : '';
                  this.#ingredients = this.#ingredients.filter((ing) => {
                    if (ing.type === 'character') {
                      return ing.importedProjectId !== charId;
                    }
                    return true;
                  });
                } else {
                  this.#ingredients = this.#ingredients.filter((ing) => {
                    if (ing.type === 'definition') {
                      try {
                        const data = JSON.parse(ing.value);
                        return data.term.toLowerCase() !== text.toLowerCase();
                      } catch (e) {}
                    }
                    return true;
                  });
                }

                // Update interface
                this.#renderDrawers();
                this.#emitChange();

                Toast.show(`${isCharacter ? 'Personaje' : 'Definición'} desvinculado con éxito.`, 'success');
              },
            });
          } else {
            // It's a block (.kai-block), unwrap it immediately
            this.#unwrapElement(element);
          }
        }
      }
    });

    // ── Custom context menu (right click) ────────────────────────────────
    this.#node.addEventListener('contextmenu', (e) => {
      this.#handleContextMenu(e);
    });

    // ── Document click listener to hide context menu ────────────────────
    this.#documentClickHandler = () => {
      this.#hideContextMenu();
      this.#hideCoverContextMenu();
    };
    document.addEventListener('click', this.#documentClickHandler);

    // ── Floating Tooltip for Character Tags (Glassmorphism style) ───────
    let tooltip = document.getElementById('kai-character-tooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = 'kai-character-tooltip';
      tooltip.className = 'kai-character-tooltip';

      const avatar = document.createElement('div');
      avatar.id = 'kai-tooltip-avatar';
      avatar.className = 'kai-tooltip-avatar';

      const img = document.createElement('img');
      img.id = 'kai-tooltip-img';
      avatar.appendChild(img);

      const name = document.createElement('div');
      name.id = 'kai-tooltip-name';
      name.className = 'kai-tooltip-name';

      tooltip.append(avatar, name);
      document.body.appendChild(tooltip);
    }

    this.#handlers['node:mouseover'] = (e) => {
      const tag = e.target.closest('.kai-tag');
      if (!tag) return;
      if (e.relatedTarget instanceof Node && tag.contains(e.relatedTarget)) return;

      const activeTooltip = document.getElementById('kai-character-tooltip');
      if (!activeTooltip) return;

      // Suppress browser default tooltip
      tag.removeAttribute('title');

      const nameEl = activeTooltip.querySelector('#kai-tooltip-name');
      const avatarEl = activeTooltip.querySelector('#kai-tooltip-avatar');
      const imgEl = activeTooltip.querySelector('#kai-tooltip-img');

      avatarEl.classList.remove('has-image');
      imgEl.onload = null;
      imgEl.onerror = null;
      imgEl.hidden = true;
      imgEl.removeAttribute('src');
      delete imgEl.dataset.fallbackUrl;
      delete imgEl.dataset.fallbackTried;

      // Check if it is a character tag
      if (tag.classList.contains('kai-character-tag') || tag.dataset.definition?.startsWith('character:')) {
        const charDef = tag.dataset.definition;
        if (!charDef || !charDef.startsWith('character:')) return;
        const charId = charDef.substring('character:'.length);

        const ing = this.#ingredients.find((i) => i.type === 'character' && i.importedProjectId === charId);
        const charName = tag.textContent.trim();

        nameEl.textContent = charName;

        let covers = [];
        let currentCoverIndex = -1;
        if (ing && ing.value) {
          try {
            const parsed = JSON.parse(ing.value);
            covers = parsed.covers || [];
            currentCoverIndex = parsed.currentCoverIndex !== undefined ? parsed.currentCoverIndex : -1;
          } catch (err) {}
        }
        if ((!covers || covers.length === 0) && ing && ing.covers) {
          covers = ing.covers || [];
          currentCoverIndex = ing.currentCoverIndex !== undefined ? ing.currentCoverIndex : -1;
        }

        if (covers && covers.length > 0) {
          const idx =
            currentCoverIndex >= 0 && currentCoverIndex < covers.length
              ? currentCoverIndex
              : covers.length - 1;
          const mainCover = covers[idx];
          if (mainCover) {
            const lastDot = mainCover.lastIndexOf('.');
            const coverStem = lastDot !== -1 ? mainCover.substring(0, lastDot) : mainCover;
            const coverExtension = lastDot !== -1 ? mainCover.substring(lastDot) : '.png';
            // Face crops are encoded as PNG in the browser. Try that canonical
            // output first, then the source extension for crops created by older
            // versions of the editor.
            const faceCandidates = [`${coverStem}-face.png`, `${coverStem}-face${coverExtension}`].filter(
              (url, index, urls) => urls.indexOf(url) === index,
            );
            let faceUrl = faceCandidates[0];

            imgEl.onload = () => {
              imgEl.hidden = false;
              avatarEl.classList.add('has-image');
            };
            imgEl.onerror = () => {
              const nextFaceIndex = Number(imgEl.dataset.faceCandidateIndex || '0') + 1;
              if (nextFaceIndex < faceCandidates.length) {
                imgEl.dataset.faceCandidateIndex = String(nextFaceIndex);
                imgEl.src = faceCandidates[nextFaceIndex];
                return;
              }
              // Older character projects may only have the main cover. Keep
              // the tooltip useful by falling back to it once before hiding
              // the avatar entirely.
              const fallbackUrl = imgEl.dataset.fallbackUrl;
              if (fallbackUrl && !imgEl.dataset.fallbackTried) {
                imgEl.dataset.fallbackTried = 'true';
                imgEl.src = fallbackUrl;
                return;
              }
              avatarEl.classList.remove('has-image');
            };
            imgEl.dataset.fallbackUrl = mainCover;
            delete imgEl.dataset.fallbackTried;
            imgEl.dataset.faceCandidateIndex = '0';
            imgEl.src = faceUrl;
          }
        }
      } else {
        // Definition tag logic: show definition text only
        nameEl.textContent = tag.dataset.definition || tag.textContent.trim();
      }

      activeTooltip.classList.add('is-visible');
      activeTooltip.offsetHeight; // force layout reflow

      const rect = tag.getBoundingClientRect();
      const tooltipRect = activeTooltip.getBoundingClientRect();
      let top = rect.top - tooltipRect.height - 8;
      let left = rect.left + (rect.width - tooltipRect.width) / 2;

      if (top < 0) {
        top = rect.bottom + 8;
      }
      if (left < 4) left = 4;
      if (left + tooltipRect.width > window.innerWidth - 4) {
        left = window.innerWidth - tooltipRect.width - 4;
      }

      activeTooltip.style.top = `${top}px`;
      activeTooltip.style.left = `${left}px`;
    };

    this.#handlers['node:mouseout'] = (e) => {
      const tag = e.target.closest('.kai-tag');
      if (!tag) return;
      if (e.relatedTarget instanceof Node && tag.contains(e.relatedTarget)) return;

      // Metadata lives in data-definition; never restore a native ID tooltip.
      tag.removeAttribute('title');

      const activeTooltip = document.getElementById('kai-character-tooltip');
      if (activeTooltip) {
        activeTooltip.classList.remove('is-visible');
      }
    };

    this.#node.addEventListener('mouseover', this.#handlers['node:mouseover']);
    this.#node.addEventListener('mouseout', this.#handlers['node:mouseout']);

    // ── Caret @ Mentions listeners ──────────────────────────────────────
    this.#handlers['editor:nodeKeydown'] = (e) => {
      if (this.#mode === Mode.WYSIWYG) {
        this.#handleWYSIWYGKeyDown(e);
      }
    };
    this.#node.addEventListener('keydown', this.#handlers['editor:nodeKeydown']);

    this.#handlers['editor:nodeKeyup'] = (e) => {
      if (this.#mode === Mode.WYSIWYG) {
        this.#handleWYSIWYGKeyUp(e);
      }
    };
    this.#node.addEventListener('keyup', this.#handlers['editor:nodeKeyup']);

    this.#handlers['document:clickCloseMention'] = (e) => {
      // Don't close if clicking inside the popup
      if (e.target.closest('#kai-mention-popup')) return;
      this.#closeMentionPopup();
    };
    document.addEventListener('click', this.#handlers['document:clickCloseMention']);

    // Apply tag styling on initial load
    this.#updateAllInlineTagStyles();

    // Auto-synchronize ingredients in the background on load
    this.#autoSyncIngredients();
  }

  // ─── Public API ──────────────────────────────────────────────────────

  /**
   * Returns the current content.
   * - WYSIWYG / Preview → HTML string
   * - Markdown → raw text
   * @returns {string}
   */
  getContent() {
    if (this.#projectType === 'stage' || isFilmProject(AppState.currentProject))
      return AppState.currentProject.content;
    if (this.#projectType === 'character') {
      const document = parseCharacterDocument(AppState.currentProject.content);
      document.identity.name = AppState.currentProject.name;
      return JSON.stringify(document);
    }
    this.#syncContentBeforeSwitch();
    if (this.#isStoryBook()) {
      this.#storyBookDocument = storyBookDocumentFromHTML(this.#htmlContent, this.#storyBookDocument);
      return serializeStoryBookDocument(this.#storyBookDocument);
    }
    if (this.#isScreenplay()) return JSON.stringify(this.#screenplayDocument);
    return Convert.htmlToMarkdown(this.#htmlContent);
  }

  applyAssistantDocument(proposal, expectedContent) {
    if (this.#destroyed || proposal.projectId !== this.#projectId || !this.#isStoryBook())
      throw new Error('La edición solo puede aplicarse al Story Book abierto.');
    if (this.getContent() !== expectedContent)
      throw new Error('El documento cambió durante la respuesta. Solicita la edición nuevamente.');
    const before = this.getContext();
    const content = prepareAssistantStoryBook(safeContent(proposal.content), this.#storyBookDocument);
    const next = parseStoryBookContent(content);
    const html = storyBookDocumentToHTML(next);
    const holder = document.createElement('div');
    holder.innerHTML = safeContent(html);
    if (
      before.blocks.some(
        (text) =>
          ![...holder.querySelectorAll('.kai-block')].some(
            (block) => block.textContent.trim() === text.trim(),
          ),
      )
    )
      throw new Error('La propuesta modifica un fragmento protegido. No se aplicó.');
    this.#storyBookDocument = next;
    this.#htmlContent = html;
    this.#renderMode(this.#mode);
    this.#emitChange();
    return { status: 'applied', projectId: this.#projectId };
  }

  acceptBackgroundBook(content, expectedContent, busy) {
    if (!this.#isStoryBook() || this.#destroyed) throw new Error('El libro ya no está abierto.');
    if (this.getContent() !== expectedContent)
      throw new Error('Hay cambios locales. Recarga el libro para ver el trabajo del servidor.');
    this.#storyBookDocument = parseStoryBookContent(content);
    this.#htmlContent = storyBookDocumentToHTML(this.#storyBookDocument);
    this.#renderMode(this.#mode);
    if (this.#surface) this.#surface.inert = busy;
    return this.getContent();
  }

  /**
   * Returns structured context for AI interactions.
   * @returns {{ content: string, tags: string[], blocks: string[] }}
   */
  getContext() {
    if (isFilmProject(AppState.currentProject)) {
      const film = parseFilmDocument(AppState.currentProject.content);
      const summary = film ? filmSummary(film) : null;
      const content = film
        ? [
            `Largometraje: ${film.identity.name}`,
            `Escenas: ${summary.total}; con prompt: ${summary.ready}`,
            ...film.scenes
              .filter((scene) => !scene.sourceRemoved)
              .map((scene, index) => `${index + 1}. ${scene.title}`),
          ].join('\n')
        : '';
      return {
        content,
        plainText: content,
        structuredText: content,
        tags: [],
        blocks: [],
        selectedText: '',
        ingredients: this.#ingredients,
        document: '',
      };
    }
    if (this.#projectType === 'stage') {
      const document = parseScenarioDocument(AppState.currentProject.content);
      const content = document ? scenarioContextText(document) : '';
      return {
        content,
        plainText: content,
        structuredText: content,
        tags: [],
        blocks: [],
        selectedText: '',
        ingredients: this.#ingredients,
        document: '',
      };
    }
    if (this.#projectType === 'character') {
      const content = characterContextText(parseCharacterDocument(this.getContent()));
      return {
        content,
        plainText: content,
        structuredText: content,
        tags: [],
        blocks: [],
        selectedText: '',
        ingredients: this.#ingredients,
        document: '',
      };
    }
    this.#syncContentBeforeSwitch();
    this.#saveLastSelection();
    const liveSelection = window.getSelection();
    const contextRange =
      liveSelection?.rangeCount &&
      this.#surface?.contains(liveSelection.getRangeAt(0).commonAncestorContainer)
        ? liveSelection.getRangeAt(0)
        : this.#lastRange;
    const container = document.createElement('div');
    container.innerHTML = safeContent(this.#htmlContent);

    // Clean remove buttons from container before extracting tags/blocks text
    container
      .querySelectorAll(
        '.kai-remove-btn, .story-book-tree-drag-handle, .story-book-tree-toggle, .story-book-node-port',
      )
      .forEach((btn) => btn.remove());

    const tags = [...container.querySelectorAll('.kai-tag')].map((el) => {
      let term = el.textContent.trim();
      if (term.endsWith('×')) {
        term = term.slice(0, -1).trim();
      } else if (term.endsWith('x') && term.length > 1 && !el.dataset.tag?.endsWith('x')) {
        term = term.slice(0, -1).trim();
      }
      return {
        term: term,
        definition: el.dataset.definition || el.title || 'Término creado por el usuario.',
      };
    });
    const blocks = [...container.querySelectorAll('.kai-block')].map((el) =>
      el.textContent.replace(/🔒/g, '').trim(),
    );

    // Clean plain text, removing locks
    let plainText = container.innerText || container.textContent || '';
    plainText = plainText.replace(/🔒/g, '').trim();

    // Capture selected text if any
    let selectedText = '';
    if (this.#mode === Mode.WYSIWYG) {
      if (contextRange && !contextRange.collapsed) {
        const range = contextRange;
        if (this.#surface && this.#surface.contains(range.commonAncestorContainer)) {
          // Clone range to clean any close buttons from selected text
          const clone = range.cloneContents();
          const div = document.createElement('div');
          div.appendChild(clone);
          div
            .querySelectorAll('button, .kai-remove-btn, [data-screenplay-controls]')
            .forEach((btn) => btn.remove());
          selectedText = (div.innerText || div.textContent || '').replace(/🔒/g, '').trim();
        }
      }
    } else if (this.#mode === Mode.MARKDOWN && this.#surface) {
      const ta = this.#surface.querySelector('textarea') || this.#surface;
      selectedText = ta.value.substring(ta.selectionStart, ta.selectionEnd).trim();
    }

    const structuredText = this.#isScreenplay()
      ? screenplayContext(this.#screenplayDocument).text
      : Convert.htmlToStructuredText(container.innerHTML);
    const target = {};
    const range = contextRange;
    if (range && this.#surface?.contains(range.endContainer)) {
      const element =
        range.endContainer.nodeType === 1 ? range.endContainer : range.endContainer.parentElement;
      const block = element?.closest('p, h1, h2, h3, h4, h5, blockquote, li, pre');
      if (block && this.#surface.contains(block)) {
        if ((this.#isStoryBook() || this.#isScreenplay()) && block.dataset.kaiId)
          target.nodeId = block.dataset.kaiId;
        const cleanRange = (part) => {
          const holder = document.createElement('div');
          holder.appendChild(part.cloneContents());
          holder
            .querySelectorAll('button, .kai-remove-btn, [data-screenplay-controls]')
            .forEach((el) => el.remove());
          return holder.textContent || '';
        };
        const before = document.createRange();
        before.selectNodeContents(block);
        before.setEnd(range.endContainer, range.endOffset);
        const after = document.createRange();
        after.selectNodeContents(block);
        after.setStart(range.endContainer, range.endOffset);
        target.before = cleanRange(before);
        target.after = cleanRange(after);
      }
    }
    return {
      content: this.#htmlContent,
      plainText,
      structuredText,
      selectedText,
      tags,
      blocks,
      ingredients: this.#ingredients,
      document: this.#isStoryBook() || this.#isScreenplay() ? this.getContent() : '',
      target,
    };
  }

  // ── Formatting commands (WYSIWYG mode) ──────────────────────────────

  /**
   * Apply an `execCommand` to the current selection.
   * @param {string} command — e.g. 'bold', 'italic', 'underline',
   *   'justifyCenter', 'justifyLeft'
   */
  applyFormat(command, value = null) {
    if (this.#mode !== Mode.WYSIWYG) return;
    document.execCommand(command, false, value);
    this.#emitChange();
  }

  /**
   * Wrap the current selection in a heading element.
   * @param {1|2|3} level
   */
  applyHeading(level) {
    if (![1, 2, 3].includes(level)) return;
    this.#applyBlockFormat(`h${level}`);
  }

  /** Convert the selected blocks to normal text, preserving content and IDs. */
  applyParagraph() {
    this.#applyBlockFormat('p');
  }

  applyScreenplayBlock(type) {
    if (!this.#isScreenplay() || this.#mode !== Mode.WYSIWYG) return;
    formatScreenplayBlocks(this.#surface, type);
    this.#emitChange();
  }

  #applyBlockFormat(tagName) {
    if (this.#mode !== Mode.WYSIWYG) return;
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!this.#surface?.contains(range.commonAncestorContainer)) return;
    if (this.#isScreenplay()) {
      this.applyScreenplayBlock(tagName === 'h2' ? 'scene' : tagName === 'h3' ? 'character' : 'action');
      return;
    }
    if (this.#isStoryBook()) {
      this.#storyEditing.formatBlocks(tagName, range);
      this.#emitChange();
      return;
    }
    document.execCommand('formatBlock', false, tagName);
    this.#emitChange();
  }

  /**
   * Apply foreground colour to the current selection.
   * @param {string} color — CSS colour value
   */
  applyColor(color) {
    if (this.#mode !== Mode.WYSIWYG) return;
    document.execCommand('foreColor', false, color);
    this.#emitChange();
  }

  /**
   * Wrap the current selection in a `kai-tag` span for AI context.
   */
  applyTag() {
    if (this.#mode !== Mode.WYSIWYG) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;

    const range = sel.getRangeAt(0);
    const text = range.toString();
    if (!text.trim()) return;

    // Save selection range since showing modal will deselect text
    const savedRange = range.cloneRange();

    // Show premium modal for definition
    this.#showTagDefinitionModal(text.trim(), (definition) => {
      if (definition === null) {
        // User cancelled, do nothing
        return;
      }

      // Restore selection to perform surroundContents
      sel.removeAllRanges();
      sel.addRange(savedRange);

      const span = document.createElement('span');
      span.className = 'kai-tag';
      span.setAttribute('spellcheck', 'false');
      // Tags are editable in WYSIWYG mode so that deleting letters unwraps them
      span.dataset.tag = text.trim();
      span.dataset.definition = definition.trim();
      span.title = definition.trim() || text.trim(); // browser tooltip

      // Surround content
      try {
        savedRange.surroundContents(span);
      } catch (err) {
        // If selection crosses nodes, fall back to wrap
        const fragment = savedRange.extractContents();
        span.appendChild(fragment);
        savedRange.insertNode(span);
      }

      sel.removeAllRanges();
      this.#ensureRemoveButtons();

      // Auto-sync tags to sidebar ingredients drawers
      this.syncIngredientsFromTags();

      this.#emitChange();
    });
  }

  /**
   * Unwrap a `kai-tag` span (replace with its text content).
   */
  removeTag() {
    this.#unwrapClosest('.kai-tag');
  }

  /**
   * Unwrap a `kai-block` span (replace with its text content).
   */
  removeBlock() {
    this.#unwrapClosest('.kai-block');
  }

  destroy() {
    this.#destroyed = true;
    this.#screenplayWorkflow.destroy();

    for (const [evt, fn] of Object.entries(this.#handlers)) {
      EventBus.off(evt, fn);
    }
    if (this.#handlers['document:selectionchange']) {
      document.removeEventListener('selectionchange', this.#handlers['document:selectionchange']);
    }
    if (this.#handlers['editor:aiResult']) {
      EventBus.off('editor:aiResult', this.#handlers['editor:aiResult']);
    }
    if (this.#handlers['editor:nodeKeydown']) {
      this.#node?.removeEventListener('keydown', this.#handlers['editor:nodeKeydown']);
    }
    if (this.#handlers['editor:nodeKeyup']) {
      this.#node?.removeEventListener('keyup', this.#handlers['editor:nodeKeyup']);
    }
    if (this.#handlers['document:clickCloseMention']) {
      document.removeEventListener('click', this.#handlers['document:clickCloseMention']);
    }
    if (this.#documentClickHandler) {
      document.removeEventListener('click', this.#documentClickHandler);
      this.#documentClickHandler = null;
    }
    this.#contextMenu?.remove();
    this.#contextMenu = null;

    this.#floatingToolbar?.remove();
    this.#floatingToolbar = null;
    this.#colorPanel = null;
    this.#highlightPanel = null;
    this.#lastRange = null;

    if (this.#handlers['node:mouseover']) {
      this.#node?.removeEventListener('mouseover', this.#handlers['node:mouseover']);
    }
    if (this.#handlers['node:mouseout']) {
      this.#node?.removeEventListener('mouseout', this.#handlers['node:mouseout']);
    }
    document.getElementById('kai-character-tooltip')?.remove();

    this.#timeline.destroy();
    this.#ingredientsPanel.destroy();
    this.#images.destroy();
    this.#cropper.destroy();
    this.#views.destroy();
    this.#handlers = {};
    this.#layoutWrapper?.remove();
    this.#layoutWrapper = null;

    this.#node = null;
    this.#surface = null;
    this.#storyBookDocument = null;
    this.#screenplayDocument = null;
    this.#storyEditing.destroy();
  }

  // ─── Private helpers ───────────────────────────────────────────────────

  #isStoryBook() {
    const project = AppState.currentProject;
    return Boolean(project?.type === 'book' && (project?.category === 'story-book' || !project?.category));
  }

  #isScreenplay() {
    return AppState.currentProject?.type === 'book' && AppState.currentProject?.category === 'screenplay';
  }

  /**
   * Save the current surface content back to `#htmlContent`.
   */
  #syncContentBeforeSwitch() {
    if (!this.#surface) return;
    if (this.#mode === Mode.WYSIWYG) {
      if (this.#isStoryBook()) {
        this.#storyBookDocument = storyBookDocumentFromHTML(this.#surface.innerHTML, this.#storyBookDocument);
        this.#htmlContent = safeContent(storyBookDocumentToHTML(this.#storyBookDocument));
      } else if (this.#isScreenplay()) {
        this.#screenplayDocument = screenplayFromHTML(
          this.#surface.innerHTML,
          this.#screenplayDocument,
          this.#surface,
        );
        this.#htmlContent = screenplayToHTML(this.#screenplayDocument);
      } else this.#htmlContent = this.#surface.innerHTML;
    } else if (this.#mode === Mode.MARKDOWN) {
      if (this.#isStoryBook() || this.#isScreenplay()) return;
      const ta = this.#surface.querySelector('textarea') || this.#surface;
      this.#htmlContent = Convert.markdownToHtml(ta.value);
    }
  }

  #updateCharacterTrait(...args) {
    return this.#characterEditing.updateCharacterTrait(...args);
  }

  /**
   * Render the editor surface for a given mode.
   * @param {Mode} mode
   */
  #renderMode(...args) {
    return this.#views.renderMode(...args);
  }

  /** Emit 'editor:change' so autosave and other modules react. */
  #emitChange() {
    if (
      ['character', 'stage'].includes(AppState.currentProject?.type) ||
      isFilmProject(AppState.currentProject)
    ) {
      EventBus.emit('editor:change');
      return;
    }
    this.#validateTags();
    this.#enforceH1Limit();
    this.#ensureStoryBookDragHandles();
    if (this.#isStoryBook() && this.#mode === Mode.WYSIWYG && storyBookRowsNeedRebuild(this.#surface)) {
      const selection = captureStoryBookSelection(this.#surface);
      this.#storyBookDocument = storyBookDocumentFromHTML(this.#surface.innerHTML, this.#storyBookDocument);
      this.#htmlContent = safeContent(storyBookDocumentToHTML(this.#storyBookDocument));
      this.#surface.innerHTML = safeContent(this.#htmlContent);
      this.#prepareStoryBookTree(this.#surface);
      restoreStoryBookSelection(this.#surface, selection);
    }
    this.#ensureStoryBookTimelinePorts();
    this.#autoTagCharacters();
    this.#autoTagDefinitions();
    this.#updateIndex();
    this.#syncStoryBookTimelineVisualState();
    this.#updateAllInlineTagStyles();
    this.#updateStickyOffsets();
    EventBus.emit('editor:change');
  }

  #parseTraitsFromHtml(...args) {
    return this.#characterEditing.parseTraitsFromHtml(...args);
  }

  #getCharacterMappedTraits(...args) {
    return this.#characterEditing.getCharacterMappedTraits(...args);
  }

  #validateTags() {
    if (this.#mode !== Mode.WYSIWYG || !this.#surface) return;

    const tags = Array.from(this.#surface.querySelectorAll('.kai-tag'));
    if (tags.length === 0) return;

    const sel = window.getSelection();
    let selectionState = null;

    if (sel && sel.rangeCount > 0) {
      selectionState = {
        anchorNode: sel.anchorNode,
        anchorOffset: sel.anchorOffset,
        focusNode: sel.focusNode,
        focusOffset: sel.focusOffset,
        isCollapsed: sel.isCollapsed,
      };
    }

    tags.forEach((tag) => {
      let shouldUnwrap = false;
      const def = tag.dataset.definition || '';
      const term = tag.dataset.tag || '';
      // Strip any residual remove button text from content comparison
      const currentText = tag.textContent.replace(/×/g, '').trim();

      if (tag.classList.contains('kai-character-tag') || def.startsWith('character:')) {
        // Character tag validation
        const charId = def.startsWith('character:') ? def.substring('character:'.length) : '';
        const charIng = this.#ingredients.find(
          (ing) => ing.type === 'character' && ing.importedProjectId === charId,
        );
        if (!charIng) {
          shouldUnwrap = true;
        } else {
          let expectedName = charIng.importedProjectName || '';
          if (!expectedName && charIng.value) {
            try {
              expectedName = JSON.parse(charIng.value).name;
            } catch (e) {}
          }
          expectedName = (expectedName || '').trim();
          let pseudonyms = '';
          if (charIng.value) {
            try {
              const parsed = JSON.parse(charIng.value);
              pseudonyms = parsed.traits?.pseudonyms || '';
            } catch (e) {}
          }
          const validNames = [expectedName.toLowerCase()];
          if (pseudonyms) {
            pseudonyms.split(',').forEach((p) => {
              const trimmed = p.trim().toLowerCase();
              if (trimmed) validNames.push(trimmed);
            });
          }
          if (!expectedName || !validNames.includes(currentText.toLowerCase())) {
            shouldUnwrap = true;
          }
        }
      } else {
        // Definition tag validation
        const defIng = this.#ingredients.find((ing) => {
          if (ing.type === 'definition') {
            try {
              const data = JSON.parse(ing.value);
              return data.term.toLowerCase() === term.toLowerCase();
            } catch (e) {}
          }
          return false;
        });

        if (!defIng) {
          shouldUnwrap = true;
        } else {
          if (currentText.toLowerCase() !== term.toLowerCase()) {
            shouldUnwrap = true;
          }
        }
      }

      if (shouldUnwrap) {
        // Clean up remove buttons inside the tag to get clean text representation
        tag.querySelectorAll('.kai-remove-btn').forEach((btn) => btn.remove());

        const rawText = tag.textContent;
        const textNode = document.createTextNode(rawText);

        // If selection is inside the tag, we will map selection coordinates to the new text node
        let updateAnchor = false;
        let updateFocus = false;
        let mappedAnchorOffset = 0;
        let mappedFocusOffset = 0;

        if (selectionState) {
          if (tag === selectionState.anchorNode || tag.contains(selectionState.anchorNode)) {
            updateAnchor = true;
            if (selectionState.anchorNode.nodeType === Node.TEXT_NODE) {
              mappedAnchorOffset = selectionState.anchorOffset;
            } else {
              mappedAnchorOffset = selectionState.anchorOffset > 0 ? rawText.length : 0;
            }
          }
          if (tag === selectionState.focusNode || tag.contains(selectionState.focusNode)) {
            updateFocus = true;
            if (selectionState.focusNode.nodeType === Node.TEXT_NODE) {
              mappedFocusOffset = selectionState.focusOffset;
            } else {
              mappedFocusOffset = selectionState.focusOffset > 0 ? rawText.length : 0;
            }
          }
        }

        tag.parentNode?.replaceChild(textNode, tag);

        // Update selectionState target nodes to point to the newly created textNode
        if (selectionState) {
          if (updateAnchor) {
            selectionState.anchorNode = textNode;
            selectionState.anchorOffset = mappedAnchorOffset;
          }
          if (updateFocus) {
            selectionState.focusNode = textNode;
            selectionState.focusOffset = mappedFocusOffset;
          }
        }
      }
    });

    // Restore the selection if it was modified
    if (selectionState && sel) {
      try {
        const newRange = document.createRange();
        if (selectionState.isCollapsed) {
          newRange.setStart(selectionState.anchorNode, selectionState.anchorOffset);
          newRange.collapse(true);
        } else {
          const position = selectionState.anchorNode.compareDocumentPosition(selectionState.focusNode);
          if (
            position & Node.DOCUMENT_POSITION_PRECEDING ||
            (selectionState.anchorNode === selectionState.focusNode &&
              selectionState.anchorOffset > selectionState.focusOffset)
          ) {
            newRange.setStart(selectionState.focusNode, selectionState.focusOffset);
            newRange.setEnd(selectionState.anchorNode, selectionState.anchorOffset);
          } else {
            newRange.setStart(selectionState.anchorNode, selectionState.anchorOffset);
            newRange.setEnd(selectionState.focusNode, selectionState.focusOffset);
          }
        }
        sel.removeAllRanges();
        sel.addRange(newRange);
      } catch (err) {
        console.error('Failed to restore cursor selection in validateTags:', err);
      }
    }
  }

  #removeTagsForIngredient(ing) {
    if (this.#mode !== Mode.WYSIWYG || !this.#surface) return;

    this.#saveLastSelection();
    const tags = Array.from(this.#surface.querySelectorAll('.kai-tag'));

    if (ing.type === 'character') {
      const charId = ing.importedProjectId;
      const charName = ing.importedProjectName || ing.label;
      tags.forEach((tag) => {
        const def = tag.dataset.definition || '';
        const isMatch =
          def === `character:${charId}` ||
          (tag.classList.contains('kai-character-tag') && tag.textContent.trim() === charName);
        if (isMatch) {
          this.#unwrapElement(tag);
        }
      });
    } else if (ing.type === 'definition') {
      try {
        const data = JSON.parse(ing.value);
        const term = data.term;
        tags.forEach((tag) => {
          const text = tag.textContent.replace(/×/g, '').trim();
          if (
            text.toLowerCase() === term.toLowerCase() ||
            tag.dataset.tag?.toLowerCase() === term.toLowerCase()
          ) {
            this.#unwrapElement(tag);
          }
        });
      } catch (e) {}
    }
  }

  #autoTagDefinitions() {
    if (this.#enforcingH1) return false;
    if (AppState.currentProject?.type !== 'book') return false;
    if (this.#mode !== Mode.WYSIWYG || !this.#surface) return false;

    // Gather active definition terms and definitions from ingredients
    const activeDefs = [];
    this.#ingredients.forEach((ing) => {
      if (ing.type === 'definition') {
        try {
          const data = JSON.parse(ing.value);
          const term = (data.term || '').trim();
          const definition = (data.definition || '').trim();
          if (term && !activeDefs.some((d) => d.term.toLowerCase() === term.toLowerCase())) {
            activeDefs.push({ term, definition });
          }
        } catch (e) {}
      }
    });

    if (activeDefs.length === 0) return false;

    let totalChanged = false;
    let iterations = 0;
    const maxIterations = 10;

    const getTextNodes = (node) => {
      const nodes = [];
      const walk = (n) => {
        if (n.nodeType === Node.TEXT_NODE) {
          nodes.push(n);
        } else {
          if (n.nodeType === Node.ELEMENT_NODE) {
            if (
              n.classList.contains('kai-tag') ||
              (n.getAttribute('contenteditable') === 'false' &&
                !n.matches(
                  '.editor-surface, .story-book-row, .story-book-tree-content, .screenplay-scene, .screenplay-scene__body, h3[data-screenplay-voice]',
                ))
            ) {
              return;
            }
          }
          for (let child = n.firstChild; child; child = child.nextSibling) {
            walk(child);
          }
        }
      };
      walk(node);
      return nodes;
    };

    const autoTagTextNode = (textNode, term, definition) => {
      const text = textNode.nodeValue;
      const regex = new RegExp(`\\b${term}\\b`, 'gi');
      const match = regex.exec(text);
      if (!match) return false;

      const matchIndex = match.index;
      const matchLength = match[0].length;
      const matchedText = text.substring(matchIndex, matchIndex + matchLength);

      const sel = window.getSelection();
      let caretOffsetInNode = -1;
      let isCaretInNode = false;
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        if (range.startContainer === textNode) {
          caretOffsetInNode = range.startOffset;
          isCaretInNode = true;
        }
      }

      // Check if user is typing at the end of the word
      const isAtWordEndAndTyping =
        isCaretInNode &&
        caretOffsetInNode === matchIndex + matchLength &&
        matchIndex + matchLength === text.length;
      if (isAtWordEndAndTyping) {
        return false;
      }

      const beforeText = text.substring(0, matchIndex);
      const afterText = text.substring(matchIndex + matchLength);
      const parent = textNode.parentNode;
      if (!parent) return false;

      const beforeNode = document.createTextNode(beforeText);
      const span = document.createElement('span');
      span.className = 'kai-tag';
      span.setAttribute('spellcheck', 'false');
      span.dataset.tag = term;
      span.dataset.definition = definition;
      span.title = definition || term;
      span.textContent = matchedText;
      const afterNode = document.createTextNode(afterText);

      parent.insertBefore(beforeNode, textNode);
      parent.insertBefore(span, textNode);
      parent.insertBefore(afterNode, textNode);
      parent.removeChild(textNode);

      if (isCaretInNode) {
        let newContainer = null;
        let newOffset = 0;
        if (caretOffsetInNode <= matchIndex) {
          newContainer = beforeNode;
          newOffset = caretOffsetInNode;
        } else if (caretOffsetInNode >= matchIndex + matchLength) {
          newContainer = afterNode;
          newOffset = caretOffsetInNode - (matchIndex + matchLength);
        } else {
          newContainer = afterNode;
          newOffset = 0;
        }
        try {
          const newRange = document.createRange();
          newRange.setStart(newContainer, newOffset);
          newRange.setEnd(newContainer, newOffset);
          sel.removeAllRanges();
          sel.addRange(newRange);
        } catch (e) {
          console.warn('Failed to restore caret in definition autoTag:', e);
        }
      }
      return true;
    };

    this.#enforcingH1 = true;
    try {
      while (iterations < maxIterations) {
        let passChanged = false;
        const textNodes = getTextNodes(this.#surface);
        for (const textNode of textNodes) {
          if (!textNode.parentNode) continue;
          for (const item of activeDefs) {
            if (autoTagTextNode(textNode, item.term, item.definition)) {
              passChanged = true;
              break;
            }
          }
          if (passChanged) break;
        }
        if (!passChanged) break;
        totalChanged = true;
        iterations++;
      }
    } finally {
      this.#enforcingH1 = false;
    }
    return totalChanged;
  }

  #autoTagCharacters() {
    if (this.#enforcingH1) return false;
    if (AppState.currentProject?.type !== 'book') return false;
    if (this.#mode !== Mode.WYSIWYG || !this.#surface) return false;

    // Gather active character names and ids from ingredients
    const activeNames = [];
    this.#ingredients.forEach((ing) => {
      if (ing.type === 'character') {
        let name = ing.importedProjectName || '';
        let pseudonyms = '';
        if (ing.value) {
          try {
            const parsed = JSON.parse(ing.value);
            name = parsed.name || name;
            pseudonyms = parsed.traits?.pseudonyms || '';
          } catch (e) {}
        }
        if (name) {
          name = name.trim();
          const namesToMatch = [name];
          if (pseudonyms) {
            pseudonyms.split(',').forEach((p) => {
              const trimmed = p.trim();
              if (trimmed && !namesToMatch.some((n) => n.toLowerCase() === trimmed.toLowerCase())) {
                namesToMatch.push(trimmed);
              }
            });
          }
          namesToMatch.forEach((n) => {
            if (!activeNames.some((item) => item.nameToMatch.toLowerCase() === n.toLowerCase())) {
              activeNames.push({ nameToMatch: n, charId: ing.importedProjectId, charName: name });
            }
          });
        }
      }
    });

    if (activeNames.length === 0) return false;

    let totalChanged = false;
    let iterations = 0;
    const maxIterations = 10;

    const getTextNodes = (node) => {
      const nodes = [];
      const walk = (n) => {
        if (n.nodeType === Node.TEXT_NODE) {
          nodes.push(n);
        } else {
          if (n.nodeType === Node.ELEMENT_NODE) {
            if (
              n.classList.contains('kai-tag') ||
              (n.getAttribute('contenteditable') === 'false' &&
                !n.matches(
                  '.editor-surface, .story-book-row, .story-book-tree-content, .screenplay-scene, .screenplay-scene__body, h3[data-screenplay-voice]',
                ))
            ) {
              return;
            }
          }
          for (let child = n.firstChild; child; child = child.nextSibling) {
            walk(child);
          }
        }
      };
      walk(node);
      return nodes;
    };

    const autoTagTextNode = (textNode, nameToMatch, charId, canonicalName) => {
      const text = textNode.nodeValue;
      const regex = new RegExp(`\\b${nameToMatch}\\b`, 'gi');
      const match = regex.exec(text);
      if (!match) return false;

      const matchIndex = match.index;
      const matchLength = match[0].length;
      const matchedText = text.substring(matchIndex, matchIndex + matchLength);

      const sel = window.getSelection();
      let caretOffsetInNode = -1;
      let isCaretInNode = false;
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        if (range.startContainer === textNode) {
          caretOffsetInNode = range.startOffset;
          isCaretInNode = true;
        }
      }

      // Check if user is typing at the end of the word
      const isAtWordEndAndTyping =
        isCaretInNode &&
        caretOffsetInNode === matchIndex + matchLength &&
        matchIndex + matchLength === text.length;
      if (isAtWordEndAndTyping) {
        return false;
      }

      const beforeText = text.substring(0, matchIndex);
      const afterText = text.substring(matchIndex + matchLength);
      const parent = textNode.parentNode;
      if (!parent) return false;

      const beforeNode = document.createTextNode(beforeText);
      const span = document.createElement('span');
      span.className = 'kai-tag kai-character-tag';
      span.setAttribute('spellcheck', 'false');
      // Tags are editable in WYSIWYG mode so that deleting letters unwraps them
      span.dataset.tag = canonicalName;
      span.dataset.definition = `character:${charId}`;
      span.title = `character:${charId}`;
      span.textContent = matchedText;
      const afterNode = document.createTextNode(afterText);

      parent.insertBefore(beforeNode, textNode);
      parent.insertBefore(span, textNode);
      parent.insertBefore(afterNode, textNode);
      parent.removeChild(textNode);

      if (isCaretInNode) {
        let newContainer = null;
        let newOffset = 0;
        if (caretOffsetInNode <= matchIndex) {
          newContainer = beforeNode;
          newOffset = caretOffsetInNode;
        } else if (caretOffsetInNode >= matchIndex + matchLength) {
          newContainer = afterNode;
          newOffset = caretOffsetInNode - (matchIndex + matchLength);
        } else {
          newContainer = afterNode;
          newOffset = 0;
        }
        try {
          const newRange = document.createRange();
          newRange.setStart(newContainer, newOffset);
          newRange.setEnd(newContainer, newOffset);
          sel.removeAllRanges();
          sel.addRange(newRange);
        } catch (e) {
          console.warn('Failed to restore caret:', e);
        }
      }
      return true;
    };

    this.#enforcingH1 = true;
    try {
      while (iterations < maxIterations) {
        let passChanged = false;
        const textNodes = getTextNodes(this.#surface);
        for (const textNode of textNodes) {
          if (!textNode.parentNode) continue;
          for (const item of activeNames) {
            if (autoTagTextNode(textNode, item.nameToMatch, item.charId, item.charName)) {
              passChanged = true;
              break;
            }
          }
          if (passChanged) break;
        }
        if (!passChanged) break;
        totalChanged = true;
        iterations++;
      }
    } finally {
      this.#enforcingH1 = false;
    }
    return totalChanged;
  }

  #enforceH1Limit() {
    if (this.#enforcingH1) return false;
    const isBook = AppState.currentProject?.type === 'book';
    if (!isBook) return false;
    if (this.#mode !== Mode.WYSIWYG || !this.#surface) return false;

    this.#enforcingH1 = true;
    let changed = false;
    try {
      // 1. Ensure the first element is an H1
      const firstChild = this.#surface.firstElementChild;
      if (
        !firstChild ||
        (firstChild.tagName !== 'H1' && !firstChild.matches('.story-book-row[data-story-row-kind="title"]'))
      ) {
        const existingH1 = this.#surface.querySelector('h1');
        if (existingH1) {
          this.#surface.insertBefore(storyBookRow(existingH1), this.#surface.firstChild);
          changed = true;
        } else {
          const newH1 = document.createElement('h1');
          newH1.textContent = 'Título';
          this.#surface.insertBefore(newH1, this.#surface.firstChild);
          changed = true;

          // Put caret at the end of the new H1 text if currently focused
          const sel = window.getSelection();
          if (sel && this.#surface.contains(sel.anchorNode)) {
            const range = document.createRange();
            range.selectNodeContents(newH1);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
          }
        }
      }

      // 2. Ensure only one H1 exists (convert subsequent ones to H2)
      const h1s = Array.from(this.#surface.querySelectorAll('h1'));
      if (h1s.length > 1) {
        for (let i = 1; i < h1s.length; i++) {
          const h1 = h1s[i];
          const h2 = document.createElement('h2');

          for (const attr of h1.attributes) {
            h2.setAttribute(attr.name, attr.value);
          }

          while (h1.firstChild) {
            h2.appendChild(h1.firstChild);
          }

          const sel = window.getSelection();
          let range = null;
          let selectionInside = false;
          if (sel && sel.rangeCount > 0) {
            range = sel.getRangeAt(0);
            if (h1.contains(range.startContainer)) {
              selectionInside = true;
            }
          }

          h1.parentNode.replaceChild(h2, h1);
          changed = true;

          if (selectionInside && range) {
            try {
              const newRange = document.createRange();
              newRange.setStart(range.startContainer, range.startOffset);
              newRange.setEnd(range.endContainer, range.endOffset);
              sel.removeAllRanges();
              sel.addRange(newRange);
            } catch (e) {
              console.warn('Failed to restore caret inside downgraded H2:', e);
            }
          }
        }
      }
      return changed;
    } finally {
      this.#enforcingH1 = false;
    }
  }

  #updateStickyOffsets() {
    const isBook = AppState.currentProject?.type === 'book';
    if (!isBook || !this.#surface) return;
    const h1 = this.#surface.querySelector('h1');
    const h2 = this.#surface.querySelector('h2');

    const h1Height = h1 ? storyBookRow(h1).offsetHeight : 0;
    const h2Height = h2 ? storyBookRow(h2).offsetHeight : 0;

    this.#surface.style.setProperty('--h1-height', `${h1Height}px`);
    this.#surface.style.setProperty('--h2-height', `${h2Height}px`);
  }

  /**
   * Build the collapsible story-book tree in the writing surface. These
   * wrappers and controls are intentionally ephemeral: the JSON serializer
   * flattens them back to chapter/theme/paragraph nodes when saving.
   */
  #prepareStoryBookTree(...args) {
    return this.#storyEditing.prepareStoryBookTree(...args);
  }

  /** Add editor-only six-dot handles without changing stored text. */
  #ensureStoryBookDragHandles(...args) {
    return this.#storyEditing.ensureStoryBookDragHandles(...args);
  }

  /** Add editor-only temporal graph ports to chapters, themes and paragraphs. */
  #ensureStoryBookTimelinePorts(...args) {
    return this.#timeline.ensureStoryBookTimelinePorts(...args);
  }

  #storyBookStructuralId(...args) {
    return this.#storyEditing.storyBookStructuralId(...args);
  }

  #createStoryBookTimeline(...args) {
    return this.#timeline.createStoryBookTimeline(...args);
  }

  #beginStoryBookTimelineDrag(...args) {
    return this.#timeline.beginStoryBookTimelineDrag(...args);
  }

  #updateStoryBookTimelineDragPreview(...args) {
    return this.#timeline.updateStoryBookTimelineDragPreview(...args);
  }

  #clearStoryBookTimelineDragPreview(...args) {
    return this.#timeline.clearStoryBookTimelineDragPreview(...args);
  }

  /** Create an interaction-free SVG layer used to render temporal graph links. */

  /** Remove cached cables while keeping the SVG definitions available. */
  #clearStoryBookTimelineLinks(...args) {
    return this.#timeline.clearStoryBookTimelineLinks(...args);
  }

  /** Draw Comfy-style cubic spline cables from story nodes to timeline entries. */
  #drawStoryBookTimelineConnections(...args) {
    return this.#timeline.drawStoryBookTimelineConnections(...args);
  }

  #handleStoryBookTimelineLinkDrop(...args) {
    return this.#timeline.handleStoryBookTimelineLinkDrop(...args);
  }

  #renderStoryBookTimeline(...args) {
    return this.#timeline.renderStoryBookTimeline(...args);
  }

  #syncStoryBookTimelineVisualState(...args) {
    return this.#timeline.syncStoryBookTimelineVisualState(...args);
  }

  #updateIndex(...args) {
    return this.#storyEditing.updateIndex(...args);
  }

  #ensureStoryBookElementIds(...args) {
    return this.#storyEditing.ensureStoryBookElementIds(...args);
  }

  /**
   * Unwrap the closest ancestor matching `selector` around the current
   * selection/caret, replacing the element with its text content.
   * @param {string} selector
   */
  #unwrapClosest(selector) {
    if (this.#mode !== Mode.WYSIWYG) return;
    const sel = window.getSelection();
    if (!sel || !sel.anchorNode) return;

    const el =
      sel.anchorNode.nodeType === Node.ELEMENT_NODE
        ? /** @type {Element} */ (sel.anchorNode).closest(selector)
        : sel.anchorNode.parentElement?.closest(selector);

    if (!el) return;

    const text = document.createTextNode(el.textContent ?? '');
    el.parentNode?.replaceChild(text, el);
    this.#emitChange();
  }

  // ─── Floating Toolbar Methods ─────────────────────────────────────────

  #createFloatingToolbar() {
    let toolbar = document.getElementById('kai-floating-toolbar');
    if (toolbar) {
      this.#floatingToolbar = toolbar;
      this.#colorPanel = toolbar.querySelector('.kai-color-panel');
      this.#highlightPanel = toolbar.querySelector('.kai-highlight-panel');
      return;
    }

    toolbar = document.createElement('div');
    toolbar.id = 'kai-floating-toolbar';
    toolbar.className = 'format-toolbar-floating';

    const screenplay = AppState.currentProject?.category === 'screenplay';
    const heading2 = this.#isStoryBook() ? 'Capítulo' : screenplay ? 'Escena' : 'Título 2';
    const heading3 = this.#isStoryBook() ? 'Tema' : screenplay ? 'Personaje' : 'Título 3';
    const buttons = [
      { label: renderIcon('bold'), title: 'Negrita', action: () => this.applyFormat('bold') },
      { label: renderIcon('italic'), title: 'Cursiva', action: () => this.applyFormat('italic') },
      { label: renderIcon('underline'), title: 'Subrayado', action: () => this.applyFormat('underline') },
      { text: heading2, title: heading2, action: () => this.applyHeading(2) },
      { text: heading3, title: heading3, action: () => this.applyHeading(3) },
      {
        text: screenplay ? 'Acción' : 'Párrafo',
        title: screenplay ? 'Acción' : 'Convertir a párrafo',
        action: () => this.applyParagraph(),
      },
    ];
    if (screenplay)
      for (const [type, label] of [
        ['dialogue', 'Diálogo'],
        ['parenthetical', 'Acotación'],
        ['transition', 'Transición'],
      ])
        buttons.push({ text: label, title: label, action: () => this.applyScreenplayBlock(type) });

    buttons.forEach((btn) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'floating-tool-btn';
      if (btn.text) {
        el.textContent = btn.text;
        el.classList.add('floating-tool-btn--block');
      } else el.innerHTML = safeHTML(btn.label);
      el.title = btn.title;
      el.setAttribute('aria-label', btn.title);
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
      });
      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        btn.action();
      });
      toolbar.appendChild(el);
    });

    // Divider
    const div1 = document.createElement('div');
    div1.className = 'editor-toolbar-separator';
    toolbar.appendChild(div1);

    // Color Selector
    const colorBtn = document.createElement('button');
    colorBtn.className = 'floating-tool-btn';
    colorBtn.innerHTML = safeHTML(renderIcon('brush'));
    colorBtn.title = 'Color de texto';
    colorBtn.addEventListener('mousedown', (e) => e.preventDefault());
    toolbar.appendChild(colorBtn);

    // Color Swatches Panel
    const colorPanel = document.createElement('div');
    colorPanel.className = 'kai-color-panel';

    const colors = [
      '#e4e4e7',
      '#f87171',
      '#fb923c',
      '#facc15',
      '#4ade80',
      '#38bdf8',
      '#818cf8',
      '#c084fc',
      '#f472b6',
      '#a1a1aa',
    ];
    colors.forEach((c) => {
      const swatch = document.createElement('button');
      swatch.className = 'editor-format-swatch';
      swatch.style.setProperty('--swatch-color', c);
      swatch.addEventListener('mousedown', (e) => e.preventDefault());
      swatch.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.applyColor(c);
        colorPanel.classList.remove('is-open');
      });
      colorPanel.appendChild(swatch);
    });
    toolbar.appendChild(colorPanel);
    this.#colorPanel = colorPanel;

    colorBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isVisible = colorPanel.classList.contains('is-open');
      colorPanel.classList.toggle('is-open', !isVisible);
      this.#highlightPanel?.classList.remove('is-open');
    });

    // Highlight Selector
    const highlightBtn = document.createElement('button');
    highlightBtn.className = 'floating-tool-btn';
    highlightBtn.innerHTML = safeHTML(renderIcon('highlighter'));
    highlightBtn.title = 'Resaltador';
    highlightBtn.addEventListener('mousedown', (e) => e.preventDefault());
    toolbar.appendChild(highlightBtn);

    // Highlight Swatches Panel
    const highlightPanel = document.createElement('div');
    highlightPanel.className = 'kai-highlight-panel';

    const highlights = [
      { color: 'transparent', label: 'close' },
      { color: 'rgba(239, 68, 68, 0.3)', label: '' },
      { color: 'rgba(249, 115, 22, 0.3)', label: '' },
      { color: 'rgba(234, 179, 8, 0.3)', label: '' },
      { color: 'rgba(34, 197, 94, 0.3)', label: '' },
      { color: 'rgba(59, 130, 246, 0.3)', label: '' },
      { color: 'rgba(99, 102, 241, 0.3)', label: '' },
      { color: 'rgba(168, 85, 247, 0.3)', label: '' },
    ];

    highlights.forEach((h) => {
      const swatch = document.createElement('button');
      swatch.className = 'editor-format-swatch editor-format-swatch--highlight';
      swatch.style.setProperty(
        '--swatch-color',
        h.color === 'transparent' ? 'rgba(255,255,255,0.1)' : h.color,
      );
      if (h.label) swatch.innerHTML = safeHTML(renderIcon(h.label));

      swatch.addEventListener('mousedown', (e) => e.preventDefault());
      swatch.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.applyFormat('hiliteColor', h.color);
        highlightPanel.classList.remove('is-open');
      });
      highlightPanel.appendChild(swatch);
    });
    toolbar.appendChild(highlightPanel);
    this.#highlightPanel = highlightPanel;

    highlightBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isVisible = highlightPanel.classList.contains('is-open');
      highlightPanel.classList.toggle('is-open', !isVisible);
      this.#colorPanel?.classList.remove('is-open');
    });

    // Clear Formatting Selector (🧹)
    const clearBtn = document.createElement('button');
    clearBtn.className = 'floating-tool-btn';
    clearBtn.innerHTML = safeHTML(renderIcon('eraser'));
    clearBtn.title = 'Limpiar formato';
    clearBtn.addEventListener('mousedown', (e) => e.preventDefault());
    clearBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.applyFormat('removeFormat');
    });
    toolbar.appendChild(clearBtn);

    // No tag or lock buttons in the floating toolbar anymore

    document.body.appendChild(toolbar);
    this.#floatingToolbar = toolbar;
  }

  #handleSelectionChange() {
    if (this.#mode !== Mode.WYSIWYG || !this.#surface) {
      this.#hideFloatingToolbar();
      return;
    }

    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      this.#hideFloatingToolbar();
      return;
    }

    // Ensure the selection is actually inside the active editor WYSIWYG surface
    if (!this.#surface.contains(sel.anchorNode)) {
      this.#hideFloatingToolbar();
      return;
    }

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    if (this.#floatingToolbar) {
      this.#floatingToolbar.classList.add('active');

      // Position the toolbar above the selection rect
      const toolbarRect = this.#floatingToolbar.getBoundingClientRect();
      const left = rect.left + rect.width / 2 - toolbarRect.width / 2;
      const top = rect.top - toolbarRect.height - 12; // 12px spacing

      // Bound within viewport limits
      const boundedLeft = Math.max(12, Math.min(window.innerWidth - toolbarRect.width - 12, left));
      const boundedTop = Math.max(12, top);

      this.#floatingToolbar.style.left = `${boundedLeft}px`;
      this.#floatingToolbar.style.top = `${boundedTop}px`;
    }
  }

  #hideFloatingToolbar() {
    if (this.#floatingToolbar) {
      this.#floatingToolbar.classList.remove('active');
      if (this.#colorPanel) {
        this.#colorPanel.classList.remove('is-open');
      }
      if (this.#highlightPanel) {
        this.#highlightPanel.classList.remove('is-open');
      }
    }
  }

  #saveLastSelection() {
    if (this.#mode !== Mode.WYSIWYG || !this.#surface) return;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      if (this.#surface.contains(range.commonAncestorContainer)) {
        this.#lastRange = range.cloneRange();
      }
    }
  }

  #restoreLastSelection() {
    if (this.#mode !== Mode.WYSIWYG || !this.#lastRange) return false;
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(this.#lastRange);
      return true;
    }
    return false;
  }

  insertAIResult(action, text) {
    if (this.#mode === Mode.WYSIWYG) {
      this.#restoreLastSelection();

      const sel = window.getSelection();
      if (
        this.#isScreenplay() &&
        (!sel?.rangeCount || !this.#surface.contains(sel.getRangeAt(0).commonAncestorContainer))
      )
        throw new Error(
          'Coloca el cursor o selecciona un bloque del guión antes de aplicar un cambio de IA.',
        );
      if (sel && sel.rangeCount > 0) {
        const range = normalizeAITextRange(sel.getRangeAt(0), this.#surface);
        sel.removeAllRanges();
        sel.addRange(range);

        const applied =
          (this.#isScreenplay()
            ? applyScreenplayEdit(range, text, this.#surface, action === 'continuar')
            : null) || applyAITextInBlock(range, text, this.#surface, action === 'continuar');
        if (applied) {
          sel.removeAllRanges();
          sel.addRange(applied);
        } else if (action === 'continuar') {
          range.collapse(false);

          // Split text into paragraphs
          const paragraphs = text.split(/\r?\n\r?\n+/);

          // First paragraph: append as text node at current range
          const firstParaText = paragraphs[0];
          const space = firstParaText.startsWith(' ') || firstParaText.startsWith('\n') ? '' : ' ';
          const textNode = document.createTextNode(space + firstParaText.replace(/\r?\n/g, ' '));
          range.insertNode(textNode);
          range.setStartAfter(textNode);
          range.setEndAfter(textNode);

          // If there are more paragraphs, we insert them after the current block
          if (paragraphs.length > 1) {
            // Find the closest block container (like a P or H1-H3)
            let block = textNode.parentNode;
            const blockTags = ['P', 'H1', 'H2', 'H3', 'LI', 'PRE', 'BLOCKQUOTE'];
            while (block && block !== this.#surface && !blockTags.includes(block.tagName)) {
              block = block.parentNode;
            }

            if (block && block !== this.#surface) {
              let lastBlock = block;
              for (let i = 1; i < paragraphs.length; i++) {
                const cleanParaText = paragraphs[i].trim();
                if (!cleanParaText) continue;

                const newP = document.createElement('p');
                newP.innerHTML = safeContent(cleanParaText.replace(/\r?\n/g, '<br>'));
                lastBlock.parentNode.insertBefore(newP, lastBlock.nextSibling);
                lastBlock = newP;

                // Move selection to the end of the last paragraph
                range.selectNodeContents(newP);
                range.collapse(false);
              }
            } else {
              // Fallback: just append paragraphs to surface
              for (let i = 1; i < paragraphs.length; i++) {
                const cleanParaText = paragraphs[i].trim();
                if (!cleanParaText) continue;

                const newP = document.createElement('p');
                newP.innerHTML = safeContent(cleanParaText.replace(/\r?\n/g, '<br>'));
                this.#surface.appendChild(newP);

                range.selectNodeContents(newP);
                range.collapse(false);
              }
            }
          }

          sel.removeAllRanges();
          sel.addRange(range);
        } else {
          // Action is reescribir, expandir, corregir
          if (!sel.isCollapsed) {
            range.deleteContents();

            const paragraphs = text.split(/\r?\n\r?\n+/);
            const fragment = document.createDocumentFragment();

            paragraphs.forEach((pText, idx) => {
              const clean = pText.trim().replace(/\r?\n/g, '<br>');
              if (!clean) return;

              if (paragraphs.length === 1) {
                fragment.appendChild(document.createTextNode(pText));
              } else {
                const p = document.createElement('p');
                p.innerHTML = safeContent(clean);
                fragment.appendChild(p);
              }
            });

            const lastNode = fragment.lastChild;
            range.insertNode(fragment);

            if (lastNode) {
              range.selectNode(lastNode);
              sel.removeAllRanges();
              sel.addRange(range);
            }
          } else {
            // Replace entire surface HTML
            this.#surface.innerHTML = safeContent(Convert.textToParagraphs(text));
          }
        }
      } else {
        // No selection
        if (action === 'continuar') {
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = safeContent(Convert.textToParagraphs(text));
          while (tempDiv.firstChild) {
            this.#surface.appendChild(tempDiv.firstChild);
          }
        } else {
          this.#surface.innerHTML = safeContent(Convert.textToParagraphs(text));
        }
      }
      this.#emitChange();
      this.#ensureRemoveButtons();
      this.#lastRange = null;
    } else if (this.#mode === Mode.MARKDOWN) {
      const ta = this.#surface.querySelector('textarea') || this.#surface;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const val = ta.value;

      let formattedText = text;
      // Ensure the generated text is wrapped in <p> tags if it doesn't have them
      if (!text.trim().startsWith('<') && !text.trim().endsWith('>')) {
        formattedText = Convert.textToParagraphs(text);
      }

      if (action === 'continuar') {
        const space = formattedText.startsWith(' ') || formattedText.startsWith('\n') ? '' : ' ';
        ta.value = val.substring(0, end) + space + formattedText + val.substring(end);
        ta.selectionStart = ta.selectionEnd = end + space.length + formattedText.length;
      } else {
        if (start !== end) {
          ta.value = val.substring(0, start) + formattedText + val.substring(end);
          ta.selectionStart = start;
          ta.selectionEnd = start + formattedText.length;
        } else {
          ta.value = formattedText;
        }
      }

      // Update syntax highlighting block
      const code = this.#surface.querySelector('code');
      if (code) {
        code.innerHTML = safeHTML(Convert.highlightHTML(ta.value) + '\n');
      }

      ta.focus();
      this.#emitChange();
    }
  }

  /**
   * Scan the editor surface for tags and blocks, ensuring each has a remove button.
   */
  #ensureRemoveButtons() {
    if (this.#mode !== Mode.WYSIWYG || !this.#surface) return;

    // Clean up any residual remove buttons inside tags
    this.#surface.querySelectorAll('.kai-tag .kai-remove-btn').forEach((btn) => btn.remove());

    // Only add remove buttons to blocks (locks)
    const elements = this.#surface.querySelectorAll('.kai-block');
    elements.forEach((el) => {
      // Check if it already has a remove button
      if (!el.querySelector('.kai-remove-btn')) {
        const btn = document.createElement('button');
        btn.className = 'kai-remove-btn';
        btn.innerHTML = safeHTML(renderIcon('close'));
        btn.title = 'Eliminar bloqueo';
        btn.contentEditable = 'false';

        // Prevent default on mousedown to preserve cursor position
        btn.addEventListener('mousedown', (e) => {
          e.preventDefault();
        });

        el.appendChild(btn);
      }
    });
  }

  /**
   * Unwrap a tag or block, replacing it with its original text content.
   * @param {HTMLElement} el
   */
  #unwrapElement(el) {
    this.#saveLastSelection();

    // Remove the remove-btn if it exists to clean text content
    el.querySelector('.kai-remove-btn')?.remove();

    // Get text content, clean up locks
    let textContent = el.textContent.replace(/🔒/g, '').trim();
    const textNode = document.createTextNode(textContent);

    el.parentNode?.replaceChild(textNode, el);
    this.#emitChange();
  }

  #createContextMenu(paragraphId = null) {
    if (this.#contextMenu) {
      this.#contextMenu.remove();
      this.#contextMenu = null;
    }

    const menu = document.createElement('div');
    menu.className = 'kai-context-menu';
    menu.hidden = true;

    // Helper to add context menu items
    const addItem = (label, icon, action, className = '') => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `kai-context-menu-item ${className}`;
      btn.innerHTML = safeHTML(`<span>${renderIcon(icon)} ${label}</span>`);
      btn.addEventListener('mousedown', (e) => {
        // Prevent default on mousedown so selection is NOT lost
        e.preventDefault();
      });
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.#hideContextMenu();
        action();
      });
      return btn;
    };

    const projectType = AppState.currentProject?.type || 'book';

    if (projectType === 'character') {
      const genContextBtn = addItem('Generar a partir del contexto', '✨', () =>
        this.#generateCharacterTraitsFromContext(),
      );
      const genRandomBtn = addItem('Generar aleatoriamente', '🎲', () =>
        this.#generateCharacterTraitsRandomly(),
      );

      menu.appendChild(genContextBtn);
      menu.appendChild(genRandomBtn);
    } else {
      const category = AppState.currentProject?.category;
      if (projectType === 'book' && category === 'screenplay') {
        const genScreenplayBtn = addItem('Generar a partir del contexto', '🎬', () =>
          this.#generateScreenplayFromContext(),
        );
        menu.appendChild(genScreenplayBtn);
        menu.appendChild(
          addItem('Actualizar esta escena con IA', 'refresh', () => this.#updateScreenplayScene()),
        );

        // Add a separator
        const sep = document.createElement('div');
        sep.className = 'kai-context-menu-divider';
        menu.appendChild(sep);
      }

      // AI Actions
      const corregirBtn = addItem(
        'Corregir selección',
        '🪄',
        () => this.#executeAIActionFromMenu('corregir', 'Corrige la gramática y estilo del siguiente texto.'),
        'selection-dependent',
      );
      const expandirBtn = addItem(
        'Expandir selección',
        '🔍',
        () =>
          this.#executeAIActionFromMenu(
            'expandir',
            'Expande el siguiente texto con más detalle y descripción.',
          ),
        'selection-dependent',
      );
      const reescribirBtn = addItem(
        'Reescribir selección',
        '🔄',
        () =>
          this.#executeAIActionFromMenu(
            'reescribir',
            'Reescribe el siguiente texto con un estilo diferente.',
          ),
        'selection-dependent',
      );

      // Continuar (submenu)
      const continuarParent = document.createElement('div');
      continuarParent.className = 'kai-context-menu-item';
      continuarParent.innerHTML = safeHTML(
        `<span>${renderIcon('bolt')} Continuar escribiendo</span> <span class="kai-context-menu-chevron">${renderIcon('chevron-right')}</span>`,
      );
      continuarParent.addEventListener('mousedown', (e) => e.preventDefault());

      const submenu = document.createElement('div');
      submenu.className = 'kai-context-submenu';

      const addSubItem = (label, lengthVal) => {
        const btn = document.createElement('button');
        btn.className = 'kai-context-menu-item';
        btn.innerHTML = safeHTML(label);
        btn.addEventListener('mousedown', (e) => e.preventDefault());
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.#hideContextMenu();
          this.#executeAIActionFromMenu(
            'continuar',
            'Continúa escribiendo a partir del siguiente texto.',
            lengthVal,
          );
        });
        submenu.appendChild(btn);
      };

      addSubItem('Corta', 'corta');
      addSubItem('Media', 'media');
      addSubItem('Larga', 'larga');

      continuarParent.appendChild(submenu);

      menu.appendChild(corregirBtn);
      menu.appendChild(expandirBtn);
      menu.appendChild(reescribirBtn);
      menu.appendChild(continuarParent);
    }

    if (paragraphId && this.#isStoryBook() && this.#mode === Mode.WYSIWYG) {
      const divider = document.createElement('div');
      divider.className = 'kai-context-menu-divider';
      menu.append(
        divider,
        addItem(
          'Eliminar párrafo',
          'trash',
          () => this.#removeStoryBookParagraph(paragraphId),
          'kai-context-menu-item--danger',
        ),
      );
    }

    document.body.appendChild(menu);
    this.#contextMenu = menu;
  }

  async #generateCharacterTraitsRandomly(...args) {
    return this.#characterEditing.generateCharacterTraitsRandomly(...args);
  }

  async #generateCharacterTraitsFromContext(...args) {
    return this.#characterEditing.generateCharacterTraitsFromContext(...args);
  }

  async #updateScreenplayScene(...args) {
    return this.#screenplayWorkflow.updateScreenplayScene(...args);
  }

  async #generateScreenplayFromContext(...args) {
    return this.#screenplayWorkflow.generateScreenplayFromContext(...args);
  }

  #handleContextMenu(e) {
    const target = e.target;
    if (!this.#surface || !this.#surface.contains(target)) return;

    e.preventDefault();
    this.#saveLastSelection();

    const paragraph = storyBookBlockFromTarget(target);
    this.#createContextMenu(paragraph?.matches('p,blockquote,pre,ul,ol,h4') ? paragraph.dataset.kaiId : null);

    const menu = this.#contextMenu;
    if (!menu) return;

    menu.hidden = false;

    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;

    const menuRect = menu.getBoundingClientRect();
    if (e.clientX + menuRect.width > window.innerWidth) {
      menu.style.left = `${window.innerWidth - menuRect.width - 8}px`;
    }
    if (e.clientY + menuRect.height > window.innerHeight) {
      menu.style.top = `${window.innerHeight - menuRect.height - 8}px`;
    }

    const ctx = this.getContext();
    const hasSelection = ctx.selectedText && ctx.selectedText.trim().length > 0;

    menu.querySelectorAll('.selection-dependent').forEach((btn) => {
      if (hasSelection) {
        btn.classList.remove('disabled');
      } else {
        btn.classList.add('disabled');
      }
    });
  }

  #hideContextMenu() {
    if (this.#contextMenu) {
      this.#contextMenu.hidden = true;
    }
  }

  async #executeAIActionFromMenu(actionKey, instruction, length = 'corta') {
    const ctx = this.getContext();
    if (!ctx || !ctx.content) {
      Toast.show('No hay contenido en el editor', 'warning');
      return;
    }

    if (actionKey !== 'continuar' && (!ctx.selectedText || ctx.selectedText.trim().length === 0)) {
      Toast.show('Por favor, selecciona un fragmento de texto primero.', 'warning');
      return;
    }

    Loader.show();

    try {
      const payload = {
        instruction: instruction,
        selectedText: ctx.selectedText || '',
        length: length,
        action: actionKey,
      };

      const response = await API.aiText(payload);
      if (response && response.debug) {
        console.group(
          '%c[AI Debug - Editor Context Menu] Datos enviados al LLM',
          'color: #10b981; font-weight: bold;',
        );
        console.log('Payload de la Petición:', payload);
        console.log('Metadatos Debug:', response.debug);
        console.group('Mensajes Compilados (System + User Prompts - Sin Truncar)');
        if (response.debug.messages) {
          response.debug.messages.forEach((m) => {
            console.log(`%c--- ${m.role.toUpperCase()} ---`, 'font-weight: bold; color: #a78bfa;');
            console.log(m.content);
          });
        }
        console.groupEnd();
        console.groupEnd();
      }
      const text = typeof response === 'string' ? response : (response?.text ?? response?.message ?? '');

      this.insertAIResult(actionKey, text);
      Toast.show('Texto generado con éxito', 'success');
    } catch (err) {
      console.error('[Editor Context Menu] AI Action failed:', err);
      Toast.show('Error al generar respuesta de IA', 'error');
    } finally {
      Loader.hide();
    }
  }

  #generateUniqueGradient(...args) {
    return this.#ingredientsPanel.generateUniqueGradient(...args);
  }

  #updateAllInlineTagStyles(...args) {
    return this.#ingredientsPanel.updateAllInlineTagStyles(...args);
  }

  #renderDrawers(...args) {
    return this.#ingredientsPanel.renderDrawers(...args);
  }

  updateTagDefinition(...args) {
    return this.#ingredientsPanel.updateTagDefinition(...args);
  }

  async #autoSyncIngredients(...args) {
    return this.#ingredientsPanel.autoSyncIngredients(...args);
  }

  syncIngredientsFromTags(...args) {
    return this.#ingredientsPanel.syncIngredientsFromTags(...args);
  }

  async importIngredient(...args) {
    return this.#ingredientsPanel.importIngredient(...args);
  }

  #showTagDefinitionModal(...args) {
    return this.#ingredientsPanel.showTagDefinitionModal(...args);
  }

  // ─── WYSIWYG caret @ mentions helpers ─────────────────────────────────

  #deleteEmptyStoryBookParagraph(...args) {
    return this.#storyEditing.deleteEmptyStoryBookParagraph(...args);
  }

  #removeStoryBookParagraph(...args) {
    return this.#storyEditing.removeStoryBookParagraph(...args);
  }

  /** Editing hosts are independent of their controls, so block splits/joins move entire rows. */
  #handleStoryBookRowKey(...args) {
    return this.#storyEditing.handleStoryBookRowKey(...args);
  }

  #handleWYSIWYGKeyDown(e) {
    if (this.#isScreenplay() && handleScreenplayKey(e, this.#surface, () => this.#emitChange())) return;
    if (e.key === 'Backspace' && this.#deleteEmptyStoryBookParagraph(e)) return;
    if (this.#handleStoryBookRowKey(e)) return;

    if (e.key === 'Enter' && !e.shiftKey) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const startContainer = range.startContainer;

        let blockNode = startContainer;
        while (
          blockNode &&
          blockNode !== this.#node &&
          !['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI'].includes(blockNode.nodeName)
        ) {
          blockNode = blockNode.parentNode;
        }

        if (blockNode && ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(blockNode.nodeName)) {
          e.preventDefault();

          // Check if there is any text before the caret in the block
          const rangeBefore = document.createRange();
          rangeBefore.setStart(blockNode, 0);
          rangeBefore.setEnd(range.startContainer, range.startOffset);
          const hasTextBefore = rangeBefore.toString().length > 0;

          if (!hasTextBefore) {
            // For the first H1 in book projects, do not allow inserting an empty header above it.
            // Instead, insert a paragraph below it and move caret to it.
            if (
              AppState.currentProject?.type === 'book' &&
              blockNode.tagName === 'H1' &&
              blockNode === this.#surface?.firstElementChild
            ) {
              const p = document.createElement('p');
              p.innerHTML = safeHTML('<br>');
              blockNode.parentNode.insertBefore(p, blockNode.nextSibling);

              const newRange = document.createRange();
              newRange.setStart(p, 0);
              newRange.collapse(true);
              sel.removeAllRanges();
              sel.addRange(newRange);

              this.#emitChange();
              return;
            }

            // Create an empty block of the same type above
            const newHeader = document.createElement(blockNode.nodeName);
            newHeader.innerHTML = safeHTML('<br>');
            blockNode.parentNode.insertBefore(newHeader, blockNode);

            // Caret stays in the current blockNode
            this.#emitChange();
            return;
          }

          // Create a range from the caret to the end of the header block
          const endRange = document.createRange();
          endRange.setStart(range.startContainer, range.startOffset);
          endRange.setEndAfter(blockNode.lastChild || blockNode);

          // Extract contents from caret to the end of the block
          const extractedFragment = endRange.extractContents();

          // Create new paragraph
          const p = document.createElement('p');

          // Check if extracted fragment is empty or just whitespace
          const hasContent =
            extractedFragment.textContent.trim().length > 0 || extractedFragment.querySelector('*') !== null;
          if (hasContent) {
            p.appendChild(extractedFragment);
          } else {
            p.innerHTML = safeHTML('<br>');
          }

          // Insert new paragraph right after the header block
          blockNode.parentNode.insertBefore(p, blockNode.nextSibling);

          // If blockNode is now empty of visible text, put a <br> inside it to ensure it maintains height
          if (!blockNode.textContent.trim() && !blockNode.querySelector('br')) {
            blockNode.innerHTML = safeHTML('<br>');
          }

          // Place caret at the start of the new paragraph
          const newRange = document.createRange();
          newRange.setStart(p, 0);
          newRange.collapse(true);
          sel.removeAllRanges();
          sel.addRange(newRange);

          this.#emitChange();
          return;
        }
      }
    }

    const popup = document.getElementById('kai-mention-popup');
    if (popup && !popup.hidden) {
      const items = popup.querySelectorAll('button.mention-item');
      if (items.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          this.#mentionActiveIndex = (this.#mentionActiveIndex + 1) % items.length;
          this.#updateMentionPopupSelection(items);
          return;
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          this.#mentionActiveIndex = (this.#mentionActiveIndex - 1 + items.length) % items.length;
          this.#updateMentionPopupSelection(items);
          return;
        } else if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          items[this.#mentionActiveIndex]?.click();
          return;
        } else if (e.key === 'Escape') {
          e.preventDefault();
          this.#closeMentionPopup();
          return;
        }
      }
    }

    // Auto-list triggers on space
    if (e.key === ' ') {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const startContainer = range.startContainer;

        let blockNode = startContainer;
        while (
          blockNode &&
          blockNode !== this.#node &&
          !['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI'].includes(blockNode.nodeName)
        ) {
          blockNode = blockNode.parentNode;
        }

        if (blockNode && (blockNode.nodeName === 'P' || blockNode.nodeName === 'DIV')) {
          if (startContainer.nodeType === Node.TEXT_NODE) {
            const text = startContainer.textContent;
            const offset = range.startOffset;
            const textBeforeCaret = text.substring(0, offset);

            if (textBeforeCaret === '*' || textBeforeCaret === '-') {
              e.preventDefault();
              startContainer.textContent = text.substring(offset);
              range.setStart(startContainer, 0);
              range.setEnd(startContainer, 0);
              sel.removeAllRanges();
              sel.addRange(range);
              document.execCommand('insertUnorderedList', false, null);
            } else if (textBeforeCaret === '1.' || textBeforeCaret === '1-') {
              e.preventDefault();
              startContainer.textContent = text.substring(offset);
              range.setStart(startContainer, 0);
              range.setEnd(startContainer, 0);
              sel.removeAllRanges();
              sel.addRange(range);
              document.execCommand('insertOrderedList', false, null);
            }
          }
        }
      }
    }
  }

  #updateMentionPopupSelection(items) {
    items.forEach((item, idx) => {
      if (idx === this.#mentionActiveIndex) {
        item.classList.add('active');
        item.scrollIntoView({ block: 'nearest' });
      } else {
        item.classList.remove('active');
      }
    });
  }

  #handleWYSIWYGKeyUp(e) {
    if (e.key === 'Enter') {
      // The row split already places the caret on keydown. Moving it again on
      // keyup would jump behind characters typed before Enter was released.
      return;
    }
    if (['ArrowUp', 'ArrowDown', 'Tab', 'Escape'].includes(e.key)) {
      return;
    }

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      this.#closeMentionPopup();
      return;
    }

    const range = sel.getRangeAt(0);
    if (range.startContainer.nodeType !== Node.TEXT_NODE) {
      this.#closeMentionPopup();
      return;
    }

    const text = range.startContainer.textContent;
    const offset = range.startOffset;
    const textBeforeCaret = text.substring(0, offset);

    const mentionMatch = textBeforeCaret.match(/@([a-zA-Z0-9áéíóúüñÁÉÍÓÚÜÑ]*)$/);
    if (!mentionMatch) {
      this.#closeMentionPopup();
      return;
    }

    const query = mentionMatch[1];
    const characters = this.#ingredients.filter((ing) => ing.type === 'character' && ing.importedProjectId);
    const filtered = characters.filter((c) => {
      let name = c.importedProjectName || '';
      if (!name && c.value) {
        try {
          name = JSON.parse(c.value).name;
        } catch (e) {}
      }
      return name.toLowerCase().includes(query.toLowerCase());
    });

    if (filtered.length > 0) {
      this.#showMentionPopup(filtered, range, mentionMatch[0]);
    } else {
      this.#closeMentionPopup();
    }
  }

  #showMentionPopup(filtered, range, matchText) {
    let popup = document.getElementById('kai-mention-popup');
    if (!popup) {
      popup = document.createElement('div');
      popup.id = 'kai-mention-popup';
      popup.className = 'kai-mention-popup glass';
      popup.hidden = true;
      document.body.appendChild(popup);
    }

    const rect = range.getBoundingClientRect();
    let top = rect.bottom;
    let left = rect.left;

    if (rect.width === 0 && rect.height === 0) {
      const span = document.createElement('span');
      span.textContent = '\u200b';
      range.insertNode(span);
      const tempRect = span.getBoundingClientRect();
      top = tempRect.bottom;
      left = tempRect.left;
      span.parentNode.removeChild(span);
    }

    popup.style.top = `${top + window.scrollY + 4}px`;
    popup.style.left = `${left + window.scrollX}px`;
    popup.hidden = false;

    if (this.#mentionActiveIndex >= filtered.length) {
      this.#mentionActiveIndex = 0;
    }

    popup.innerHTML = safeHTML('');
    filtered.forEach((char, idx) => {
      let charName = char.importedProjectName || '';
      if (!charName && char.value) {
        try {
          charName = JSON.parse(char.value).name;
        } catch (e) {}
      }

      const btn = document.createElement('button');
      btn.className = `mention-item ${idx === this.#mentionActiveIndex ? 'active' : ''}`;
      btn.innerHTML = safeHTML(
        `<span class="mention-item__icon">${renderIcon('character')}</span> <span>${charName}</span>`,
      );

      btn.addEventListener('mouseenter', () => {
        this.#mentionActiveIndex = idx;
        popup.querySelectorAll('button').forEach((b, i) => {
          b.classList.toggle('active', i === idx);
        });
      });

      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.#insertMention(char, range, matchText);
      });

      popup.appendChild(btn);
    });
  }

  #closeMentionPopup() {
    const popup = document.getElementById('kai-mention-popup');
    if (popup) {
      popup.hidden = true;
    }
  }

  #insertMention(char, range, matchText) {
    const textNode = range.startContainer;
    const offset = range.startOffset;
    const startOffset = offset - matchText.length;

    const replaceRange = document.createRange();
    replaceRange.setStart(textNode, startOffset);
    replaceRange.setEnd(textNode, offset);
    replaceRange.deleteContents();

    let charName = char.importedProjectName || '';
    if (!charName && char.value) {
      try {
        charName = JSON.parse(char.value).name;
      } catch (e) {}
    }

    const span = document.createElement('span');
    span.className = 'kai-tag kai-character-tag';
    span.setAttribute('spellcheck', 'false');
    // Tags are editable in WYSIWYG mode so that deleting letters unwraps them
    span.dataset.tag = charName;
    span.dataset.definition = `character:${char.importedProjectId}`;
    span.title = `character:${char.importedProjectId}`;
    span.textContent = charName;

    replaceRange.insertNode(span);

    // Use regular space character for cursor positioning stability
    const spaceNode = document.createTextNode(' ');
    span.parentNode.insertBefore(spaceNode, span.nextSibling);

    const newRange = document.createRange();
    newRange.setStart(spaceNode, 1);
    newRange.setEnd(spaceNode, 1);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(newRange);

    this.#ensureRemoveButtons();
    this.#closeMentionPopup();
    this.#emitChange();
  }

  // =========================================================================
  // BOOK COVER GENERATION
  // =========================================================================

  #createCoverSection(...args) {
    return this.#images.createCoverSection(...args);
  }

  updateCoverVisuals(...args) {
    return this.#images.updateCoverVisuals(...args);
  }

  navigateCoverHistory(...args) {
    return this.#images.navigateCoverHistory(...args);
  }

  regenerateCover(...args) {
    return this.#images.regenerateCover(...args);
  }

  deleteCover(...args) {
    return this.#images.deleteCover(...args);
  }

  #showCropperModal(...args) {
    return this.#cropper.showCropperModal(...args);
  }

  setCoverLoading(...args) {
    return this.#images.setCoverLoading(...args);
  }

  #hideCoverContextMenu(...args) {
    return this.#images.hideCoverContextMenu(...args);
  }

  async generateCover(...args) {
    return this.#images.generateCover(...args);
  }

  async generateCoverImage(...args) {
    return this.#images.generateCoverImage(...args);
  }

  async showCoverHistory(...args) {
    return this.#images.showCoverHistory(...args);
  }

  async generateCharacterPortrait(...args) {
    return this.#images.generateCharacterPortrait(...args);
  }
  async executeCharacterAction(action, transport) {
    if (this.#views.characterWorkspace && action?.projectId === this.#projectId)
      return this.#views.characterWorkspace.executeAction(action, transport);
    return enqueueRemoteCharacterAction(action, transport);
  }
  async attachCharacterPhoto(file) {
    return this.#views.characterWorkspace
      ? this.#views.characterWorkspace.attachPhoto(file)
      : attachCharacterTaskPhoto(file);
  }
}
