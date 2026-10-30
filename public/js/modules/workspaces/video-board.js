import { renderIcon } from '../../icons.js';
import { MAX_SCENES, MAX_SCENE_TITLE, normalizeSceneIds } from '../screenplay/scene-rules.js';
import { publishProduction, showSceneImport, undoSceneImport } from '../screenplay/scene-import.js';
import { AppState } from '../../app-state.js';
import { EventBus } from '../../event-bus.js';
import { API } from '../../api-service.js';
import { safeHTML, escapeHTML, safeContent } from '../../safe-html.js';
import { Toast } from '../../ui-components.js';
import { trapCoverFocus } from '../media/cover-workflow.js';
import { enhanceSelect } from '../../custom-select.js';
import { screenplayToHTML, screenplaySceneDocument } from '../screenplay/screenplay-document.js';
import { screenplayProductionScenes } from '../screenplay/screenplay-production.js';
import { mountProductionShots } from '../screenplay/production-shots.js';

const sceneId = () => globalThis.crypto.randomUUID();

/**
 * Visual production board for a video project.
 * The editor remains mounted behind it so existing project notes and HTML editing
 * can be opened without losing the original workspace functionality.
 */
export class VideoBoard {
  #root = null;
  #editorNode = null;
  #importButton = null;
  #projectId = null;
  #production = null;
  #onProduction = null;
  #undoButton = null;
  #picker = null;
  #closePicker = null;

  init(container, project) {
    this.#projectId = project.id;
    this.#editorNode = container.querySelector('.editor-layout-wrapper');
    this.#production = this.#normalise(project.production);
    AppState.currentProject.production = this.#production;

    this.#root = document.createElement('section');
    this.#root.className = 'video-board-node';
    container.appendChild(this.#root);
    this.#importButton = document.createElement('button');
    this.#importButton.className = 'btn-ghost video-import-button';
    this.#importButton.textContent = 'Importar desde guión';
    this.#importButton.addEventListener('click', () => this.#openScriptPicker());
    container.closest('.workspace').querySelector('.workspace__toolbar').appendChild(this.#importButton);
    this.#undoButton = document.createElement('button');
    this.#undoButton.className = 'btn-ghost video-import-button';
    this.#undoButton.textContent = 'Deshacer importación';
    this.#undoButton.addEventListener('click', undoSceneImport);
    this.#importButton.after(this.#undoButton);
    this.#onProduction = ({ projectId, source }) => {
      if (projectId !== this.#projectId || source === 'board') return;
      this.#production = AppState.currentProject.production;
      this.#render();
    };
    EventBus.on('production:changed', this.#onProduction);
    this.#showBoard();
    this.#render();
  }

  destroy() {
    EventBus.off('production:changed', this.#onProduction);
    this.#undoButton?.remove();
    this.#closePicker?.();
    this.#editorNode?.classList.remove('is-video-board-hidden');
    this.#importButton?.remove();
    this.#root?.remove();
    this.#root = null;
    this.#editorNode = null;
    this.#importButton = null;
  }

  #normalise(value) {
    const production = value && typeof value === 'object' ? value : {};
    return {
      scenes: Array.isArray(production.scenes)
        ? normalizeSceneIds(production.scenes).map((scene, index) => ({
            ...scene,
            id: scene.id || `scene-${index + 1}`,
            title: scene.title || `Escena ${index + 1}`,
            duration: scene.duration === null ? null : Number.isInteger(scene.duration) ? scene.duration : 10,
            status: scene.status || 'pendiente',
            prompt: scene.prompt || '',
            script: scene.script || '',
          }))
        : [],
      voiceover: production.voiceover || '',
      soundtrack: production.soundtrack || '',
      styles: Array.isArray(production.styles) ? production.styles : [],
      vfx: production.vfx || { parallax: false, glitch: false, particles: false },
      ...(production.scriptProjectId
        ? {
            scriptProjectId: production.scriptProjectId,
            scriptProjectName: production.scriptProjectName || '',
          }
        : {}),
    };
  }

  #showBoard() {
    this.#editorNode?.classList.add('is-video-board-hidden');
    if (this.#root) this.#root.hidden = false;
  }

  #persist() {
    AppState.currentProject.production = this.#production;
    publishProduction('board');
  }

  #render() {
    if (!this.#root) return;
    const scenes = this.#production.scenes;
    this.#root.innerHTML = safeHTML('<main class="video-board__grid" data-grid></main>');
    const grid = this.#root.querySelector('[data-grid]');
    scenes.forEach((scene, index) => grid.appendChild(this.#sceneCard(scene, index)));
    grid.appendChild(this.#addCard());
  }

  #sceneCard(scene, index) {
    const card = document.createElement('article');
    card.className = 'video-scene-card';
    card.draggable = true;
    card.dataset.sceneId = scene.id;
    card.innerHTML = safeHTML(`
      <div class="video-scene-card__top"><span>ESCENA ${String(index + 1).padStart(2, '0')}</span><button data-remove aria-label="Eliminar escena">${renderIcon('close')}</button></div>
      <input data-title aria-label="Título de escena" value="${escapeHTML(scene.title)}">
      <textarea data-script aria-label="Descripción de escena" maxlength="50000" placeholder="Describe esta escena o impórtala desde el guión.">${escapeHTML(scene.script || '')}</textarea>
      <details class="video-scene-prompt"><summary>Prompt de producción</summary><textarea data-prompt aria-label="Prompt de escena" maxlength="10000" placeholder="Indicaciones visuales para producción">${escapeHTML(scene.prompt || '')}</textarea></details>
      <footer><label>Duración <input data-duration type="number" min="1" max="600" placeholder="Sin definir" value="${scene.duration ?? ''}"> s</label><button data-status>${scene.status === 'lista' ? 'Lista' : 'Pendiente'}</button></footer>
    `);
    if (scene.source) {
      const origin = document.createElement('p');
      origin.className = 'video-scene-source';
      origin.textContent = scene.sourceRemoved
        ? 'La escena ya no aparece en la fuente seleccionada.'
        : `Origen: ${scene.source.projectName || 'Guión'} · ${scene.source.source === 'draft' ? 'borrador' : scene.source.source === 'version' ? 'versión ' + (scene.source.versionNumber || 'guardada') : 'proyecto guardado'}`;
      card.append(origin);
    }
    if (scene.sourceScene) {
      const original = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = 'Escena narrativa de origen';
      const body = document.createElement('div');
      body.className = 'screenplay-preview';
      const doc = screenplaySceneDocument(scene.sourceScene);
      body.innerHTML = safeContent(screenplayToHTML(doc));
      body.querySelector('h1')?.remove();
      original.append(summary, body);
      card.append(original);
    }
    mountProductionShots(card, scene, () => this.#persist());
    const title = card.querySelector('[data-title]');
    title.maxLength = MAX_SCENE_TITLE;
    const description = card.querySelector('[data-script]');
    card.querySelector('[data-prompt]').addEventListener('input', (event) => {
      scene.prompt = event.target.value;
      this.#persist();
    });
    description.addEventListener('input', () => {
      scene.script = description.value;
      this.#persist();
    });
    const duration = card.querySelector('[data-duration]');
    title.addEventListener('change', () => {
      if (title.value.length > MAX_SCENE_TITLE) {
        Toast.show('El título admite hasta 300 caracteres.', 'warning');
        title.value = scene.title;
        return;
      }
      scene.title = title.value.trim() || `Escena ${index + 1}`;
      this.#persist();
      this.#render();
    });
    duration.addEventListener('change', () => {
      scene.duration = duration.value
        ? Math.max(1, Math.min(600, Number.parseInt(duration.value, 10) || 1))
        : null;
      this.#persist();
      this.#render();
    });
    card.querySelector('[data-status]').addEventListener('click', () => {
      scene.status = scene.status === 'lista' ? 'pendiente' : 'lista';
      this.#persist();
      this.#render();
    });
    card.querySelector('[data-remove]').addEventListener('click', () => {
      this.#production.scenes = this.#production.scenes.filter((item) => item.id !== scene.id);
      this.#persist();
      this.#render();
    });
    card.addEventListener('dragstart', (event) => {
      if (event.target.closest('input, textarea, button, details')) {
        event.preventDefault();
        return;
      }
      event.dataTransfer.setData('text/plain', scene.id);
      event.dataTransfer.effectAllowed = 'move';
      card.classList.add('is-dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('is-dragging'));
    card.addEventListener('dragover', (event) => event.preventDefault());
    card.addEventListener('drop', (event) => {
      event.preventDefault();
      const draggedId = event.dataTransfer.getData('text/plain');
      const from = this.#production.scenes.findIndex((item) => item.id === draggedId);
      const to = this.#production.scenes.findIndex((item) => item.id === scene.id);
      if (from < 0 || to < 0 || from === to) return;
      const [moved] = this.#production.scenes.splice(from, 1);
      this.#production.scenes.splice(to, 0, moved);
      this.#persist();
      this.#render();
    });
    return card;
  }

  #addCard() {
    const card = document.createElement('button');
    card.className = 'video-scene-add';
    card.setAttribute('aria-label', 'Añadir escena');
    card.disabled = this.#production.scenes.length >= MAX_SCENES;
    if (card.disabled) {
      card.title = 'Límite de 200 escenas alcanzado';
      card.setAttribute('aria-label', card.title);
    }
    card.innerHTML = safeHTML(`<span>${renderIcon('plus')}</span>`);
    card.addEventListener('click', () => {
      if (this.#production.scenes.length >= MAX_SCENES) {
        Toast.show('El proyecto admite hasta 200 escenas.', 'warning');
        return;
      }
      this.#production.scenes.push({
        id: sceneId(),
        title: 'Nueva escena',
        duration: null,
        status: 'pendiente',
        prompt: '',
        script: '',
      });
      this.#persist();
      this.#render();
    });
    return card;
  }

  async #openScriptPicker() {
    const projectId = this.#projectId;
    let projects;
    try {
      const result = await API.getProjects();
      projects = Array.isArray(result) ? result : result.projects || [];
    } catch (error) {
      Toast.show('No se pudieron cargar los guiones.', 'error');
      return;
    }
    if (!this.#root || AppState.currentProject?.id !== projectId) return;
    const screenplays = projects.filter(
      (project) => project.type === 'book' && project.category === 'screenplay',
    );
    if (!screenplays.length) {
      Toast.show('Crea primero un Libro de tipo Guión cinematográfico.', 'warning');
      return;
    }
    this.#closePicker?.();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay visible';
    this.#picker = overlay;
    const dialog = document.createElement('div');
    dialog.className = 'modal-content glass-heavy video-script-picker';
    dialog.innerHTML = safeHTML(
      `<header class="modal-header"><h2 class="modal-title">Importar escenas</h2><button class="modal-close" aria-label="Cerrar">${renderIcon('close')}</button></header><div class="modal-body"><p>Elige el guión y su estado de origen.</p></div><footer class="modal-footer"><button class="btn" data-cancel>Cancelar</button><button class="btn btn-primary" data-import>Revisar escenas</button></footer>`,
    );
    const select = document.createElement('select');
    screenplays.forEach((project) => {
      const option = document.createElement('option');
      option.value = project.id;
      option.textContent = project.name;
      select.appendChild(option);
    });
    dialog.querySelector('.modal-body').appendChild(select);
    select.setAttribute('aria-label', 'Guión para importar escenas');
    const selectControl = enhanceSelect(select);
    const state = document.createElement('select');
    state.setAttribute('aria-label', 'Versión o borrador del guión');
    dialog.querySelector('.modal-body').append(state);
    const stateControl = enhanceSelect(state, { searchable: false });
    let sourceRequest = 0,
      catalog = [],
      sourceDraft = null;
    const importButton = dialog.querySelector('[data-import]');
    const loadStates = async () => {
      const current = ++sourceRequest;
      importButton.disabled = true;
      try {
        const [entries, draft] = await Promise.all([
          API.getDocumentVersions(select.value),
          API.getProjectDraft(select.value),
        ]);
        if (this.#picker !== overlay || current !== sourceRequest) return;
        catalog = entries.sort((a, b) => b.number - a.number);
        sourceDraft = draft;
        state.replaceChildren();
        for (const choice of [
          ...catalog.map((entry) => ({ value: entry.id, label: `Versión ${entry.number}` })),
          ...(draft ? [{ value: 'draft', label: 'Borrador temporal' }] : []),
          ...(!catalog.length ? [{ value: 'saved', label: 'Proyecto guardado' }] : []),
        ]) {
          const option = document.createElement('option');
          option.value = choice.value;
          option.textContent = choice.label;
          state.append(option);
        }
        stateControl.refresh();
        importButton.disabled = false;
      } catch (error) {
        if (this.#picker === overlay) Toast.show('No se pudo leer el historial: ' + error.message, 'error');
      }
    };
    select.addEventListener('change', loadStates);
    selectControl.root.classList.add('video-board__script-select');
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    let releaseFocus = () => {};
    const close = () => {
      if (this.#picker !== overlay) return;
      selectControl.destroy({ restore: false });
      stateControl.destroy({ restore: false });
      sourceRequest++;
      overlay.remove();
      releaseFocus();
      this.#picker = null;
      this.#closePicker = null;
    };
    this.#closePicker = close;
    dialog.querySelector('.modal-close').addEventListener('click', close);
    dialog.querySelector('[data-cancel]').addEventListener('click', close);
    dialog.querySelector('[data-import]').addEventListener('click', async () => {
      const selected = screenplays.find((project) => project.id === select.value);
      try {
        const selectedId = select.value,
          selectedState = state.value;
        importButton.disabled = true;
        let script = await API.getProject(selectedId);
        const source = {
          projectId: selectedId,
          projectName: selected?.name || script.name || '',
          source: selectedState === 'draft' ? 'draft' : selectedState === 'saved' ? 'saved' : 'version',
          revision: script.revision || 0,
        };
        if (source.source === 'version') {
          const version = await API.getDocumentVersion(selectedId, selectedState);
          script = { ...script, ...version.snapshot };
          source.versionId = version.id;
          source.versionNumber = version.number;
        }
        if (source.source === 'draft') {
          sourceDraft = await API.getProjectDraft(selectedId);
          if (!sourceDraft) throw new Error('El borrador ya no existe.');
          script = { ...script, ...sourceDraft.payload };
          source.revision = sourceDraft.revision;
        }
        if (this.#picker !== overlay || select.value !== selectedId || state.value !== selectedState) return;
        const scenes = screenplayProductionScenes(script.content || '', source);
        if (!scenes.length) {
          Toast.show('Ese guión no tiene escenas para importar.', 'warning');
          return;
        }
        if (!this.#root || AppState.currentProject?.id !== projectId) return;
        close();
        showSceneImport(scenes, {
          scriptProjectId: script.id,
          scriptProjectName: selected?.name || script.name || '',
        });
      } catch (error) {
        console.error('[VideoBoard] Script import failed:', error);
        Toast.show('No se pudieron importar las escenas: ' + error.message, 'error');
      } finally {
        if (this.#picker === overlay) importButton.disabled = false;
      }
    });
    releaseFocus = trapCoverFocus(overlay, close, { closeOnBackdrop: true });
    void loadStates();
  }
}
