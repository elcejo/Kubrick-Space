import { API } from '../../api-service.js';
import { AppState, applyProjectInference } from '../../app-state.js';
import { EventBus } from '../../event-bus.js';
import { enhanceSelect } from '../../custom-select.js';
import { renderIcon } from '../../icons.js';
import { safeHTML } from '../../safe-html.js';
import { Modal } from '../../ui-components.js';

/** Local-model preference and explicit VRAM control; no generation on selection. */
export class LocalInferenceControls {
  constructor(projectId = AppState.currentProject?.id) {
    this.projectId = projectId;
    this.element = document.createElement('div');
    this.element.className = 'toolbar-local-inference';
    this.select = document.createElement('select');
    this.select.setAttribute('aria-label', 'Modelo local');
    const initial = document.createElement('option');
    initial.textContent = 'Cargando modelo local…';
    initial.value = '';
    this.select.append(initial);
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'btn-ghost toolbar-local-power';
    this.button.disabled = true;
    this.imageSelect = document.createElement('select');
    this.imageSelect.setAttribute('aria-label', 'Modelo de imagen local');
    this.element.append(this.select, this.button, this.imageSelect);
    // Only the feature film generates video, so only it offers a video model (and only in Local mode).
    const project = AppState.currentProject;
    this.videoSelect = null;
    if (project?.type === 'video' && project.category === 'feature') {
      this.videoSelect = document.createElement('select');
      this.videoSelect.setAttribute('aria-label', 'Modelo de video local');
      this.videoSelect.append(new Option('Video · Elegir modelo', ''));
      this.element.append(this.videoSelect);
      this.videoPicker = enhanceSelect(this.videoSelect, { searchable: false });
      this.videoSelect.addEventListener('change', () => void this.saveVideo());
    }
    this.imagePicker = enhanceSelect(this.imageSelect, { searchable: false });
    this.picker = enhanceSelect(this.select, { searchable: false });
    this.select.addEventListener('change', () => void this.save());
    this.button.addEventListener('click', () => void this.control());
    this.listener = ({ key }) => {
      if (['inferenceMode', 'localModel', 'inferenceSettings'].includes(key)) this.render();
    };
    EventBus.on('state:change', this.listener);
    this.render();
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), 1000);
    this.timer.unref?.();
  }
  async refresh() {
    if (this.refreshing || this.destroyed || !API.localRuntime) return;
    this.refreshing = true;
    try {
      const state = await API.localRuntime();
      if (this.destroyed) return;
      this.state = state;
      this.imageSelect.replaceChildren(
        ...(state.imageModels?.length
          ? state.imageModels.map((model) => new Option(model.name, model.model))
          : [new Option('Imagen · Sin modelo local', '')]),
      );
      if (this.videoSelect) {
        this.videoSelect.replaceChildren(
          new Option('Video · Elegir modelo', ''),
          ...(state.videoModels || []).map((model) => new Option(model.name, model.model)),
        );
      }
      this.select.replaceChildren(
        ...state.models.map((model) => {
          const option = document.createElement('option');
          option.textContent = model.name.replace(' · Local · INT8 ConvRot', '');
          option.value = model.id;
          return option;
        }),
      );
      this.render();
    } catch {
      /* The explicit Play action reports actionable engine errors. */
    } finally {
      this.refreshing = false;
    }
  }
  render() {
    const mode = AppState.inferenceMode || 'api';
    this.element.hidden = mode === 'api';
    this.select.value = AppState.localModel || 'local:qwen3.5-4b-int8-convrot';
    const loaded = this.state?.loadedModel === this.select.value && this.state?.pinned;
    const busy = this.pending || this.saving || this.state?.busy;
    this.button.innerHTML = safeHTML(renderIcon(busy ? 'spinner' : loaded ? 'stop' : 'play', 18));
    this.button.setAttribute('aria-label', loaded ? 'Descargar modelo de VRAM' : 'Cargar modelo en VRAM');
    this.button.setAttribute('aria-pressed', String(!!loaded));
    this.button.title = busy
      ? 'Preparando modelo local…'
      : loaded
        ? 'Descargar modelo de VRAM'
        : 'Cargar modelo en VRAM';
    this.button.disabled = !!busy || !this.state?.models?.length;
    this.select.disabled = !!busy;
    this.select.title =
      mode !== 'local'
        ? 'Selecciona Local para cargar este modelo.'
        : 'Modelo usado por todas las funciones de texto en modo Local';
    this.picker?.refresh();
    this.imageSelect.disabled = !this.state?.imageModels?.length;
    this.imagePicker?.refresh();
    if (this.videoSelect) {
      this.videoSelect.value = AppState.currentProject?.inferenceSettings?.videoModel?.model || '';
      this.videoSelect.disabled = !!this.saving || !this.state?.videoModels?.length;
      this.videoSelect.title = this.state?.videoModels?.length
        ? 'Modelo que genera las previsualizaciones del largometraje'
        : 'No se encontró el modelo de video local (models/video/h3).';
      this.videoPicker?.refresh();
    }
  }
  async save() {
    const model = this.select.value;
    this.saving = true;
    this.render();
    try {
      applyProjectInference(
        this.projectId,
        await API.saveProjectInference(this.projectId, { localModel: model }),
      );
    } catch (error) {
      if (!this.destroyed) await Modal.alert({ title: 'Modelo local', message: error.message });
    } finally {
      this.saving = false;
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
    if (this.pending || !this.select.value) return;
    const action = this.state?.loadedModel === this.select.value && this.state?.pinned ? 'unload' : 'load';
    this.pending = true;
    this.render();
    try {
      this.state = { ...this.state, ...(await API.controlLocalModel(action, this.select.value)) };
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
    this.picker.destroy({ restore: false });
    this.imagePicker.destroy({ restore: false });
    this.videoPicker?.destroy({ restore: false });
  }
}
