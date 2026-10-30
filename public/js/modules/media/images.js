import {
  parseCharacterDocument,
  characterVisualChangeKeys,
  validateCharacterPhotoReferences,
  characterAssistedCreation,
} from '../characters/character-model.js';
import { renderIcon } from '../../icons.js';
import { EventBus } from '../../event-bus.js';
import { cropCharacterFace, faceFilename } from '../characters/character-face.js';
import {
  saveGeneratedImage,
  characterImageTrashPatch,
  restoreCharacterImage,
  chooseCharacterVariation,
} from './generated-media.js';
import { updateDocumentDraft } from '../documents/document-draft.js';
import { trapCoverFocus, chooseCoverReferences } from './cover-workflow.js';
import { buildCharacterPortraitPrompt, characterPortraitReference } from '../characters/character-prompt.js';
import { safeHTML } from '../../safe-html.js';
import { AppState, applyProjectInference } from '../../app-state.js';
import { API } from '../../api-service.js';
import { Loader, Toast, Alert } from '../../ui-components.js';
import { CharacterImageGallery } from './character-gallery.js';
import {
  generateCharacterAssets,
  regenerateCharacterAsset,
  changeCharacterAssetLibrary,
  purgeCharacterPortraits,
  retryCharacterMediaCleanup,
  importSharedCharacterAsset,
} from './character-assets.js';
import { prepareCharacterAssetSelection } from './character-asset-selection.js';
import { activateCharacterPortraitOutfit } from '../characters/character-model.js';

/** Owns images DOM and lifecycle; context is the explicit editor integration contract. */
export class EditorImages {
  referenceController = new AbortController();
  dialogCleanups = new Set();
  coverContainer = null;
  coverContextMenu = null;
  portraitGenerating = false;
  characterChange = null;
  constructor(context) {
    this.context = context;
    this.inferenceChange = ({ key }) => {
      if (!['inferenceMode', 'inferenceSettings'].includes(key)) return;
      for (const button of this.coverContainer?.querySelectorAll('[data-generation-backend="api"]') || [])
        void this.refreshGenerationActions(
          button.parentElement,
          this.context.projectType === 'character' ? 'character' : 'cover',
        );
    };
  }

  destroy() {
    if (this.inferenceChangeRegistered) EventBus.off('state:change', this.inferenceChange);
    this.assetController?.abort();
    if (this.characterChange) EventBus.off('editor:change', this.characterChange);
    if (this.screenplayCoverChange) EventBus.off('autosave:saved', this.screenplayCoverChange);
    this.referenceController.abort();
    this.characterGallery?.destroy();
    for (const close of [...this.dialogCleanups]) close();
    this.coverContextMenu?.remove();
    this.coverContainer?.remove();
    this.coverContainer = null;
    this.coverContextMenu = null;
  }

  createCoverSection(projectData) {
    if (!this.inferenceChangeRegistered) {
      EventBus.on('state:change', this.inferenceChange);
      this.inferenceChangeRegistered = true;
    }
    const cover = document.createElement('div');
    const isCharacter = this.context.projectType === 'character';
    cover.className = isCharacter ? 'character-portrait-section' : 'book-cover-section';

    // Context Menu Event
    cover.addEventListener('contextmenu', (e) => {
      if (AppState.currentProject?.category !== 'screenplay') this.handleCoverContextMenu(e);
    });

    this.coverContainer = cover;
    if (projectData.category === 'screenplay') {
      this.screenplayCoverChange = () => {
        if (AppState.currentProject?.id === this.context.projectId)
          this.updateCoverVisuals(AppState.currentProject);
      };
      EventBus.on('autosave:saved', this.screenplayCoverChange);
    }
    if (isCharacter) {
      this.characterChange = () => {
        const button = this.coverContainer?.querySelector('[data-generation-backend="api"]');
        if (button) this.updateCharacterGenerationGate(button);
      };
      EventBus.on('editor:change', this.characterChange);
    }
    this.updateCoverVisuals(projectData);

    return cover;
  }

  isAdaptiveBookCover() {
    const project = AppState.currentProject || {};
    return (
      project.type === 'book' && (project.category === 'story-book' || project.category === 'screenplay')
    );
  }

  applyCoverDimensions(width = 780, height = 1170) {
    if (!this.context.layoutWrapper) return;
    if (!this.isAdaptiveBookCover()) {
      this.context.layoutWrapper.style.removeProperty('--book-canvas-width');
      this.context.layoutWrapper.style.removeProperty('--book-canvas-height');
      this.context.timelineNode?.style.removeProperty('height');
      this.context.timelineNode?.style.removeProperty('min-height');
      this.context.timelineNode?.style.removeProperty('max-height');
      this.context.requestTimelineGeometry?.();
      return;
    }
    const safeWidth = Number.isFinite(width) && width > 0 ? width : 780;
    const safeHeight = Number.isFinite(height) && height > 0 ? height : 1170;
    const canvasWidth = 780;
    const canvasHeight = Math.max(480, Math.min(2600, Math.round((canvasWidth * safeHeight) / safeWidth)));
    this.context.layoutWrapper.style.setProperty('--book-canvas-width', `${canvasWidth}px`);
    this.context.layoutWrapper.style.setProperty('--book-canvas-height', `${canvasHeight}px`);
    if (this.context.timelineNode) {
      this.context.timelineNode.style.height = `${canvasHeight}px`;
      this.context.timelineNode.style.minHeight = `${canvasHeight}px`;
      this.context.timelineNode.style.maxHeight = `${canvasHeight}px`;
    }
    this.context.requestTimelineGeometry?.();
  }

  updateCoverVisuals(projectData) {
    if (!this.coverContainer) return;
    const project = projectData || AppState.currentProject || {};
    if (this.context.projectType === 'character') {
      this.context.refreshCharacterVisualLibrary?.();
      this.characterGallery ||= new CharacterImageGallery(this.coverContainer, {
        upload: () => this.handleUploadClick(),
        generate: () => {
          const descriptionMode = characterAssistedCreation(
            parseCharacterDocument(AppState.currentProject?.content || ''),
          );
          void this.chooseAndGenerateImage(null, {
            automatic: descriptionMode,
            variation: Boolean(AppState.currentProject.covers?.length),
          });
        },
        regenerateProps: () =>
          void this.chooseAndGenerateImage(null, { automatic: true, assetsOnly: true, refreshAssets: true }),
        generation: (group) => void this.refreshGenerationActions(group, 'character'),
        delete: (url) => this.deleteCover(url),
        select: (url) => void this.selectCharacterImage(url),
        restore: (url) => void this.restoreCharacterImage(url),
        restoreMany: async (urls) => {
          let complete = true;
          for (const url of urls) if ((await this.restoreCharacterImage(url)) === false) complete = false;
          return complete;
        },
        purge: (urls) => this.purgeCharacterPortraits(urls),
        retryPurge: () => this.visualAssetAction({ type: 'retry-purge' }),
      });
      this.characterGallery.render(project, {
        descriptionMode: characterAssistedCreation(parseCharacterDocument(project.content || '')),
      });
      return;
    }
    this.coverContainer.innerHTML = safeHTML('');
    if (project.type === 'book' && project.category === 'screenplay') {
      this.applyCoverDimensions(1280, 1920);
      const url = project.covers?.[project.currentCoverIndex ?? 0] || project.previewImage;
      if (url) {
        const image = document.createElement('img');
        image.src = url;
        image.alt = project.name || 'Guión';
        image.className = 'w-full h-full object-cover book-cover-image';
        this.coverContainer.append(image);
      }
      return;
    }

    const covers = project.covers || [];
    const idx = project.currentCoverIndex !== undefined ? project.currentCoverIndex : -1;
    const isCharacter = this.context.projectType === 'character';
    this.applyCoverDimensions(780, 1170);

    const hasCover = covers.length > 0 && idx >= 0 && idx < covers.length;
    this.coverContainer.classList.toggle('is-empty', !hasCover);
    let emptyActions = null;

    // 1. Render Cover Image or Placeholder
    if (hasCover) {
      const img = document.createElement('img');
      img.src = covers[idx];
      img.className = 'w-full h-full object-cover';
      img.classList.add('book-cover-image');
      img.addEventListener('load', () => this.applyCoverDimensions(img.naturalWidth, img.naturalHeight), {
        once: true,
      });
      this.coverContainer.appendChild(img);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'cover-empty';
      placeholder.innerHTML = safeHTML(`
        <span class="cover-empty__icon" aria-hidden="true">${renderIcon(isCharacter ? 'character' : 'brush')}</span>
        <h3>${isCharacter ? 'Sin retrato' : 'Sin portada'}</h3>
      `);
      emptyActions = document.createElement('div');
      emptyActions.className = 'cover-empty__actions';
      placeholder.append(emptyActions);
      this.coverContainer.appendChild(placeholder);
    }

    // 2. Bottom Controls Overlay
    const overlay = document.createElement('div');
    overlay.className = 'cover-overlay';

    // Bottom row containing history nav and action buttons
    const row = document.createElement('div');
    row.className = 'w-full flex items-center justify-between gap-4';

    // Left: History Navigation (if any covers exist)
    const navContainer = document.createElement('div');
    navContainer.className = 'flex items-center gap-2';

    if (covers.length > 1) {
      const prevBtn = document.createElement('button');
      prevBtn.innerHTML = safeHTML(renderIcon('chevron-left'));
      prevBtn.type = 'button';
      prevBtn.setAttribute('aria-label', 'Imagen anterior');
      prevBtn.className = 'btn-ghost text-xs p-2 rounded-lg text-slate-400 hover:text-white cursor-pointer';
      prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.navigateCoverHistory(-1);
      });

      const label = document.createElement('span');
      label.className = 'text-[11px] text-slate-400 font-mono';
      label.textContent = `${idx + 1} de ${covers.length}`;

      const nextBtn = document.createElement('button');
      nextBtn.innerHTML = safeHTML(renderIcon('chevron-right'));
      nextBtn.type = 'button';
      nextBtn.setAttribute('aria-label', 'Imagen siguiente');
      nextBtn.className = 'btn-ghost text-xs p-2 rounded-lg text-slate-400 hover:text-white cursor-pointer';
      nextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.navigateCoverHistory(1);
      });

      navContainer.append(prevBtn, label, nextBtn);
    } else if (covers.length === 1) {
      const label = document.createElement('span');
      label.className = 'text-[11px] text-slate-500 font-mono';
      label.textContent = '1 imagen';
      navContainer.appendChild(label);
    }
    row.appendChild(navContainer);

    // Right: Action buttons (Upload, Regenerate, and Delete buttons)
    const actionsContainer = document.createElement('div');
    actionsContainer.className = 'flex items-center gap-2';

    // 1. Upload Button
    const uploadBtn = document.createElement('button');
    uploadBtn.innerHTML = safeHTML(`${renderIcon('upload')} Subir`);
    uploadBtn.type = 'button';
    uploadBtn.className = 'btn btn-secondary';
    uploadBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handleUploadClick();
    });
    (emptyActions || actionsContainer).appendChild(uploadBtn);

    // 2. Choose the provider for this generation. Availability is refreshed
    // from the server after the controls are rendered, so keys/models can be
    // changed in Settings without reloading the workspace.
    const generationGroup = document.createElement('div');
    generationGroup.className = 'image-generation-actions flex items-center gap-1.5';
    const apiBtn = document.createElement('button');
    apiBtn.type = 'button';
    apiBtn.dataset.generationBackend = 'api';
    apiBtn.innerHTML = safeHTML(`${renderIcon('brush')} Generar`);
    apiBtn.title = 'Seleccionar un modelo de imágenes en la nube';
    apiBtn.className = 'btn btn-primary';
    apiBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.chooseAndGenerateImage();
    });
    generationGroup.append(apiBtn);
    (emptyActions || actionsContainer).appendChild(generationGroup);

    // 3. Delete Button (only if there is at least one cover)
    if (this.context.projectType === 'book') {
      const historyBtn = document.createElement('button');
      historyBtn.className = 'btn btn-ghost';
      historyBtn.textContent = 'Historial y borradores';
      historyBtn.addEventListener('click', () => this.showCoverHistory());
      actionsContainer.append(historyBtn);
    }
    if (covers.length > 0) {
      const deleteBtn = document.createElement('button');
      deleteBtn.innerHTML = safeHTML(`${renderIcon('trash')} Eliminar`);
      deleteBtn.className =
        'px-3 py-1.5 rounded-lg border border-red-500/20 bg-red-900/30 hover:bg-red-800/50 hover:text-red-200 text-xs font-semibold text-red-400 cursor-pointer flex items-center gap-1.5 transition-all';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteCover();
      });
      actionsContainer.appendChild(deleteBtn);
    }

    row.appendChild(actionsContainer);
    overlay.appendChild(row);
    if (actionsContainer.childElementCount || navContainer.childElementCount) {
      this.coverContainer.appendChild(overlay);
    }
    void this.refreshGenerationActions(generationGroup, isCharacter ? 'character' : 'cover');
  }

  async refreshGenerationActions(group, imageType) {
    const apiBtn = group?.querySelector('[data-generation-backend="api"]');
    if (!apiBtn) return;
    apiBtn.disabled = true;
    apiBtn.title = 'Comprobando claves API…';
    try {
      const mode = AppState.inferenceMode;
      const availability = await this.imageAvailability();
      if (!group.isConnected) return;
      if (mode !== AppState.inferenceMode) return this.refreshGenerationActions(group, imageType);
      const apiAvailable = availability.api.some(
        (model) => !model.imageTypes || model.imageTypes.includes(imageType),
      );
      apiBtn.disabled = !apiAvailable;
      apiBtn.dataset.apiAvailable = String(apiAvailable);
      apiBtn.title = apiAvailable
        ? 'Generar con el modelo seleccionado en la barra superior'
        : mode === 'local'
          ? 'Faltan los pesos locales de FLUX 3 Image Klein'
          : 'Configura una clave de un proveedor de imágenes en Inicio → Configuración';
      if (imageType === 'character') this.updateCharacterGenerationGate(apiBtn);
    } catch (error) {
      if (group.isConnected) {
        apiBtn.disabled = true;
        apiBtn.title = 'No se pudo consultar la disponibilidad de modelos';
      }
      console.warn('No se pudo actualizar la disponibilidad de generación:', error);
    }
  }

  async setCharacterImageModel(engine) {
    if (this.context.destroyed || AppState.currentProject?.id !== this.context.projectId) return;
    const settings = await API.saveProjectInference(this.context.projectId, {
      imageModel: { provider: engine.provider, model: engine.model },
    });
    applyProjectInference(this.context.projectId, settings);
    if (!this.context.destroyed) this.characterGenerationModel = settings.imageModel;
  }
  async selectCharacterEngine() {
    const availability = await this.imageAvailability();
    const models = availability.api.filter(
      (model) => !model.imageTypes || model.imageTypes.includes('character'),
    );
    if (AppState.inferenceMode === 'local' && !models.length)
      throw Error('Faltan los pesos locales de FLUX 3 Image Klein.');
    const saved =
      (AppState.inferenceMode === 'local'
        ? models[0]
        : AppState.currentProject.inferenceSettings?.imageModel) ||
      AppState.currentProject.characterImageGeneration;
    if (saved) {
      if (!models.some((model) => model.provider === saved.provider && model.model === saved.model))
        throw Error('El modelo de imagen guardado no está disponible. Selecciona otro en la barra superior.');
      return saved;
    }
    throw Error('Selecciona un modelo de imagen en la barra superior.');
  }

  imageAvailability() {
    if (AppState.inferenceMode === 'local') {
      return API.localRuntime().then((state) => ({ api: state.imageModels || [] }));
    }
    return API.getImageGenerationAvailability();
  }

  chooseBackgroundAppearance(job) {
    return this.chooseCharacterAppearance(
      job.result.baseImage,
      job.result.candidateImage,
      this.referenceController.signal,
    );
  }

  async chooseAndGenerateImage(
    generationMode = null,
    {
      replaceCharacterImage = false,
      attachmentImage = '',
      automatic = false,
      variation = false,
      visualChangeKeys = [],
      photoReferences,
      signal,
      assetsOnly = false,
      refreshAssets = false,
      assetRegeneration,
      applyAssets = false,
    } = {},
  ) {
    const imageType = this.context.projectType === 'character' ? 'character' : 'cover';
    const assetReference = assetsOnly
      ? AppState.currentProject?.covers?.[AppState.currentProject.currentCoverIndex] ||
        AppState.currentProject?.covers?.[0]
      : '';
    if (imageType === 'character') {
      const document = parseCharacterDocument(AppState.currentProject?.content || '');
      if (!document?.identity.base || !document.identity.nature.trim()) {
        Toast.show('Define la base y la naturaleza antes de generar la imagen.', 'warning');
        return;
      }
    }
    try {
      signal?.throwIfAborted();
      const availability = await this.imageAvailability();
      const apiModels = availability.api.filter(
        (model) => !model.imageTypes || model.imageTypes.includes(imageType),
      );
      if (!apiModels.length)
        throw new Error(
          AppState.inferenceMode === 'local'
            ? 'Faltan los pesos locales de FLUX 3 Image Klein.'
            : 'Configura una clave de imágenes en Inicio → Configuración.',
        );
      const project = AppState.currentProject;
      const character = imageType === 'character' ? parseCharacterDocument(project.content || '') : null;
      const reference = character ? characterPortraitReference(project, character) : '';
      const inferredMuse = /\/muse-[A-Za-z0-9-]+\.(png|jpe?g|webp)$/i.test(reference)
        ? { provider: 'openrouter', model: 'meta/muse-image' }
        : null;
      const preferred =
        (AppState.inferenceMode === 'local' ? apiModels[0] : project.inferenceSettings?.imageModel) ||
        project.characterImageGeneration ||
        this.characterGenerationModel ||
        inferredMuse;
      let selected;
      if (preferred) {
        selected = apiModels.find(
          (model) => model.model === preferred.model && model.provider === preferred.provider,
        );
        if (!selected)
          throw new Error(
            'El motor de imágenes guardado no está disponible. Configura su clave o selecciona otro modelo en la barra superior; no se cambió de proveedor.',
          );
      } else throw Error('Selecciona un modelo de imagen en la barra superior.');
      if (!selected || this.context.destroyed || signal?.aborted) return;
      if (imageType === 'character') {
        if (
          assetsOnly &&
          (!assetReference ||
            (project.covers?.[project.currentCoverIndex] || project.covers?.[0]) !== assetReference)
        )
          throw new Error('Selecciona una fotografía principal y vuelve a generar sus props.');
        this.characterGenerationModel = selected;
        const engine = { provider: selected.provider, model: selected.model };
        if (JSON.stringify(project.characterImageGeneration) !== JSON.stringify(engine)) {
          const updated = await updateDocumentDraft(this.context.projectId, () => ({
            characterImageGeneration: engine,
          }));
          if (!this.context.destroyed && AppState.currentProject?.id === this.context.projectId)
            AppState.currentProject.characterImageGeneration = updated.characterImageGeneration;
        }
        if (this.context.destroyed || AppState.currentProject?.id !== this.context.projectId) return;
        if (API.enqueueCharacterJob && this.context.runCharacterJob) {
          const assetSelection = applyAssets
            ? await prepareCharacterAssetSelection(project, character, signal)
            : undefined;
          return await this.context.runCharacterJob({
            kind: assetsOnly ? 'assets' : assetRegeneration ? 'regenerate' : 'portrait',
            engine,
            ...(assetsOnly
              ? {
                  referenceImage: assetReference,
                  refreshAssets,
                }
              : {}),
            ...(assetRegeneration
              ? { assetId: assetRegeneration.id, referenceImage: assetRegeneration.referenceImage }
              : {}),
            ...(attachmentImage ? { attachmentImage } : {}),
            variation,
            visualChangeKeys,
            ...(photoReferences ? { photoReferences } : {}),
            ...(assetSelection ? { assetSelection } : {}),
          });
        }
        if (assetsOnly) return await this.generateCharacterVisualLibrary(engine, { refreshAssets });
        if (assetRegeneration) return await this.regenerateCharacterVisualAsset(assetRegeneration, engine);
        return await this.generateCharacterPortrait({
          provider: selected.provider,
          model: selected.model,
          replacePrevious: replaceCharacterImage,
          attachmentImage,
          variation,
          visualChangeKeys,
          photoReferences,
          signal,
          modelLabel: selected.label,
          applyAssets,
        });
      }
      const candidates = this.getCoverReferenceCandidates();
      const referenceSetup = await chooseCoverReferences(
        candidates,
        this.context.getContext()?.plainText || '',
        {
          maxReferences: selected.maxReferences ?? 8,
          returnMetadata: true,
          defaultIncludeText: true,
          signal: this.referenceController.signal,
        },
      );
      if (!referenceSetup || this.context.destroyed) return;
      const generation = {
        backend: selected.provider === 'local' ? 'local' : 'api',
        provider: selected.provider,
        inputImages: referenceSetup.selected.map((item) => item.url),
        referenceProjectIds: referenceSetup.selected.map((item) => item.projectId).filter(Boolean),
        referenceNames: referenceSetup.selected.map((item) => item.name).filter(Boolean),
        referenceLabels: referenceSetup.selected.map((item, i) =>
          item.kind === 'scene'
            ? `Image ${i + 1}: scene/background reference ${item.name}. Preserve its environment, palette and composition.`
            : `Image ${i + 1}: character ${item.name}. Preserve their recognizable appearance without adding an extra person.`,
        ),
        includeText: referenceSetup.includeText,
        referencesSelected: true,
        promptPrepared: true,
        modelLabel: selected.label,
        model: selected.model,
      };
      const lastMode = generationMode || AppState.currentProject?.lastCoverGenerationMode || 'proyecto';
      if (lastMode === 'personalizado') {
        this.showCoverPromptModal((customPrompt) => {
          if (customPrompt) void this.generateCoverImage(customPrompt, 'personalizado', '', generation);
        });
      } else {
        await this.generateCover(lastMode, generation);
      }
    } catch (error) {
      Toast.show(error.message || 'No se pudo consultar la disponibilidad de generación.', 'error');
    }
  }

  getCoverReferenceCandidates() {
    const candidates = [];
    for (const ing of this.context.ingredients || []) {
      if (!['character', 'stage', 'scenario', 'setting'].includes(ing.type) || ing.active === false) continue;
      try {
        let data = {};
        try {
          data = JSON.parse(ing.value || '{}');
        } catch {
          data = {};
        }
        const covers = data.covers || ing.covers || [];
        if (!covers.length) continue;
        const current = data.currentCoverIndex ?? ing.currentCoverIndex;
        const index = typeof current === 'number' ? current : covers.length - 1;
        const url = covers[index] || covers[covers.length - 1];
        if (!url) continue;
        const kind = ing.type === 'character' ? 'subject' : 'scene';
        candidates.push({
          url,
          name: data.name || ing.label || (kind === 'scene' ? 'Escenario' : 'Personaje'),
          kind,
          projectId: ing.importedProjectId || null,
        });
      } catch (error) {
        console.warn('No se pudo preparar una referencia de portada:', error);
      }
    }
    return candidates;
  }

  navigateCoverHistory(direction) {
    const project = AppState.currentProject;
    if (!project || !project.covers || project.covers.length <= 1) return;

    let newIdx = project.currentCoverIndex + direction;
    if (newIdx < 0) newIdx = project.covers.length - 1;
    if (newIdx >= project.covers.length) newIdx = 0;

    project.currentCoverIndex = newIdx;
    this.updateCoverVisuals(project);

    // Save only the temporary document.
    updateDocumentDraft(this.context.projectId, () => ({ currentCoverIndex: newIdx })).catch((err) =>
      console.error('Failed to update cover index on server:', err),
    );
  }

  chooseCharacterAppearance(baseImage, candidateImage, signal) {
    if (this.context.destroyed || signal?.aborted) return Promise.resolve(null);
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay character-appearance-overlay';
      const dialog = document.createElement('section');
      dialog.className = 'modal-content character-appearance-dialog';
      const header = document.createElement('header');
      header.className = 'modal-header';
      const heading = document.createElement('h2');
      heading.className = 'modal-title';
      heading.textContent = 'Elige la apariencia principal';
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'modal-close';
      close.setAttribute('aria-label', 'Conservar actual y cerrar');
      close.innerHTML = safeHTML(renderIcon('close'));
      header.append(heading, close);
      const body = document.createElement('div');
      body.className = 'modal-body';
      const description = document.createElement('p');
      description.textContent =
        'Conserva una de las dos fotos como apariencia principal. La otra irá a la papelera; las demás poses se mantienen.';
      const grid = document.createElement('div');
      grid.className = 'character-appearance-options';
      let settled = false,
        releaseFocus = () => {};
      const finish = (choice) => {
        if (settled) return;
        settled = true;
        this.dialogCleanups.delete(cancel);
        signal?.removeEventListener('abort', cancel);
        overlay.remove();
        releaseFocus();
        resolve(choice);
      };
      const cancel = () => finish(null);
      this.dialogCleanups.add(cancel);
      signal?.addEventListener('abort', cancel, { once: true });
      for (const [choice, title, url, label] of [
        ['current', 'Actual', baseImage, 'Conservar actual'],
        ['new', 'Nueva propuesta', candidateImage, 'Conservar nueva'],
      ]) {
        const card = document.createElement('figure');
        card.className = 'character-appearance-option';
        const caption = document.createElement('figcaption');
        caption.textContent = title;
        const image = document.createElement('img');
        image.src = url;
        image.alt = title + ' del personaje';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-secondary';
        button.textContent = label;
        button.addEventListener('click', () => finish(choice));
        card.append(caption, image, button);
        grid.append(card);
      }
      const hint = document.createElement('p');
      hint.className = 'character-appearance-hint';
      hint.textContent = 'Si cierras esta ventana, conservas la foto actual.';
      body.append(description, grid, hint);
      dialog.append(header, body);
      overlay.append(dialog);
      document.body.append(overlay);
      close.addEventListener('click', () => finish('current'));
      releaseFocus = trapCoverFocus(overlay, () => finish('current'), { closeOnBackdrop: true });
    });
  }

  regenerateCover() {
    const lastMode = AppState.currentProject?.lastCoverGenerationMode || 'proyecto';
    void this.chooseAndGenerateImage(this.context.projectType === 'character' ? null : lastMode);
  }

  async selectCharacterImage(url) {
    const projectId = this.context.projectId;
    if (this.primarySelecting || this.context.destroyed || AppState.currentProject?.id !== projectId) return;
    this.primarySelecting = true;
    try {
      const updated = await updateDocumentDraft(projectId, (current) => {
        const index = current.covers?.indexOf(url) ?? -1;
        if (index < 0) throw new Error('La imagen ya no pertenece al personaje.');
        const linked = activateCharacterPortraitOutfit(
          parseCharacterDocument(current.content),
          current.characterVisualLibrary,
          url,
        );
        return {
          currentCoverIndex: index,
          ...(linked
            ? { content: JSON.stringify(linked.document), characterVisualLibrary: linked.library }
            : {}),
        };
      });
      if (!this.context.destroyed && AppState.currentProject?.id === projectId) {
        AppState.currentProject.currentCoverIndex = updated.currentCoverIndex;
        this.updateCoverVisuals(AppState.currentProject);
        if (parseCharacterDocument(updated.content || '')?.identity.base === 'humanoid')
          void this.ensureCharacterFace(url, projectId);
      }
    } catch (error) {
      Toast.show('No se pudo seleccionar la imagen: ' + error.message, 'error');
    } finally {
      this.primarySelecting = false;
    }
  }

  async ensureCharacterFace(url, projectId) {
    try {
      const { files } = await API.getFiles(projectId);
      if (!files.includes(faceFilename(url))) await this.detectAndUploadFace(url, projectId);
    } catch (error) {
      console.warn('[Character face] No se pudo preparar el rostro de la imagen principal:', error);
    }
  }

  async restoreCharacterImage(url) {
    const projectId = this.context.projectId;
    if (this.restoringImage || this.context.destroyed || AppState.currentProject?.id !== projectId)
      return false;
    this.restoringImage = true;
    try {
      const updated = await restoreCharacterImage(projectId, url);
      if (!this.context.destroyed && AppState.currentProject?.id === projectId) {
        Object.assign(AppState.currentProject, {
          covers: updated.covers,
          characterImageTrash: updated.characterImageTrash,
          currentCoverIndex: updated.currentCoverIndex,
        });
        this.updateCoverVisuals(AppState.currentProject);
        if (
          updated.covers[updated.currentCoverIndex] === url &&
          parseCharacterDocument(updated.content)?.identity.base === 'humanoid'
        )
          void this.ensureCharacterFace(url, projectId);
        Toast.show('Imagen restaurada en la galería.', 'success');
      }
      return true;
    } catch (error) {
      Toast.show(error.message, 'error');
      return false;
    } finally {
      this.restoringImage = false;
    }
  }

  deleteCover(requestedUrl) {
    const project = AppState.currentProject;
    if (!project || !project.covers || project.covers.length === 0) return;

    const idx = requestedUrl === undefined ? project.currentCoverIndex : project.covers.indexOf(requestedUrl);
    if (idx < 0 || idx >= project.covers.length) return;
    const projectId = this.context.projectId;
    const imageUrl = project.covers[idx];

    Alert.confirm({
      title: project.type === 'character' ? 'Mover imagen a la papelera' : 'Eliminar imagen',
      message:
        project.type === 'character'
          ? 'Podrás restaurarla desde la papelera de la galería.'
          : '¿Estás seguro de que deseas eliminar la imagen actual? Esta acción no se puede deshacer.',
      confirmLabel: project.type === 'character' ? 'Mover a la papelera' : 'Eliminar',
      cancelLabel: 'Cancelar',
      type: 'danger',
      onConfirm: async () => {
        try {
          Loader.show();
          const updated = await updateDocumentDraft(projectId, (current) => {
            if (current.type === 'character') return characterImageTrashPatch(current, imageUrl);
            const selected = current.covers?.[current.currentCoverIndex];
            const covers = (current.covers || []).filter((url) => url !== imageUrl);
            return {
              covers,
              ...(current.type === 'character' && current.lastCharacterImage === imageUrl
                ? { lastCharacterImage: '' }
                : {}),
              currentCoverIndex: covers.length ? Math.max(0, covers.indexOf(selected)) : -1,
              coverVersions: (current.coverVersions || []).filter((version) => version.finalUrl !== imageUrl),
            };
          });
          // Retain source files: backgrounds may be shared by other versions/drafts.
          if (!this.context.destroyed && AppState.currentProject?.id === projectId) {
            Object.assign(AppState.currentProject, {
              covers: updated.covers,
              currentCoverIndex: updated.currentCoverIndex,
              coverVersions: updated.coverVersions,
              ...(updated.type === 'character'
                ? {
                    lastCharacterImage: updated.lastCharacterImage,
                    characterImageTrash: updated.characterImageTrash,
                  }
                : {}),
            });
            this.updateCoverVisuals(AppState.currentProject);
          }

          Toast.show(
            project.type === 'character' ? 'Imagen movida a la papelera.' : 'Imagen eliminada con éxito.',
            'success',
          );
        } catch (err) {
          console.error('Error deleting image:', err);
          Toast.show('Error al eliminar la imagen: ' + err.message, 'error');
        } finally {
          Loader.hide();
        }
      },
    });
  }

  async detectAndUploadFace(imageUrl, projectId = this.context.projectId) {
    if (!imageUrl || !projectId) return;
    try {
      const result = await cropCharacterFace(imageUrl);
      if (result) await API.uploadBase64(projectId, result.dataURL, faceFilename(imageUrl));
    } catch (error) {
      console.warn('[Character face] No se pudo guardar el recorte:', error);
    }
  }

  async importCharacterPortrait(dataURL, projectId) {
    if (this.portraitUploading || this.context.destroyed || AppState.currentProject?.id !== projectId) return;
    this.portraitUploading = true;
    Loader.show();
    try {
      const response = await API.uploadBase64(projectId, dataURL);
      if (!response?.imageUrl) throw new Error('No se recibió la URL de la imagen.');
      if (this.context.destroyed || AppState.currentProject?.id !== projectId) return;
      const project = AppState.currentProject;
      const first = !project.covers?.length;
      const doc = first ? parseCharacterDocument(project.content || '') : null;
      if (doc) {
        doc.creation.mode ||= 'image';
        doc.creation.initialState = 'complete';
      }
      const updated = await saveGeneratedImage(
        projectId,
        response.imageUrl,
        first
          ? {
              ...(doc ? { content: JSON.stringify(doc) } : {}),
              lastCharacterImage: response.imageUrl,
            }
          : {},
      );
      if (this.context.destroyed || AppState.currentProject?.id !== projectId) return;
      Object.assign(project, updated);
      this.context.onCharacterPhotoUploaded?.();
      this.updateCoverVisuals(project);
      Toast.show('Fotografía añadida a la galería.', 'success');
    } catch (error) {
      if (!this.context.destroyed && AppState.currentProject?.id === projectId)
        Toast.show('No se pudo subir la fotografía: ' + error.message, 'error');
    } finally {
      this.portraitUploading = false;
      Loader.hide();
    }
  }

  handleUploadClick() {
    const projectId = this.context.projectId;
    const projectType = this.context.projectType;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.jpg,.jpeg,.png,.webp,.gif,.bmp';
    input.hidden = true;

    input.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 15 * 1024 * 1024) {
        Toast.show('Elige una imagen de hasta 15 MB.', 'warning');
        return;
      }

      // Check extension
      const validExtensions = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'];
      const extension = file.name.split('.').pop().toLowerCase();
      const validMimeTypes = [
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/webp',
        'image/gif',
        'image/bmp',
        'image/x-ms-bmp',
      ];

      if (!validExtensions.includes(extension) && !validMimeTypes.includes(file.type)) {
        Toast.show('Formato no aceptado. Usa JPG, PNG, WebP, GIF o BMP.', 'error');
        return;
      }

      // Check dimensions
      const reader = new FileReader();
      reader.onload = (evt) => {
        const img = new Image();
        img.onload = () => {
          const w = img.naturalWidth;
          const h = img.naturalHeight;

          if (projectType === 'character') {
            if (w < 64 || h < 64 || w > 8192 || h > 8192 || w * h > 32000000) {
              Toast.show(
                'Elige una fotografía de entre 64 y 8192 píxeles por lado y hasta 32 megapíxeles.',
                'warning',
              );
              return;
            }
            void this.importCharacterPortrait(evt.target.result, projectId);
            return;
          }
          if (w < 500 || h < 500) {
            Toast.show('La imagen es demasiado pequeña. El tamaño mínimo es 500x500 píxeles.', 'error');
            return;
          }
          if (w > 3000 || h > 3000) {
            Toast.show('La imagen es demasiado grande. El tamaño máximo es 3000x3000 píxeles.', 'error');
            return;
          }

          if (this.context.destroyed || AppState.currentProject?.id !== projectId) return;
          // Open cropper
          this.context.showCropperModal(evt.target.result, async (croppedBase64) => {
            if (!croppedBase64 || this.context.destroyed || AppState.currentProject?.id !== projectId) return;

            try {
              Loader.show();
              const response = await API.uploadBase64(projectId, croppedBase64);
              if (!response || !response.imageUrl) {
                throw new Error('No se recibió la URL de la imagen.');
              }

              const updated = await saveGeneratedImage(projectId, response.imageUrl);
              if (!this.context.destroyed && AppState.currentProject?.id === projectId) {
                Object.assign(AppState.currentProject, {
                  covers: updated.covers,
                  currentCoverIndex: updated.currentCoverIndex,
                });
                this.updateCoverVisuals(AppState.currentProject);
                Toast.show('Imagen subida y recortada con éxito.', 'success');
              }
              if (
                projectType === 'character' &&
                parseCharacterDocument(AppState.currentProject.content)?.identity.base === 'humanoid'
              )
                void this.detectAndUploadFace(response.imageUrl, projectId);
            } catch (err) {
              console.error('Upload error:', err);
              Toast.show('Error al subir la imagen: ' + err.message, 'error');
            } finally {
              Loader.hide();
            }
          });
        };
        img.onerror = () => Toast.show('No se pudo leer la imagen.', 'error');
        img.src = evt.target.result;
      };
      reader.onerror = () => Toast.show('No se pudo leer el archivo.', 'error');
      reader.readAsDataURL(file);
    });

    document.body.appendChild(input);
    input.click();
    input.remove();
  }

  setCoverLoading(state, text = 'Procesando...') {
    if (!this.coverContainer) return;

    let overlay = this.coverContainer.querySelector('.cover-loading-overlay');

    if (state) {
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'cover-loading-overlay';
        overlay.innerHTML = safeHTML(`
          <div class="kubrick-loader" role="status" aria-label="Generando imagen">${renderIcon('interpreting', 48)}</div>
          <span class="text-sm font-semibold text-slate-200 loading-text">${text}</span>
          <span class="text-xs text-slate-400">El tiempo depende del motor y la resolución elegidos.</span>
        `);
        this.coverContainer.appendChild(overlay);
      } else {
        overlay.querySelector('.loading-text').textContent = text;
      }
    } else {
      if (overlay) {
        overlay.remove();
      }
    }
  }

  createCoverContextMenu() {
    if (this.coverContextMenu) return;
    const menu = document.createElement('div');
    menu.className = 'kai-context-menu';
    menu.hidden = true;

    // Generar Portada (parent menu item with submenu) - for books
    const generateParent = document.createElement('div');
    generateParent.className = 'kai-context-menu-item cover-menu-book';
    generateParent.innerHTML = safeHTML(
      `<span>${renderIcon('image')} Generar portada</span> <span class="kai-context-menu-chevron">${renderIcon('chevron-right')}</span>`,
    );
    generateParent.addEventListener('mousedown', (e) => e.preventDefault());

    const submenu = document.createElement('div');
    submenu.className = 'kai-context-submenu';

    const addSubItem = (label, action) => {
      const btn = document.createElement('button');
      btn.className = 'kai-context-menu-item';
      btn.innerHTML = safeHTML(label);
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.hideCoverContextMenu();
        action();
      });
      submenu.appendChild(btn);
    };

    addSubItem('A partir del proyecto', () => this.chooseAndGenerateImage('proyecto'));
    addSubItem('A partir de selección de texto', () => this.chooseAndGenerateImage('seleccion'));
    addSubItem('A partir de prompt personalizado', () => this.chooseAndGenerateImage('personalizado'));

    generateParent.appendChild(submenu);
    menu.appendChild(generateParent);

    // Generar Fotografía de Personaje - for characters
    const generateCharacterPhoto = document.createElement('button');
    generateCharacterPhoto.className = 'kai-context-menu-item cover-menu-character';
    generateCharacterPhoto.innerHTML = safeHTML(`<span>${renderIcon('camera')} Generar retrato</span>`);
    generateCharacterPhoto.addEventListener('mousedown', (e) => e.preventDefault());
    generateCharacterPhoto.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.hideCoverContextMenu();
      void this.chooseAndGenerateImage();
    });
    menu.appendChild(generateCharacterPhoto);

    document.body.appendChild(menu);
    this.coverContextMenu = menu;
  }

  handleCoverContextMenu(e) {
    e.preventDefault();
    e.stopPropagation();

    this.createCoverContextMenu();

    const menu = this.coverContextMenu;
    if (!menu) return;

    // Show/hide menu items based on project type
    const isCharacter = this.context.projectType === 'character';

    const bookItem = menu.querySelector('.cover-menu-book');
    const charItem = menu.querySelector('.cover-menu-character');

    if (bookItem) bookItem.hidden = isCharacter;
    if (charItem) charItem.hidden = !isCharacter;

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

    // Enable/disable selection-dependent submenu options
    const ctx = this.context.getContext();
    const hasSelection = ctx.selectedText && ctx.selectedText.trim().length > 0;
    const subitems = menu.querySelectorAll('.kai-context-submenu .kai-context-menu-item');
    if (subitems && subitems[1]) {
      if (hasSelection) {
        subitems[1].classList.remove('disabled');
      } else {
        subitems[1].classList.add('disabled');
      }
    }
  }

  hideCoverContextMenu() {
    if (this.coverContextMenu) {
      this.coverContextMenu.hidden = true;
    }
  }

  async generateCover(mode, generation = {}) {
    if (mode === 'personalizado') {
      this.showCoverPromptModal((text) => {
        if (text) void this.generateCoverImage(text, mode, '', generation);
      });
      return;
    }
    return this.submitCoverJob(mode, generation);
  }

  async generateCoverImage(promptText, mode, tagline, generation = {}) {
    return this.submitCoverJob('personalizado', generation, promptText);
  }

  async submitCoverJob(mode, generation = {}, customPrompt = '') {
    if (AppState.currentProject?.category === 'screenplay') return;
    const projectId = this.context.projectId;
    if (this.coverJobPending) return;
    const ctx = this.context.getContext();
    if (mode === 'seleccion' && !ctx?.selectedText?.trim()) {
      Toast.show('Selecciona un fragmento del editor primero.', 'warning');
      return;
    }
    this.coverJobPending = true;
    this.setCoverLoading(true, 'Preparando portada…');
    try {
      await EventBus.emitAsync('autosave:flush');
      const response = await API.enqueueCoverJob({
        projectId,
        token: crypto.randomUUID(),
        mode,
        selectedText: mode === 'seleccion' ? ctx.selectedText : '',
        customPrompt,
        includeText: generation.includeText !== false,
        inputImages: generation.inputImages || [],
        referenceLabels: generation.referenceLabels || [],
        referenceProjectIds: generation.referenceProjectIds || [],
        referenceNames: generation.referenceNames || [],
      });
      const signal = this.referenceController.signal;
      while (!signal.aborted) {
        const state = await API.characterJob(response.job.id, { signal });
        if (['completed', 'failed', 'cancelled', 'interrupted'].includes(state.job.status)) {
          if (state.job.status !== 'completed')
            throw new Error(state.job.error || 'Generación de portada detenida.');
          if (!this.context.destroyed && AppState.currentProject?.id === projectId) {
            const saved = state.draft?.payload;
            if (saved) {
              for (const key of ['covers', 'currentCoverIndex', 'lastCoverPrompt', 'lastCoverGenerationMode'])
                AppState.currentProject[key] = saved[key];
              this.updateCoverVisuals(AppState.currentProject);
            }
            Toast.show('Portada guardada.', 'success');
          }
          return;
        }
        this.setCoverLoading(true, state.job.message || 'Generando portada…');
        await new Promise((resolve) => {
          const finish = () => {
            clearTimeout(timer);
            signal.removeEventListener('abort', finish);
            resolve();
          };
          const timer = setTimeout(finish, 1500);
          signal.addEventListener('abort', finish, { once: true });
        });
      }
    } catch (error) {
      if (!this.context.destroyed && error.name !== 'AbortError') Toast.show(error.message, 'error');
    } finally {
      this.coverJobPending = false;
      if (!this.context.destroyed) this.setCoverLoading(false);
    }
  }

  async showCoverHistory() {
    const projectId = this.context.projectId;
    if (this.context.destroyed || AppState.currentProject?.id !== projectId) return;
    const project = AppState.currentProject;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay cover-history-overlay';
    const dialog = document.createElement('div');
    dialog.className = 'modal-content glass-heavy cover-history';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'Historial de portadas');
    const heading = document.createElement('h2');
    heading.textContent = 'Historial de portadas';
    const closeButton = document.createElement('button');
    closeButton.className = 'btn btn-ghost';
    closeButton.textContent = 'Cerrar';
    const grid = document.createElement('div');
    grid.className = 'cover-history-grid';
    dialog.append(heading, closeButton, grid);
    overlay.append(dialog);
    document.body.append(overlay);
    const close = () => {
      this.dialogCleanups.delete(close);
      overlay.remove();
      release();
    };
    this.dialogCleanups.add(close);
    const release = trapCoverFocus(overlay, close);
    closeButton.addEventListener('click', close);
    for (const [index, url] of (project.covers || []).entries()) {
      const item = document.createElement('article');
      const image = document.createElement('img');
      image.src = url;
      image.alt = 'Portada ' + (index + 1);
      const caption = document.createElement('p');
      caption.textContent = 'Portada ' + (index + 1);
      const useButton = document.createElement('button');
      useButton.className = 'btn btn-ghost';
      useButton.textContent =
        url === project.covers?.[project.currentCoverIndex] ? 'Portada actual' : 'Usar portada';
      useButton.disabled = useButton.textContent === 'Portada actual';
      useButton.addEventListener('click', async () => {
        try {
          const updated = await updateDocumentDraft(projectId, (current) => {
            const currentIndex = current.covers?.indexOf(url) ?? -1;
            if (currentIndex < 0) throw new Error('Esta portada ya no está disponible.');
            return { currentCoverIndex: currentIndex };
          });
          if (!this.context.destroyed && AppState.currentProject?.id === projectId) {
            Object.assign(AppState.currentProject, {
              covers: updated.covers,
              currentCoverIndex: updated.currentCoverIndex,
              coverVersions: updated.coverVersions,
            });
            this.updateCoverVisuals(AppState.currentProject);
          }
          close();
        } catch (error) {
          Toast.show(error.message, 'error');
        }
      });
      item.append(image, caption, useButton);
      grid.append(item);
    }
    if (!grid.children.length) {
      const empty = document.createElement('p');
      empty.textContent = 'Todavía no hay portadas.';
      grid.append(empty);
    }
  }

  showCoverPromptModal(callback) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay editor-cover-prompt-overlay';

    const content = document.createElement('div');
    content.className = 'modal-content glass-heavy editor-modal editor-modal--cover';

    content.innerHTML = safeHTML(`
      <div class="editor-modal__title">
        <span>${renderIcon('brush')}</span> Generar portada: Prompt personalizado
      </div>
      <p class="editor-modal__description">
        Describe la escena, estilo artístico y detalles visuales que deseas para la portada del libro.
      </p>
      <div>
        <textarea id="cover-modal-prompt" class="input editor-modal__textarea" placeholder="Ej: Una ilustración de óleo de un astronauta en medio de un desierto de cristales violetas, estilo surrealista, colores cálidos..."></textarea>
      </div>
      <div class="editor-modal__actions">
        <button id="cover-modal-cancel" class="btn btn-ghost editor-modal__button">Cancelar</button>
        <button id="cover-modal-save" class="btn btn-primary editor-modal__button editor-modal__button--accent">Generar Portada</button>
      </div>
    `);

    overlay.appendChild(content);
    document.body.appendChild(overlay);

    const textarea = overlay.querySelector('#cover-modal-prompt');
    let releaseFocus = () => {};

    const cleanup = () => {
      this.dialogCleanups.delete(cleanup);
      overlay.remove();
      releaseFocus();
    };

    this.dialogCleanups.add(cleanup);
    overlay.querySelector('#cover-modal-cancel').addEventListener('click', () => {
      cleanup();
      callback(null);
    });

    overlay.querySelector('#cover-modal-save').addEventListener('click', () => {
      const prompt = textarea.value.trim();
      cleanup();
      callback(prompt);
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        cleanup();
        callback(null);
      }
    });

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        overlay.querySelector('#cover-modal-save').click();
      }
    });
    releaseFocus = trapCoverFocus(overlay, () => overlay.querySelector('#cover-modal-cancel').click());
  }

  updateCharacterGenerationGate(button) {
    const document = parseCharacterDocument(AppState.currentProject?.content || '');
    const ready = document?.identity.base && document.identity.nature.trim();
    button.disabled = !ready || button.dataset.apiAvailable !== 'true';
    if (!ready) button.title = 'Define la base y la naturaleza del personaje';
    else if (button.dataset.apiAvailable === 'true')
      button.title = 'Generar con el modelo seleccionado en la barra superior';
  }

  async generateCharacterPortrait(generation = {}) {
    if (generation.applyAssets)
      throw new Error(
        'Aplicar Outfit requiere la cola del servidor para componer y verificar las piezas. Recarga el workspace.',
      );
    if (
      this.portraitGenerating ||
      this.context.destroyed ||
      AppState.currentProject?.id !== this.context.projectId
    )
      return;
    this.portraitGenerating = true;
    const projectId = this.context.projectId;
    const project = JSON.parse(JSON.stringify(AppState.currentProject || {}));
    this.setCoverLoading(true, 'Analizando personaje...');
    try {
      const signal = generation.signal
        ? AbortSignal.any([this.referenceController.signal, generation.signal])
        : this.referenceController.signal;
      signal.throwIfAborted();
      const document = parseCharacterDocument(project.content);
      if (!document?.identity.base || !document.identity.nature.trim())
        throw new Error('Define la base y la naturaleza antes de generar la imagen.');
      const photoReferences =
        generation.photoReferences === undefined
          ? undefined
          : validateCharacterPhotoReferences(generation.photoReferences, projectId);
      const selectedPhotos = photoReferences ? [photoReferences.base, ...photoReferences.details] : [];
      const replacePrevious = generation.replacePrevious && !photoReferences;
      if (selectedPhotos.some((photo) => !project.covers?.includes(photo.image)))
        throw new Error('Una foto seleccionada ya no está en la galería. Revisa sus números.');
      const primary = project.covers?.[project.currentCoverIndex] || project.covers?.[0];
      const assetSelection = generation.applyAssets
        ? await prepareCharacterAssetSelection(project, document, signal)
        : undefined;
      const referenceImage =
        photoReferences?.base.image ||
        ((generation.variation || generation.applyAssets) && primary) ||
        characterPortraitReference(project, document);
      const compareAppearance = Boolean(generation.variation && primary && !photoReferences);
      const initialPhotoReference =
        !primary && document.creation.mode === 'image' && referenceImage === document.creation.referenceImage;
      const attachmentImage = generation.attachmentImage || '';
      if (
        attachmentImage &&
        (!attachmentImage.startsWith(`/projects/${projectId}/content/`) ||
          !/^\/projects\/[A-Za-z0-9_-]{1,140}\/content\/[A-Za-z0-9][A-Za-z0-9_.-]{0,180}\.(png|jpe?g|webp|gif|bmp)$/i.test(
            attachmentImage,
          ))
      )
        throw new Error('La fotografía adjunta debe pertenecer a este personaje.');
      if (
        (replacePrevious || compareAppearance) &&
        referenceImage &&
        (project.characterImageTrash || []).length >= 500
      )
        throw new Error('La papelera está llena. Restaura imágenes antes de generar otra edición.');
      const changeKeys = generation.visualChangeKeys || [];
      this.setCoverLoading(true, 'Preparando una dirección visual específica…');
      const prepared = await API.prepareCharacterImagePrompt(
        {
          projectId,
          document,
          purpose: assetSelection
            ? 'assets'
            : initialPhotoReference
              ? 'initial'
              : referenceImage
                ? generation.variation || !changeKeys.length
                  ? 'variation'
                  : 'edit'
                : 'initial',
          referenceImage,
          attachmentImage,
          visualChangeKeys: changeKeys,
          ...(photoReferences ? { photoReferences } : {}),
          ...(assetSelection ? { assetSelection } : {}),
        },
        { signal },
      );
      signal.throwIfAborted();
      if (this.context.destroyed || AppState.currentProject?.id !== projectId) return null;
      const current = parseCharacterDocument(AppState.currentProject.content);
      if (initialPhotoReference && current?.creation.referenceImage !== referenceImage)
        throw new Error(
          'La fotografía de origen cambió mientras se preparaba la imagen. Reintenta con la referencia vigente.',
        );
      if (!current || characterVisualChangeKeys(document, current).length)
        throw new Error(
          'Los rasgos visuales cambiaron mientras se preparaba la imagen. Reintenta con la ficha vigente.',
        );
      if (
        JSON.stringify(document.narrative) !== JSON.stringify(current.narrative) ||
        JSON.stringify(document.fields.filter((field) => field.section !== 'appearance')) !==
          JSON.stringify(current.fields.filter((field) => field.section !== 'appearance'))
      )
        throw new Error(
          'El contexto narrativo cambió mientras se preparaba la imagen. Reintenta con la ficha vigente.',
        );
      if (selectedPhotos.some((photo) => !AppState.currentProject.covers?.includes(photo.image)))
        throw new Error('La galería cambió mientras se preparaba la imagen. Reintenta.');
      const finalImagePrompt = buildCharacterPortraitPrompt({ direction: prepared?.prompt });
      this.setCoverLoading(
        true,
        `Generando con ${generation.modelLabel || generation.model || 'el motor seleccionado'}…`,
      );
      const imageResponse = await API.aiImage(
        {
          prompt: finalImagePrompt,
          projectId,
          imageType: 'character',
          backend: 'api',
          ...(referenceImage || attachmentImage
            ? {
                inputImages: [
                  referenceImage,
                  ...(photoReferences?.details.map((photo) => photo.image) || []),
                  assetSelection?.sheetImage,
                  attachmentImage,
                ].filter(Boolean),
              }
            : {}),
          ...(generation.provider ? { provider: generation.provider } : {}),
          ...(generation.model ? { model: generation.model } : {}),
        },
        { signal },
      );
      signal.throwIfAborted();
      const imageUrl = imageResponse?.imageUrl || null;
      if (!imageUrl)
        throw new Error(imageResponse?.message || 'La IA no devolvió un enlace de imagen válido.');
      let updated = await saveGeneratedImage(
        projectId,
        imageUrl,
        {
          lastCharacterImage: imageUrl,
          ...(generation.provider && generation.model
            ? { characterImageGeneration: { provider: generation.provider, model: generation.model } }
            : {}),
        },
        compareAppearance
          ? { characterVariationCandidate: true }
          : replacePrevious
            ? {
                replaceImage: referenceImage,
                ...(assetSelection ? { characterAssetApply: assetSelection } : {}),
              }
            : {},
      );
      let choice;
      let selectedImage = imageUrl;
      if (compareAppearance) {
        signal.throwIfAborted();
        if (this.context.destroyed || AppState.currentProject?.id !== projectId) return null;
        Object.assign(AppState.currentProject, { characterImageTrash: updated.characterImageTrash });
        this.updateCoverVisuals(AppState.currentProject);
        if (
          (updated.covers?.[updated.currentCoverIndex] || updated.covers?.[0]) !== referenceImage ||
          updated.content !== project.content
        )
          throw new Error(
            'El personaje cambió durante la generación. La propuesta se conserva en la papelera.',
          );
        this.setCoverLoading(false);
        choice = await this.chooseCharacterAppearance(referenceImage, imageUrl, signal);
        signal.throwIfAborted();
        if (!choice || this.context.destroyed || AppState.currentProject?.id !== projectId) return null;
        updated = await chooseCharacterVariation(
          projectId,
          referenceImage,
          imageUrl,
          choice,
          updated.content,
        );
        selectedImage = choice === 'new' ? imageUrl : referenceImage;
      }
      if (!this.context.destroyed && AppState.currentProject?.id === projectId) {
        Object.assign(AppState.currentProject, {
          covers: updated.covers,
          currentCoverIndex: updated.currentCoverIndex,
          lastCharacterImage: updated.lastCharacterImage,
          characterImageTrash: updated.characterImageTrash,
          characterImageGeneration: updated.characterImageGeneration,
          ...(assetSelection
            ? { content: updated.content, characterVisualLibrary: updated.characterVisualLibrary }
            : {}),
        });
        this.updateCoverVisuals(AppState.currentProject);
        const acceptedPrimary = updated.covers?.[updated.currentCoverIndex] || updated.covers?.[0];
        if (!assetSelection && (!compareAppearance || choice === 'new') && acceptedPrimary === selectedImage)
          void this.generateCharacterVisualLibrary(updated.characterImageGeneration || generation);
        if (
          (!compareAppearance || choice === 'new') &&
          parseCharacterDocument(project.content)?.identity.base === 'humanoid'
        )
          this.detectAndUploadFace(selectedImage);
      }
      Toast.show(
        choice === 'current'
          ? 'Se conserva la apariencia actual. La propuesta está en la papelera.'
          : choice === 'new'
            ? 'Nueva apariencia principal seleccionada. La anterior está en la papelera.'
            : '¡Retrato de personaje generado con éxito!',
        'success',
      );
      return {
        imageUrl: selectedImage,
        referenceImage,
        ...(choice ? { choice, candidateImage: imageUrl } : {}),
      };
    } catch (error) {
      console.error('Error generating character portrait:', error);
      if (error.name !== 'AbortError' && !this.context.destroyed && AppState.currentProject?.id === projectId)
        Toast.show('Error al generar retrato: ' + error.message, 'error');
      return null;
    } finally {
      this.portraitGenerating = false;
      if (!this.context.destroyed) this.setCoverLoading(false);
    }
  }
  async generateCharacterVisualLibrary(engine, { refreshAssets = false } = {}) {
    this.assetController?.abort();
    const controller = new AbortController();
    this.assetController = controller;
    const signal = AbortSignal.any([controller.signal, this.referenceController.signal]);
    const setState = (busy, message, progressive = false) => {
      if (
        !signal.aborted &&
        !this.context.destroyed &&
        AppState.currentProject?.id === this.context.projectId
      )
        this.context.setVisualLibraryState?.({ busy, message, progressive });
    };
    setState(true, 'Preparando biblioteca visual…');
    try {
      const library = await generateCharacterAssets(this.context.projectId, {
        signal,
        engine,
        refreshAssets,
        onProgress: (message, progress) => setState(true, message, !!progress),
      });
      setState(
        false,
        library.items.some((item) => !item.image) ? 'Hay piezas pendientes. Puedes reintentarlas.' : '',
      );
      return library;
    } catch (error) {
      if (!signal.aborted)
        setState(false, error.message || 'No se pudieron preparar las piezas. Puedes reintentar.');
      return null;
    }
  }
  async regenerateCharacterVisualAsset(action, engine) {
    this.assetController?.abort();
    const controller = new AbortController();
    this.assetController = controller;
    const signal = AbortSignal.any([controller.signal, this.referenceController.signal]);
    const setState = (busy, message) => {
      if (!this.context.destroyed && AppState.currentProject?.id === this.context.projectId)
        this.context.setVisualLibraryState?.({ busy, message });
    };
    setState(true, 'Regenerando pieza…');
    try {
      const updated = await regenerateCharacterAsset(this.context.projectId, { ...action, signal, engine });
      if (
        !signal.aborted &&
        !this.context.destroyed &&
        AppState.currentProject?.id === this.context.projectId
      )
        AppState.currentProject.characterVisualLibrary = updated.characterVisualLibrary;
      setState(false, 'Pieza regenerada. La anterior está en la papelera.');
      return true;
    } catch (error) {
      setState(false, error.name === 'AbortError' ? '' : error.message);
      return false;
    }
  }
  async visualAssetAction(action) {
    try {
      if (action.type === 'regenerate')
        return await this.chooseAndGenerateImage(null, { automatic: true, assetRegeneration: action });
      const updated =
        action.type === 'retry-purge'
          ? await retryCharacterMediaCleanup(this.context.projectId)
          : action.type === 'import'
            ? await importSharedCharacterAsset(this.context.projectId, action)
            : await changeCharacterAssetLibrary(this.context.projectId, action);
      if (!this.context.destroyed && AppState.currentProject?.id === this.context.projectId) {
        Object.assign(AppState.currentProject, {
          characterVisualLibrary: updated.characterVisualLibrary,
          characterMediaDeletions: updated.characterMediaDeletions,
        });
        this.context.refreshCharacterVisualLibrary?.();
      }
      return true;
    } catch (error) {
      if (error.name !== 'AbortError') Toast.show(error.message, 'error');
      return false;
    } finally {
      if (!this.context.destroyed && AppState.currentProject?.id === this.context.projectId)
        this.context.refreshCharacterVisualLibrary?.();
      if (
        action.type === 'retry-purge' &&
        !this.context.destroyed &&
        AppState.currentProject?.id === this.context.projectId
      )
        this.updateCoverVisuals(AppState.currentProject);
    }
  }
  async purgeCharacterPortraits(urls) {
    try {
      const updated = await purgeCharacterPortraits(this.context.projectId, urls);
      if (!this.context.destroyed && AppState.currentProject?.id === this.context.projectId) {
        Object.assign(AppState.currentProject, {
          characterImageTrash: updated.characterImageTrash,
          characterMediaDeletions: updated.characterMediaDeletions,
        });
        this.updateCoverVisuals(AppState.currentProject);
      }
      return true;
    } catch (error) {
      Toast.show(error.message, 'error');
      return false;
    } finally {
      if (!this.context.destroyed && AppState.currentProject?.id === this.context.projectId)
        this.updateCoverVisuals(AppState.currentProject);
    }
  }
}
