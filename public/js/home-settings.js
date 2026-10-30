import { renderIcon } from './icons.js';
import { API } from './api-service.js';
import { safeHTML } from './safe-html.js';
import { TaskHistory } from './task-history.js';

const providers = [
  ['openrouter', 'OpenRouter', 'Texto e imágenes'],
  ['replicate', 'Replicate', 'Generación multimedia'],
  ['openai', 'OpenAI', 'Servicios de OpenAI'],
  ['minimax', 'MiniMax', 'Servicios de MiniMax'],
  ['artificial-analysis', 'Artificial Analysis', 'Rankings y benchmark de inteligencia'],
];

export class HomeSettings {
  constructor(root) {
    this.root = root;
    this.dialog = null;
  }
  open() {
    if (this.dialog) {
      this.dialog.focus();
      return;
    }
    const dialog = document.createElement('dialog');
    this.dialog = dialog;
    dialog.className = 'studio-settings';
    dialog.setAttribute('aria-labelledby', 'settings-title');
    dialog.innerHTML = safeHTML(`
      <header class="settings-header"><div><h2 id="settings-title">Configuración</h2></div><div class="settings-header-actions"><a class="settings-docs-link" href="/roadmap.html" target="_blank" rel="noopener">${renderIcon('timeline')} Roadmap</a><button type="button" class="settings-close" aria-label="Cerrar configuración">${renderIcon('close', 18)}</button></div></header>
      <div class="settings-tabs" role="tablist" aria-label="Secciones de configuración"><button type="button" id="settings-api-tab" role="tab" aria-selected="true" aria-controls="settings-api">Claves API</button></div>
      <section id="settings-api" role="tabpanel" aria-labelledby="settings-api-tab"><div class="settings-intro"><p>Conecta tus proveedores con una clave API.</p><details class="settings-storage-help"><summary>Almacenamiento y privacidad</summary><p>Las claves se guardan en esta computadora sin cifrado de aplicación. No compartas la carpeta del proyecto. Los campos vacíos conservan la clave actual.</p></details></div><form id="settings-key-form" autocomplete="off"><div class="settings-providers"></div><footer class="settings-footer"><p role="status" aria-live="polite" data-key-status>Cargando estado de las claves…</p><button class="studio-button studio-primary" type="submit" disabled>Guardar claves</button></footer></form></section>`);
    const historyTab = document.createElement('button');
    historyTab.type = 'button';
    historyTab.id = 'settings-history-tab';
    historyTab.setAttribute('role', 'tab');
    historyTab.setAttribute('aria-selected', 'false');
    historyTab.setAttribute('aria-controls', 'settings-history');
    historyTab.tabIndex = -1;
    historyTab.textContent = 'Historial de tareas';
    dialog.querySelector('.settings-tabs').append(historyTab);
    const historyPanel = document.createElement('section');
    historyPanel.id = 'settings-history';
    historyPanel.setAttribute('role', 'tabpanel');
    historyPanel.setAttribute('aria-labelledby', historyTab.id);
    historyPanel.hidden = true;
    dialog.append(historyPanel);
    this.root.append(dialog);
    // Only the central content scrolls; navigation and save actions remain visible.
    for (const section of dialog.querySelectorAll('[role=tabpanel]')) {
      const form = section.querySelector('form');
      if (!form) continue;
      const footer = form.querySelector('.settings-footer');
      const scroll = document.createElement('div');
      scroll.className = 'settings-scroll';
      for (const child of [...section.children]) if (child !== form) scroll.append(child);
      for (const child of [...form.children]) if (child !== footer) scroll.append(child);
      form.prepend(scroll);
      const pending = document.createElement('span');
      pending.dataset.settingsPending = '';
      pending.className = 'settings-pending';
      pending.setAttribute('role', 'status');
      pending.hidden = true;
      footer.prepend(pending);
      form.addEventListener('input', () => this.updatePending(dialog));
      form.addEventListener('change', () => this.updatePending(dialog));
    }
    for (const [id, label, description] of providers) {
      const row = document.createElement('div');
      row.className = 'settings-provider';
      row.innerHTML = safeHTML(
        `<div class="settings-provider-heading"><label for="settings-key-${id}">${label}<small>${description}</small></label><span data-provider-state>Consultando…</span></div><div class="settings-key-input"><input id="settings-key-${id}" name="${id}" type="password" maxlength="1024" autocomplete="new-password" spellcheck="false" placeholder="Introduce una clave API"><button type="button" data-reveal aria-label="Mostrar clave de ${label}" aria-pressed="false">Mostrar</button></div><label class="settings-remove"><input type="checkbox" data-remove> Eliminar clave guardada</label>`,
      );
      const input = row.querySelector('input[type=password]'),
        remove = row.querySelector('[data-remove]'),
        reveal = row.querySelector('[data-reveal]');
      remove.addEventListener('change', () => {
        input.disabled = remove.checked;
        if (remove.checked) input.value = '';
      });
      reveal.addEventListener('click', () => {
        const visible = input.type === 'password';
        input.type = visible ? 'text' : 'password';
        reveal.textContent = visible ? 'Ocultar' : 'Mostrar';
        reveal.setAttribute('aria-pressed', String(visible));
        reveal.setAttribute('aria-label', `${visible ? 'Ocultar' : 'Mostrar'} clave de ${label}`);
      });
      dialog.querySelector('.settings-providers').append(row);
    }
    const tabs = [...dialog.querySelectorAll('[role=tab]')];
    const selectTab = (tab) => {
      if (tab === historyTab && !this.history) this.history = new TaskHistory(historyPanel);
      this.history?.setActive(tab === historyTab);
      for (const item of tabs) {
        const active = item === tab;
        item.setAttribute('aria-selected', String(active));
        item.tabIndex = active ? 0 : -1;
        dialog.querySelector('#' + item.getAttribute('aria-controls')).hidden = !active;
      }
    };
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => selectTab(tab));
      tab.addEventListener('keydown', (event) => {
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const next =
            tabs[
              event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + 1) % tabs.length
            ];
          selectTab(next);
          next.focus();
        }
      });
    });
    dialog.querySelector('.settings-close').addEventListener('click', () => this.close());
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.close();
    });
    dialog.querySelector('#settings-key-form').addEventListener('submit', (event) => {
      event.preventDefault();
      void this.saveKeys(dialog);
    });
    dialog.showModal();
    void this.loadKeys(dialog);
  }
  updatePending(dialog) {
    const keys = dialog.querySelector('#settings-key-form');
    const keyDirty = [...keys.querySelectorAll('.settings-provider')].some(
      (row) => row.querySelector('[data-remove]').checked || row.querySelector('input[name]').value.trim(),
    );
    const pending = keys.querySelector('[data-settings-pending]');
    if (pending) {
      pending.hidden = !keyDirty;
      pending.textContent = keyDirty ? 'Cambios sin guardar' : '';
    }
  }
  async loadKeys(dialog) {
    try {
      const status = await API.getApiKeys();
      if (this.dialog !== dialog) return;
      this.renderKeyStatus(dialog, status);
      dialog.querySelector('[data-key-status]').textContent =
        'Las claves guardadas no se muestran ni se vuelven a descargar.';
      dialog.querySelector('#settings-key-form button[type=submit]').disabled = false;
    } catch {
      if (this.dialog === dialog) {
        const message = dialog.querySelector('[data-key-status]');
        message.textContent = 'No se pudo consultar el estado de las claves. ';
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.textContent = 'Reintentar';
        retry.className = 'studio-button';
        retry.addEventListener('click', () => this.loadKeys(dialog));
        message.append(retry);
      }
    }
  }
  renderKeyStatus(dialog, status) {
    providers.forEach(([id]) => {
      const row = dialog.querySelector(`[name="${id}"]`).closest('.settings-provider');
      row.querySelector('[data-provider-state]').textContent = status[id]?.configured
        ? 'Configurada'
        : 'Sin configurar';
      row.querySelector('[data-remove]').disabled = !status[id]?.configured;
    });
  }
  async saveKeys(dialog) {
    const form = dialog.querySelector('#settings-key-form'),
      message = form.querySelector('[data-key-status]');
    const payload = {};
    for (const [id] of providers) {
      const input = form.querySelector(`[name="${id}"]`);
      if (input.closest('.settings-provider').querySelector('[data-remove]').checked) payload[id] = '';
      else if (input.value.trim()) payload[id] = input.value.trim();
    }
    if (!Object.keys(payload).length) {
      message.textContent = 'No hay cambios en las claves.';
      return;
    }
    const controls = [...form.querySelectorAll('input,button')];
    const previous = controls.map((control) => control.disabled);
    controls.forEach((control) => (control.disabled = true));
    message.textContent = 'Guardando claves…';
    let refreshedStatus;
    try {
      await API.saveApiKeys(payload);
      if (this.dialog !== dialog) return;
      for (const [id] of providers) {
        const input = form.querySelector(`[name="${id}"]`);
        input.value = '';
        input.type = 'password';
        const row = input.closest('.settings-provider');
        row.querySelector('[data-remove]').checked = false;
        const reveal = row.querySelector('[data-reveal]');
        reveal.textContent = 'Mostrar';
        reveal.setAttribute('aria-pressed', 'false');
        reveal.setAttribute('aria-label', 'Mostrar clave de ' + providers.find(([key]) => key === id)[1]);
      }
      message.textContent = 'Claves guardadas localmente.';
      this.updatePending(dialog);
      refreshedStatus = await API.getApiKeys();
    } catch {
      if (this.dialog === dialog)
        message.textContent =
          'No se pudo completar la operación. Comprueba la conexión con el servidor y reintenta.';
    } finally {
      if (this.dialog === dialog) {
        controls.forEach((control, index) => (control.disabled = previous[index]));
        for (const [id] of providers) {
          const input = form.querySelector(`[name="${id}"]`);
          input.disabled = input.closest('.settings-provider').querySelector('[data-remove]').checked;
        }
        if (refreshedStatus) this.renderKeyStatus(dialog, refreshedStatus);
      }
    }
  }
  close() {
    if (!this.dialog) return;
    this.history?.destroy();
    this.history = null;
    this.dialog.querySelectorAll('input,textarea').forEach((input) => {
      input.value = '';
    });
    this.dialog.close();
    this.dialog.remove();
    this.dialog = null;
  }
  destroy() {
    this.close();
  }
}
