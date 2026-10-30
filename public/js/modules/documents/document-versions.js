import { renderIcon } from '../../icons.js';
import { API } from '../../api-service.js';
import { safeHTML } from '../../safe-html.js';
import { EventBus } from '../../event-bus.js';
import { AppState } from '../../app-state.js';

function liveContent() {
  let value;
  const read = (content) => {
    value = content;
  };
  EventBus.on('editor:content', read);
  try {
    EventBus.emit('editor:getContent');
  } finally {
    EventBus.off('editor:content', read);
  }
  return value;
}

export function openDocumentVersions(project, presentation = {}) {
  const dialog = document.createElement('dialog');
  dialog.className = 'document-versions';
  dialog.setAttribute('aria-label', 'Versiones guardadas del proyecto');
  dialog.innerHTML = safeHTML(
    `<header><div><h2>Versiones guardadas</h2><p>Guardados permanentes · Vista de solo lectura</p></div><button type="button" aria-label="Cerrar versiones">${renderIcon('close')}</button></header><div class="document-versions__layout"><nav aria-label="Seleccionar versión"></nav><section class="document-versions__preview" aria-live="polite"></section></div>`,
  );
  const list = dialog.querySelector('nav');
  const preview = dialog.querySelector('section');
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  dialog.querySelector('header button').addEventListener('click', close);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.appendChild(dialog);
  dialog.showModal();
  list.textContent = 'Cargando versiones…';
  let request = 0;
  const date = (value) =>
    new Date(value).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
  const select = async (entry, button) => {
    const current = ++request;
    list.querySelectorAll('button').forEach((item) => item.removeAttribute('aria-current'));
    button.setAttribute('aria-current', 'true');
    preview.textContent = 'Cargando contenido…';
    try {
      const version = await API.getDocumentVersion(project.id, entry.id);
      if (!dialog.isConnected || request !== current) return;
      preview.replaceChildren();
      const heading = document.createElement('h3');
      heading.textContent = `${version.name} · Versión ${version.number}`;
      const timestamp = document.createElement('p');
      timestamp.textContent = date(version.savedAt);
      const body = document.createElement('article');
      const content = version.snapshot?.content || '';
      let structured;
      try {
        structured = JSON.parse(content);
      } catch {
        /* Legacy HTML or plain text. */
      }
      if (presentation.render) {
        presentation.render(body, content);
      } else if (content.trim().startsWith('{')) {
        const pre = document.createElement('pre');
        try {
          pre.textContent = JSON.stringify(JSON.parse(content), null, 2);
        } catch {
          pre.textContent = content;
        }
        body.appendChild(pre);
      } else {
        body.innerHTML = safeHTML(content);
      }
      if (!content) body.textContent = 'Esta versión no contiene texto.';
      preview.append(heading, timestamp, body);
      if (presentation.compare) {
        const controls = document.createElement('div');
        controls.className = 'document-versions__actions';
        const compare = document.createElement('button');
        compare.type = 'button';
        compare.className = 'btn btn-secondary';
        compare.textContent = 'Comparar por escena';
        compare.addEventListener('click', () => {
          try {
            const previous = preview.querySelector('.screenplay-comparison');
            if (previous) {
              previous.remove();
              body.hidden = false;
              compare.textContent = 'Comparar por escena';
              return;
            }
            const currentContent = liveContent();
            if (AppState.currentProject?.id !== project.id || typeof currentContent !== 'string')
              throw new Error('Abre este guión para comparar su borrador.');
            const comparison = presentation.compare(currentContent, content);
            body.hidden = true;
            body.before(comparison);
            compare.textContent = 'Ver versión completa';
          } catch (error) {
            status.textContent = error.message;
          }
        });
        const recover = document.createElement('button');
        recover.type = 'button';
        recover.className = 'btn btn-secondary';
        recover.textContent = 'Recuperar como borrador';
        const status = document.createElement('p');
        status.setAttribute('role', 'status');
        let baseline = null;
        recover.addEventListener('click', async () => {
          if (baseline === null) {
            baseline = liveContent();
            if (typeof baseline !== 'string' || AppState.currentProject?.id !== project.id) {
              baseline = null;
              status.textContent = 'Abre este guión para recuperar su versión.';
              return;
            }
            status.textContent =
              'Se reemplazará el borrador actual por esta versión. Las versiones guardadas permanecerán intactas.';
            recover.textContent = 'Confirmar recuperación';
            return;
          }
          recover.disabled = true;
          try {
            const result = await EventBus.emitAsync('document:restore-version', {
              projectId: project.id,
              versionId: version.id,
              expectedContent: baseline,
            });
            if (!result.some((value) => value === true))
              throw new Error('No hay un workspace disponible para recuperar.');
            close();
          } catch (error) {
            status.textContent = error.message;
            recover.disabled = false;
            baseline = null;
            recover.textContent = 'Recuperar como borrador';
          }
        });
        controls.append(compare, recover);
        preview.insertBefore(controls, body);
        preview.append(status);
      }
      for (const [key, label] of [
        ['ingredients', 'Ingredientes'],
        ['traits', 'Rasgos'],
        ['production', 'Producción'],
      ]) {
        const value = version.snapshot?.[key];
        if (!value || (typeof value === 'object' && !Object.keys(value).length)) continue;
        if (key === 'traits' && structured?.schema === 'code-kai.character') continue;
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = label;
        const pre = document.createElement('pre');
        pre.textContent = JSON.stringify(version.snapshot[key], null, 2);
        details.append(summary, pre);
        preview.appendChild(details);
      }
    } catch (error) {
      if (dialog.isConnected && request === current)
        preview.textContent = `No se pudo cargar la versión: ${error.message}`;
    }
  };
  API.getDocumentVersions(project.id)
    .then((entries) => {
      if (!dialog.isConnected) return;
      list.replaceChildren();
      if (!entries.length) {
        preview.textContent =
          'Aún no hay versiones permanentes. Usa el icono Guardar para crear la primera. El autoguardado conserva únicamente el borrador temporal.';
        return;
      }
      entries
        .sort((a, b) => b.number - a.number)
        .forEach((entry, index) => {
          const button = document.createElement('button');
          button.type = 'button';
          const title = document.createElement('strong');
          title.textContent = `Versión ${entry.number}`;
          const time = document.createElement('span');
          time.textContent = date(entry.savedAt);
          button.append(title, time);
          button.addEventListener('click', () => select(entry, button));
          list.appendChild(button);
          if (index === 0) select(entry, button);
        });
    })
    .catch((error) => {
      if (dialog.isConnected) list.textContent = `No se pudo cargar el historial: ${error.message}`;
    });
  return close;
}
