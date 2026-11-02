import { API } from '../../api-service.js';
import { Modal } from '../../ui-components.js';
import { enhanceSelect, enhanceModelSelect, appendModelGroups } from '../../custom-select.js';
/** An explicit decision for a newly created resource, never a silent inherited image model. */
export async function chooseResourceImageModel(resource) {
  const results = await Promise.allSettled([API.getImageGenerationAvailability(), API.localRuntime()]);
  const catalog = {
    ...(results[0].status === 'fulfilled' ? results[0].value : {}),
    local: results[1].status === 'fulfilled' ? results[1].value?.imageModels || [] : [],
  };
  return new Promise((resolve) => {
    const content = document.createElement('div');
    content.className = 'settings-field';
    const intro = document.createElement('p');
    intro.textContent = 'Elige cómo generar la imagen de ' + resource.name + '.';
    content.append(intro);
    const mode = document.createElement('select');
    mode.setAttribute('aria-label', 'Modo de imagen del personaje');
    for (const [value, label] of [
      ['', 'Elegir Local o API'],
      ['local', 'Local'],
      ['api', 'API'],
    ])
      mode.add(new Option(label, value));
    const model = document.createElement('select');
    model.setAttribute('aria-label', 'Modelo de imagen del personaje');
    model.add(new Option('Elegir modelo de imagen', ''));
    model.disabled = true;
    content.append(mode, model);
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      modePicker.destroy?.();
      modelPicker.destroy?.();
      resolve(value);
    };
    const layer = Modal.show({
      title: 'Imagen de ' + resource.name,
      content,
      onDismiss: () => finish(null),
      actions: [
        {
          label: 'Recordar luego',
          class: 'btn-secondary',
          onClick: () => {
            Modal.hide();
            finish(null);
          },
        },
        {
          label: 'Usar modelo',
          class: 'btn-primary',
          onClick: () => {
            const entry = [...(catalog.local || []), ...(catalog.api || [])].find(
              (item) => item.provider + ':' + item.model === model.value,
            );
            if (!mode.value || !entry) return;
            Modal.hide();
            finish({
              projectId: resource.projectId,
              mode: mode.value,
              engine: { provider: entry.provider, model: entry.model },
            });
          },
        },
      ],
    });
    const modePicker = enhanceSelect(mode),
      modelPicker = enhanceModelSelect(model, { image: true });
    mode.addEventListener('change', () => {
      model.replaceChildren(new Option('Elegir modelo de imagen', ''));
      const list = (catalog[mode.value] || []).filter(
        (item) => item.imageTypes?.includes('character') && item.editing && item.maxReferences >= 2,
      );
      appendModelGroups(model, list, { image: true });
      model.disabled = !list.length;
      modelPicker.refresh();
    });
    modelPicker.refresh();
    void layer;
  });
}
