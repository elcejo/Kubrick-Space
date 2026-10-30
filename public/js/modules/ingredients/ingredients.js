import { parseCharacterDocument, characterDescription } from '../characters/character-model.js';
import { createColorControl } from '../../color-picker.js';
import { renderIcon } from '../../icons.js';
import { faceImageUrl } from '../characters/character-face.js';
import { mountIngredientCard } from './ingredient-card.js';
import { trapCoverFocus } from '../media/cover-workflow.js';
import { safeHTML, safeContent, escapeHTML } from '../../safe-html.js';
import { AppState } from '../../app-state.js';
import { EventBus } from '../../event-bus.js';
import { API } from '../../api-service.js';
import { Toast, Alert } from '../../ui-components.js';
import { Mode } from '../../contracts/editor-mode.js';
import { enhanceSelect } from '../../custom-select.js';
import {
  loadIngredientVersions,
  readIngredientVersion,
  applyIngredientVersion,
  ingredientContent,
  ingredientHasNewVersion,
  ingredientVersionLabel,
  ingredientPreviewText,
} from './ingredient-versions.js';
import { chooseIngredientVersion, confirmIngredientUpdates } from './ingredient-version-dialogs.js';

/** Owns ingredientsPanel DOM and lifecycle; context is the explicit editor integration contract. */
export class EditorIngredients {
  drawersContainer = null;
  cardCleanups = [];
  dialogCleanups = new Set();
  addIngredientHandler = null;
  versionCatalogues = new Map();
  pendingImports = new Set();
  versionChanges = new WeakMap();
  constructor(context) {
    this.context = context;
  }

  mount(container) {
    this.drawersContainer = document.createElement('div');
    this.drawersContainer.className = 'editor-drawers-sidebar';
    container.appendChild(this.drawersContainer);
    this.addIngredientHandler = ({ projectId, ingredient } = {}) => {
      if (projectId === this.context.projectId) this.addIngredient(ingredient, true);
    };
    EventBus.on('editor:addIngredient', this.addIngredientHandler);
  }

  destroy() {
    EventBus.off('editor:addIngredient', this.addIngredientHandler);
    this.addIngredientHandler = null;
    for (const close of [...this.dialogCleanups]) close();
    this.cardCleanups.splice(0).forEach((cleanup) => cleanup?.());
    this.drawersContainer?.remove();
    this.drawersContainer = null;
    this.versionCatalogues.clear();
  }

  isCurrent() {
    return Boolean(
      this.context.canEdit?.() !== false &&
      this.drawersContainer?.isConnected &&
      AppState.currentProject?.id === this.context.projectId,
    );
  }
  setBusy(busy) {
    if (this.drawersContainer) this.drawersContainer.inert = busy;
  }

  applySource(ingredient, source) {
    const project = source.project;
    const character = project.type === 'character' ? parseCharacterDocument(project.content || '') : null;
    const role = this.getIngredientLabel(project.type, character?.narrative.role || project.category);
    return applyIngredientVersion(
      ingredient,
      source,
      role,
      project.type === 'character' ? this.context.getCharacterMappedTraits(project) : undefined,
    );
  }

  commitIngredients() {
    if (!this.isCurrent()) return;
    AppState.currentProject.ingredients = this.context.ingredients;
    this.renderDrawers();
    this.context.emitChange();
  }

  async bindVersion(ingredient, projectId, versionId, choose = false) {
    const token = {};
    this.versionChanges.set(ingredient, token);
    const before = JSON.stringify(ingredient);
    const catalogue = await loadIngredientVersions(API, projectId);
    if (!this.isCurrent() || this.versionChanges.get(ingredient) !== token) return false;
    this.versionCatalogues.set(projectId, catalogue);
    const selected = choose ? await chooseIngredientVersion(catalogue, this.dialogCleanups) : versionId;
    if (!this.isCurrent() || (choose && selected === null)) return false;
    const source = await readIngredientVersion(API, catalogue, selected === 'draft' ? null : selected);
    if (
      !this.isCurrent() ||
      this.versionChanges.get(ingredient) !== token ||
      !this.context.ingredients.includes(ingredient) ||
      JSON.stringify(ingredient) !== before
    )
      return false;
    this.applySource(ingredient, source);
    this.commitIngredients();
    return true;
  }

  createVersionSelector(ingredient) {
    const catalogue = this.versionCatalogues.get(ingredient.importedProjectId);
    const row = document.createElement('div');
    row.className = 'ingredient-card__version';
    const label = document.createElement('span');
    label.className = 'ingredient-card__color-label';
    label.textContent = 'Versión';
    const select = document.createElement('select');
    select.setAttribute('aria-label', `Versión de ${ingredient.importedProjectName || 'ingrediente'}`);
    const entries = catalogue?.versions || [];
    if (
      !ingredient.importedVersionId ||
      !entries.some((entry) => entry.id === ingredient.importedVersionId)
    ) {
      const option = document.createElement('option');
      option.value = ingredient.importedSource === 'draft' ? 'draft' : 'legacy';
      option.textContent = ingredientVersionLabel(ingredient);
      option.disabled = entries.length > 0;
      select.append(option);
    }
    for (const entry of entries) {
      const option = document.createElement('option');
      option.value = entry.id;
      option.textContent = `Versión ${entry.number}`;
      select.append(option);
    }
    select.value =
      ingredient.importedVersionId || (ingredient.importedSource === 'draft' ? 'draft' : 'legacy');
    select.disabled = entries.length === 0;
    row.append(label, select);
    const control = enhanceSelect(select, { searchable: false });
    this.cardCleanups.push(() => control.destroy({ restore: false }));
    select.addEventListener('change', async () => {
      if (['draft', 'legacy'].includes(select.value)) {
        select.value =
          ingredient.importedVersionId || (ingredient.importedSource === 'draft' ? 'draft' : 'legacy');
        control.refresh();
        return;
      }
      const value = select.value;
      select.disabled = true;
      control.refresh();
      try {
        await this.bindVersion(ingredient, ingredient.importedProjectId, value);
      } catch (error) {
        if (this.isCurrent()) Toast.show(`No se pudo cambiar la versión: ${error.message}`, 'error');
      } finally {
        if (select.isConnected) {
          select.disabled = false;
          select.value =
            ingredient.importedVersionId || (ingredient.importedSource === 'draft' ? 'draft' : 'legacy');
          control.refresh();
        }
      }
    });
    return row;
  }

  hslToHex(h, s, l) {
    s /= 100;
    l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    const toHex = (x) =>
      Math.round(x * 255)
        .toString(16)
        .padStart(2, '0');
    return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
  }

  hexToHsl(hex) {
    hex = hex.replace(/^#/, '');
    if (hex.length === 3) {
      hex = hex
        .split('')
        .map((x) => x + x)
        .join('');
    }
    if (hex.length !== 6) return null;
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h,
      s,
      l = (max + min) / 2;

    if (max === min) {
      h = s = 0;
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r:
          h = (g - b) / d + (g < b ? 6 : 0);
          break;
        case g:
          h = (b - r) / d + 2;
          break;
        case b:
          h = (r - g) / d + 4;
          break;
      }
      h /= 6;
    }
    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
  }

  generateUniqueGradient() {
    const existingHues = [];
    this.context.ingredients.forEach((ing) => {
      if (ing.color1) {
        const hsl = this.hexToHsl(ing.color1);
        if (hsl) existingHues.push(hsl.h);
      }
    });

    let bestHue = 0;
    let maxMinDistance = -1;

    for (let i = 0; i < 30; i++) {
      const candidate = Math.floor(Math.random() * 360);
      let minDistance = 360;
      if (existingHues.length === 0) {
        minDistance = 360;
      } else {
        existingHues.forEach((hue) => {
          let diff = Math.abs(candidate - hue);
          if (diff > 180) diff = 360 - diff;
          if (diff < minDistance) minDistance = diff;
        });
      }

      if (minDistance > maxMinDistance) {
        maxMinDistance = minDistance;
        bestHue = candidate;
      }
    }

    const h1 = bestHue;
    const h2 = (bestHue + 45 + Math.floor(Math.random() * 45)) % 360;
    const s = 80; // Saturation 80% for vibrancy
    const l = 60; // Lightness 60% for high contrast

    const color1 = this.hslToHex(h1, s, l);
    const color2 = this.hslToHex(h2, s, l);
    return { color1, color2 };
  }

  updateAllInlineTagStyles() {
    if (this.context.mode !== Mode.WYSIWYG || !this.context.surface) return;

    const tags = this.context.surface.querySelectorAll('.kai-tag');
    tags.forEach((tag) => {
      const def = tag.dataset.definition || tag.getAttribute('title') || '';
      if (def) tag.dataset.definition = def;
      tag.classList.toggle('kai-character-tag', def.startsWith('character:'));
      tag.removeAttribute('title');
      const text = tag.textContent.replace(/×/g, '').trim();
      const term = tag.dataset.tag || '';

      let matchingIng = null;
      if (tag.classList.contains('kai-character-tag') || def.startsWith('character:')) {
        const charId = def.startsWith('character:') ? def.substring('character:'.length) : '';
        matchingIng = this.context.ingredients.find(
          (ing) => ing.type === 'character' && ing.importedProjectId === charId,
        );
      } else {
        matchingIng = this.context.ingredients.find((ing) => {
          if (ing.type === 'definition') {
            try {
              const data = JSON.parse(ing.value);
              return (
                data.term.toLowerCase() === term.toLowerCase() ||
                data.term.toLowerCase() === text.toLowerCase()
              );
            } catch (e) {}
          }
          return false;
        });
      }

      if (matchingIng && matchingIng.color1 && matchingIng.color2) {
        tag.style.setProperty('--grad-color1', matchingIng.color1);
        tag.style.setProperty('--grad-color2', matchingIng.color2);
      }

      // Turn off browser spellcheck to prevent red underlines from breaking text-clipping
      tag.setAttribute('spellcheck', 'false');
    });
  }

  renderDrawers() {
    if (!this.drawersContainer) return;
    this.cardCleanups.splice(0).forEach((cleanup) => cleanup?.());
    this.drawersContainer.innerHTML = safeHTML('');

    // Keep the add/drop target independent of every project-specific group.
    const add = document.createElement('div');
    add.className = 'drawer-column column-others';
    const heading = document.createElement('div');
    heading.className = 'column-title';
    heading.innerHTML = safeHTML(`${renderIcon('ingredients')} Ingredientes`);
    add.append(heading, this.createEmptyDrawer());
    this.drawersContainer.append(add);
    const groups = new Map();
    for (const ingredient of this.context.ingredients) {
      const type = ingredient.type === 'backstory' ? 'book' : ingredient.type;
      if (!groups.has(type)) groups.set(type, []);
      groups.get(type).push(ingredient);
    }
    const labels = {
      character: ['Personajes', 'character'],
      definition: ['Definiciones', 'tag'],
      book: ['Libros', 'book'],
      stage: ['Escenarios', 'stage'],
      song: ['Música', 'song'],
      video: ['Metraje', 'video'],
    };
    for (const type of [
      ...Object.keys(labels),
      ...[...groups.keys()].filter((type) => !Object.hasOwn(labels, type)),
    ]) {
      if (!groups.has(type)) continue;
      const col = document.createElement('div');
      col.className = 'drawer-column';
      col.dataset.ingredientType = type;
      if (type === 'character') col.classList.add('column-characters');
      if (type === 'definition') col.classList.add('column-definitions');
      const title = document.createElement('div');
      title.className = 'column-title';
      const [label, icon] = Object.hasOwn(labels, type)
        ? labels[type]
        : [this.getIngredientLabel(type), 'ingredients'];
      title.innerHTML = safeHTML(`${renderIcon(icon)} ${escapeHTML(label)}`);
      col.append(title);
      for (const ingredient of groups.get(type))
        col.append(this.createOccupiedDrawer(ingredient, this.context.ingredients.indexOf(ingredient)));
      this.drawersContainer.append(col);
    }
  }

  updateTagDefinition(term, newDefinition) {
    if (this.context.mode === Mode.WYSIWYG && this.context.node) {
      this.context.node.querySelectorAll('.kai-tag').forEach((el) => {
        if (
          el.textContent.trim().toLowerCase() === term.toLowerCase() ||
          el.dataset.tag?.toLowerCase() === term.toLowerCase()
        ) {
          el.dataset.definition = newDefinition;
          el.title = newDefinition;
        }
      });
    }

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = safeContent(this.context.htmlContent || '');
    tempDiv.querySelectorAll('.kai-tag').forEach((el) => {
      if (
        el.textContent.trim().toLowerCase() === term.toLowerCase() ||
        el.dataset.tag?.toLowerCase() === term.toLowerCase()
      ) {
        el.dataset.definition = newDefinition;
        el.title = newDefinition;
      }
    });
    this.context.htmlContent = tempDiv.innerHTML;
  }

  unwrapTagsInHtml(htmlString, characterId) {
    const temp = document.createElement('div');
    temp.innerHTML = safeContent(htmlString || '');
    const tags = temp.querySelectorAll('.kai-tag');
    tags.forEach((tag) => {
      const def = tag.dataset.definition || '';
      if (def === `character:${characterId}`) {
        const parent = tag.parentNode;
        while (tag.firstChild) {
          parent.insertBefore(tag.firstChild, tag);
        }
        tag.remove();
      }
    });
    return temp.innerHTML;
  }

  getIngredientLabel(type, category) {
    if (!type) return 'Ingrediente';

    // Characters
    if (type === 'character') {
      if (category === 'protagonist') return 'Protagonista';
      if (category === 'antagonist') return 'Antagonista';
      if (category === 'secondary' || category === 'custom') return 'Secundario';
      if (category === 'supporting') return 'Reparto';
      if (category && category !== 'other') return String(category).slice(0, 100);
      return 'Personaje';
    }

    // Books
    if (type === 'book') {
      if (category === 'story-book') return 'Historia';
      if (category === 'screenplay') return 'Guión';
      return 'Libro';
    }

    // Stages (Escenarios)
    if (type === 'stage') {
      if (category === 'interior') return 'Interior';
      if (category === 'exterior') return 'Exterior';
      return 'Escenario';
    }

    // Songs (Música)
    if (type === 'song') {
      if (category === 'soundtrack') return 'Soundtrack';
      if (category === 'song') return 'Canción';
      if (category === 'single') return 'Sencillo';
      if (category === 'album') return 'Álbum';
      return 'Música';
    }

    // Videos/Movies
    if (type === 'video') {
      if (category === 'short-film') return 'Cortometraje';
      if (category === 'feature') return 'Largometraje';
      if (category === 'documentary') return 'Documental';
      if (category === 'music-video') return 'Videoclip';
      if (category === 'animation') return 'Animación';
      return 'Metraje';
    }

    // Default fallbacks based on type
    const typeLabels = {
      character: 'Personaje',
      book: 'Libro',
      stage: 'Escenario',
      song: 'Música',
      video: 'Metraje',
      definition: 'Definición',
    };

    return Object.hasOwn(typeLabels, type) ? typeLabels[type] : 'Ingrediente';
  }

  async autoSyncIngredients() {
    if (!this.isCurrent()) return;
    const originals = this.context.ingredients.filter((ingredient) => ingredient.importedProjectId);
    const ids = [...new Set(originals.map((ingredient) => ingredient.importedProjectId))];
    const results = await Promise.allSettled(
      ids.map(async (id) => {
        const catalogue = await loadIngredientVersions(API, id);
        return [id, catalogue];
      }),
    );
    if (!this.isCurrent()) return;
    let changed = false;
    if (!results.some((result) => result.status === 'fulfilled') && ids.length) {
      Toast.show('No se pudieron comprobar las versiones; se conservaron los ingredientes.', 'warning');
      return;
    }
    for (const result of results) {
      if (result.status === 'rejected') {
        console.warn('No se pudo comprobar la versión del ingrediente; se conserva su ficha.', result.reason);
        continue;
      }
      const [id, catalogue] = result.value;
      this.versionCatalogues.set(id, catalogue);
    }
    // Migrate provenance without changing cached content. Never silently replace an older source.
    for (const ingredient of originals) {
      const catalogue = this.versionCatalogues.get(ingredient.importedProjectId);
      if (!catalogue || ingredient.importedSource || !this.context.ingredients.includes(ingredient)) continue;
      if (!catalogue.versions.length) {
        ingredient.importedSource = 'draft';
        changed = true;
        continue;
      }
      const before = ingredient.value;
      try {
        const latest = await readIngredientVersion(API, catalogue);
        if (!this.isCurrent()) return;
        if (
          !this.context.ingredients.includes(ingredient) ||
          ingredient.value !== before ||
          ingredient.importedSource
        )
          continue;
        if (ingredientContent(ingredient) === (latest.project.content || '')) {
          ingredient.importedSource = 'version';
          ingredient.importedVersionId = latest.versionId;
          ingredient.importedVersionNumber = latest.versionNumber;
          ingredient.importedVersionSavedAt = latest.savedAt;
        } else ingredient.importedSource = 'legacy';
        changed = true;
      } catch (error) {
        console.warn('No se pudo identificar la versión anterior; se conserva el ingrediente.', error);
      }
    }
    if (!this.isCurrent()) return;
    this.renderDrawers();
    if (changed) this.context.emitChange();
    const stale = originals
      .filter(
        (ingredient) =>
          this.context.ingredients.includes(ingredient) &&
          ingredientHasNewVersion(ingredient, this.versionCatalogues.get(ingredient.importedProjectId)),
      )
      .map((ingredient) => ({
        ingredient,
        catalogue: this.versionCatalogues.get(ingredient.importedProjectId),
        before: JSON.stringify(ingredient),
      }));
    if (!stale.length) return;
    try {
      if ((await confirmIngredientUpdates(stale, this.dialogCleanups)) !== true || !this.isCurrent()) return;
      // Read all snapshots first: a failed download must not cause a partial batch update.
      const sources = await Promise.all(stale.map(({ catalogue }) => readIngredientVersion(API, catalogue)));
      if (
        !this.isCurrent() ||
        stale.some(
          ({ ingredient, before }) =>
            !this.context.ingredients.includes(ingredient) || JSON.stringify(ingredient) !== before,
        )
      )
        return;
      stale.forEach(({ ingredient }, index) => this.applySource(ingredient, sources[index]));
      this.commitIngredients();
      Toast.show('Ingredientes actualizados.', 'success');
    } catch (error) {
      if (this.isCurrent()) Toast.show('No se actualizaron los ingredientes: ' + error.message, 'error');
    }
  }

  syncIngredientsFromTags() {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = safeContent(this.context.htmlContent || '');

    // First, remove close buttons from tempDiv so we don't parse "×" as part of the tag text!
    tempDiv.querySelectorAll('.kai-remove-btn').forEach((btn) => btn.remove());

    const tagElements = tempDiv.querySelectorAll('.kai-tag');

    let changed = false;
    tagElements.forEach((el) => {
      let term = el.textContent.trim();
      if (term.endsWith('×')) {
        term = term.slice(0, -1).trim();
      } else if (term.endsWith('x') && term.length > 1 && !el.dataset.tag?.endsWith('x')) {
        term = term.slice(0, -1).trim();
      }

      const definition = el.dataset.definition || el.title || '';
      if (!term) return;

      // Ignore character tags or mentions
      if (el.classList.contains('kai-character-tag') || definition.startsWith('character:')) {
        return;
      }

      const existing = this.context.ingredients.find((ing) => {
        if (ing.type === 'definition') {
          try {
            const data = JSON.parse(ing.value);
            return data.term.toLowerCase() === term.toLowerCase();
          } catch (e) {}
        }
        return false;
      });

      if (!existing) {
        const colors = this.generateUniqueGradient();
        this.context.ingredients.push({
          type: 'definition',
          label: 'Definición',
          icon: 'tag',
          value: JSON.stringify({ term, definition }),
          active: true,
          color1: colors.color1,
          color2: colors.color2,
        });
        changed = true;
      } else {
        try {
          const data = JSON.parse(existing.value);
          if (data.definition !== definition) {
            existing.value = JSON.stringify({ term, definition });
            changed = true;
          }
        } catch (e) {}
      }
    });

    // Clean up any existing definition ingredients that are character tags
    this.context.ingredients = this.context.ingredients.filter((ing) => {
      if (ing.type === 'definition') {
        try {
          const data = JSON.parse(ing.value);
          if (data.definition.startsWith('character:') || data.term.startsWith('@')) {
            changed = true;
            return false;
          }
        } catch (e) {
          changed = true;
          return false;
        }
      }
      return true;
    });

    if (changed) {
      AppState.currentProject.ingredients = this.context.ingredients;
      this.renderDrawers();
      this.context.emitChange();
    }
  }

  async importIngredient({ id, name, type, deferToast = false }) {
    if (this.context.canEdit?.() === false) {
      Toast.show('Espera a que termine el trabajo del personaje.', 'warning');
      return false;
    }
    if (!id) throw new Error('Falta el identificador del proyecto que se quiere vincular.');
    if (!this.isCurrent()) return false;
    if (this.context.ingredients.some((ingredient) => ingredient.importedProjectId === id)) return true;
    if (this.pendingImports.has(id)) return false;
    this.pendingImports.add(id);
    try {
      const catalogue = await loadIngredientVersions(API, id);
      if (!this.isCurrent()) return false;
      const selected = await chooseIngredientVersion(catalogue, this.dialogCleanups);
      if (selected === null || !this.isCurrent()) return false;
      const source = await readIngredientVersion(API, catalogue, selected === 'draft' ? null : selected);
      if (
        !this.isCurrent() ||
        this.context.ingredients.some((ingredient) => ingredient.importedProjectId === id)
      )
        return false;
      const ingredient = {
        type: source.project.type || type,
        label: '',
        icon: source.project.type || type,
        value: '',
        active: true,
        ...this.generateUniqueGradient(),
      };
      this.applySource(ingredient, source);
      this.versionCatalogues.set(id, catalogue);
      this.context.ingredients.push(ingredient);
      this.commitIngredients();
      if (!deferToast)
        Toast.show('Ingrediente «' + (name || source.project.name) + '» vinculado.', 'success');
      return true;
    } catch (error) {
      if (this.isCurrent()) Toast.show('Error al vincular ingrediente: ' + error.message, 'error');
      throw error;
    } finally {
      this.pendingImports.delete(id);
    }
  }

  showTagDefinitionModal(term, callback, initialDefinition = null) {
    const isEditing = initialDefinition !== null;
    const overlay = document.createElement('div');
    overlay.className = isEditing
      ? 'modal-overlay ingredient-definition-edit-overlay editor-definition-modal-overlay'
      : 'modal-overlay editor-definition-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    const content = document.createElement('div');
    content.className = 'modal-content glass-heavy editor-modal editor-modal--definition';

    content.innerHTML = safeHTML(`
      <div class="editor-modal__title">
        <span>${renderIcon('tag')}</span> ${isEditing ? 'Editar definición' : 'Definir término'}: "${escapeHTML(term)}"
      </div>
      <p class="editor-modal__description">
        Define o explica este término para que la IA comprenda su significado exacto cuando analice el contexto de la historia.
      </p>
      <div>
        <textarea id="tag-modal-def" class="input editor-modal__textarea" placeholder="Ej: Nombre propio de un desierto ficticio con tormentas de vidrio..."></textarea>
      </div>
      <div class="editor-modal__actions">
        <button id="tag-modal-cancel" class="btn btn-ghost editor-modal__button">Cancelar</button>
        <button id="tag-modal-save" class="btn btn-primary editor-modal__button editor-modal__button--save">${isEditing ? 'Guardar cambios' : 'Guardar Definición'}</button>
      </div>
    `);

    overlay.appendChild(content);
    document.body.appendChild(overlay);

    const textarea = overlay.querySelector('#tag-modal-def');
    if (isEditing) textarea.value = initialDefinition;
    let releaseFocus = () => {};

    const cleanup = () => {
      this.dialogCleanups.delete(cleanup);
      overlay.remove();
      releaseFocus();
    };

    this.dialogCleanups.add(cleanup);
    overlay.querySelector('#tag-modal-cancel').addEventListener('click', () => {
      cleanup();
      callback(null);
    });

    overlay.querySelector('#tag-modal-save').addEventListener('click', () => {
      const definition = textarea.value.trim();
      cleanup();
      callback(definition);
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        cleanup();
        callback(null);
      }
    });

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        overlay.querySelector('#tag-modal-save').click();
      }
    });
    releaseFocus = trapCoverFocus(overlay, () => overlay.querySelector('#tag-modal-cancel').click());
  }

  createEmptyDrawer() {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'ingredient-drawer empty glass';
    el.setAttribute('aria-label', 'Añadir ingrediente');
    el.innerHTML = safeHTML(`
      <span class="ingredient-drawer__empty-icon">${renderIcon('download')}</span>
      <span class="ingredient-drawer__empty-label">Arrastrar ingrediente aquí</span>
    `);
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      EventBus.emit('workspace:panel:open', 'ingredients');
    });

    // Highlight on dragover / dragenter
    el.addEventListener('dragenter', (e) => {
      e.preventDefault();
      el.classList.add('is-drop-target');
    });

    el.addEventListener('dragover', (e) => {
      e.preventDefault();
    });

    el.addEventListener('dragleave', () => {
      el.classList.remove('is-drop-target');
    });

    el.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation(); // prevent canvas drop handler
      el.classList.remove('is-drop-target');

      let data;
      try {
        const raw = e.dataTransfer.getData('application/json');
        data = raw ? JSON.parse(raw) : null;
      } catch {
        return;
      }

      this.addIngredient(data);
    });

    return el;
  }

  /** Click and drop share the catalogue validation, definition dialog and autosave path. */
  addIngredient(data, restoreFocus = false) {
    if (this.context.canEdit?.() === false) {
      Toast.show('Espera a que termine el trabajo del personaje.', 'warning');
      return false;
    }
    const projectId = this.context.projectId;
    const isCurrent = () => this.drawersContainer?.isConnected && AppState.currentProject?.id === projectId;
    if (!isCurrent()) return;
    const type = data?.ingredientType || data?.type;
    const item = AppState.moduleConfig?.ingredients?.find((ingredient) => ingredient.type === type);
    if (!item) {
      Toast.show('Selecciona un ingrediente disponible en el menú lateral', 'warning');
      return;
    }
    const commit = (ingredient) => {
      if (!isCurrent()) return;
      this.context.ingredients.push(ingredient);
      AppState.currentProject.ingredients = this.context.ingredients;
      this.renderDrawers();
      this.context.emitChange();
      if (restoreFocus) {
        const drop = this.drawersContainer.querySelector('.ingredient-drawer.empty');
        const target = drop?.closest('.is-video-board-hidden, [hidden], [inert]')
          ? this.drawersContainer.closest('.workspace')?.querySelector('[data-section="ingredients"]')
          : drop;
        target?.focus();
      }
    };
    if (type === 'definition') {
      this.showNewDefinitionIngredientModal((res) => {
        if (!res || !isCurrent()) return;
        commit({
          type,
          label: res.term,
          icon: 'tag',
          value: JSON.stringify(res),
          active: true,
          ...this.generateUniqueGradient(),
        });
      });
    } else {
      commit({
        type,
        label: item.label || item.name || 'Ingrediente',
        icon: item.icon || 'ingredients',
        value: '',
        active: true,
        ...(type === 'character' ? this.generateUniqueGradient() : {}),
      });
    }
  }

  createOccupiedDrawer(ing, index) {
    const el = document.createElement('div');
    el.className = `ingredient-drawer occupied glass ${ing.active ? 'active' : 'inactive'}`;

    // Helper to add color pickers to character and definition cards
    const addColorPickers = (containerNode) => {
      const colorRow = document.createElement('div');
      colorRow.className = 'ingredient-card__colors';

      const label = document.createElement('span');
      label.className = 'ingredient-card__color-label';
      label.textContent = 'Resaltado';
      colorRow.appendChild(label);

      for (const [key, fallback, caption, property] of [
        ['color1', '#6366f1', 'Color inicial', '--ingredient-color-1'],
        ['color2', '#a855f7', 'Color final', '--ingredient-color-2'],
      ]) {
        const control = createColorControl(ing[key] || fallback, caption, (color) => {
          ing[key] = color;
          el.style.setProperty(property, color);
          if (AppState.currentProject) AppState.currentProject.ingredients = this.context.ingredients;
          this.context.emitChange();
        });
        this.cardCleanups.push(control.destroy);
        colorRow.append(control.element);
      }
      containerNode.appendChild(colorRow);
    };

    // Header: Icon + Label + Close Button
    const header = document.createElement('div');
    header.className = 'ingredient-card__header';

    const titleContainer = document.createElement('div');
    titleContainer.className = 'ingredient-card__category';
    titleContainer.innerHTML = safeHTML(
      `<span class="ingredient-card__icon">${renderIcon(ing.icon || ing.type)}</span> <span>${escapeHTML(ing.label)}</span>`,
    );
    header.appendChild(titleContainer);

    // Delete Button (x)
    const deleteBtn = document.createElement('button');
    deleteBtn.innerHTML = safeHTML(renderIcon('close'));
    deleteBtn.title = 'Eliminar ingrediente';
    deleteBtn.className = 'ingredient-card__remove';
    deleteBtn.addEventListener('click', () => {
      const displayName = el
        .querySelector('.ingredient-card__name, .ingredient-card__term')
        ?.textContent?.trim();
      Alert.confirm({
        title: 'Eliminar ingrediente',
        message: `¿Eliminar ${displayName ? `«${displayName}»` : 'este ingrediente'}? Se quitarán este elemento y sus etiquetas vinculadas al proyecto.`,
        confirmLabel: 'Eliminar',
        cancelLabel: 'Cancelar',
        type: 'danger',
        onConfirm: () => {
          this.context.removeTagsForIngredient(ing);
          this.context.ingredients.splice(index, 1);
          AppState.currentProject.ingredients = this.context.ingredients;
          this.renderDrawers();
          this.context.emitChange();
        },
      });
    });
    header.appendChild(deleteBtn);
    el.appendChild(header);

    // If it's a character, backstory or book ingredient, we want to support importing existing projects
    const linkedType = ing.type === 'backstory' ? 'book' : ing.type;
    if (['character', 'book', 'stage', 'song', 'video'].includes(linkedType)) {
      const isChar = linkedType === 'character';
      const projectLabel = {
        character: 'personaje',
        book: 'libro',
        stage: 'escenario',
        song: 'proyecto musical',
        video: 'metraje',
      }[linkedType];
      const importContainer = document.createElement('div');
      importContainer.className = `${ing.type}-drawer-container`;

      // Extract background image URL if any
      let bgUrl = null;
      let hasFacePreview = true;
      if (isChar) {
        try {
          const charData = JSON.parse(ing.value || '{}');
          const sheet = parseCharacterDocument(charData.content || '');
          if (sheet) hasFacePreview = sheet.identity.base === 'humanoid';
          if (charData.covers && charData.covers.length > 0) {
            const idx =
              typeof charData.currentCoverIndex === 'number'
                ? charData.currentCoverIndex
                : charData.covers.length - 1;
            bgUrl = charData.covers[idx] || charData.covers[charData.covers.length - 1];
          }
        } catch (e) {}
        if (!bgUrl && ing.covers && ing.covers.length > 0) {
          const idx =
            typeof ing.currentCoverIndex === 'number' ? ing.currentCoverIndex : ing.covers.length - 1;
          bgUrl = ing.covers[idx] || ing.covers[ing.covers.length - 1];
        }
      } else {
        if (ing.covers && ing.covers.length > 0) {
          const idx =
            typeof ing.currentCoverIndex === 'number' ? ing.currentCoverIndex : ing.covers.length - 1;
          bgUrl = ing.covers[idx] || ing.covers[ing.covers.length - 1];
        }
      }

      importContainer.classList.add('ingredient-card__import');
      if (bgUrl && ing.importedProjectId) {
        const portrait = document.createElement('img');
        portrait.className = 'ingredient-card__portrait';
        portrait.src = isChar && hasFacePreview ? faceImageUrl(bgUrl) : bgUrl;
        portrait.alt = ing.importedProjectName || this.getIngredientLabel(linkedType);
        portrait.loading = 'lazy';
        portrait.addEventListener(
          'error',
          () => {
            if (isChar && portrait.dataset.portraitKind === 'face') {
              portrait.dataset.portraitKind = 'subject';
              portrait.src = bgUrl;
              portrait.addEventListener('error', () => portrait.remove(), { once: true });
            } else portrait.remove();
          },
          { once: true },
        );
        if (isChar) portrait.dataset.portraitKind = hasFacePreview ? 'face' : 'subject';
        importContainer.appendChild(portrait);
      }

      // Imported projects are synchronized once during editor initialization
      // and again only when the user presses the card's sync button. Fetching
      // from inside this renderer caused an endless request -> re-render loop
      // for characters that do not yet have a portrait, repeatedly replacing
      // the card DOM and preventing its flip animation from settling.

      if (!ing.importedProjectId) {
        // Search & select mode
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.className = 'input';
        searchInput.placeholder = `Buscar ${projectLabel}...`;
        searchInput.setAttribute('aria-label', `Buscar ${projectLabel}`);
        searchInput.classList.add('ingredient-import-search');
        importContainer.appendChild(searchInput);

        const resultsList = document.createElement('div');
        resultsList.className = 'ingredient-import-results';
        importContainer.appendChild(resultsList);

        let projects = [];
        const performSearch = async () => {
          if (projects.length === 0) {
            try {
              const res = await API.getProjects();
              const currentId = this.context.projectId;
              projects = (res.projects || []).filter((p) => p.type === linkedType && p.id !== currentId);
            } catch (err) {
              console.error(`Error fetching ${ing.type} projects:`, err);
            }
          }

          const query = searchInput.value.toLowerCase().trim();
          const matches = projects.filter((p) => p.name.toLowerCase().includes(query));

          resultsList.innerHTML = safeHTML('');
          if (matches.length > 0) {
            resultsList.classList.add('is-open');
            matches.forEach((p) => {
              const btn = document.createElement('button');
              btn.className = 'btn-ghost ingredient-import-result';
              btn.innerHTML = safeHTML(
                isChar
                  ? `${renderIcon('character')} ${escapeHTML(p.name)}`
                  : `${renderIcon(linkedType)} ${escapeHTML(p.name)}`,
              );
              btn.addEventListener('click', async () => {
                if (btn.disabled) return;
                btn.disabled = true;
                try {
                  await this.bindVersion(ing, p.id, null, true);
                } catch (error) {
                  if (this.isCurrent())
                    Toast.show('No se pudo vincular el ingrediente: ' + error.message, 'error');
                } finally {
                  if (btn.isConnected) btn.disabled = false;
                }
              });
              resultsList.appendChild(btn);
            });
          } else {
            resultsList.classList.add('is-open');
            const emptyMsg = document.createElement('div');
            emptyMsg.className = 'ingredient-import-empty';
            emptyMsg.textContent = query ? 'Sin resultados' : 'Escribe para buscar...';
            resultsList.appendChild(emptyMsg);
          }
        };

        searchInput.addEventListener('input', performSearch);
        searchInput.addEventListener('focus', performSearch);
      } else {
        // Selected mode: show card and sync button
        const card = document.createElement('div');
        card.className = `${ing.type}-import-card`;

        card.classList.add('ingredient-card__body');

        const nameRow = document.createElement('div');
        nameRow.className = 'ingredient-card__name-row';

        const titleSpan = document.createElement('span');
        titleSpan.className = 'ingredient-card__name';

        if (isChar) {
          let charData = {};
          try {
            charData = JSON.parse(ing.value || '{}');
          } catch (e) {}
          titleSpan.textContent = charData.name || ing.importedProjectName || 'Personaje sin nombre';
        } else {
          titleSpan.textContent =
            ing.importedProjectName || `${this.getIngredientLabel(linkedType)} sin nombre`;
        }
        nameRow.appendChild(titleSpan);

        const syncBtn = document.createElement('button');
        syncBtn.innerHTML = safeHTML(renderIcon('refresh'));
        syncBtn.title = 'Consultar versiones guardadas';
        syncBtn.className = 'ingredient-card__sync';
        syncBtn.addEventListener('click', async () => {
          syncBtn.disabled = true;
          try {
            await this.bindVersion(ing, ing.importedProjectId, null, true);
          } catch (error) {
            if (this.isCurrent())
              Toast.show('No se pudo actualizar el ingrediente: ' + error.message, 'error');
          } finally {
            if (syncBtn.isConnected) syncBtn.disabled = false;
          }
        });
        nameRow.appendChild(syncBtn);
        card.appendChild(nameRow);
        card.appendChild(this.createVersionSelector(ing));

        const details = document.createElement('div');
        details.className = 'ingredient-card__details';

        if (isChar) {
          let charData = {};
          try {
            charData = JSON.parse(ing.value || '{}');
          } catch (e) {}
          const sheet = parseCharacterDocument(charData.content || '');
          const description = sheet
            ? characterDescription(sheet)
            : charData.description || charData.traits?.lore || charData.traits?.psychology || '';
          const text = document.createElement('p');
          text.className = 'ingredient-card__description';
          text.textContent = description || 'Sin descripción todavía.';
          details.appendChild(text);
        } else {
          const plainText = ingredientPreviewText(ing);
          const previewText =
            plainText.length > 80
              ? plainText.substring(0, 80) + '...'
              : plainText || 'Sin descripción todavía.';
          details.innerHTML = safeHTML(
            `<div class="ingredient-card__quote">"${escapeHTML(previewText)}"</div>`,
          );
        }
        card.appendChild(details);

        if (isChar) {
          addColorPickers(card);
        }

        const unlinkBtn = document.createElement('button');
        unlinkBtn.textContent = `Cambiar ${projectLabel}`;
        unlinkBtn.className = 'ingredient-card__change';
        unlinkBtn.addEventListener('click', () => {
          for (const key of [
            'importedProjectId',
            'importedProjectName',
            'importedSource',
            'importedVersionId',
            'importedVersionNumber',
            'importedVersionSavedAt',
            'lastAdaptedVersionId',
            'lastAdaptedVersionNumber',
            'lastAdaptedContent',
          ])
            delete ing[key];
          ing.value = '';
          AppState.currentProject.ingredients = this.context.ingredients;
          this.renderDrawers();
          this.context.emitChange();
        });
        card.appendChild(unlinkBtn);

        importContainer.appendChild(card);
      }
      el.appendChild(importContainer);
    } else if (ing.type === 'definition') {
      const defContainer = document.createElement('div');
      defContainer.className = 'definition-drawer-container ingredient-card__body';

      let defData = { term: ing.label || 'Término', definition: '' };
      try {
        if (ing.value && ing.value.trim().startsWith('{')) {
          defData = JSON.parse(ing.value);
        } else {
          defData = { term: ing.label.replace(/^Def:\s*/, ''), definition: ing.value };
        }
      } catch (e) {
        defData = { term: ing.label.replace(/^Def:\s*/, ''), definition: ing.value };
      }

      const termTitle = document.createElement('div');
      termTitle.className = 'ingredient-card__term';
      termTitle.textContent = defData.term;
      defContainer.appendChild(termTitle);

      addColorPickers(defContainer);

      const definitionPreview = document.createElement('button');
      definitionPreview.type = 'button';
      definitionPreview.className = 'ingredient-card__definition-preview';
      definitionPreview.textContent = defData.definition || 'Haz clic para añadir una definición';
      definitionPreview.title = 'Editar definición';
      definitionPreview.setAttribute('aria-label', `Editar definición de ${defData.term}`);
      const editDefinition = () => {
        if (document.querySelector('.ingredient-definition-edit-overlay')) return;
        this.showTagDefinitionModal(
          defData.term,
          (definition) => {
            if (definition !== null) {
              const newVal = JSON.stringify({ term: defData.term, definition });
              this.context.ingredients[index].value = newVal;
              AppState.currentProject.ingredients = this.context.ingredients;
              definitionPreview.textContent = definition || 'Haz clic para añadir una definición';
              this.context.emitChange();
              this.updateTagDefinition(defData.term, definition);
            }
            definitionPreview.focus({ preventScroll: true });
          },
          defData.definition || '',
        );
      };
      definitionPreview.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        editDefinition();
      });
      defContainer.appendChild(definitionPreview);
      el.appendChild(defContainer);
    } else {
      const textarea = document.createElement('textarea');
      textarea.className = 'input ingredient-card__textarea';
      textarea.placeholder = `Escribe el contenido de ${ing.label.toLowerCase()}...`;
      textarea.value = ing.value || '';
      textarea.addEventListener('input', () => {
        this.context.ingredients[index].value = textarea.value;
        AppState.currentProject.ingredients = this.context.ingredients;
        this.context.emitChange();
      });
      el.appendChild(textarea);
    }

    if (ing.importedProjectId && !el.querySelector('.ingredient-card__version'))
      el.appendChild(this.createVersionSelector(ing));

    // Footer: Toggle Switch for Active/Inactive
    const footer = document.createElement('div');
    footer.className = 'ingredient-card__footer';

    const toggleLabel = document.createElement('span');
    toggleLabel.className = 'ingredient-card__status';
    toggleLabel.textContent = ing.active ? 'Activo' : 'Desactivado';
    footer.appendChild(toggleLabel);

    // Checkbox or toggle container
    const toggleContainer = document.createElement('label');
    toggleContainer.className = 'ingredient-card__switch';
    toggleContainer.classList.add('editor-toggle-container');

    const toggleInput = document.createElement('input');
    toggleInput.type = 'checkbox';
    toggleInput.checked = ing.active;
    toggleInput.setAttribute('aria-label', `Activar ${ing.label}`);
    toggleInput.setAttribute('role', 'switch');
    toggleInput.addEventListener('change', () => {
      const active = toggleInput.checked;
      this.context.ingredients[index].active = active;
      AppState.currentProject.ingredients = this.context.ingredients;

      // Update styling dynamically
      if (active) {
        el.classList.remove('inactive');
        el.classList.add('active');
        toggleLabel.textContent = 'Activo';
      } else {
        el.classList.remove('active');
        el.classList.add('inactive');
        toggleLabel.textContent = 'Desactivado';
      }

      this.context.emitChange();
    });

    toggleContainer.appendChild(toggleInput);
    footer.appendChild(toggleContainer);
    el.appendChild(footer);

    this.cardCleanups.push(mountIngredientCard(el, ing));
    return el;
  }

  showNewDefinitionIngredientModal(callback) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay editor-definition-modal-overlay';

    const content = document.createElement('div');
    content.className = 'modal-content glass-heavy editor-modal editor-modal--definition';

    content.innerHTML = safeHTML(`
      <div class="editor-modal__title">
        <span>${renderIcon('tag')}</span> Nueva Definición de Tag
      </div>
      <p class="editor-modal__description">
        Escribe la palabra (término) que se etiquetará automáticamente en el texto y su definición/explicación para la IA.
      </p>
      <div class="editor-modal__fields">
        <div>
          <label class="label editor-modal__label">Palabra / Término a etiquetar</label>
          <input type="text" id="new-tag-modal-term" class="input editor-modal__input" placeholder="Ej: Espejismo, Leonardo..." />
        </div>
        <div>
          <label class="label editor-modal__label">Definición / Explicación para la IA</label>
          <textarea id="new-tag-modal-def" class="input editor-modal__textarea" placeholder="Ej: Fenómeno óptico común en el desierto..."></textarea>
        </div>
      </div>
      <div class="editor-modal__actions">
        <button id="new-tag-modal-cancel" class="btn btn-ghost editor-modal__button">Cancelar</button>
        <button id="new-tag-modal-save" class="btn btn-primary editor-modal__button editor-modal__button--save">Crear Ingrediente</button>
      </div>
    `);

    overlay.appendChild(content);
    document.body.appendChild(overlay);

    const termInput = overlay.querySelector('#new-tag-modal-term');
    const textarea = overlay.querySelector('#new-tag-modal-def');
    let releaseFocus = () => {};

    const cleanup = () => {
      this.dialogCleanups.delete(cleanup);
      overlay.remove();
      releaseFocus();
    };

    this.dialogCleanups.add(cleanup);
    overlay.querySelector('#new-tag-modal-cancel').addEventListener('click', () => {
      cleanup();
      callback(null);
    });

    overlay.querySelector('#new-tag-modal-save').addEventListener('click', () => {
      const term = termInput.value.trim();
      const definition = textarea.value.trim();
      if (!term || !definition) {
        Toast.show('Por favor, introduce tanto el término como la definición', 'warning');
        return;
      }
      cleanup();
      callback({ term, definition });
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        cleanup();
        callback(null);
      }
    });

    releaseFocus = trapCoverFocus(overlay, () => overlay.querySelector('#new-tag-modal-cancel').click());
    termInput.focus();
  }
}
