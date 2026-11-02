import { API } from '../../api-service.js';
import { AppState, applyProjectInference } from '../../app-state.js';
import { EventBus } from '../../event-bus.js';
import { enhanceModelSelect, enhanceSelect, appendModelGroups } from '../../custom-select.js';
import { renderIcon } from '../../icons.js';
import { safeHTML } from '../../safe-html.js';
import { Modal } from '../../ui-components.js';

const LOCAL_TEXT_FALLBACK = 'local:qwen3.5-4b-int8-convrot';

/**
 * Model selection for the project. Local is one more provider of each catalogue and always comes first;
 * choosing a model also sets the project's inference mode, so there is no separate API/Local switch.
 */
export class InferenceControls {
  constructor(projectId = AppState.currentProject?.id) {
    this.projectId = projectId;
    this.element = document.createElement('div');
    this.element.className = 'toolbar-inference-controls';
    this.localText = [];
    this.localImage = [];
    this.apiText = [];
    this.apiImage = [];
    this.pickers = [];
    this.selects = {};
    for (const [key, label, placeholder] of [
      ['textModel', 'Modelo LLM', 'LLM · Elegir modelo'],
      ['imageModel', 'Modelo de imagen', 'Imagen · Elegir modelo'],
    ]) {
      const select = document.createElement('select');
      select.setAttribute('aria-label', label);
      select.append(new Option(placeholder, ''));
      select.disabled = true;
      select.addEventListener('change', () => void this.save(key));
      this.selects[key] = select;
      this.pickers.push(
        enhanceModelSelect(select, {
          image: key === 'imageModel',
          onReload: () => this.load({ force: true }),
        }),
      );
    }
    this.textSelect = this.selects.textModel;
    this.imageSelect = this.selects.imageModel;
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'btn-ghost toolbar-local-power';
    this.button.disabled = true;
    this.element.append(this.textSelect.parentElement, this.button, this.imageSelect.parentElement);
    // Only the feature film generates video, and the only video engine is local.
    const project = AppState.currentProject;
    this.videoSelect = null;
    if (project?.type === 'video' && project.category === 'feature') {
      this.videoSelect = document.createElement('select');
      this.videoSelect.setAttribute('aria-label', 'Modelo de video');
      this.videoSelect.append(new Option('Video · Elegir modelo', ''));
      this.element.append(this.videoSelect);
      this.videoPicker = enhanceSelect(this.videoSelect, { searchable: false });
      this.videoSelect.addEventListener('change', () => void this.saveVideo());
    }
    this.button.addEventListener('click', () => void this.control());
    this.listener = ({ key }) => {
      if (['inferenceMode', 'imageMode', 'localModel', 'inferenceSettings', 'currentProject'].includes(key))
        this.render();
    };
    EventBus.on('state:change', this.listener);
    this.render();
    this.ready = this.load();
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), 1000);
    this.timer.unref?.();
  }
  async load({ force = false } = {}) {
    if (this.loading) return this.loading;
    this.loading = this.loadCatalog(force).finally(() => {
      this.loading = null;
    });
    return this.loading;
  }
  async loadCatalog(force) {
    const results = await Promise.allSettled([
      API.getLLMModels?.({ mode: 'api', force }),
      API.getImageGenerationAvailability?.({ force }),
    ]);
    if (this.destroyed) return;
    if (
      force &&
      (results.some((result) => result.status === 'rejected') || results[1].value?.warnings?.length)
    ) {
      await Modal.alert({
        title: 'Modelos',
        message: 'No se pudo actualizar todo el catálogo. Puedes volver a recargarlo.',
      });
      if (this.destroyed) return;
    }
    const catalogue = results[0].status === 'fulfilled' ? results[0].value?.models || [] : this.apiText || [];
    const keys = results[1].value?.keys;
    const character = AppState.currentProject?.type === 'character';
    this.apiText = (keys && !keys.openrouter?.configured ? [] : catalogue).filter(
      (model) =>
        !model.id.startsWith('local:') &&
        (!model.outputModalities || model.outputModalities.includes('text')) &&
        model.supportedParameters?.includes('tools') &&
        (!character || model.inputModalities?.includes('image')),
    );
    this.apiImage = results[1].status === 'fulfilled' ? results[1].value?.api || [] : this.apiImage || [];
    if (character)
      this.apiImage = this.apiImage.filter(
        (model) => model.imageTypes?.includes('character') && model.editing && model.maxReferences >= 2,
      );
    this.rebuild();
  }
  async refresh() {
    if (this.refreshing || this.destroyed || !API.localRuntime) return;
    this.refreshing = true;
    try {
      const state = await API.localRuntime();
      if (this.destroyed) return;
      this.state = state;
      const character = AppState.currentProject?.type === 'character';
      const text = (state.models || []).map((model) => ({
        id: model.id,
        name: model.name.replace(' · Local · INT8 ConvRot', ''),
        provider: 'local',
      }));
      const image = (state.imageModels || [])
        .filter((model) => !character || !model.imageTypes || model.imageTypes.includes('character'))
        .map((model) => ({ ...model, provider: 'local', label: model.label || model.name }));
      const video = state.videoModels || [];
      const signature = JSON.stringify([text, image, video]);
      this.localText = text;
      this.localImage = image;
      if (signature !== this.localSignature) {
        this.localSignature = signature;
        this.videoSelect?.replaceChildren(
          new Option('Video · Elegir modelo', ''),
          ...video.map((model) => new Option(model.name, model.model)),
        );
        this.rebuild();
      } else this.render();
    } catch {
      /* The explicit Play action reports actionable engine errors. */
    } finally {
      this.refreshing = false;
    }
  }
  /** Local first, then every API provider. */
  rebuild() {
    this.textSelect.replaceChildren(this.textSelect.options[0]);
    appendModelGroups(this.textSelect, [...this.localText, ...(this.apiText || [])]);
    this.imageSelect.replaceChildren(this.imageSelect.options[0]);
    appendModelGroups(this.imageSelect, [...this.localImage, ...(this.apiImage || [])], { image: true });
    this.render();
  }
  render() {
    const mode = AppState.inferenceMode === 'local' ? 'local' : 'api';
    const project = AppState.currentProject?.id === this.projectId ? AppState.currentProject : null;
    const settings = project?.inferenceSettings || {};
    const image = settings.imageModel || project?.characterImageGeneration;
    const values = {
      textModel: mode === 'local' ? AppState.localModel || LOCAL_TEXT_FALLBACK : settings.textModel || '',
      imageModel:
        AppState.imageMode === 'local'
          ? this.localImage[0]
            ? `local:${this.localImage[0].model}`
            : ''
          : image
            ? `${image.provider}:${image.model}`
            : '',
    };
    const busy = !!(this.pending || this.saving || this.state?.busy);
    for (const key of ['textModel', 'imageModel']) {
      const select = this.selects[key];
      const value = values[key];
      if (value && ![...select.options].some((option) => option.value === value)) {
        const option = new Option(value, value);
        option.disabled = true;
        select.append(option);
      }
      select.value = value;
      select.options[0].disabled = !!value;
      const available =
        key === 'textModel'
          ? this.localText.length + (this.apiText?.length || 0)
          : this.localImage.length + (this.apiImage?.length || 0);
      select.disabled = !!(this.pending || this.saving) || !project || !available;
    }
    const loaded = this.state?.loadedModel === this.textSelect.value && this.state?.pinned;
    this.button.hidden = mode !== 'local';
    this.button.innerHTML = safeHTML(renderIcon(busy ? 'spinner' : loaded ? 'stop' : 'play', 18));
    this.button.setAttribute('aria-label', loaded ? 'Descargar modelo de VRAM' : 'Cargar modelo en VRAM');
    this.button.setAttribute('aria-pressed', String(!!loaded));
    this.button.title = busy
      ? 'Preparando modelo local…'
      : loaded
        ? 'Descargar modelo de VRAM'
        : 'Cargar modelo en VRAM';
    this.button.disabled = !!busy || !this.state?.models?.length;
    this.pickers.forEach((picker) => picker.refresh());
    if (this.videoSelect) {
      this.videoSelect.value = settings.videoModel?.model || '';
      this.videoSelect.disabled = !!this.saving || !this.state?.videoModels?.length;
      this.videoSelect.title = this.state?.videoModels?.length
        ? 'Modelo que genera las previsualizaciones del largometraje'
        : 'No se encontró el modelo de video local (models/video/h3).';
      this.videoPicker?.refresh();
    }
  }
  /** Persist one selection; the provider of the chosen model decides the project's mode. */
  async save(key) {
    if (this.pending || AppState.currentProject?.id !== this.projectId) return;
    const value = this.selects[key].value;
    if (!value) return this.render();
    let patch;
    if (key === 'textModel') {
      patch = value.startsWith('local:')
        ? { mode: 'local', imageMode: AppState.imageMode, localModel: value }
        : { mode: 'api', imageMode: AppState.imageMode, textModel: value };
    } else {
      const model = [...this.localImage, ...(this.apiImage || [])].find(
        (item) => `${item.provider}:${item.model}` === value,
      );
      if (!model) return this.render();
      patch =
        model.provider === 'local'
          ? { imageMode: 'local' }
          : { imageMode: 'api', imageModel: { provider: model.provider, model: model.model } };
    }
    this.pending = true;
    this.render();
    try {
      applyProjectInference(this.projectId, await API.saveProjectInference(this.projectId, patch));
    } catch (error) {
      if (!this.destroyed) await Modal.alert({ title: 'Modelos del proyecto', message: error.message });
    } finally {
      this.pending = false;
      if (!this.destroyed) this.render();
    }
  }
  async saveVideo() {
    const model = this.videoSelect.value;
    this.saving = true;
    this.render();
    try {
      applyProjectInference(
        this.projectId,
        await API.saveProjectInference(this.projectId, {
          videoModel: model ? { provider: 'local', model } : null,
        }),
      );
    } catch (error) {
      if (!this.destroyed) await Modal.alert({ title: 'Modelo de video', message: error.message });
    } finally {
      this.saving = false;
      if (!this.destroyed) this.render();
    }
  }
  async control() {
    const model = this.textSelect.value;
    if (this.pending || !model.startsWith('local:')) return;
    const action = this.state?.loadedModel === model && this.state?.pinned ? 'unload' : 'load';
    this.pending = true;
    this.render();
    try {
      this.state = { ...this.state, ...(await API.controlLocalModel(action, model)) };
    } catch (error) {
      if (!this.destroyed)
        await Modal.alert({
          title: 'Motor local',
          message: error.message || 'No se pudo controlar el motor local.',
        });
    } finally {
      this.pending = false;
      if (!this.destroyed) this.render();
    }
  }
  destroy() {
    this.destroyed = true;
    clearInterval(this.timer);
    EventBus.off('state:change', this.listener);
    this.pickers.forEach((picker) => picker.destroy({ restore: false }));
    this.videoPicker?.destroy({ restore: false });
  }
}
