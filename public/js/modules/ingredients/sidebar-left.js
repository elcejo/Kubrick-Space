import { renderIcon } from '../../icons.js';
import { CHARACTER_FIELDS, characterFieldText } from '../characters/character-document.js';
import { cropCharacterFace, faceFilename } from '../characters/character-face.js';
import { MAX_SCENES, MAX_SCENE_TITLE, normalizeSceneIds } from '../screenplay/scene-rules.js';
import { publishProduction, showSceneImport, undoSceneImport } from '../screenplay/scene-import.js';
import { safeHTML, safeContent } from '../../safe-html.js';
import { enhanceSelect } from '../../custom-select.js';
/**
 * @module sidebar-left
 * @description Left sidebar with tabbed panels: Ingredientes (draggable items),
 * Formato (WYSIWYG formatting toolbar), Generación (AI action buttons).
 * Collapsible via double-click on the header.
 */

import { EventBus } from '../../event-bus.js';
import { AppState } from '../../app-state.js';
import { API } from '../../api-service.js';
import { Toast } from '../../ui-components.js';

/** Inline SVG icons used within the sidebar. */
const Icons = {
  drag: renderIcon('grip', 14),
  tag: renderIcon('tag', 14),
  lock: renderIcon('lock', 14),
  check: renderIcon('check', 16),
  expand: renderIcon('expand', 16),
  refresh: renderIcon('refresh', 16),
  arrow: renderIcon('arrow-right', 16),
};

/**
 * Left sidebar panel.
 *
 * @example
 * const sb = new SidebarLeft();
 * sb.init(container, moduleConfig);
 */
export class SidebarLeft {
  /** @type {HTMLElement|null} */ #root = null; // This will be the floating FAB container
  /** @type {HTMLElement|null} */ #contentArea = null;
  /** @type {string} */ #activeTab = '';
  /** @type {object|null} */ #moduleConfig = null;
  /** @type {Record<string,Function>} */ #handlers = {};
  /** @type {HTMLElement|null} */ #activeCard = null;
  /** @type {HTMLElement|null} */ #activeFab = null;
  #traitSelectControls = [];
  #returnFocus = null;

  /**
   * Build and mount the minimalist floating FAB controls.
   * @param {HTMLElement} container — the hidden sidebar container (kept for compatibility)
   * @param {object} moduleConfig — module descriptor (type, ingredients, getSidebarConfig, …)
   */
  init(container, moduleConfig) {
    this.#moduleConfig = moduleConfig;

    // Get the workspace wrapper to mount floating elements
    const workspaceWrapper =
      container?.closest('.workspace') || document.querySelector('.workspace') || document.body;

    // Create the floating FAB container
    this.#root = document.createElement('div');
    this.#root.className = 'floating-fab-container';

    // Fetch and filter tabs from sidebar config
    const sidebarConfig = moduleConfig?.getSidebarConfig?.() ?? {};
    const tabs = (
      sidebarConfig.tabs ?? [
        { key: 'ingredientes', label: 'Ingredientes', icon: 'ingredients' },
        { key: 'formato', label: 'Formato', icon: 'edit' },
        { key: 'generacion', label: 'Generación', icon: 'agent' },
      ]
    ).filter((t) => {
      const key = (t.key || t.id || '').toLowerCase();
      // Keep only specific active tabs (ingredients, traits, calendar, etc.)
      return (
        key !== 'formato' &&
        key !== 'format' &&
        key !== 'generacion' &&
        key !== 'generate' &&
        key !== 'generación'
      );
    });

    // Render a FAB for each active tab
    tabs.forEach((tab) => {
      const fab = document.createElement('button');
      fab.className = 'fab-menu-btn';
      fab.dataset.panelKey = tab.key || tab.id;

      let icon = tab.icon || 'traits';
      if (tab.id === 'ingredients' || tab.key === 'ingredientes' || icon === '📦') {
        icon = 'ingredients';
      }
      fab.innerHTML = safeHTML(`<span class="fab-icon">${renderIcon(icon)}</span>`);

      // Tooltip (custom, simple, aligned to the right of the button)
      const tooltip = document.createElement('span');
      tooltip.textContent = tab.label;
      tooltip.className = 'fab-menu-tooltip';
      fab.appendChild(tooltip);

      fab.addEventListener('click', (e) => {
        e.stopPropagation();
        this.#toggleTab(tab.key || tab.id, fab);
      });

      this.#root.appendChild(fab);
    });

    workspaceWrapper.appendChild(this.#root);

    this.#handlers['editor:characterTraitsUpdated'] = () => {
      if (this.#activeTab === 'traits') this.#syncTraitsForm();
    };
    this.#handlers['workspace:panel:open'] = (key) => {
      const normalized = key === 'resources' ? 'ingredients' : key;
      const fab = [...(this.#root?.querySelectorAll('[data-panel-key]') || [])].find(
        (button) =>
          button.dataset.panelKey === normalized ||
          (['ingredients', 'ingredientes'].includes(normalized) &&
            ['ingredients', 'ingredientes'].includes(button.dataset.panelKey)),
      );
      if (fab && this.#activeTab !== fab.dataset.panelKey) {
        this.#closeActiveCard(true);
        this.#openCard(fab.dataset.panelKey, fab);
      }
    };
    this.#handlers['workspace:panel:close'] = () => this.#closeActiveCard(true);
    this.#handlers['production:changed'] = ({ projectId, source }) => {
      if (
        projectId === AppState.currentProject?.id &&
        source !== 'timeline' &&
        this.#activeTab === 'timeline' &&
        this.#contentArea
      ) {
        this.#contentArea.replaceChildren();
        this.#renderTimeline();
      }
    };
    EventBus.on('production:changed', this.#handlers['production:changed']);
    EventBus.on('editor:characterTraitsUpdated', this.#handlers['editor:characterTraitsUpdated']);
    EventBus.on('workspace:panel:open', this.#handlers['workspace:panel:open']);
    EventBus.on('workspace:panel:close', this.#handlers['workspace:panel:close']);
  }

  /** Clean up DOM and events. */
  destroy() {
    for (const [evt, fn] of Object.entries(this.#handlers)) {
      EventBus.off(evt, fn);
    }
    this.#handlers = {};

    this.#closeActiveCard(true);
    this.#root?.remove();
    this.#root = null;
    this.#contentArea = null;
  }

  /**
   * Toggle a floating tab card.
   * @param {string} key
   * @param {HTMLElement} fab
   */
  #toggleTab(key, fab) {
    if (this.#activeTab === key) {
      this.#closeActiveCard();
    } else {
      this.#closeActiveCard(true);
      this.#openCard(key, fab);
    }
  }

  /** Close the open floating card. */
  #closeActiveCard(immediate = false) {
    const controls = this.#traitSelectControls;
    this.#traitSelectControls = [];
    const disposeControls = () => controls.forEach((control) => control.destroy());
    if (this.#activeCard) {
      const cardToRemove = this.#activeCard;
      if (cardToRemove.contains(document.activeElement)) {
        const opener = this.#returnFocus?.isConnected ? this.#returnFocus : this.#activeFab;
        opener?.focus();
      }
      if (immediate) {
        disposeControls();
        cardToRemove.remove();
      } else {
        controls.forEach((control) => control.close());
        cardToRemove.inert = true;
        cardToRemove.classList.remove('is-open');
        cardToRemove.classList.add('is-closing');
        setTimeout(() => {
          disposeControls();
          cardToRemove.remove();
        }, 300);
      }
      this.#activeCard = null;
    } else disposeControls();

    if (this.#activeFab) {
      this.#activeFab.classList.remove('is-active');
      this.#activeFab = null;
    }

    this.#activeTab = '';
    this.#contentArea = null;
    this.#returnFocus = null;
  }

  /**
   * Open the floating card for a key and style its active FAB.
   * @param {string} key
   * @param {HTMLElement} fab
   */
  #openCard(key, fab) {
    this.#activeTab = key;
    this.#activeFab = fab;
    this.#returnFocus = document.activeElement !== document.body ? document.activeElement : fab;

    // Make active FAB button standout
    fab.classList.add('is-active');

    // Get the workspace wrapper to mount floating elements
    const workspaceWrapper =
      this.#root?.closest('.workspace') || document.querySelector('.workspace') || document.body;

    // Create the floating card
    const card = document.createElement('div');
    card.className = `floating-tab-card floating-card-${key} is-entering`;

    // Title from tab metadata
    const sidebarConfig = this.#moduleConfig?.getSidebarConfig?.() ?? {};
    const tabs = sidebarConfig.tabs ?? [];
    const tabMeta = tabs.find((t) => (t.key || t.id) === key) || { label: key };
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', tabMeta.label);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.#closeActiveCard();
      }
    });

    // Header
    const header = document.createElement('div');
    header.className = 'floating-tab-card__header';

    const title = document.createElement('span');
    title.className = 'floating-tab-card__title';
    title.textContent = tabMeta.label;
    header.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = safeHTML(renderIcon('close'));
    closeBtn.className = 'floating-tab-card__close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', `Cerrar ${tabMeta.label}`);
    closeBtn.title = `Cerrar ${tabMeta.label}`;
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.#closeActiveCard();
    });
    header.appendChild(closeBtn);

    card.appendChild(header);

    // Content Area
    this.#contentArea = document.createElement('div');
    this.#contentArea.className = 'floating-card__content';
    card.appendChild(this.#contentArea);

    workspaceWrapper.appendChild(card);
    this.#activeCard = card;

    // Trigger animation frame for transition
    requestAnimationFrame(() => {
      card.classList.remove('is-entering');
      card.classList.add('is-open');
    });

    // Render the content depending on key
    const normalizedKey = (key || '').toLowerCase();
    if (normalizedKey === 'ingredientes' || normalizedKey === 'ingredients') {
      this.#renderIngredientes();
      this.#contentArea.querySelector('.ingredient-item')?.focus({ preventScroll: true });
    } else if (normalizedKey === 'traits') {
      this.#renderTraits();
    } else if (normalizedKey === 'timeline') {
      this.#renderTimeline();
    }
  }

  // ─── Ingredientes tab ─────────────────────────────────────────────────

  #renderIngredientes() {
    const ingredients = this.#moduleConfig?.ingredients ?? [];
    if (ingredients.length === 0) {
      this.#contentArea.innerHTML = safeHTML(
        '<p class="ingredient-list-empty">Sin ingredientes definidos</p>',
      );
      return;
    }

    const list = document.createElement('div');
    list.className = 'ingredient-list';
    list.setAttribute('role', 'list');
    list.setAttribute('aria-label', 'Ingredientes disponibles');
    for (const item of ingredients) {
      const entry = document.createElement('div');
      entry.setAttribute('role', 'listitem');
      entry.appendChild(this.#createIngredientItem(item, item.category || 'General'));
      list.appendChild(entry);
    }
    this.#contentArea.appendChild(list);
  }

  /** The entire card supports native button activation and ingredient dragging. */
  #createIngredientItem(item, category) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'ingredient-item';
    row.draggable = true;
    row.dataset.ingredientType = item.type || 'ingredient';
    row.setAttribute('aria-label', `Añadir ${item.name ?? item.label ?? 'ingrediente'}`);
    const projectId = AppState.currentProject?.id;
    const payload = {
      isIngredient: true,
      type: 'ingredient',
      category,
      ingredientType: item.type,
      ...item,
    };
    let dragged = false;
    row.addEventListener('pointerdown', () => (dragged = false));
    row.addEventListener('keydown', () => (dragged = false));
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dragged || !row.isConnected || row.closest('[inert]') || projectId !== AppState.currentProject?.id)
        return;
      this.#closeActiveCard(true);
      EventBus.emit('editor:addIngredient', { projectId, ingredient: payload });
    });

    row.addEventListener('dragstart', (e) => {
      dragged = true;
      e.dataTransfer.setData('application/json', JSON.stringify(payload));
      e.dataTransfer.setData('kubrick-space-ingredient', '1');
      e.dataTransfer.effectAllowed = 'copy';
      row.classList.add('is-dragging');
    });
    row.addEventListener('dragend', () => row.classList.remove('is-dragging'));

    const icon = document.createElement('span');
    icon.className = 'ingredient-item__icon';
    icon.setAttribute('aria-hidden', 'true');
    const typeIcon = {
      book: 'book',
      character: 'character',
      definition: 'tag',
      stage: 'stage',
      script: 'document',
      storyboard: 'brush',
      media: 'image',
      lyrics: 'document',
      mood: 'mask',
      reference: 'headphones',
    };
    icon.innerHTML = safeHTML(renderIcon(item.icon || typeIcon[item.type] || 'ingredients'));

    const label = document.createElement('span');
    label.className = 'ingredient-item__label';
    label.textContent = item.name ?? item.label ?? 'Sin nombre';

    const handle = document.createElement('span');
    handle.innerHTML = safeHTML(Icons.drag);
    handle.className = 'ingredient-item__drag-handle';
    handle.setAttribute('aria-hidden', 'true');
    row.append(icon, label, handle);

    if (item.thumbnail && (item.type === 'media' || /multimedia|media/i.test(category))) {
      const thumb = document.createElement('img');
      thumb.src = item.thumbnail;
      thumb.alt = '';
      thumb.draggable = false;
      thumb.className = 'ingredient-item__thumbnail';
      row.appendChild(thumb);
    }
    return row;
  }

  // ─── Traits (Personaje) Panel ─────────────────────────────────────────

  #syncTraitsForm() {
    const traits = AppState.currentProject?.traits || {};
    this.#contentArea?.querySelectorAll('[data-trait]').forEach((input) => {
      if (input === document.activeElement) return;
      const value = traits[input.dataset.trait] ?? '';
      if (
        input.tagName === 'SELECT' &&
        value !== '' &&
        ![...input.options].some((option) => option.value === String(value))
      ) {
        input.add(new Option(characterFieldText(input.dataset.trait, value), String(value)));
      }
      input.value = value;
    });
    this.#traitSelectControls.forEach((control) => control.refresh());
  }

  #destroyTraitSelects() {
    this.#traitSelectControls.forEach((control) => control.destroy());
    this.#traitSelectControls = [];
  }

  #renderTraits() {
    const area = this.#contentArea;
    const projectId = AppState.currentProject?.id;
    if (!area || AppState.currentProject?.type !== 'character') return;
    this.#destroyTraitSelects();
    area.replaceChildren();
    const container = document.createElement('div');
    container.className = 'character-traits-form';
    const intro = document.createElement('p');
    intro.textContent =
      'Define los rasgos de tu personaje. Los cambios se guardan en la ficha y se usan al generar su retrato.';
    container.appendChild(intro);
    const options = {
      skin: ['muy-clara', 'clara', 'media', 'morena', 'oscura'],
      body: [1, 2, 3, 4, 5],
      voice: ['male-deep', 'male-warm', 'female-soft', 'female-bright', 'neutral'],
    };
    for (const [heading, fields] of [
      ['Identidad y apariencia', ['age', 'skin', 'body', 'clothing']],
      ['Historia y personalidad', ['pseudonyms', 'lore', 'psychology']],
      ['Referencia de voz', ['voice', 'pitch']],
    ]) {
      const group = document.createElement('fieldset');
      const legend = document.createElement('legend');
      legend.textContent = heading;
      group.appendChild(legend);
      for (const key of fields) {
        const label = document.createElement('label');
        label.textContent = key === 'pitch' ? 'Frecuencia de referencia (Hz)' : CHARACTER_FIELDS[key][1];
        const input = document.createElement(
          options[key] ? 'select' : ['clothing', 'lore', 'psychology'].includes(key) ? 'textarea' : 'input',
        );
        input.className = 'input';
        input.dataset.trait = key;
        input.id = 'character-trait-' + key;
        if (options[key]) {
          input.add(new Option('Sin definir', ''));
          options[key].forEach((value) =>
            input.add(new Option(characterFieldText(key, value), String(value))),
          );
        } else if (key === 'age' || key === 'pitch') {
          input.type = 'number';
          input.min = '0';
          input.max = key === 'age' ? '10000' : '20000';
          input.step = '1';
          input.placeholder = 'Sin definir';
        } else {
          input.maxLength = 100000;
          input.placeholder =
            key === 'pseudonyms' ? 'Nombres alternativos, separados por comas' : 'Escribe aquí…';
          if (input.tagName === 'TEXTAREA') input.rows = 4;
        }
        label.appendChild(input);
        group.appendChild(label);
        if (options[key]) {
          input.setAttribute('aria-label', CHARACTER_FIELDS[key][1]);
          this.#traitSelectControls.push(enhanceSelect(input, { searchable: false, allowEmpty: true }));
        }
        input.addEventListener(options[key] ? 'change' : 'input', () => {
          if (AppState.currentProject?.id !== projectId || !input.checkValidity()) return;
          const value =
            input.value === ''
              ? undefined
              : ['age', 'body', 'pitch'].includes(key)
                ? Number(input.value)
                : input.value;
          const traits = (AppState.currentProject.traits ||= {});
          if (value === undefined) delete traits[key];
          else traits[key] = value;
          EventBus.emit('editor:updateCharacterTrait', { key, value });
          EventBus.emit('editor:change');
        });
      }
      if (heading === 'Referencia de voz') {
        const note = document.createElement('p');
        note.textContent = 'Describe la voz del personaje. Este apartado no sintetiza audio.';
        group.appendChild(note);
      }
      container.appendChild(group);
    }

    const faceGroup = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = 'Rostro para las etiquetas';
    faceGroup.appendChild(legend);
    const help = document.createElement('p');
    help.textContent =
      'Sube un rostro para el retrato seleccionado. Aparecerá al pasar el cursor sobre el personaje en un libro. Primero debes generar o subir un retrato.';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-secondary';
    button.textContent = 'Subir rostro';
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp,image/gif';
    input.hidden = true;
    button.addEventListener('click', () => input.click());
    let uploading = false;
    const upload = async (file) => {
      if (!file || uploading || AppState.currentProject?.id !== projectId) return;
      const project = AppState.currentProject;
      const covers = project.covers || [];
      const cover = covers[project.currentCoverIndex] || covers.at(-1);
      if (!cover) {
        Toast.show('Genera o sube un retrato antes de asociarle un rostro.', 'warning');
        return;
      }
      if (
        !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) ||
        file.size > 15 * 1024 * 1024
      ) {
        Toast.show('Elige una imagen JPG, PNG, WebP o GIF de hasta 15 MB.', 'warning');
        return;
      }
      uploading = true;
      button.disabled = true;
      status.textContent = 'Procesando rostro…';
      const url = URL.createObjectURL(file);
      try {
        const result = await cropCharacterFace(url, { fallback: true });
        await API.uploadBase64(projectId, result.dataURL, faceFilename(cover), { replaceFace: true });
        status.textContent = result.detected
          ? 'Rostro recortado y guardado.'
          : 'Imagen guardada. No se detectó un rostro para recortar.';
      } catch (error) {
        status.textContent = 'No se pudo guardar: ' + error.message;
      } finally {
        URL.revokeObjectURL(url);
        uploading = false;
        button.disabled = false;
        input.value = '';
      }
    };
    input.addEventListener('change', () => upload(input.files[0]));
    faceGroup.addEventListener('dragover', (event) => event.preventDefault());
    faceGroup.addEventListener('drop', (event) => {
      event.preventDefault();
      event.stopPropagation();
      upload(event.dataTransfer.files[0]);
    });
    faceGroup.append(help, button, input, status);
    container.appendChild(faceGroup);
    area.appendChild(container);
    this.#syncTraitsForm();
  }

  // ─── Arrangement (Canción) Panel ──────────────────────────────────────

  // ─── Timeline (Video / Película) Panel ────────────────────────────────

  #renderTimeline() {
    const area = this.#contentArea;
    if (!area) return;
    const getScriptScenes = () => {
      let context = null;
      const handler = (value) => {
        context = value;
      };
      EventBus.on('editor:context', handler);
      EventBus.emit('editor:getContext');
      EventBus.off('editor:context', handler);
      const source = document.createElement('div');
      source.innerHTML = safeContent(context?.content || '');
      return [...source.querySelectorAll('h2')].map((heading, index) => ({
        id: globalThis.crypto.randomUUID(),
        title: heading.textContent.trim() || `Escena ${index + 1}`,
        duration: 10,
        status: 'pendiente',
        prompt: '',
      }));
    };

    const current = AppState.currentProject || {};
    const defaults = {
      scenes: getScriptScenes(),
      voiceover: '',
      soundtrack: '',
      styles: [],
      vfx: { parallax: false, glitch: false, particles: false },
    };
    const production = current.production || (current.production = defaults);
    production.scenes = normalizeSceneIds(production.scenes || []);
    production.styles ||= [];
    production.vfx ||= defaults.vfx;
    const persist = () => publishProduction('timeline');

    const container = document.createElement('div');
    container.className = 'production-panel';
    container.innerHTML = safeHTML(`
      <section class="production-panel__section"><div class="production-panel__section-header"><h3>Plan de escenas</h3><button class="btn-ghost production-panel__small-button" data-sync-scenes>${renderIcon('refresh')} Sincronizar guión</button></div><p class="production-panel__description">Cada encabezado H2 del guión puede convertirse en una toma de producción.</p><div class="production-panel__scene-list" data-scenes-list></div><button class="btn-ghost production-panel__add-scene" data-add-scene>${renderIcon('plus')} Añadir escena</button></section>
      <section class="production-panel__section"><h3>Voz y música</h3><textarea class="input production-panel__voiceover" data-voiceover placeholder="Narración de voz en off..."></textarea><input class="input production-panel__soundtrack" data-soundtrack placeholder="Música o proyecto musical vinculado"></section>
      <section class="production-panel__section"><h3>Tratamiento visual</h3><div class="production-panel__vfx" data-vfx></div><div class="production-panel__styles" data-styles></div></section>
    `);
    const undo = document.createElement('button');
    undo.className = 'btn-ghost';
    undo.textContent = 'Deshacer importación';
    undo.addEventListener('click', undoSceneImport);
    container.appendChild(undo);
    area.appendChild(container);

    const scenesList = container.querySelector('[data-scenes-list]');
    const renderScenes = () => {
      scenesList.innerHTML = safeHTML('');
      const add = container.querySelector('[data-add-scene]');
      add.disabled = production.scenes.length >= MAX_SCENES;
      add.title = add.disabled ? 'Límite de 200 escenas alcanzado' : 'Añadir escena';
      if (!production.scenes.length) {
        const empty = document.createElement('p');
        empty.textContent = 'Aún no hay escenas. Sincroniza el guión o añade una toma.';
        empty.className = 'production-panel__empty';
        scenesList.appendChild(empty);
        return;
      }
      production.scenes.forEach((scene, index) => {
        const row = document.createElement('div');
        row.className = 'production-panel__scene-row';
        const order = document.createElement('span');
        order.textContent = String(index + 1).padStart(2, '0');
        order.className = 'production-panel__scene-order';
        const title = document.createElement('input');
        title.className = 'production-panel__scene-title';
        title.value = scene.title;
        title.maxLength = MAX_SCENE_TITLE;
        title.setAttribute('aria-label', `Nombre de escena ${index + 1}`);
        const duration = document.createElement('input');
        duration.className = 'production-panel__scene-duration';
        duration.type = 'number';
        duration.min = '1';
        duration.max = '600';
        duration.value = String(scene.duration);
        duration.title = 'Duración en segundos';
        duration.setAttribute('aria-label', `Duración de escena ${index + 1}`);
        const remove = document.createElement('button');
        remove.className = 'production-panel__scene-remove';
        remove.innerHTML = safeHTML(renderIcon('close'));
        remove.title = 'Eliminar escena';
        title.addEventListener('change', () => {
          if (title.value.length > MAX_SCENE_TITLE) {
            Toast.show('El título admite hasta 300 caracteres.', 'warning');
            title.value = scene.title;
            return;
          }
          scene.title = title.value.trim() || `Escena ${index + 1}`;
          persist();
        });
        duration.addEventListener('change', () => {
          scene.duration = Math.max(1, Math.min(600, Number.parseInt(duration.value, 10) || 10));
          duration.value = String(scene.duration);
          persist();
        });
        remove.addEventListener('click', () => {
          production.scenes.splice(index, 1);
          renderScenes();
          persist();
        });
        row.append(order, title, duration, remove);
        scenesList.appendChild(row);
      });
    };
    renderScenes();

    container.querySelector('[data-add-scene]').addEventListener('click', () => {
      if (production.scenes.length >= MAX_SCENES) {
        Toast.show('El proyecto admite hasta 200 escenas.', 'warning');
        return;
      }
      production.scenes.push({
        id: globalThis.crypto.randomUUID(),
        title: 'Nueva escena',
        duration: 10,
        status: 'pendiente',
        prompt: '',
      });
      renderScenes();
      persist();
    });
    container.querySelector('[data-sync-scenes]').addEventListener('click', () => {
      const scenes = getScriptScenes();
      if (!scenes.length) {
        Toast.show('Añade encabezados H2 al guión antes de sincronizar.', 'warning');
        return;
      }
      showSceneImport(scenes);
    });

    const voiceover = container.querySelector('[data-voiceover]');
    voiceover.value = production.voiceover;
    voiceover.addEventListener('change', () => {
      production.voiceover = voiceover.value.slice(0, 20000);
      persist();
    });
    const soundtrack = container.querySelector('[data-soundtrack]');
    soundtrack.value = production.soundtrack;
    soundtrack.addEventListener('change', () => {
      production.soundtrack = soundtrack.value.slice(0, 300);
      persist();
    });

    const vfxLabels = { parallax: 'Parallax', glitch: 'Glitch', particles: 'Partículas' };
    const vfx = container.querySelector('[data-vfx]');
    Object.entries(vfxLabels).forEach(([key, label]) => {
      const row = document.createElement('label');
      row.className = 'production-panel__vfx-option';
      row.append(label);
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = Boolean(production.vfx[key]);
      input.addEventListener('change', () => {
        production.vfx[key] = input.checked;
        persist();
      });
      row.appendChild(input);
      vfx.appendChild(row);
    });
    const styleLabels = {
      cinematic: 'Cinematic',
      '8k': 'Ultra HD',
      anamorphic: 'Anamorphic',
      golden: 'Golden hour',
    };
    const styles = container.querySelector('[data-styles]');
    Object.entries(styleLabels).forEach(([key, label]) => {
      const button = document.createElement('button');
      button.className = `btn-ghost production-panel__style-button${production.styles.includes(key) ? ' is-active' : ''}`;
      button.textContent = label;
      button.addEventListener('click', () => {
        const active = production.styles.includes(key);
        production.styles = active
          ? production.styles.filter((value) => value !== key)
          : [...production.styles, key];
        button.classList.toggle('is-active', !active);
        persist();
      });
      styles.appendChild(button);
    });
  }
}
