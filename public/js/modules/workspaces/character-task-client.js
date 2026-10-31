import { API } from '../../api-service.js';
import { EventBus } from '../../event-bus.js';
import { Modal } from '../../ui-components.js';
import { enhanceSelect } from '../../custom-select.js';

export async function enqueueRemoteCharacterAction(action, { signal } = {}) {
  if (
    !action ||
    Object.keys(action).some((key) => !['projectId', 'action', 'request', 'attachmentImage'].includes(key)) ||
    !['manage', 'interpret'].includes(action.action) ||
    !/^[a-f0-9-]{36}$/.test(action.projectId || '') ||
    typeof action.request !== 'string' ||
    !action.request.trim() ||
    action.request.length > 12000
  )
    throw new Error('Acción de gestión de personajes inválida.');
  signal?.throwIfAborted();
  await EventBus.emitAsync('autosave:flush');
  const project = await API.getProject(action.projectId),
    draft = await API.getProjectDraft(action.projectId);
  const current = { ...project, ...draft?.payload };
  if (current.type !== 'character' || typeof current.content !== 'string')
    throw new Error('El destino debe ser un personaje.');
  let attachmentImage = action.attachmentImage || '';
  if (attachmentImage && !attachmentImage.startsWith(`/projects/${action.projectId}/content/`)) {
    const sourceProjectId = /^\/projects\/([a-f0-9-]{36})\/content\//.exec(attachmentImage)?.[1];
    if (!sourceProjectId) throw new Error('Referencia adjunta inválida.');
    attachmentImage = (
      await API.copyCharacterReference({
        sourceProjectId,
        projectId: action.projectId,
        image: attachmentImage,
      })
    ).image;
  }
  signal?.throwIfAborted();
  const response = await API.enqueueCharacterJob({
    projectId: action.projectId,
    kind: 'interpret',
    source: 'description',
    request: action.request,
    ...(attachmentImage ? { attachmentImage } : {}),
    expectedContent: current.content,
    token: crypto.randomUUID(),
    gallery: current.covers || [],
    ...(current.characterImageGeneration ? { engine: current.characterImageGeneration } : {}),
  });
  return {
    status: 'queued',
    jobId: response.job.id,
    message:
      'Trabajo de personaje aceptado por el servidor. Consulta Tareas activas; aún no está completado.',
  };
}

export async function attachCharacterTaskPhoto(file) {
  if (!file) return '';
  if (
    !['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'].includes(file.type) ||
    file.size > 15 * 1024 * 1024
  )
    throw new Error('Elige una imagen PNG, JPEG, WebP, GIF o BMP de hasta 15 MB.');
  const projects = await API.characterCatalogue();
  if (!projects.length) throw new Error('Crea primero un proyecto de personaje para adjuntar su referencia.');
  const select = document.createElement('select');
  select.className = 'input';
  select.setAttribute('aria-label', 'Personaje que usará la referencia');
  for (const p of projects) {
    const option = document.createElement('option');
    option.value = p.id;
    option.textContent = p.name;
    select.append(option);
  }
  let picker;
  const projectId = await new Promise((resolve) => {
    Modal.show({
      title: 'Referencia para personaje',
      content: select,
      actions: [
        {
          label: 'Cancelar',
          class: 'btn-secondary',
          onClick: () => {
            Modal.hide();
            resolve(null);
          },
        },
        {
          label: 'Adjuntar',
          class: 'btn-primary',
          onClick: () => {
            const id = select.value;
            Modal.hide();
            resolve(id);
          },
        },
      ],
      onDismiss: () => resolve(null),
    });
    // The dialog attaches `select`; the themed control replaces the native one.
    picker = enhanceSelect(select, { searchable: false });
  });
  picker?.destroy({ restore: false });
  if (!projectId) return '';
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(Error('No se pudo leer la imagen.'));
    reader.readAsDataURL(file);
  });
  return (await API.uploadBase64(projectId, data)).imageUrl;
}
