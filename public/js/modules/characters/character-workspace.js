import { AppState } from '../../app-state.js';
import { EventBus } from '../../event-bus.js';
import { API } from '../../api-service.js';
import { Modal, Toast } from '../../ui-components.js';
import { enhanceSelect } from '../../custom-select.js';
import { createColorControl } from '../../color-picker.js';
import {
  characterElement as el,
  characterAction as action,
  characterTabs,
  characterAddButton,
  autoSizeCharacterText,
} from './character-ui.js';
import { showCharacterFieldPicker } from './character-field-picker.js';
import { CharacterNarrativeNode, CharacterComposerNode } from './character-nodes.js';
import { CharacterVisualLibraryNode, characterDesignAssets } from './character-visual-library.js';
import {
  characterVisualLibraryCurrent,
  characterRequestedTraits,
  validateCharacterVisualLibrary,
} from '../../contracts/character-visual-library.js';
import { createCharacterTemporalControl } from './character-temporal-control.js';
import {
  CHARACTER_NATURES,
  applyCharacterOption,
  selectCharacterNature,
} from '../../contracts/character-options.js';
import { createCharacterOptionsPanel } from './character-options-panel.js';
import { openCharacterPhotoDialog } from './character-photo-dialog.js';
import { CharacterJobs } from './character-jobs.js';
import { renderCharacterLore } from './character-lore.js';
import {
  CHARACTER_BASES,
  CHARACTER_SECTIONS,
  CHARACTER_NARRATIVE,
  parseCharacterDocument,
  validateCharacterDocument,
  changeCharacterIdentity,
  characterDescription,
  characterSummaryBasis,
  characterContextText,
  characterFieldVisible,
  characterDescriptionLocked,
  characterAssistedCreation,
  characterPhotoNeedsInterpretation,
  characterEditableDimension,
  newCharacterFieldId,
  characterImageAction,
  characterVisualChangeKeys,
  characterPhotoCatalog,
  characterPhotoNumbers,
  validateCharacterPhotoReferences,
} from './character-model.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
export class CharacterWorkspace {
  constructor(
    node,
    {
      onChange,
      onCreationSelected,
      onGeneratePhoto,
      onUploadPhoto,
      onGenerateVisualLibrary,
      onVisualAssetAction,
      onBackgroundState,
      onBackgroundChoice,
      onSelectImageEngine,
    } = {},
  ) {
    this.node = node;
    this.onChange = onChange;
    this.onCreationSelected = onCreationSelected;
    this.onGeneratePhoto = onGeneratePhoto;
    this.onUploadPhoto = onUploadPhoto;
    this.onGenerateVisualLibrary = onGenerateVisualLibrary;
    this.onVisualAssetAction = onVisualAssetAction;
    this.onBackgroundState = onBackgroundState;
    this.onBackgroundChoice = onBackgroundChoice;
    this.onSelectImageEngine = onSelectImageEngine;
    this.photoGenerating = false;
    this.projectId = AppState.currentProject.id;
    this.document = parseCharacterDocument(AppState.currentProject.content);
    this.restorePortraitReadiness();
    this.cleanups = [];
    this.fieldCleanups = [];
    this.controller = new AbortController();
    this.destroyed = false;
    this.busy = Boolean(API.enqueueCharacterJob);
    this.visualLibraryBusy = this.busy;
    this.visualLibraryStatus = this.busy ? 'Consultando tareas…' : '';
    this.visualLibraryStatusKind = this.busy ? 'progress' : 'notice';
    this.node.classList.add('character-workspace', 'character-node');
    this.mount();
    if (API.enqueueCharacterJob) this.jobs = new CharacterJobs(this);
  }
  destroy() {
    this.jobs?.destroy();
    if (this.noticeDialog && Modal._el?.contains(this.noticeDialog)) Modal.hide({ notify: true });
    if (this.loreDialog?.isConnected) Modal.hide();
    this.photoDialogCleanup?.();
    this.visualLibraryNode?.destroy();
    this.narrativeNode?.destroy();
    this.composerNode?.destroy();
    this.node.parentElement?.classList.remove(
      'editor-layout-wrapper--character-choosing',
      'editor-layout-wrapper--character-describing',
      'editor-layout-wrapper--character-single-node',
    );
    this.node.hidden = false;
    this.destroyed = true;
    this.controller.abort();
    this.cleanups.forEach((dispose) => dispose());
    this.fieldCleanups.forEach((dispose) => dispose());
    if (this.review?.isConnected) Modal.hide();
    if (this.addDialog?.isConnected) Modal.hide({ notify: true });
  }
  current() {
    return !this.destroyed && AppState.currentProject?.id === this.projectId;
  }
  showCharacterNotice(message, key = null) {
    if (!this.current() || !message) return;
    key ||= `notice:${message}`;
    let storage;
    try {
      storage = this.node.ownerDocument.defaultView.sessionStorage;
    } catch {
      /* A restricted browser can still display the notice. */
    }
    if (!this.noticeKeys) {
      this.noticeKeys = new Set();
      try {
        const saved = JSON.parse(storage?.getItem(`kubrick-character-notices:${this.projectId}`) || '[]');
        if (Array.isArray(saved))
          for (const value of saved.slice(-100)) if (typeof value === 'string') this.noticeKeys.add(value);
      } catch {
        /* Error acknowledgement also works without storage. */
      }
    }
    if (key && this.noticeKeys.has(key)) return;
    if (key) {
      this.noticeKeys.add(key);
      try {
        storage?.setItem(
          `kubrick-character-notices:${this.projectId}`,
          JSON.stringify([...this.noticeKeys].slice(-100)),
        );
      } catch {
        /* Polling still deduplicates notices for this mounted workspace. */
      }
    }
    this.noticeDialog = Modal.show({
      title: 'Aviso de personaje',
      content: el('p', null, message),
      role: 'alertdialog',
      preserveCurrent: true,
      actions: [{ label: 'OK', class: 'btn-primary btn-md', onClick: () => Modal.hide({ notify: true }) }],
      onDismiss: () => {
        this.noticeDialog = null;
      },
    });
  }
  async enqueueBackgroundJob(input) {
    if (!this.jobs) throw Error('La cola del servidor no está disponible.');
    return this.jobs.perform(input);
  }
  async resolveLore(selection) {
    if (!this.current() || this.busy || this.photoGenerating || this.visualLibraryBusy) return false;
    try {
      await EventBus.emitAsync?.('autosave:flush');
      if (!this.current()) return false;
      const response = await API.approveCharacterLore({
        projectId: this.projectId,
        expectedContent: this.project().content,
        ...selection,
      });
      if (!this.current()) return false;
      if (response.job) {
        await this.acceptBackgroundJob(response);
        void this.jobs.observe(response.job.id, response);
        return true;
      }
      await this.acceptBackgroundJob({ job: null, draft: response });
      return true;
    } catch (error) {
      Toast.show(error.message, 'error');
      return false;
    }
  }
  async acceptBackgroundJob({ job, draft }) {
    if (!this.current()) return;
    const wasIntro = this.isDescriptionIntro();
    const busy = !!job && ['queued', 'running', 'awaiting_choice'].includes(job.status);
    const draftChanged = !!draft && draft.revision !== this.backgroundRevision;
    const mediaChanged =
      draftChanged &&
      ['covers', 'currentCoverIndex', 'lastCharacterImage', 'characterImageTrash'].some(
        (key) => JSON.stringify(this.project()[key]) !== JSON.stringify(draft.payload[key]),
      );
    if (draftChanged || busy !== this.backgroundBusyAccepted) {
      await this.onBackgroundState?.({ busy, ...(draftChanged ? { draft } : {}), mediaChanged });
      this.backgroundBusyAccepted = busy;
    }
    if (!this.current()) return;
    this.backgroundJob = job;
    const visualStatus = busy
      ? job.status === 'queued'
        ? `En cola · posición ${job.position}. Puedes salir; el servidor continuará.`
        : job.message || ''
      : job?.error || '';
    const busyChanged =
      this.busy !== busy ||
      this.visualLibraryBusy !== busy ||
      this.photoGenerating ||
      this.visualLibraryStatus !== visualStatus;
    this.busy = busy;
    this.photoGenerating = false;
    this.visualLibraryBusy = busy;
    this.visualLibraryProgressive = busy && !!job?.assetProgress;
    this.visualLibraryStatus = visualStatus;
    this.visualLibraryStatusKind = busy ? 'progress' : 'notice';
    if (draftChanged) {
      Object.assign(AppState.currentProject, draft.payload);
      this.document = parseCharacterDocument(this.project().content);
      this.restorePortraitReadiness();
      this.backgroundRevision = draft.revision;
    }
    // Recover failed initial jobs saved before initialState was introduced too.
    if (
      job?.kind === 'interpret' &&
      ['failed', 'interrupted', 'cancelled'].includes(job.status) &&
      characterAssistedCreation(this.document) &&
      !this.project().covers?.length &&
      this.document.creation.initialState !== 'complete'
    )
      this.document.creation.initialState = 'pending';
    const introChanged = wasIntro !== this.isDescriptionIntro();
    if (draftChanged || introChanged) this.mount();
    else if (busyChanged) this.visualLibraryNode?.render();
    if (introChanged) this.onCreationSelected?.();
    this.updateComposer();
    if (this.status && job)
      this.status.textContent =
        job.error ||
        (job.status === 'queued'
          ? `En cola · posición ${job.position}. Puedes salir; el servidor continuará.`
          : job.message);
    this.renderBackgroundActions();
    if (this.narrativeNode) this.narrativeNode.element.inert = busy;
    const gallery = this.node.parentElement?.querySelector('.character-portrait-section');
    if (gallery) gallery.inert = busy;
    if (!busy && job?.error) {
      const message =
        this.document.creation.initialState === 'pending'
          ? `${job.error}\n\nConservamos tu descripción y la referencia. Prueba seleccionando otro modelo de ${/ficha|propuesta|modelo local/i.test(job.error) ? 'texto' : 'imagen'} en la barra superior y vuelve a interpretar.`
          : job.error;
      this.showCharacterNotice(message, `job:${job.id}:${job.status}:${job.error}`);
    }
  }
  renderBackgroundActions() {
    this.composerNode?.element.querySelector('.character-job-actions')?.remove();
    if (!this.backgroundJob || !['failed', 'interrupted'].includes(this.backgroundJob.status)) return;
    const row = el('div', 'character-job-actions');
    row.append(action('Reintentar trabajo', 'refresh', () => void this.jobs.retry(), 'btn btn-secondary'));
    this.composerNode.element.append(row);
  }
  backgroundJobError(error, mayContinue = false) {
    if (!this.current()) return;
    this.busy = mayContinue;
    this.visualLibraryBusy = mayContinue;
    this.updateComposer();
    if (!mayContinue) void this.onBackgroundState?.({ busy: false });
    this.status.textContent = mayContinue
      ? 'No se pudo consultar el estado. El servidor puede seguir trabajando; recarga para reconectar.'
      : error.message;
    this.visualLibraryStatus = this.status.textContent;
    this.visualLibraryStatusKind = 'notice';
    this.visualLibraryNode?.render();
    this.showCharacterNotice(this.status.textContent, `connection:${this.status.textContent}`);
    this.status.hidden = true;
  }
  commit() {
    this.document.identity.name = AppState.currentProject.name;
    this.document = validateCharacterDocument(this.document);
    AppState.currentProject.content = JSON.stringify(this.document);
    this.onChange?.();
    this.updateDescription();
  }
  change(fn) {
    if (!this.current()) return;
    fn(this.document);
    this.document.revision++;
    this.commit();
  }
  labelled(label, control) {
    const wrapper = el('label', 'character-field');
    const caption = el('span', 'character-field__label', label);
    wrapper.append(caption, control);
    return wrapper;
  }
  input(label, value, change, { multiline = false, collection = this.cleanups } = {}) {
    const control = el('textarea', 'input');
    control.maxLength = 12000;
    control.value = value || '';
    autoSizeCharacterText(control, collection);
    control.addEventListener('input', () => {
      wrapper.classList.toggle(
        'character-field--wide',
        multiline || control.value.length > 96 || control.value.includes('\n'),
      );
      this.change((doc) => change(doc, control.value));
    });
    const wrapper = this.labelled(label, control);
    wrapper.classList.toggle(
      'character-field--wide',
      multiline || control.value.length > 96 || control.value.includes('\n'),
    );
    return wrapper;
  }
  select(label, options, value, change, collection = this.cleanups) {
    const select = el('select', 'input');
    for (const [key, text] of options) {
      const option = el('option', null, text);
      option.value = key;
      select.append(option);
    }
    select.value = value;
    select.addEventListener('change', () => change(select.value));
    const wrapper = this.labelled(label, select);
    select.setAttribute('aria-label', label);
    const custom = enhanceSelect(select, { searchable: options.length > 10, allowEmpty: true });
    collection.push(() => custom.destroy());
    return wrapper;
  }
  mount() {
    this.cleanups.splice(0).forEach((dispose) => dispose());
    this.fieldCleanups.splice(0).forEach((dispose) => dispose());
    this.narrativeNode?.destroy();
    if (this.visualLibraryNode)
      this.visualLibraryView = {
        category: this.visualLibraryNode.category,
        selected: this.visualLibraryNode.selected,
        showTrash: this.visualLibraryNode.showTrash,
        scrollTop: this.visualLibraryNode.element.querySelector('.character-asset-panel')?.scrollTop || 0,
      };
    this.visualLibraryNode?.destroy();
    this.visualLibraryNode = null;
    this.narrativeNode = null;
    const composerKey = JSON.stringify([
      Boolean(this.project().covers?.length),
      this.needsCreationChoice(),
      this.document.creation.mode,
      this.document.creation.referenceImage,
      characterPhotoNeedsInterpretation(this.document),
    ]);
    if (composerKey !== this.composerKey) {
      this.composerNode?.destroy();
      this.composerNode = null;
      this.composerKey = composerKey;
    }
    this.node.replaceChildren();
    this.fields = this.summaryText = this.summaryState = null;
    const choosing = this.needsCreationChoice();
    const describing = this.isDescriptionIntro();
    const singleNode = choosing || describing;
    this.node.hidden = singleNode;
    this.node.parentElement.classList.toggle('editor-layout-wrapper--character-choosing', choosing);
    this.node.parentElement.classList.toggle('editor-layout-wrapper--character-describing', describing);
    this.node.parentElement.classList.toggle('editor-layout-wrapper--character-single-node', singleNode);
    if (singleNode) {
      this.mountComposer();
      if (choosing) {
        this.composerNode.element.classList.add('character-creation-picker');
        this.composerNode.element.setAttribute('aria-label', 'Seleccionar vía de creación del personaje');
      } else this.composerNode.element.classList.add('character-description-intro');
      this.updateComposer();
      return;
    }
    const header = el('header', 'character-workspace__header');
    header.append(el('h2', 'character-eyebrow', 'DISEÑO'));
    const design = el('section', 'character-design character-node__body');
    design.setAttribute('aria-label', 'Características del personaje');
    const identity = el('div', 'character-identity');
    identity.append(
      this.select(
        'Base',
        [['', 'Selecciona una base'], ...Object.entries(CHARACTER_BASES)],
        this.document.identity.base,
        (base) => {
          if (characterAssistedCreation(this.document)) return;
          this.document =
            this.document.creation.mode === 'options' && base
              ? selectCharacterNature(this.document, base, CHARACTER_NATURES[base][0])
              : changeCharacterIdentity(this.document, base, this.document.identity.nature);
          this.commit();
          this.mount();
        },
      ),
    );
    const nature =
      this.document.creation.mode === 'options'
        ? this.select(
            'Naturaleza',
            (CHARACTER_NATURES[this.document.identity.base] || []).map((value) => [value, value]),
            this.document.identity.nature,
            (value) => {
              this.document = selectCharacterNature(this.document, this.document.identity.base, value);
              this.commit();
              this.renderFields();
              this.updateComposer();
            },
          )
        : this.input('Naturaleza', this.document.identity.nature, (doc, value) => {
            if (characterAssistedCreation(doc)) return;
            doc.identity.nature = value.slice(0, 200);
            this.updateComposer();
          });
    if (this.document.creation.mode !== 'options') {
      nature.querySelector('textarea').maxLength = 200;
      nature.querySelector('textarea').placeholder = 'Humano, gato, brócoli fantasma…';
    }
    identity.append(nature);
    this.identityFields = identity;
    this.fields = el('div', 'character-fields');
    design.append(this.fields);
    const summary = el('section', 'character-summary');
    const summaryHeader = el('div', 'character-summary__header');
    summaryHeader.append(
      el('h3', null, 'Descripción'),
      action('Actualizar', 'refresh', () => this.ask('summary')),
    );
    this.summaryText = el('p');
    this.summaryState = el('span', 'character-summary__state');
    summary.append(summaryHeader, this.summaryText, this.summaryState);
    design.append(summary);
    if (this.document.legacyText) {
      const legacy = el('details', 'character-legacy');
      legacy.append(
        el('summary', null, 'Ficha anterior conservada'),
        el('p', null, this.document.legacyText),
      );
      design.append(legacy);
    }
    this.narrativeNode = new CharacterNarrativeNode(this);
    this.mountComposer();
    this.node.append(
      header,
      design,
      characterAddButton('Añadir característica', () => {
        if (characterAssistedCreation(this.document)) return;
        if (this.document.creation.mode === 'options') this.optionsView = false;
        showCharacterFieldPicker(this);
      }),
    );
    const gallery = this.node.parentElement.querySelector(':scope > .character-portrait-section');
    this.visualLibraryNode = new CharacterVisualLibraryNode(this, this.visualLibraryView);
    (gallery || this.node).after(this.visualLibraryNode.element, this.narrativeNode.element);
    this.renderFields();
    this.updateComposer();
    this.updateDescription();
    this.ingredientChange = () => {
      if (this.current() && this.document.identity.name !== AppState.currentProject.name) {
        this.document.identity.name = AppState.currentProject.name;
        this.updateDescription();
      }
      this.updateComposer();
      this.refreshVisualLibrary();
    };
    EventBus.on('editor:change', this.ingredientChange);
    this.cleanups.push(() => EventBus.off('editor:change', this.ingredientChange));
  }
  needsCreationChoice() {
    return !this.document.creation.mode && !this.hasCharacterContent() && !this.document.history.length;
  }
  restorePortraitReadiness() {
    if (this.document.creation.initialState === 'pending' && this.project().covers?.length)
      this.document.creation.initialState = 'complete';
  }
  isDescriptionIntro() {
    const initialPending = this.document.creation.initialState === 'pending';
    const active =
      this.backgroundJob && ['queued', 'running', 'awaiting_choice'].includes(this.backgroundJob.status);
    return (
      characterAssistedCreation(this.document) &&
      (!this.hasCharacterContent({ ignoreReference: true }) || (initialPending && !active))
    );
  }
  hasCharacterContent({ ignoreReference = false } = {}) {
    const doc = this.document;
    return Boolean(
      doc.identity.base ||
      doc.identity.nature ||
      doc.fields.some(characterFieldVisible) ||
      doc.description ||
      doc.legacyText ||
      doc.history.some((turn) => turn.status === 'applied') ||
      doc.enabledNarrative.length ||
      Object.entries(doc.narrative).some(([key, value]) => key !== 'role' && value) ||
      (!ignoreReference && doc.creation.referenceImage) ||
      AppState.currentProject.covers?.length,
    );
  }
  acceptUploadedPortrait() {
    if (!this.current()) return;
    this.document = parseCharacterDocument(this.project().content);
    this.restorePortraitReadiness();
    this.mount();
    this.onCreationSelected?.();
  }

  mountComposer() {
    if (this.composerNode) {
      this.composerNode.element.classList.remove('character-creation-picker', 'character-description-intro');
      this.composerNode.prompt.value = this.document.request;
      this.composerNode.fitPrompt?.();
      this.composerNode.renderAttachment(this.document.requestImage);
      return;
    }
    this.composerNode = new CharacterComposerNode({
      creation: this.needsCreationChoice()
        ? this.document.creation
        : { ...this.document.creation, mode: this.document.creation.mode || 'description' },
      modeLocked: characterDescriptionLocked(this.document),
      initialPhoto: characterPhotoNeedsInterpretation(this.document),
      onMode: (mode) => this.setCreationMode(mode),
      onReference: () => this.choosePhotoReference(),
      requestImage: this.document.requestImage,
      onAttachment: (file) => void this.uploadReference(file, true),
      onRemoveAttachment: () => {
        if (this.busy || this.photoGenerating) return;
        this.change((doc) => {
          doc.requestImage = '';
        });
        this.mount();
      },
      request: this.document.request,
      onUploadPhoto: !this.project().covers?.length ? this.onUploadPhoto : undefined,
      getHistory: () => this.document.history,
      onInput: (value) => {
        this.change((doc) => {
          doc.request = value;
        });
        this.updateComposer();
      },
      onSend: (source) => {
        if (this.jobs) {
          const turn = this.document.history.findLast((turn) => turn.id === 'turn_' + this.backgroundJob?.id);
          if (
            ['failed', 'interrupted'].includes(this.backgroundJob?.status) &&
            this.document.creation.initialState !== 'pending' &&
            turn &&
            this.matchesSubmittedDraft(turn)
          ) {
            void this.jobs.retry();
            return;
          }
          void this.ask(source);
          return;
        }
        const photo = this.pendingPhotoTurn();
        if (['description', 'image'].includes(source) && photo && this.matchesSubmittedDraft(photo))
          void this.generatePhoto();
        else if (
          ['description', 'image'].includes(source) &&
          this.failedRequestForCurrentMode() &&
          this.matchesSubmittedDraft(this.failedRequestForCurrentMode())
        )
          void this.retryLastRequest();
        else void this.ask(source);
      },
      onRetry: () => void (this.jobs ? this.jobs.retry() : this.retryLastRequest()),
      onGeneratePhoto: () => void this.generatePhoto(),
    });
    for (const key of ['prompt', 'hint', 'status', 'fromIngredients', 'interpret'])
      this[key] = this.composerNode[key];
    this.node.parentElement.append(this.composerNode.element);
  }
  fieldControl(field, collection) {
    const update = (value) =>
      this.change((doc) => {
        if (
          characterAssistedCreation(doc) &&
          field.section === 'appearance' &&
          !characterEditableDimension(field)
        )
          return;
        let target = doc.fields.find((item) => item.id === field.id);
        if (!target && characterEditableDimension(field)) {
          target = { ...field };
          doc.fields.push(target);
        }
        if (!target) return;
        target.value = value;
        target.origin = 'user';
        target.explicit = true;
        if (/estatura|altura/i.test(target.label)) {
          target.label = 'Estatura (cm)';
          const caption = wrapper?.querySelector('.character-field__label');
          if (caption) caption.textContent = target.label;
        }
      });
    let wrapper;
    if (field.type === 'select' || field.type === 'boolean') {
      const options =
        field.type === 'boolean'
          ? [
              ['', 'Sin definir'],
              ['true', 'Sí'],
              ['false', 'No'],
            ]
          : [['', 'Sin definir'], ...field.options.map((value) => [value, value])];
      wrapper = this.select(
        field.label,
        options,
        field.value === null ? '' : String(field.value),
        (value) => update(value === '' ? null : field.type === 'boolean' ? value === 'true' : value),
        collection,
      );
    } else if (field.type === 'date' || field.type === 'time') {
      const temporal = createCharacterTemporalControl(field, update);
      wrapper = temporal.element;
      collection.push(() => temporal.destroy());
    } else if (field.type === 'color') {
      wrapper = el('div', 'character-field');
      wrapper.append(el('span', 'character-field__label', field.label));
      const row = el('div', 'character-color-field');
      const color = createColorControl(field.value || '#ffffff', field.label, (value) => {
        update(value);
        valueText.textContent = value;
      });
      const valueText = el('span', null, field.value || 'Sin definir');
      row.append(
        color.element,
        valueText,
        action('Vaciar', 'close', () => {
          update(null);
          valueText.textContent = 'Sin definir';
        }),
      );
      wrapper.append(row);
      collection.push(() => color.destroy());
    } else {
      const control = el(field.type === 'number' ? 'input' : 'textarea', 'input');
      if (field.type === 'number') control.type = 'number';
      if (field.type === 'number') {
        control.min = characterEditableDimension(field) ? '0' : '-1000000000';
        control.max = '1000000000';
        control.step = 'any';
      } else control.maxLength = 4000;
      control.value = field.value ?? '';
      if (field.type !== 'number') autoSizeCharacterText(control, collection);
      control.placeholder = 'Sin definir';
      control.addEventListener('input', () => {
        if (field.type === 'number' && !control.checkValidity()) return;
        wrapper.classList.toggle(
          'character-field--wide',
          field.type === 'multiline' ||
            (field.type === 'text' && (control.value.length > 96 || control.value.includes('\n'))),
        );
        update(control.value === '' ? null : field.type === 'number' ? Number(control.value) : control.value);
      });
      wrapper = this.labelled(field.label, control);
    }
    wrapper.dataset.characterField = field.id;
    if (characterEditableDimension(field)) wrapper.dataset.editableDimension = 'true';
    wrapper.classList.toggle(
      'character-field--wide',
      field.type === 'multiline' ||
        (field.type === 'text' &&
          (String(field.value ?? '').length > 96 || String(field.value ?? '').includes('\n'))),
    );
    if (field.origin === 'ingredient' || field.origin === 'suggestion')
      wrapper.append(el('span', 'character-field__source', 'Propuesto desde ingredientes'));
    return wrapper;
  }
  renderFields() {
    this.fieldCleanups.forEach((dispose) => dispose());
    this.fieldCleanups = [];
    this.fields.replaceChildren();
    if (this.document.creation.mode === 'options') {
      const showOptions = this.optionsView !== false;
      this.fields.append(
        action(showOptions ? 'Editar ficha' : 'Volver a opciones', showOptions ? 'edit' : 'grid', () => {
          this.optionsView = !showOptions;
          this.renderFields();
        }),
      );
      if (showOptions) {
        this.fields.append(this.identityFields);
        this.fields.append(createCharacterOptionsPanel(this));
        return;
      }
    }
    const library = this.visualLibrary();
    const visualItems = library?.items || [];
    if (
      !visualItems.length &&
      !this.document.fields.some((field) => field.section === 'appearance' && characterFieldVisible(field))
    ) {
      if (!characterAssistedCreation(this.document)) this.fields.append(this.identityFields);
      this.fields.append(
        el('p', 'character-empty', 'El ayudante preparará las características según su naturaleza.'),
      );
      return;
    }
    const represented = new Set(visualItems.flatMap((item) => item.fieldKeys));
    const displayFields = [...this.document.fields];
    if (
      characterAssistedCreation(this.document) &&
      this.document.identity.base &&
      this.document.identity.base !== 'entity' &&
      this.document.fields.length < 80 &&
      !this.document.fields.some((field) => field.key === 'custom.height') &&
      !displayFields.some(
        (field) =>
          characterEditableDimension(field) &&
          !/(?:^|\.)(?:age|edad)$/.test(field.key) &&
          !/^edad/i.test(field.label),
      )
    ) {
      this.heightPlaceholder ||= {
        id: newCharacterFieldId(),
        key: 'custom.height',
        label: 'Estatura (cm)',
        type: 'number',
        section: 'appearance',
        value: null,
        options: [],
        required: false,
        origin: 'user',
        explicit: true,
      };
      displayFields.push(this.heightPlaceholder);
    }
    const groups = [];
    for (const [section, label] of Object.entries(CHARACTER_SECTIONS).filter(
      ([section]) => section === 'appearance',
    )) {
      const items = displayFields.filter(
        (field) =>
          field.section === section &&
          (characterFieldVisible(field) || characterEditableDimension(field)) &&
          (characterEditableDimension(field) ||
            !characterAssistedCreation(this.document) ||
            !represented.has(field.key)),
      );
      if (!items.length && !visualItems.length) continue;
      const group = el('section', 'character-field-group');
      const grid = el('div', 'character-field-grid');
      for (const field of items.sort(
        (a, b) => Number(characterEditableDimension(b)) - Number(characterEditableDimension(a)),
      )) {
        const wrapper = this.fieldControl(field, this.fieldCleanups);
        grid.append(wrapper);
      }
      group.append(grid);
      if (!characterAssistedCreation(this.document)) group.append(this.identityFields);
      if (visualItems.length)
        group.append(
          characterDesignAssets(library, (id) => this.visualLibraryNode.open(id), this.fieldCleanups),
        );
      groups.push({ key: section, label: section === 'appearance' ? 'Apariencia' : label, content: group });
    }
    if (groups.length)
      this.fields.append(
        characterTabs(groups, {
          label: 'Características del personaje',
          selected: this.activeSection,
          onSelect: (section) => {
            this.activeSection = section;
          },
        }),
      );
  }
  project() {
    return AppState.currentProject;
  }
  visualLibrary() {
    return this.project().characterVisualLibrary
      ? validateCharacterVisualLibrary(this.project().characterVisualLibrary, this.projectId)
      : null;
  }
  refreshVisualLibrary() {
    if (!this.fields || !this.visualLibraryNode) return;
    const currentDocument = parseCharacterDocument(this.project().content);
    if (currentDocument) this.document = currentDocument;
    const library = this.visualLibrary();
    const stamp = JSON.stringify([
      library,
      library && characterVisualLibraryCurrent(this.project(), this.document),
    ]);
    if (stamp !== this.visualLibraryStamp) {
      this.visualLibraryStamp = stamp;
      this.renderFields();
    }
    this.updateComposer();
    this.visualLibraryNode.render();
  }
  setVisualLibraryState({ busy, message, progressive = false }) {
    this.visualLibraryBusy = busy;
    this.visualLibraryProgressive = busy && progressive;
    this.visualLibraryStatus = message || '';
    this.visualLibraryStatusKind = busy ? 'progress' : 'notice';
    if (!busy && message && !message.startsWith('Pieza regenerada.')) this.showCharacterNotice(message);
    this.refreshVisualLibrary();
  }
  finishVisualLibraryState() {
    this.visualLibraryBusy = Boolean(this.busy);
    if (!this.busy && this.visualLibraryStatusKind === 'progress') {
      this.visualLibraryStatus = '';
      this.visualLibraryStatusKind = 'notice';
    }
    this.refreshVisualLibrary();
  }
  async generateVisualLibrary() {
    if (!this.current() || this.visualLibraryBusy) return;
    this.setVisualLibraryState({ busy: true, message: 'Preparando biblioteca visual…' });
    try {
      await this.onGenerateVisualLibrary?.();
    } finally {
      if (this.current()) {
        this.finishVisualLibraryState();
      }
    }
  }
  async visualAssetAction(action) {
    if (!this.current() || this.photoGenerating || this.visualLibraryBusy || this.busy) return false;
    const regenerating = action.type === 'regenerate';
    if (regenerating) this.setVisualLibraryState({ busy: true, message: 'Preparando regeneración…' });
    try {
      return await this.onVisualAssetAction?.(action);
    } finally {
      if (this.current()) {
        if (regenerating) this.finishVisualLibraryState();
        else this.refreshVisualLibrary();
      }
    }
  }
  async applyVisualAssets() {
    if (!this.current() || this.photoGenerating || this.visualLibraryBusy || this.busy) return;
    this.photoGenerating = true;
    this.visualLibraryNode.render();
    this.updateComposer();
    try {
      const result = await this.onGeneratePhoto?.({
        automatic: true,
        applyAssets: true,
        signal: this.controller.signal,
      });
      if (result && this.current()) {
        this.document = parseCharacterDocument(AppState.currentProject.content);
        this.mount();
      }
    } finally {
      this.photoGenerating = false;
      if (this.current()) {
        this.visualLibraryNode?.render();
        this.updateComposer();
      }
    }
  }
  updateDescription() {
    if (!this.summaryText) return;
    this.summaryText.textContent = characterDescription(this.document) || 'Aún sin descripción.';
    const stale = this.document.summaryBasis !== characterSummaryBasis(this.document);
    this.summaryState.textContent =
      stale && this.document.fields.some((field) => field.value !== null && field.value !== '')
        ? 'Hay cambios por resumir.'
        : '';
  }
  updateComposer() {
    if (characterAssistedCreation(this.document)) {
      this.node.querySelectorAll('.character-design input, .character-design textarea').forEach((control) => {
        const editable = control.closest('[data-editable-dimension="true"]');
        if (['text', 'number', 'textarea'].includes(control.type)) {
          control.readOnly = !editable;
          control.setAttribute('aria-readonly', String(!editable));
          if (editable)
            control.disabled = Boolean(this.busy || this.photoGenerating || this.visualLibraryBusy);
        } else control.disabled = true;
      });
      this.node
        .querySelectorAll(
          '.character-design select, .character-design button:not([role="tab"]):not(.character-design-asset__image), .character-add-field',
        )
        .forEach((control) => {
          control.disabled = true;
        });
    }
    const ready = Boolean(this.document.identity.base && this.document.identity.nature.trim());
    this.composerNode.update({
      ready,
      busy: Boolean(this.busy || this.photoGenerating || this.visualLibraryBusy),
      hasIngredients: (AppState.currentProject.ingredients || []).some(
        (item) => item.active !== false && item.value,
      ),
      mode: this.composerNode.mode,
      hasReference: !!this.document.creation.referenceImage,
      retry: this.failedRequestForCurrentMode(),
      canGeneratePhoto: ready && typeof this.onGeneratePhoto === 'function',
      hasPreviousPhoto: !!AppState.currentProject.covers?.length,
      modeLocked: characterDescriptionLocked(this.document),
      photoRetry: this.matchesSubmittedDraft(this.pendingPhotoTurn()),
      activityMessage:
        this.visualLibraryStatusKind === 'progress'
          ? this.visualLibraryStatus || 'Interpretando personaje…'
          : 'Consultando tareas…',
    });
    renderCharacterLore(this);
    this.node
      .querySelector('.character-summary__header button')
      ?.toggleAttribute(
        'disabled',
        this.busy ||
          characterAssistedCreation(this.document) ||
          !ready ||
          !this.document.fields.some((field) => field.value !== null && field.value !== ''),
      );
  }
  setCreationMode(mode) {
    if (!this.current() || this.busy || this.photoGenerating) return;
    if (characterDescriptionLocked(this.document)) return;
    if (mode === 'image') {
      this.choosePhotoReference();
      return;
    }
    const wasChoosing = this.needsCreationChoice();
    this.change((doc) => {
      doc.creation.mode = mode;
    });
    if (mode === 'options') {
      const base = this.document.identity.base || 'humanoid';
      const nature = CHARACTER_NATURES[base].includes(this.document.identity.nature)
        ? this.document.identity.nature
        : CHARACTER_NATURES[base][0];
      this.document = selectCharacterNature(this.document, base, nature);
      this.commit();
      this.optionsView = true;
    }
    this.mount();
    if (wasChoosing) this.onCreationSelected?.();
    if (mode === 'description') this.prompt.focus();
    if (
      mode === 'ingredients' &&
      !AppState.currentProject.ingredients?.some((item) => item.active !== false && item.value)
    )
      EventBus.emit('workspace:panel:open', 'ingredients');
  }
  choosePhotoReference() {
    if (
      !this.current() ||
      this.busy ||
      this.photoGenerating ||
      (characterDescriptionLocked(this.document) && !characterPhotoNeedsInterpretation(this.document))
    )
      return;
    this.photoDialogCleanup?.();
    this.photoDialogCleanup = openCharacterPhotoDialog(this, (url) => {
      if (!this.current()) return;
      this.change((doc) => {
        doc.creation.mode = 'image';
        doc.creation.referenceImage = url;
      });
      this.mount();
      this.onCreationSelected?.();
      this.prompt.focus();
    });
  }
  chooseOption(group, choice) {
    if (!this.current() || this.busy) return;
    try {
      this.document = applyCharacterOption(this.document, group, choice);
      this.commit();
      this.updateComposer();
    } catch (error) {
      Toast.show(error.message, 'error');
    }
  }
  async uploadReference(file, attachment = false) {
    if (!file || !this.current() || this.busy || this.photoGenerating) return;
    if (
      !['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'].includes(file.type) ||
      file.size > 15 * 1024 * 1024
    ) {
      Toast.show('Elige una imagen PNG, JPEG, WebP, GIF o BMP de hasta 15 MB.', 'warning');
      return;
    }
    this.busy = true;
    this.updateComposer();
    try {
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
        reader.readAsDataURL(file);
      });
      if (!this.current()) return;
      const result = await API.uploadBase64(this.projectId, data);
      if (!this.current()) return;
      this.change((doc) => {
        if (attachment) doc.requestImage = result.imageUrl;
        else {
          doc.creation.mode = 'image';
          doc.creation.referenceImage = result.imageUrl;
        }
      });
      this.mount();
    } catch (error) {
      if (this.current()) Toast.show(error.message, 'error');
    } finally {
      this.busy = false;
      if (this.current()) this.updateComposer();
    }
  }
  finishTurn(id, status, message = '') {
    if (!this.current()) return;
    this.change((doc) => {
      const turn = doc.history.find((item) => item.id === id);
      if (turn) Object.assign(turn, { status, message: String(message).slice(0, 1500) });
    });
  }
  failedRequestForCurrentMode() {
    const turn = this.document.history.at(-1);
    const mode = this.composerNode.mode;
    return turn?.status === 'error' &&
      (turn.source === mode ||
        (['options', 'image'].includes(this.document.creation.mode) && turn.source === 'description'))
      ? turn
      : null;
  }
  async retryLastRequest(signal) {
    const turn = this.failedRequestForCurrentMode();
    if (!turn || !this.current() || this.busy || !this.matchesSubmittedDraft(turn)) return;
    await this.ask(turn.source, turn.request, turn.attachmentImage || '', signal);
  }
  matchesSubmittedDraft(turn) {
    if (!turn || turn.source === 'summary') return false;
    if (
      turn.source === 'image' &&
      turn.referenceImage &&
      turn.referenceImage !== this.document.creation.referenceImage
    )
      return false;
    const text = this.prompt.value.trim();
    const image = this.document.requestImage || '';
    return (
      (!text && !image) ||
      ((text === turn.request || (!text && !this.document.request.trim())) &&
        image === (turn.attachmentImage || ''))
    );
  }
  consumeSubmittedDraft(turn) {
    if (!this.matchesSubmittedDraft(turn)) return;
    this.change((doc) => {
      doc.request = '';
      doc.requestImage = '';
    });
    this.composerNode.clear();
  }
  beginSubmission() {
    this.submitting = true;
    this.busy = true;
    this.visualLibraryStatusKind = 'progress';
    this.visualLibraryStatus = 'Interpretando personaje…';
    this.updateComposer();
  }
  async ask(source, retryRequest = '', retryImage = '', signal) {
    if (!this.current() || this.busy || this.photoGenerating || this.visualLibraryBusy) return;
    if (
      this.jobs &&
      source !== 'summary' &&
      !characterPhotoNeedsInterpretation(this.document) &&
      this.document.history.some((turn) => turn.status === 'applied') &&
      (retryRequest || this.prompt.value.trim())
    )
      source = 'description';
    const ready = this.document.identity.base && this.document.identity.nature.trim();
    if (
      (['summary', 'options'].includes(source) && !ready) ||
      (source === 'description' && !(retryRequest || this.prompt.value.trim())) ||
      (source === 'image' && !this.document.creation.referenceImage)
    )
      return;
    if (
      this.document.history.length >= 500 ||
      this.document.history.reduce((size, turn) => size + turn.request.length + turn.message.length, 0) +
        (retryRequest || this.prompt.value).length +
        13500 >
        1500000
    ) {
      Toast.show(
        'El historial alcanzó su límite. Conserva esta ficha y continúa en una copia del proyecto.',
        'warning',
      );
      return;
    }
    const request =
      source === 'summary'
        ? 'Actualiza la descripción con las características seleccionadas, sin modificar campos.'
        : retryRequest ||
          this.prompt.value.trim() ||
          (source === 'image'
            ? 'Describe los rasgos visibles del personaje en esta imagen.'
            : source === 'options'
              ? 'Redacta la ficha usando exclusivamente las opciones seleccionadas. No inventes datos desconocidos.'
              : 'Desarrolla este personaje a partir de los ingredientes activos.');
    let gallery;
    try {
      const catalog = characterPhotoCatalog(AppState.currentProject);
      if (source !== 'summary' && characterPhotoNumbers(request, catalog).length)
        gallery = catalog.map((photo) => photo.image);
    } catch (error) {
      if (this.jobs) gallery = [...(this.project().covers || [])];
      else {
        this.status.textContent = error.message;
        this.showCharacterNotice(error.message);
        this.status.hidden = true;
        return;
      }
    }
    const turnId = `turn_${globalThis.crypto.randomUUID()}`;
    const attachmentImage =
      source === 'summary' ? '' : retryRequest ? retryImage : this.document.requestImage;
    if (this.jobs) {
      this.beginSubmission();
      try {
        const engine =
          source === 'summary'
            ? this.project().characterImageGeneration
            : (await this.onSelectImageEngine?.()) || this.project().characterImageGeneration;
        if (source !== 'summary' && !engine) return;
        return await this.enqueueBackgroundJob({
          kind: 'interpret',
          source,
          request,
          engine,
          ...(source === 'image' ? { referenceImage: this.document.creation.referenceImage } : {}),
          ...(attachmentImage ? { attachmentImage } : {}),
          ...(gallery ? { gallery } : {}),
        });
      } catch (error) {
        this.backgroundJobError(error);
        return;
      } finally {
        if (this.current() && this.submitting) {
          this.submitting = false;
          this.busy = false;
          this.visualLibraryStatus = '';
          this.updateComposer();
        }
      }
    }
    this.change((doc) => {
      doc.history.push({
        id: turnId,
        source,
        request,
        createdAt: new Date().toISOString(),
        status: 'pending',
        message: '',
        ...(attachmentImage ? { attachmentImage } : {}),
        ...(source === 'image' ? { referenceImage: this.document.creation.referenceImage } : {}),
      });
      if (source !== 'summary') {
        doc.request = this.prompt.value || retryRequest;
        doc.requestImage = attachmentImage;
      }
    });
    if (source !== 'summary') {
      this.prompt.value = this.document.request;
      this.composerNode.renderAttachment(attachmentImage);
    }
    this.busy = true;
    this.updateComposer();
    this.status.textContent = 'Preparando una propuesta…';
    const baseline = JSON.stringify(this.document),
      name = AppState.currentProject.name,
      ingredients = clone(AppState.currentProject.ingredients || []);
    try {
      const requestSignal = signal
        ? AbortSignal.any([this.controller.signal, signal])
        : this.controller.signal;
      requestSignal.throwIfAborted();
      const response = await API.characterDesign(
        {
          projectId: this.projectId,
          document: clone(this.document),
          source,
          request,
          ingredients,
          ...(gallery ? { gallery } : {}),
          ...(source === 'image' ? { referenceImage: this.document.creation.referenceImage } : {}),
          ...(attachmentImage ? { attachmentImage } : {}),
        },
        { signal: requestSignal },
      );
      requestSignal.throwIfAborted();
      if (!this.current()) return;
      const proposed = validateCharacterDocument(response.document);
      if (proposed.id !== this.projectId) throw new Error('La propuesta pertenece a otra ficha.');
      if (
        JSON.stringify(this.document) !== baseline ||
        (gallery &&
          JSON.stringify(characterPhotoCatalog(AppState.currentProject).map((photo) => photo.image)) !==
            JSON.stringify(gallery)) ||
        AppState.currentProject.name !== name ||
        JSON.stringify(AppState.currentProject.ingredients || []) !== JSON.stringify(ingredients)
      )
        throw new Error(
          'La ficha o sus referencias cambiaron mientras el ayudante respondía. Solicita una nueva propuesta.',
        );
      this.finishTurn(turnId, 'proposed', response.message);
      this.change((doc) => {
        const turn = doc.history.find((item) => item.id === turnId);
        if (response.photoReferences)
          turn.photoReferences = validateCharacterPhotoReferences(response.photoReferences, this.projectId);
        turn.visualChangeKeys = [
          ...new Set([
            ...characterVisualChangeKeys(this.document, proposed),
            ...(turn.photoReferences?.details.flatMap((photo) => photo.keys) || []),
          ]),
        ];
      });
      proposed.history = clone(this.document.history);
      if (['description', 'image'].includes(source) && characterAssistedCreation(this.document)) {
        const imageAction = response.photoReferences
          ? 'generate'
          : source === 'image' && !AppState.currentProject.covers?.length
            ? 'generate'
            : characterImageAction(this.document, proposed, response.imageAction);
        this.change((doc) => {
          const turn = doc.history.find((item) => item.id === turnId);
          turn.imageAction = imageAction;
          if (imageAction === 'generate') turn.imageStatus = 'pending';
        });
        if (this.applyProposal(proposed, JSON.stringify(this.document), name, ingredients, turnId, true)) {
          this.busy = false;
          if (imageAction === 'generate') {
            if (this.onGeneratePhoto) await this.generatePhoto(signal);
            else this.status.textContent = 'Ficha actualizada. La fotografía sigue pendiente.';
          } else {
            this.consumeSubmittedDraft(this.document.history.find((item) => item.id === turnId));
            this.status.textContent =
              'Personaje actualizado. La apariencia no cambió; se conserva la fotografía.';
          }
        }
        return;
      }
      this.showProposal(proposed, response, JSON.stringify(this.document), name, ingredients, turnId);
      this.status.textContent = 'Propuesta lista para revisar.';
    } catch (error) {
      if (this.current()) {
        if (error.name === 'AbortError') {
          this.finishTurn(turnId, 'cancelled', 'Solicitud detenida; el borrador se conserva.');
          this.status.textContent = 'Solicitud detenida; el borrador se conserva.';
          return;
        }
        this.finishTurn(turnId, 'error', error.message);
        this.status.textContent = error.message;
        this.showCharacterNotice(error.message);
      }
    } finally {
      this.busy = false;
      if (this.current()) this.updateComposer();
    }
  }
  showProposal(proposed, response, baseline, name, ingredients, turnId) {
    const body = el('div', 'character-review');
    this.review = body;
    body.append(el('p', 'character-review__message', response.message));
    const list = el('div', 'character-review__changes');
    const before = new Map(this.document.fields.map((field) => [field.key, field]));
    for (const field of proposed.fields) {
      const old = before.get(field.key);
      before.delete(field.key);
      if (old && JSON.stringify(old) === JSON.stringify(field)) continue;
      if (!characterFieldVisible(field) && (!old || !characterFieldVisible(old))) continue;
      const item = el('div', 'character-review__change');
      item.append(
        el('strong', null, field.label),
        el(
          'span',
          null,
          `${old ? `${old.value ?? 'Sin definir'} →` : 'Añadir ·'} ${field.value ?? 'Sin definir'}`,
        ),
      );
      list.append(item);
    }
    for (const field of before.values()) {
      if (!characterFieldVisible(field)) continue;
      const item = el('div', 'character-review__change');
      item.append(el('strong', null, field.label), el('span', null, 'Eliminar'));
      list.append(item);
    }
    if (JSON.stringify(this.document.identity) !== JSON.stringify(proposed.identity))
      list.append(
        el('p', null, `Identidad: ${CHARACTER_BASES[proposed.identity.base]} · ${proposed.identity.nature}`),
      );
    for (const [key, label] of Object.entries(CHARACTER_NARRATIVE))
      if (this.document.narrative[key] !== proposed.narrative[key]) {
        const item = el('div', 'character-review__change');
        item.append(el('strong', null, label), el('span', null, proposed.narrative[key] || 'Vaciar'));
        list.append(item);
      }
    body.append(
      list,
      el('h3', null, 'Descripción para ingredientes'),
      el('p', null, proposed.description || 'Sin descripción.'),
    );
    Modal.show({
      title: 'Revisar personaje',
      content: body,
      onDismiss: () => this.finishTurn(turnId, 'cancelled', 'Propuesta descartada.'),
      actions: [
        {
          label: 'Cancelar',
          class: 'btn-ghost',
          onClick: () => {
            this.finishTurn(turnId, 'cancelled', 'Propuesta descartada.');
            Modal.hide();
          },
        },
        {
          label: 'Aplicar cambios',
          class: this.onGeneratePhoto ? 'btn-secondary' : 'btn-primary',
          onClick: () => {
            if (this.applyProposal(proposed, baseline, name, ingredients, turnId)) {
              this.consumeSubmittedDraft(this.document.history.find((item) => item.id === turnId));
              this.updateComposer();
            }
          },
        },
        ...(this.onGeneratePhoto && response.source !== 'summary'
          ? [
              {
                label: 'Aplicar y generar foto',
                class: 'btn-primary',
                onClick: () => {
                  if (this.applyProposal(proposed, baseline, name, ingredients, turnId)) {
                    this.change((doc) => {
                      const turn = doc.history.find((item) => item.id === turnId);
                      turn.imageAction = 'generate';
                      turn.imageStatus = 'pending';
                    });
                    void this.generatePhoto();
                  }
                },
              },
            ]
          : []),
      ],
    });
  }
  applyProposal(proposed, baseline, name, ingredients, turnId, automatic = false) {
    if (!this.current()) {
      if (!automatic) Modal.hide();
      return false;
    }
    if (
      JSON.stringify(this.document) !== baseline ||
      AppState.currentProject.name !== name ||
      JSON.stringify(AppState.currentProject.ingredients || []) !== JSON.stringify(ingredients)
    ) {
      if (!automatic) Modal.hide();
      this.finishTurn(turnId, 'error', 'La ficha cambió antes de aplicar.');
      Toast.show('La ficha cambió. Solicita una nueva propuesta.', 'warning');
      return false;
    }
    proposed.history = clone(this.document.history);
    proposed.request = this.document.request;
    proposed.requestImage = this.document.requestImage;
    const turn = proposed.history.find((item) => item.id === turnId);
    if (turn) turn.status = 'applied';
    proposed.revision = Math.max(this.document.revision, proposed.revision) + 1;
    const extractionOnly =
      JSON.stringify(characterRequestedTraits(this.document)) !==
        JSON.stringify(characterRequestedTraits(proposed)) &&
      characterImageAction(this.document, proposed, 'preserve') === 'preserve';
    const wasDescribing = this.isDescriptionIntro();
    this.document = proposed;
    this.commit();
    if (!automatic) Modal.hide();
    this.mount();
    if (wasDescribing && !this.isDescriptionIntro()) this.onCreationSelected?.();
    this.prompt.focus();
    if (!automatic) Toast.show('Ficha actualizada.', 'success');
    if (extractionOnly && this.project().covers?.length) void this.generateVisualLibrary();
    return true;
  }
  pendingPhotoTurn() {
    const turn = this.document.history.findLast(
      (item) => item.status === 'applied' && item.imageAction === 'generate',
    );
    return turn && ['error', 'pending'].includes(turn.imageStatus) ? turn : null;
  }
  /** Public command port used by Kubrick Space through the workspace coordinator. */
  async attachPhoto(file) {
    if (!this.current() || this.busy || this.photoGenerating) throw new Error('El ayudante está ocupado.');
    if (file) await this.uploadReference(file, true);
    else {
      this.change((doc) => {
        doc.requestImage = '';
      });
      this.mount();
    }
    return this.document.requestImage;
  }

  async executeAction(input, { signal } = {}) {
    if (!this.current() || this.busy || this.photoGenerating || this.visualLibraryBusy)
      throw new Error('El ayudante de personajes está ocupado.');
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).some(
        (key) =>
          ![
            'projectId',
            'action',
            'source',
            'request',
            'base',
            'nature',
            'options',
            'referenceImage',
            'attachmentImage',
          ].includes(key),
      ) ||
      input.projectId !== this.projectId ||
      !['interpret', 'manage', 'generate', 'retry'].includes(input.action)
    )
      throw new Error('Acción de personaje inválida para el proyecto activo.');
    if (signal?.aborted) throw new Error('Acción cancelada.');
    if (input.action === 'generate') {
      if (this.document.request.trim() || this.document.requestImage)
        throw new Error('Primero interpreta el borrador pendiente del ayudante.');
      this.photoGenerating = true;
      this.updateComposer();
      try {
        const result = await this.onGeneratePhoto?.({ automatic: true, variation: true, signal });
        return {
          status: result?.choice === 'current' ? 'kept' : result?.imageUrl ? 'generated' : 'error',
          message: result?.imageUrl
            ? result.choice === 'current'
              ? 'Se conserva la apariencia actual; la propuesta está en la papelera.'
              : result.choice === 'new'
                ? 'Nueva apariencia principal seleccionada; la anterior está en la papelera.'
                : 'Foto principal generada.'
            : 'No se generó la foto; la ficha se conserva.',
        };
      } finally {
        this.photoGenerating = false;
        if (this.current()) this.updateComposer();
      }
    }
    if (input.action === 'retry') {
      const pending = this.pendingPhotoTurn();
      if (this.jobs && ['failed', 'interrupted'].includes(this.backgroundJob?.status))
        await this.jobs.retry();
      else if (pending && this.matchesSubmittedDraft(pending)) await this.generatePhoto(signal);
      else if (this.failedRequestForCurrentMode()) await this.retryLastRequest(signal);
      else throw new Error('No hay una solicitud fallida para reintentar.');
    } else {
      const source =
        input.source ||
        (characterDescriptionLocked(this.document) && !characterPhotoNeedsInterpretation(this.document)
          ? 'description'
          : this.document.creation.mode) ||
        'description';
      const request =
        source === 'image' && (input.request === undefined || input.request === '')
          ? 'Crea el personaje de esta fotografía.'
          : input.request;
      if (typeof request !== 'string' || !request.trim() || request.length > 12000)
        throw new Error('Describe la creación o el cambio de personaje.');
      if (!['description', 'image', 'options', 'ingredients'].includes(source))
        throw new Error('Vía de creación inválida.');
      if (
        characterDescriptionLocked(this.document) &&
        source !== 'description' &&
        !(
          source === 'image' &&
          this.document.creation.mode === 'image' &&
          !this.document.history.some((turn) => turn.source === 'image' && turn.status === 'applied')
        )
      )
        throw new Error('La vía de creación ya está fijada. Usa el asistente para modificar el personaje.');
      if (
        (this.document.request.trim() && this.document.request.trim() !== input.request.trim()) ||
        (this.document.requestImage &&
          input.attachmentImage !== undefined &&
          input.attachmentImage !== this.document.requestImage)
      )
        throw new Error(
          'El ayudante tiene un borrador pendiente; consérvalo o retíralo antes de enviar otro desde Kubrick Space.',
        );
      let next = clone(this.document);
      if (source === 'options') {
        next = selectCharacterNature(
          next,
          input.base || next.identity.base || 'humanoid',
          input.nature || next.identity.nature || 'Humano',
        );
        if (input.options !== undefined && (!Array.isArray(input.options) || input.options.length > 80))
          throw new Error('Opciones inválidas.');
        for (const option of input.options || [])
          next = applyCharacterOption(next, option.group, option.choice, { toggle: false });
      }
      if (!characterDescriptionLocked(this.document)) next.creation.mode = source;
      if (input.referenceImage !== undefined) next.creation.referenceImage = input.referenceImage;
      next.request = request;
      if (input.attachmentImage !== undefined) next.requestImage = input.attachmentImage;
      this.document = validateCharacterDocument(next);
      this.commit();
      this.mount();
      this.onCreationSelected?.();
      const previousTurns = this.document.history.length;
      await this.ask(source, '', '', signal);
      if (this.document.history.length === previousTurns)
        throw new Error(this.status.textContent || 'No se envió la solicitud.');
    }
    const turn = this.document.history.at(-1);
    return {
      status: turn?.status || 'error',
      imageStatus: turn?.imageStatus || 'unchanged',
      message: this.status.textContent || turn?.message || 'No se aplicaron cambios.',
    };
  }
  async generatePhoto(signal) {
    if (signal?.aborted) return;
    const turn =
      this.pendingPhotoTurn() || this.document.history.findLast((item) => item.status === 'applied');
    const hasUnsentDraft = this.prompt.value.trim() || this.document.requestImage;
    if (
      !this.current() ||
      this.busy ||
      this.photoGenerating ||
      typeof this.onGeneratePhoto !== 'function' ||
      (hasUnsentDraft && !this.matchesSubmittedDraft(turn)) ||
      !this.document.identity.base ||
      !this.document.identity.nature.trim()
    )
      return;
    this.photoGenerating = true;
    this.updateComposer();
    this.status.textContent = 'Generando la fotografía del personaje…';
    try {
      const result = await this.onGeneratePhoto({
        attachmentImage: turn?.attachmentImage || '',
        automatic: characterAssistedCreation(this.document),
        visualChangeKeys: turn?.visualChangeKeys || [],
        photoReferences: turn?.photoReferences,
        ...(signal ? { signal } : {}),
      });
      if (this.current() && turn?.imageAction === 'generate')
        this.change((doc) => {
          const current = doc.history.find((item) => item.id === turn.id);
          current.imageStatus = result?.imageUrl ? 'generated' : 'error';
        });
      if (this.current() && result?.imageUrl) this.consumeSubmittedDraft(turn);
      if (this.current())
        this.status.textContent = result?.imageUrl
          ? turn?.photoReferences
            ? 'Nueva foto añadida. Las referencias originales se conservan en la galería.'
            : 'Foto actualizada. Las imágenes reemplazadas se conservan en la papelera.'
          : 'La ficha se conserva. Puedes volver a generar la foto cuando quieras.';
    } catch (error) {
      if (this.current()) {
        const turn =
          this.pendingPhotoTurn() || this.document.history.findLast((item) => item.status === 'applied');
        if (turn?.imageAction === 'generate')
          this.change((doc) => {
            doc.history.find((item) => item.id === turn.id).imageStatus = 'error';
          });
        this.status.textContent = 'No se pudo generar la foto. La ficha se conserva.';
        this.showCharacterNotice(error.message);
      }
    } finally {
      this.photoGenerating = false;
      if (this.current()) this.updateComposer();
    }
  }
}

export function characterDocumentToHTML(document) {
  const root = el('article', 'character-document-preview');
  root.append(
    el('h1', null, document.identity.name),
    el('p', null, characterDescription(document)),
    el('pre', null, characterContextText(document)),
  );
  return root.innerHTML;
}
