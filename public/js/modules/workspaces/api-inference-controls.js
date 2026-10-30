import { API } from '../../api-service.js';
import { AppState, applyProjectInference } from '../../app-state.js';
import { EventBus } from '../../event-bus.js';
import { enhanceModelSelect, appendModelGroups } from '../../custom-select.js';
import { Modal } from '../../ui-components.js';

/** API selections belong to this project; defaults remain function-specific. */
export class APIInferenceControls {
  constructor(projectId) {
    this.projectId = projectId;
    this.element = document.createElement('div');
    this.element.className = 'toolbar-api-inference';
    this.pickers = [];
    for (const [key, label] of [
      ['textModel', 'Modelo LLM API'],
      ['imageModel', 'Modelo de imagen API'],
    ]) {
      const select = document.createElement('select');
      select.setAttribute('aria-label', label);
      select.append(new Option(key === 'textModel' ? 'LLM · Elegir modelo' : 'Imagen · Elegir modelo', ''));
      select.disabled = true;
      select.addEventListener('change', () => void this.save(key));
      this[key] = select;
      this.element.append(select);
      this.pickers.push(enhanceModelSelect(select, { image: key === 'image' || key === 'imageModel' }));
    }
    this.listener = ({ key }) => {
      if (['inferenceMode', 'inferenceSettings', 'currentProject'].includes(key)) this.render();
    };
    EventBus.on('state:change', this.listener);
    this.render();
    this.ready = this.load();
  }
  async load() {
    const results = await Promise.allSettled([
      API.getLLMModels?.({ mode: 'api' }),
      API.getImageGenerationAvailability?.(),
    ]);
    if (this.destroyed) return;
    const catalogue = results[0].status === 'fulfilled' ? results[0].value?.models || [] : [];
    const keys = results[1].value?.keys;
    this.textModels = (keys && !keys.openrouter?.configured ? [] : catalogue).filter(
      (model) =>
        !model.id.startsWith('local:') &&
        (!model.outputModalities || model.outputModalities.includes('text')) &&
        model.supportedParameters?.includes('tools') &&
        (AppState.currentProject?.type !== 'character' || model.inputModalities?.includes('image')),
    );
    this.imageModels = results[1].status === 'fulfilled' ? results[1].value?.api || [] : [];
    if (AppState.currentProject?.type === 'character')
      this.imageModels = this.imageModels.filter(
        (model) => model.imageTypes?.includes('character') && model.editing && model.maxReferences >= 2,
      );
    this.textModel.replaceChildren(this.textModel.options[0]);
    appendModelGroups(this.textModel, this.textModels);
    this.imageModel.replaceChildren(this.imageModel.options[0]);
    appendModelGroups(this.imageModel, this.imageModels, { image: true });
    this.render();
  }
  render() {
    this.element.hidden = AppState.inferenceMode !== 'api';
    const project = AppState.currentProject?.id === this.projectId ? AppState.currentProject : null;
    const settings = project?.inferenceSettings || {};
    const image = settings.imageModel || project?.characterImageGeneration;
    for (const key of ['textModel', 'imageModel']) {
      const select = this[key];
      const value =
        key === 'textModel' ? settings.textModel || '' : image ? `${image.provider}:${image.model}` : '';
      if (value && ![...select.options].some((option) => option.value === value)) {
        const option = new Option(value, value);
        option.disabled = true;
        select.append(option);
      }
      select.value = value;
      select.options[0].disabled = !!value;
      select.disabled =
        !!this.pending ||
        !project ||
        !(key === 'textModel' ? this.textModels?.length : this.imageModels?.length);
    }
    this.pickers.forEach((picker) => picker.refresh());
  }
  async save(key) {
    if (this.pending || AppState.currentProject?.id !== this.projectId) return;
    const value = this[key].value;
    const model =
      key === 'imageModel'
        ? this.imageModels.find((item) => `${item.provider}:${item.model}` === value)
        : null;
    if (!value || (key === 'imageModel' && !model)) return this.render();
    this.pending = true;
    this.render();
    try {
      const settings = await API.saveProjectInference(this.projectId, {
        [key]: model ? { provider: model.provider, model: model.model } : value,
      });
      applyProjectInference(this.projectId, settings);
    } catch (error) {
      if (!this.destroyed) await Modal.alert({ title: 'Modelos del proyecto', message: error.message });
    } finally {
      this.pending = false;
      if (!this.destroyed) this.render();
    }
  }
  destroy() {
    this.destroyed = true;
    EventBus.off('state:change', this.listener);
    this.pickers.forEach((picker) => picker.destroy({ restore: false }));
  }
}
