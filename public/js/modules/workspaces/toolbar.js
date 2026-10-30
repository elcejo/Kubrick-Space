import { renderIcon } from '../../icons.js';
import { safeHTML } from '../../safe-html.js';
import { openDocumentVersions } from '../documents/document-versions.js';
import { enhanceSelect } from '../../custom-select.js';
import { LocalInferenceControls } from './local-inference-controls.js';
import { APIInferenceControls } from './api-inference-controls.js';
import { API } from '../../api-service.js';
import { Modal } from '../../ui-components.js';
/**
 * @module toolbar
 * @description Top toolbar bar with editable project name, autosave status
 * indicator, and export dropdown.
 */

import { EventBus } from '../../event-bus.js';
import {
  AppState,
  setTheme,
  setCanvasEffects,
  applyProjectInference,
  renameProjectSummary,
} from '../../app-state.js';

/** SVG icon helpers (inline, small). */
const Icons = { save: renderIcon('save', 16), export: renderIcon('download', 16) };

/**
 * Top Toolbar.
 *
 * @example
 * const tb = new Toolbar();
 * tb.init(toolbarContainer, projectData, moduleConfig);
 */
export class Toolbar {
  /** @type {HTMLElement|null} */ #root = null;
  /** @type {HTMLElement|null} */ #statusDot = null;
  /** @type {HTMLElement|null} */ #dropdown = null;
  /** @type {Function[]} */ #handlers = {};
  /** @type {Function|null} */ #outsideClick = null;
  /** @type {HTMLButtonElement|null} */ #exportBtn = null;
  /** @type {HTMLButtonElement|null} */ #saveBtn = null;
  #closeVersions = null;
  #inferenceControl = null;
  #localInference = null;
  #apiInference = null;
  setBackgroundBusy(busy) {
    const name = this.#root?.querySelector('#toolbar-project-name');
    if (name) {
      name.disabled = busy;
      if (AppState.currentProject?.name) name.value = AppState.currentProject.name;
    }
    if (this.#saveBtn) this.#saveBtn.disabled = busy;
  }

  /**
   * Build and mount the toolbar.
   * @param {HTMLElement} container
   * @param {{ id: string, name: string }} projectData
   * @param {{ exportFormats?: Array<{ label: string, key: string }> }} moduleConfig
   */
  init(container, projectData, moduleConfig) {
    this.#root = document.createElement('div');
    this.#root.className = 'workspace-toolbar toolbar';

    // ── Left section ─────────────────────────────────────────────────
    const left = document.createElement('div');
    left.className = 'toolbar-left';

    // Project name input
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = projectData.name || 'Sin título';
    nameInput.className = 'toolbar-name';
    nameInput.id = 'toolbar-project-name';
    nameInput.maxLength = 300;
    nameInput.addEventListener('input', () => this.#saveProjectName(projectData.id, nameInput.value));
    nameInput.addEventListener('blur', () => {
      nameInput.value = nameInput.value.trim() || projectData.name;
      this.#saveProjectName(projectData.id, nameInput.value);
    });
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        /** @type {HTMLInputElement} */ (e.target).blur();
      }
    });

    // ── Status Dot & Text ─────────────────────────────────────────────
    this.#statusDot = document.createElement('span');
    this.#statusDot.className = 'toolbar-status-dot is-saved';
    this.#statusDot.title = 'Documento sin cambios pendientes';
    this.#statusDot.setAttribute('role', 'status');
    this.#statusDot.setAttribute('aria-label', 'Documento sin cambios pendientes');

    left.append(this.#statusDot, nameInput);

    // ── Right section ────────────────────────────────────────────────
    const right = document.createElement('div');
    right.className = 'toolbar-right';

    this.#saveBtn = document.createElement('button');
    this.#saveBtn.type = 'button';
    this.#saveBtn.className = 'btn-ghost toolbar-save';
    this.#saveBtn.innerHTML = safeHTML(Icons.save);
    this.#saveBtn.title = 'Guardar una versión permanente del documento';
    this.#saveBtn.setAttribute('aria-label', 'Guardar versión permanente');
    this.#saveBtn.addEventListener('click', () => EventBus.emit('document:save-permanent'));
    left.insertBefore(this.#saveBtn, this.#statusDot);

    const versionsBtn = document.createElement('button');
    versionsBtn.type = 'button';
    versionsBtn.className = 'btn-ghost toolbar-versions';
    versionsBtn.textContent = 'Versiones';
    versionsBtn.title = 'Consultar versiones permanentes guardadas';
    versionsBtn.classList.add('toolbar-utility-btn');
    versionsBtn.addEventListener('click', () => {
      this.#closeVersions?.();
      this.#closeVersions = openDocumentVersions(projectData, moduleConfig.versionPresentation);
    });

    // Export button + dropdown
    const exportWrap = document.createElement('div');
    exportWrap.className = 'toolbar-export-wrap';

    this.#exportBtn = document.createElement('button');
    this.#exportBtn.className = 'btn-ghost toolbar-export';
    this.#exportBtn.innerHTML = safeHTML(Icons.export);
    this.#exportBtn.title = 'Exportar';
    this.#exportBtn.setAttribute('aria-label', 'Exportar');
    this.#exportBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.#toggleDropdown();
    });

    this.#dropdown = document.createElement('div');
    this.#dropdown.className = 'toolbar-dropdown';
    this.#dropdown.hidden = true;

    const formats = (moduleConfig?.exportFormats ?? []).map((format) =>
      format.id === 'docx' && projectData.type === 'book'
        ? {
            ...format,
            id: projectData.category === 'screenplay' ? 'docx' : 'doc',
            label: projectData.category === 'screenplay' ? 'Word (.docx)' : 'Word (.doc)',
          }
        : format,
    );
    formats.forEach((fmt) => {
      const item = document.createElement('button');
      item.className = 'toolbar-dropdown-item';
      item.textContent = fmt.label;
      item.addEventListener('click', () => {
        EventBus.emit('export:request', fmt.id || fmt.key);
        this.#closeDropdown();
      });
      this.#dropdown.appendChild(item);
    });

    if (formats.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'toolbar-dropdown-empty';
      empty.textContent = 'Sin formatos disponibles';
      this.#dropdown.appendChild(empty);
    }

    // Theme toggle button
    const themeBtn = document.createElement('button');
    themeBtn.className = 'btn-ghost toolbar-theme';
    themeBtn.type = 'button';
    themeBtn.title = 'Alternar tema claro/oscuro';
    themeBtn.setAttribute('aria-label', themeBtn.title);

    const updateThemeIcon = () => {
      themeBtn.innerHTML = safeHTML(renderIcon(AppState.theme === 'light' ? 'moon' : 'sun'));
    };
    updateThemeIcon();

    themeBtn.addEventListener('click', () => {
      setTheme(AppState.theme === 'light' ? 'dark' : 'light');
    });

    const fxBtn = document.createElement('button');
    fxBtn.type = 'button';
    fxBtn.className = 'btn-ghost toolbar-fx';
    fxBtn.innerHTML = safeHTML(renderIcon('fx'));
    fxBtn.setAttribute('aria-label', 'FX: colores del fondo');
    const updateEffects = () => {
      fxBtn.setAttribute('aria-pressed', String(AppState.canvasEffects));
      fxBtn.title = AppState.canvasEffects ? 'Desactivar colores del fondo' : 'Activar colores del fondo';
    };
    updateEffects();
    fxBtn.addEventListener('click', () => setCanvasEffects(!AppState.canvasEffects));

    exportWrap.append(this.#exportBtn, this.#dropdown);
    container.querySelectorAll('.video-import-button').forEach((button) => right.appendChild(button));
    const inferenceSelect = document.createElement('select');
    inferenceSelect.className = 'toolbar-inference';
    inferenceSelect.setAttribute('aria-label', 'Modo de inferencia');
    for (const [value, label] of [
      ['local', 'Local'],
      ['api', 'API'],
    ]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      inferenceSelect.append(option);
    }
    inferenceSelect.value = AppState.inferenceMode === 'local' ? 'local' : 'api';
    inferenceSelect.addEventListener('change', async () => {
      const mode = inferenceSelect.value;
      inferenceSelect.disabled = true;
      this.#inferenceControl?.refresh();
      try {
        applyProjectInference(projectData.id, await API.saveProjectInference(projectData.id, { mode }));
      } catch (error) {
        await Modal.alert({ title: 'Modo del proyecto', message: error.message });
      } finally {
        inferenceSelect.value = AppState.inferenceMode;
        inferenceSelect.disabled = false;
        this.#inferenceControl?.refresh();
      }
    });
    this.#localInference = new LocalInferenceControls(projectData.id);
    this.#apiInference = new APIInferenceControls(projectData.id);
    right.append(
      inferenceSelect,
      this.#localInference.element,
      this.#apiInference.element,
      versionsBtn,
      themeBtn,
      fxBtn,
      exportWrap,
    );
    this.#inferenceControl = enhanceSelect(inferenceSelect, { searchable: false });
    this.#inferenceControl.root.classList.add('toolbar-inference-control');

    this.#root.append(left, right);
    container.appendChild(this.#root);

    // ── Close dropdown on outside click ─────────────────────────────
    this.#outsideClick = (e) => {
      if (this.#dropdown && !this.#dropdown.hidden && !exportWrap.contains(/** @type {Node} */ (e.target))) {
        this.#closeDropdown();
      }
    };
    document.addEventListener('click', this.#outsideClick);

    // ── EventBus listeners for autosave status ──────────────────────
    this.#handlers['autosave:saving'] = () => this.updateStatus('saving');
    this.#handlers['autosave:saved'] = () => this.updateStatus('saved');
    this.#handlers['autosave:error'] = (error) => {
      this.updateStatus('error');
      const message =
        error?.status === 409
          ? error.localRecovery
            ? 'Conflicto: borrador local recuperable'
            : 'Conflicto al guardar el borrador'
          : error?.message || 'Error al guardar el borrador temporal';
      this.#statusDot.title = message;
      this.#statusDot.setAttribute('aria-label', message);
    };
    this.#handlers['autosave:unsaved'] = () => this.updateStatus('unsaved');
    this.#handlers['document:save:started'] = () => {
      if (!this.#saveBtn) return;
      this.#saveBtn.disabled = true;
      this.#saveBtn.setAttribute('aria-busy', 'true');
      this.#saveBtn.title = 'Guardando versión permanente...';
    };
    this.#handlers['document:save:saved'] = (version) => {
      if (!this.#saveBtn) return;
      this.#saveBtn.disabled = false;
      this.#saveBtn.removeAttribute('aria-busy');
      this.#saveBtn.title = `Versión ${version.number} guardada permanentemente`;
      this.updateStatus('saved');
      if (this.#statusDot) {
        this.#statusDot.title = `Versión ${version.number} guardada permanentemente`;
        this.#statusDot.setAttribute('aria-label', `Versión ${version.number} guardada permanentemente`);
      }
    };
    this.#handlers['document:save:error'] = (error) => {
      if (!this.#saveBtn) return;
      this.#saveBtn.disabled = false;
      this.#saveBtn.removeAttribute('aria-busy');
      this.#saveBtn.title = error?.message || 'No se pudo guardar la versión permanente';
    };
    this.#handlers['export:started'] = () => this.#setExportState(true);
    this.#handlers['export:completed'] = () => this.#setExportState(false);
    this.#handlers['export:error'] = () => this.#setExportState(false);
    this.#handlers['state:change'] = ({ key }) => {
      if (key === 'theme') {
        updateThemeIcon();
      }
      if (key === 'canvasEffects') updateEffects();
      if (key === 'inferenceMode' || key === 'currentProject') {
        inferenceSelect.value = AppState.inferenceMode;
        this.#inferenceControl?.refresh();
      }
    };

    for (const [evt, fn] of Object.entries(this.#handlers)) {
      EventBus.on(evt, fn);
    }
  }

  /**
   * Update the autosave status indicator.
   * @param {'saved'|'saving'|'error'|'unsaved'} status
   */
  updateStatus(status) {
    if (!this.#statusDot) return;
    switch (status) {
      case 'saving':
        this.#setStatusClass('is-saving');
        this.#statusDot.title = 'Guardando borrador temporal...';
        this.#statusDot.setAttribute('aria-label', 'Guardando');
        break;
      case 'saved':
        this.#setStatusClass('is-saved');
        this.#statusDot.title = 'Borrador temporal guardado';
        this.#statusDot.setAttribute('aria-label', 'Borrador temporal guardado');
        break;
      case 'error':
        this.#setStatusClass('is-error');
        this.#statusDot.title = 'Error al guardar el borrador temporal';
        this.#statusDot.setAttribute('aria-label', 'Error al guardar el borrador temporal');
        break;
      case 'unsaved':
        this.#setStatusClass('is-unsaved');
        this.#statusDot.title = 'Cambios pendientes en el borrador temporal';
        this.#statusDot.setAttribute('aria-label', 'Cambios pendientes en el borrador temporal');
        break;
    }
  }

  /** Clean up. */
  destroy() {
    this.#apiInference?.destroy();
    this.#apiInference = null;
    this.#localInference?.destroy();
    this.#localInference = null;
    this.#inferenceControl?.destroy({ restore: false });
    this.#inferenceControl = null;
    this.#closeVersions?.();
    this.#closeVersions = null;
    for (const [evt, fn] of Object.entries(this.#handlers)) {
      EventBus.off(evt, fn);
    }
    this.#handlers = {};
    if (this.#outsideClick) {
      document.removeEventListener('click', this.#outsideClick);
      this.#outsideClick = null;
    }
    this.#root?.remove();
    this.#root = null;
    this.#exportBtn = null;
    this.#saveBtn = null;
  }

  // ─── Private helpers ───────────────────────────────────────────────────

  #setStatusClass(statusClass) {
    this.#statusDot.classList.remove('is-saving', 'is-saved', 'is-error', 'is-unsaved');
    this.#statusDot.classList.add(statusClass);
  }

  /** Toggle dropdown visibility. */
  #toggleDropdown() {
    if (!this.#dropdown) return;
    this.#dropdown.hidden = !this.#dropdown.hidden;
  }

  /** Close dropdown. */
  #closeDropdown() {
    if (this.#dropdown) this.#dropdown.hidden = true;
  }

  /** Update the export control while a file is being prepared. */
  #setExportState(isExporting) {
    if (!this.#exportBtn) return;
    this.#exportBtn.disabled = isExporting;
    this.#exportBtn.setAttribute('aria-busy', String(isExporting));
    this.#exportBtn.title = isExporting ? 'Preparando exportación...' : 'Exportar';
  }

  /**
   * Persist project name change.
   * @param {string} id
   * @param {string} name
   */
  #saveProjectName(id, name) {
    const trimmed = name.trim();
    const project = AppState.currentProject;
    if (!trimmed || project?.id !== id || project.name === trimmed) return;
    renameProjectSummary(id, trimmed);
    EventBus.emit('project:renamed', { id, name: trimmed });
    EventBus.emit('editor:change');
  }
}
