import { API } from '../../api-service.js';
import { Modal } from '../../ui-components.js';
import { characterAssetImage } from './character-model.js';
import { characterElement as el, characterAction as action, characterTabs } from './character-ui.js';

/** Select and import the origin before committing the photo creation method. */
export function openCharacterPhotoDialog(host, onChoose) {
  const controller = new AbortController(),
    { signal } = controller;
  const root = el('div', 'character-photo-dialog');
  const filePane = el('div', 'character-photo-dialog__source');
  const urlPane = el('div', 'character-photo-dialog__source');
  const file = el('input');
  file.type = 'file';
  file.hidden = true;
  file.accept = 'image/png,image/jpeg,image/webp,image/gif,image/bmp';
  file.setAttribute('aria-label', 'Archivo de fotografía');
  const preview = el('img', 'character-photo-dialog__preview');
  preview.alt = 'Fotografía seleccionada';
  preview.hidden = true;
  const url = el('input', 'input');
  url.type = 'url';
  url.placeholder = 'https://ejemplo.com/personaje.jpg';
  url.setAttribute('aria-label', 'URL de la fotografía');
  const status = el('p', 'character-empty');
  status.setAttribute('role', 'status');
  let mode = 'file',
    data = '',
    busy = false,
    reader = null,
    ticket = 0;
  const release = () => {
    controller.abort();
    ticket++;
    if (reader?.readyState === 1) reader.abort();
    reader = null;
    data = '';
    url.value = '';
    preview.removeAttribute('src');
  };
  const close = () => {
    release();
    if (root.isConnected) Modal.hide();
  };
  const choose = action('Elegir fotografía', 'image', () => file.click(), 'btn btn-secondary');
  const submit = action('Usar fotografía', 'check', () => void save(), 'btn btn-primary');
  const cancel = action('Cancelar', 'close', close, 'btn btn-ghost');
  function update() {
    submit.disabled = busy || (mode === 'file' ? !data : !url.value.trim());
  }
  file.addEventListener('change', () => {
    const selected = file.files?.[0];
    file.value = '';
    if (!selected) return;
    data = '';
    preview.hidden = true;
    status.textContent = '';
    const current = ++ticket;
    if (
      !['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'].includes(selected.type) ||
      selected.size > 15 * 1024 * 1024
    ) {
      status.textContent = 'Elige PNG, JPEG, WebP, GIF o BMP de hasta 15 MB.';
      update();
      return;
    }
    reader = new FileReader();
    reader.onload = () => {
      if (signal.aborted || current !== ticket) return;
      data = String(reader.result);
      preview.src = data;
      preview.hidden = false;
      update();
    };
    reader.onerror = () => {
      if (!signal.aborted) {
        status.textContent = 'No se pudo leer la fotografía.';
        update();
      }
    };
    reader.readAsDataURL(selected);
    update();
  });
  url.addEventListener('input', () => {
    status.textContent = '';
    update();
  });
  filePane.append(
    choose,
    file,
    preview,
    el(
      'p',
      'character-empty',
      'Elige una fotografía con un solo personaje. PNG, JPEG, WebP, GIF o BMP; hasta 15 MB.',
    ),
  );
  urlPane.append(
    url,
    el(
      'p',
      'character-empty',
      'Pega el enlace directo a una imagen pública. Se guardará una copia en este proyecto.',
    ),
  );
  const tabs = characterTabs(
    [
      { key: 'file', label: 'Subir archivo', content: filePane },
      { key: 'url', label: 'Pegar URL', content: urlPane },
    ],
    {
      label: 'Origen de la fotografía',
      selected: 'file',
      onSelect: (key) => {
        mode = key;
        status.textContent = '';
        update();
      },
    },
  );
  const actions = el('div', 'character-photo-dialog__actions');
  actions.append(cancel, submit);
  root.append(tabs, status, actions);
  update();
  async function save() {
    if (busy || signal.aborted || !host.current()) return;
    if (mode === 'url') {
      try {
        const parsed = new URL(url.value.trim());
        if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password)
          throw Error();
      } catch {
        status.textContent = 'Escribe una URL http o https válida de una imagen pública.';
        return;
      }
    }
    if (mode === 'file' && !data) return;
    busy = true;
    root.querySelectorAll('button,input').forEach((control) => {
      if (control !== cancel) control.disabled = true;
    });
    status.textContent = mode === 'file' ? 'Subiendo fotografía…' : 'Descargando fotografía…';
    try {
      const result =
        mode === 'file'
          ? await API.uploadBase64(host.projectId, data, null, { signal })
          : await API.importCharacterPhoto(host.projectId, url.value.trim(), { signal });
      if (signal.aborted || !host.current()) return;
      if (!characterAssetImage(result.imageUrl, host.projectId))
        throw Error('La fotografía importada no pertenece a este proyecto.');
      const image = result.imageUrl;
      close();
      onChoose(image);
    } catch (error) {
      if (!signal.aborted)
        status.textContent = error.message || 'No se pudo importar la fotografía. Puedes reintentar.';
    } finally {
      if (!signal.aborted) {
        busy = false;
        root.querySelectorAll('button,input').forEach((control) => {
          control.disabled = false;
        });
        update();
      }
    }
  }
  Modal.show({ title: 'Fotografía del personaje', content: root, initialFocus: choose, onDismiss: release });
  return close;
}
