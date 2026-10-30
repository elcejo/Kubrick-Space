import { EventBus } from '../../event-bus.js';
import { AppState, commitProjectSnapshot } from '../../app-state.js';
import { API } from '../../api-service.js';
import { storeDraft, removeDraft } from './drafts.js';
import { Modal } from '../../ui-components.js';
import { createDocumentDraftPayload } from './document-draft.js';

export class Autosave {
  #projectId = null;
  #dirty = false;
  #stopped = false;
  #conflict = false;
  #timer = null;
  #interval = null;
  #pending = null;
  #draftKey = null;
  #draftStored = false;
  #draftRevision = 0;
  #permanentSaving = false;
  #change = null;
  #flush = null;
  #pageHide = null;
  #patch = null;
  #background = false;

  init(projectId, draftRevision = 0) {
    this.#projectId = projectId;
    this.#draftRevision = Number.isSafeInteger(draftRevision) && draftRevision >= 0 ? draftRevision : 0;
    // Keep one emergency browser snapshot per project, shared across sessions.
    this.#draftKey = projectId;
    this.#change = () => {
      if (this.#background) return;
      this.#dirty = true;
      try {
        this.#snapshot();
      } catch (error) {
        EventBus.emit('autosave:error', error);
      }
      EventBus.emit('autosave:unsaved');
      window.clearTimeout(this.#timer);
      this.#timer = window.setTimeout(() => this.#autoSave(), 1000);
    };
    this.#flush = () => {
      document.activeElement?.blur?.();
      const save = this.forceSave();
      // Existing fire-and-forget callers use emit(); async workflows can use
      // emitAsync() and observe the original rejection before confirming.
      save.catch(() => {});
      return save;
    };
    this.#pageHide = () => {
      if (this.#dirty || this.#pending) {
        try {
          this.#snapshot();
        } catch (error) {
          console.error('[Autosave]', error);
        }
      }
    };
    this.#patch = async ({ projectId, transform }) => {
      if (projectId !== this.#projectId || this.#stopped) return;
      if (this.#background) throw new Error('El servidor está actualizando este personaje.');
      if (this.#permanentSaving)
        throw new Error('Espera a que termine el guardado permanente antes de cambiar la imagen.');
      const project = AppState.currentProject;
      if (project?.id !== projectId) throw new Error('El proyecto activo cambió antes de guardar.');
      Object.assign(project, transform(project));
      this.#change();
      await this.forceSave();
      return project;
    };
    EventBus.on('autosave:patch', this.#patch);
    EventBus.on('editor:change', this.#change);
    EventBus.on('autosave:flush', this.#flush);
    window.addEventListener('pagehide', this.#pageHide);
    this.#interval = window.setInterval(() => this.#autoSave(), 15000);
  }

  #autoSave() {
    if (this.#dirty && !this.#pending && !this.#permanentSaving && !this.#conflict && !this.#stopped)
      this.#save().catch(() => {});
  }

  #snapshot() {
    const project = AppState.currentProject;
    if (project?.id !== this.#projectId) throw new Error('El proyecto activo cambió antes de guardar.');
    let content;
    const handler = (value) => {
      content = value;
    };
    EventBus.on('editor:content', handler);
    try {
      EventBus.emit('editor:getContent');
    } finally {
      EventBus.off('editor:content', handler);
    }
    if (typeof content !== 'string')
      throw new Error('No se pudo leer el contenido; no se sobrescribirá el documento.');
    const snapshot = JSON.parse(JSON.stringify(createDocumentDraftPayload(project, content)));
    try {
      storeDraft(this.#draftKey, project, snapshot, this.#draftRevision);
      this.#draftStored = true;
    } catch (error) {
      this.#draftStored = false;
      console.error('[Autosave] Local recovery unavailable:', error);
    }
    return snapshot;
  }

  async beforeLeave() {
    document.activeElement?.blur?.();
    if (!this.#dirty && !this.#pending) return true;
    try {
      await this.forceSave();
      return true;
    } catch (error) {
      if (!this.#draftStored) {
        await Modal.alert({
          title: 'No se pudo guardar',
          message: 'No se pudo guardar ni crear una copia local. Permanece aquí y reintenta el guardado.',
        });
        return false;
      }
      return Modal.confirm({
        title: 'El guardado está pendiente',
        message: `${error.message}\nHay una copia local recuperable. ¿Salir conservando ese borrador?`,
        confirmLabel: 'Salir y conservar borrador',
        cancelLabel: 'Seguir aquí',
        type: 'warning',
      });
    }
  }

  async forceSave() {
    if (this.#stopped || !this.#projectId || this.#background) return;
    this.#dirty = true;
    let saved;
    do {
      saved = await (this.#pending || this.#save());
    } while (this.#dirty && !this.#stopped);
    return saved;
  }

  async savePermanent() {
    if (this.#background)
      throw new Error('Espera a que termine el trabajo del servidor antes de guardar una versión.');
    if (this.#stopped || !this.#projectId) throw new Error('No hay un documento abierto para guardar.');
    if (this.#permanentSaving) throw new Error('Ya se está guardando una versión permanente.');

    this.#permanentSaving = true;
    window.clearTimeout(this.#timer);
    EventBus.emit('document:save:started');

    try {
      // Flush the latest edits into the recoverable draft before promoting
      // them. This keeps the two persistence paths distinct.
      await this.forceSave();
      const payload = this.#snapshot();
      this.#dirty = false;
      const result = await API.saveDocumentVersion(this.#projectId, payload, this.#draftRevision);
      this.#draftRevision = 0;
      commitProjectSnapshot(result.project);
      if (!this.#dirty) {
        try {
          removeDraft(this.#draftKey, payload);
        } catch {}
      }
      EventBus.emit('document:save:saved', result.version);
      return result.version;
    } catch (error) {
      this.#dirty = true;
      this.#conflict = error.status === 409;
      error.localRecovery = this.#draftStored;
      EventBus.emit('document:save:error', error);
      throw error;
    } finally {
      this.#permanentSaving = false;
      if (this.#dirty && !this.#stopped && !this.#conflict) {
        this.#timer = window.setTimeout(() => this.#autoSave(), 0);
      }
    }
  }

  #save() {
    let payload;
    try {
      payload = this.#snapshot();
    } catch (error) {
      EventBus.emit('autosave:error', error);
      return Promise.reject(error);
    }
    this.#dirty = false;
    let saveSucceeded = false;
    window.clearTimeout(this.#timer);
    EventBus.emit('autosave:saving');
    this.#pending = API.saveProjectDraft(this.#projectId, payload, this.#draftRevision)
      .then((draft) => {
        saveSucceeded = true;
        this.#draftRevision = draft.revision;
        const current = AppState.currentProject;
        if (
          !this.#stopped &&
          !this.#dirty &&
          current?.id === this.#projectId &&
          current.type === 'book' &&
          current.category === 'screenplay' &&
          draft.payload?.covers
        ) {
          current.covers = draft.payload.covers;
          current.currentCoverIndex = 0;
        }
        if (!this.#dirty) {
          try {
            removeDraft(this.#draftKey, payload);
          } catch {}
        }
        if (!this.#stopped) EventBus.emit(this.#dirty ? 'autosave:unsaved' : 'autosave:saved');
        return draft;
      })
      .catch((error) => {
        this.#dirty = true;
        this.#conflict = error.status === 409;
        error.localRecovery = this.#draftStored;
        if (!this.#stopped) EventBus.emit('autosave:error', error);
        throw error;
      })
      .finally(() => {
        this.#pending = null;
        if (saveSucceeded && this.#dirty && !this.#stopped && !this.#permanentSaving && !this.#conflict) {
          this.#timer = window.setTimeout(() => this.#autoSave(), 1000);
        }
      });
    return this.#pending;
  }

  stop() {
    this.#stopped = true;
    window.clearTimeout(this.#timer);
    window.clearInterval(this.#interval);
    EventBus.off('editor:change', this.#change);
    EventBus.off('autosave:patch', this.#patch);
    EventBus.off('autosave:flush', this.#flush);
    window.removeEventListener('pagehide', this.#pageHide);
  }
  acceptBackgroundState({ busy, draft }) {
    if (this.#stopped || AppState.currentProject?.id !== this.#projectId) return;
    if (!this.#background && (this.#dirty || this.#pending))
      throw new Error('Hay cambios locales pendientes. No se sustituyeron por el resultado del servidor.');
    window.clearTimeout(this.#timer);
    this.#background = busy;
    if (draft) {
      Object.assign(AppState.currentProject, draft.payload);
      this.#draftRevision = draft.revision;
      this.#dirty = false;
      this.#conflict = false;
    }
  }
  destroy() {
    this.stop();
  }
}
