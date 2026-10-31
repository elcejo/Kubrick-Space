import { renderIcon } from './icons.js';
import { safeHTML } from './safe-html.js';
/**
 * @file wizard.js — Wizard Flow for Kubrick Space
 * @description Bubble-based project creation wizard with smooth animated transitions.
 * @module wizard
 */

import { getAllModules } from './modules/workspaces/project-module-registry.js';
import { API } from './api-service.js';
import { Toast, Loader } from './ui-components.js';
import { Router } from './router.js';

/** A subcategory flagged comingSoon cannot be created yet; a module is blocked when all its subcategories are. */
const isAvailable = (subcategory) => subcategory.comingSoon !== true;
const moduleAvailable = (module) => module.subcategories.some(isAvailable);
const COMING_SOON = 'Próximamente';

/** Marks a bubble as not selectable: dimmed, announced as disabled and labelled "Próximamente". */
function markComingSoon(bubble) {
  bubble.classList.add('is-coming-soon');
  const badge = document.createElement('span');
  badge.className = 'wizard-bubble-soon';
  badge.textContent = COMING_SOON;
  bubble.append(badge);
}

export class Wizard {
  /** @type {HTMLElement|null} */
  _container = null;
  /** @type {HTMLElement|null} */
  _root = null;
  /** @type {number} */
  _step = 1;
  /** @type {Object|null} Selected module definition */
  _selectedModule = null;
  /** @type {Object|null} Selected subcategory */
  _selectedCategory = null;
  /** @type {Array<Object>} List of loaded modules */
  _modules = [];
  /** @type {Function|null} Window resize handler */
  _onResize = null;

  /**
   * Mount the wizard into a parent container.
   * @param {HTMLElement} container
   * @returns {void}
   */
  async mount(container, isCurrent = () => true) {
    this._isCurrent = isCurrent;
    this._container = container;
    this._root = container.querySelector('.wizard-overlay');
    if (!this._root) {
      console.error('[Wizard] .wizard-overlay not found in container');
      return;
    }
    const backBtn = this._root.querySelector('#wizard-back');
    if (backBtn) {
      backBtn.addEventListener('click', () => this._goBack());
    }
    const closeBtn = this._root.querySelector('#wizard-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => Router.navigate('#/'));
    }

    // Setup window resize listener
    this._onResize = () => this.updatePositions();
    window.addEventListener('resize', this._onResize);

    // Load modules
    try {
      this._modules = await getAllModules();
      if (!this._isCurrent()) return;
      this._buildBubblesDOM();
      this._renderStep(1);
    } catch (err) {
      console.error('[Wizard] Failed to load modules:', err);
    }
  }

  /**
   * Cleanup when navigating away from the wizard.
   */
  unmount() {
    this._isCurrent = () => false;
    if (this._onResize) {
      window.removeEventListener('resize', this._onResize);
      this._onResize = null;
    }
    if (this._root) {
      this._root.remove();
      this._root = null;
    }
    this._container = null;
    this._selectedModule = null;
    this._selectedCategory = null;
    this._step = 1;
  }

  /* ─── Navigation ──────────────────────────── */

  /**
   * Navigate back one step.
   * @private
   */
  _goBack() {
    if (this._step <= 1) return;
    this._step--;
    this._renderStep(this._step);
  }

  /**
   * Advance to the next step.
   * @private
   */
  _goForward() {
    if (this._step >= 3) return;
    this._step++;
    this._renderStep(this._step);
  }

  /* ─── Step rendering ──────────────────────── */

  /**
   * Render a specific step with animated transitions.
   * @param {number} step — 1, 2, or 3
   * @private
   */
  _renderStep(step) {
    const moveChoiceFocus =
      this._root.contains(document.activeElement) && document.activeElement.closest('.wizard-bubble-node');
    this._step = step;
    this._updateDots(step);

    const backBtn = this._root.querySelector('#wizard-back');
    if (backBtn) {
      backBtn.classList.toggle('is-visible', step > 1);
      backBtn.tabIndex = step > 1 ? 0 : -1;
      backBtn.setAttribute('aria-hidden', String(step <= 1));
    }

    const textStage = this._root.querySelector('#wizard-text-stage');
    const canvasContainer = this._root.querySelector('#wizard-canvas-container');
    const formStage = this._root.querySelector('#wizard-form-stage');

    if (step === 1) {
      textStage.innerHTML = safeHTML(`
        <h2 class="wizard-step-title animate-fadeIn">¿Qué deseas crear?</h2>
        <p class="wizard-step-description animate-fadeIn">Elige una categoría inicial para comenzar a dar vida a tus ideas con inteligencia artificial</p>
      `);
      if (canvasContainer) {
        this._showCanvas(canvasContainer);
      }
      if (formStage) {
        formStage.classList.remove('is-active');
        formStage.innerHTML = safeHTML('');
      }
      this.updatePositions();
    } else if (step === 2) {
      const mod = this._selectedModule;
      textStage.innerHTML = safeHTML(`
        <h2 class="wizard-step-title animate-fadeIn">Elige una categoría de <em>${mod.label}</em></h2>
        <p class="wizard-step-description animate-fadeIn">Personaliza el formato y estilo de tu nueva creación literaria o visual</p>
      `);
      if (canvasContainer) {
        this._showCanvas(canvasContainer);
      }
      if (formStage) {
        formStage.classList.remove('is-active');
        formStage.innerHTML = safeHTML('');
      }
      this.updatePositions();
    } else if (step === 3) {
      const mod = this._selectedModule;
      const cat = this._selectedCategory;
      const defaultName = mod.type === 'character' ? '' : `${mod?.label ?? ''} — ${cat?.label ?? ''}`;

      textStage.innerHTML = safeHTML(`
        <h2 class="wizard-step-title animate-fadeIn">Nombra tu proyecto</h2>
        <p class="wizard-step-description animate-fadeIn">Asigna un título identificador a tu espacio de trabajo creativo</p>
      `);

      if (canvasContainer) {
        canvasContainer.classList.remove('is-visible');
        setTimeout(() => {
          if (this._step === 3 && canvasContainer) {
            canvasContainer.classList.remove('is-rendered');
          }
        }, 500);
      }

      if (formStage) {
        formStage.classList.add('is-active');
        formStage.innerHTML = safeHTML(`
          <div class="wizard-form animate-scaleIn">
            <label class="input-label" for="wizard-name">
              ${mod.type === 'character' ? 'Nombre del personaje' : 'Nombre del proyecto'}
              <input
                type="text"
                id="wizard-name"
                class="input"
                value="${defaultName}"
                placeholder="${mod.type === 'character' ? 'Escribe su nombre' : 'Nombre del proyecto'}"
                maxlength="120"
                autofocus
              />
            </label>
            <button class="wizard-create-btn btn btn-primary btn-lg" id="wizard-create">
              Crear Proyecto
            </button>
          </div>
        `);

        const nameInput = formStage.querySelector('#wizard-name');
        const createBtn = formStage.querySelector('#wizard-create');

        nameInput.focus();

        nameInput.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' && !event.isComposing) {
            event.preventDefault();
            createBtn.click();
          }
        });
        createBtn.addEventListener('click', async () => {
          if (createBtn.disabled) return;
          const name = nameInput.value.trim();
          if (!name) {
            Toast.show('El nombre del proyecto es obligatorio', 'warning');
            nameInput.focus();
            return;
          }

          createBtn.disabled = true;
          createBtn.textContent = 'Creando…';
          Loader.show();

          try {
            const project = await API.createProject({
              name,
              type: mod.type,
              category: cat.id,
            });

            Toast.show('¡Proyecto creado!', 'success');
            if (this._isCurrent()) Router.navigate(`#/workspace/${project.id}`);
          } catch (err) {
            console.error('[Wizard] Project creation failed:', err);
            Toast.show('Error al crear el proyecto: ' + err.message, 'error');
            createBtn.disabled = false;
            createBtn.textContent = 'Crear Proyecto';
          } finally {
            Loader.hide();
          }
        });
      }
    }
    this._syncChoiceAccessibility();
    if (moveChoiceFocus && step < 3) {
      this._root.querySelector('.wizard-bubble-node[tabindex="0"]')?.focus({ preventScroll: true });
    }
  }

  _syncChoiceAccessibility() {
    this._root.querySelectorAll('.wizard-bubble-node').forEach((bubble) => {
      const category = bubble.classList.contains('wizard-bubble-category');
      const currentModule = bubble.dataset.moduleType === this._selectedModule?.type;
      const visible = this._step === 1 ? category : this._step === 2 && currentModule;
      const selectable = visible && (this._step === 1 || !category);
      bubble.tabIndex = selectable ? 0 : -1;
      bubble.setAttribute('aria-hidden', String(!visible));
      // A blocked option stays reachable by keyboard so its "Próximamente" label is announced, but it is disabled.
      bubble.setAttribute(
        'aria-disabled',
        String(!selectable || bubble.classList.contains('is-coming-soon')),
      );
    });
  }

  /**
   * Update step indicator dots.
   * @param {number} activeStep
   * @private
   */
  _updateDots(activeStep) {
    const dots = this._root.querySelectorAll('#wizard-dots .wizard-step-dot');
    dots.forEach((dot, i) => {
      dot.classList.toggle('active', i < activeStep);
      dot.classList.toggle('completed', i < activeStep - 1);
    });
  }

  _showCanvas(canvas) {
    canvas.classList.add('is-rendered');
    requestAnimationFrame(() => {
      if (this._step !== 3 && canvas.isConnected) canvas.classList.add('is-visible');
    });
  }

  _showBubble(bubble) {
    const token = Number(bubble.dataset.visibilityToken || 0) + 1;
    bubble.dataset.visibilityToken = String(token);
    bubble.classList.add('is-rendered');
    requestAnimationFrame(() => {
      if (Number(bubble.dataset.visibilityToken) === token && bubble.isConnected) {
        bubble.classList.add('is-visible');
        this.updateLines();
      }
    });
  }

  _hideBubble(bubble, step) {
    const token = Number(bubble.dataset.visibilityToken || 0) + 1;
    bubble.dataset.visibilityToken = String(token);
    bubble.classList.remove('is-visible');
    setTimeout(() => {
      if (this._step === step && Number(bubble.dataset.visibilityToken) === token) {
        bubble.classList.remove('is-rendered');
      }
    }, 500);
  }

  /**
   * Pre-render all bubble elements into the DOM (but keep them hidden/opacity 0 initially).
   * @private
   */
  _buildBubblesDOM() {
    const bubblesContainer = this._root.querySelector('#wizard-bubbles');
    if (!bubblesContainer) return;
    bubblesContainer.innerHTML = safeHTML('');

    // 1. Build Category Bubbles
    this._modules.forEach((mod) => {
      const color = this.getCategoryColor(mod.type);
      const categoryIcon = renderIcon(mod.type, 32);

      const div = document.createElement('div');
      div.id = `bubble-cat-${mod.type}`;
      div.className = 'wizard-bubble-node wizard-bubble-category absolute cursor-pointer select-none';
      div.dataset.moduleType = mod.type;
      div.dataset.visibilityToken = '0';
      div.style.setProperty('--wizard-bubble-color', color);

      div.innerHTML = safeHTML(`
        <div class="wizard-bubble-circle">
          <span class="wizard-bubble-icon">${categoryIcon}</span>
        </div>
        <div class="wizard-bubble-label">
          ${mod.label}
        </div>
      `);

      const available = moduleAvailable(mod);
      if (!available) markComingSoon(div);
      this._setupDragAndClick(div, () => {
        if (this._step === 1) {
          if (!available) return void Toast.show(`${mod.label}: ${COMING_SOON.toLowerCase()}.`, 'info');
          this._selectedModule = mod;
          this._goForward();
        }
      });
      if (!available) {
        div.setAttribute('aria-disabled', 'true');
        div.setAttribute('aria-label', `${mod.label}, ${COMING_SOON.toLowerCase()}`);
      }

      bubblesContainer.appendChild(div);
    });

    // 2. Build Subcategory Bubbles
    this._modules.forEach((mod) => {
      mod.subcategories.forEach((sub) => {
        const color = this.getBorderColor(sub.id);
        const div = document.createElement('div');
        div.id = `bubble-sub-${sub.id}`;
        div.dataset.id = sub.id;
        div.dataset.moduleType = mod.type;
        div.className = 'wizard-bubble-node wizard-bubble-sub absolute cursor-pointer select-none';
        div.dataset.visibilityToken = '0';
        div.style.setProperty('--wizard-bubble-color', color);

        div.innerHTML = safeHTML(`
          <div class="wizard-bubble-circle">
            <span class="wizard-bubble-icon">${renderIcon(sub.icon)}</span>
          </div>
          <div class="wizard-bubble-label">
            ${sub.label}
          </div>
        `);

        const available = isAvailable(sub);
        if (!available) markComingSoon(div);
        this._setupDragAndClick(div, () => {
          if (this._step === 2) {
            if (!available) return void Toast.show(`${sub.label}: ${COMING_SOON.toLowerCase()}.`, 'info');
            this._selectedCategory = sub;
            this._goForward();
          }
        });
        if (!available) {
          div.setAttribute('aria-disabled', 'true');
          div.setAttribute('aria-label', `${sub.label}, ${COMING_SOON.toLowerCase()}`);
        }

        bubblesContainer.appendChild(div);
      });
    });
  }

  /**
   * Set up D3 drag behavior and standard click handler on a bubble element.
   * @param {HTMLElement} div
   * @param {Function} onClickCallback
   * @private
   */
  _setupDragAndClick(div, onClickCallback) {
    div.setAttribute('role', 'button');
    div.setAttribute('aria-label', div.querySelector('.wizard-bubble-label').textContent.trim());
    div.tabIndex = -1;
    let isDragging = false;
    let dragStartCoords = { x: 0, y: 0 };

    const dragBehavior = d3
      .drag()
      .on('start', (event) => {
        dragStartCoords = { x: event.x, y: event.y };
        isDragging = false;
        div.classList.add('dragging');
      })
      .on('drag', (event) => {
        // Distinguish drag from micro-movements
        const dx = event.x - dragStartCoords.x;
        const dy = event.y - dragStartCoords.y;
        if (Math.sqrt(dx * dx + dy * dy) > 5) {
          isDragging = true;
        }

        let curX = parseFloat(div.dataset.x) || 0;
        let curY = parseFloat(div.dataset.y) || 0;
        const r = parseFloat(div.dataset.radius) || 45;

        curX += event.dx;
        curY += event.dy;

        div.dataset.x = curX;
        div.dataset.y = curY;

        div.style.left = `${curX - r}px`;
        div.style.top = `${curY - r}px`;

        this.updateLines();
      })
      .on('end', () => {
        div.classList.remove('dragging');
      });

    d3.select(div).call(dragBehavior);

    div.addEventListener('click', (e) => {
      if (isDragging) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      onClickCallback();
    });
    div.addEventListener('keydown', (event) => {
      if (div.tabIndex !== 0 || event.isComposing || event.repeat) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      onClickCallback();
    });
  }

  /**
   * Recalculate pixel coordinates for bubble layouts and redraw connection lines.
   */
  updatePositions() {
    const canvas = this._root.querySelector('#wizard-canvas-container');
    if (!canvas || !canvas.classList.contains('is-rendered')) return;

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    if (this._step === 1) {
      // Hide all subcategories
      const allSubcategoryDivs = this._root.querySelectorAll('.wizard-bubble-sub');
      allSubcategoryDivs.forEach((div) => {
        this._hideBubble(div, 1);
      });

      // Position 5 category bubbles horizontally
      const radius = 50;

      this._modules.forEach((mod, i) => {
        const bubble = this._root.querySelector(`#bubble-cat-${mod.type}`);
        if (!bubble) return;

        const x = (w * (i + 1)) / 6;
        const y = h / 2;

        bubble.dataset.x = x;
        bubble.dataset.y = y;
        bubble.dataset.radius = radius;

        this._showBubble(bubble);
        bubble.style.width = `${radius * 2}px`;
        bubble.style.height = `${radius * 2}px`;
        bubble.style.left = `${x - radius}px`;
        bubble.style.top = `${y - radius}px`;
      });
    } else if (this._step === 2) {
      const parentMod = this._selectedModule;
      if (!parentMod) return;

      const parentRadius = 32;
      const parentX = w / 2;
      const parentY = h * 0.28; // shifted down to avoid header text

      // Position selected parent category bubble at top-center
      const parentBubble = this._root.querySelector(`#bubble-cat-${parentMod.type}`);
      if (parentBubble) {
        parentBubble.dataset.x = parentX;
        parentBubble.dataset.y = parentY;
        parentBubble.dataset.radius = parentRadius;

        this._showBubble(parentBubble); // allow dragging in step 2!
        parentBubble.style.width = `${parentRadius * 2}px`;
        parentBubble.style.height = `${parentRadius * 2}px`;
        parentBubble.style.left = `${parentX - parentRadius}px`;
        parentBubble.style.top = `${parentY - parentRadius}px`;
      }

      // Hide all other category bubbles
      this._modules.forEach((mod) => {
        if (mod.type !== parentMod.type) {
          const bubble = this._root.querySelector(`#bubble-cat-${mod.type}`);
          if (bubble) {
            this._hideBubble(bubble, 2);
          }
        }
      });

      // Position subcategory bubbles horizontally below
      const subs = parentMod.subcategories || [];
      const subRadius = 45;
      const subY = h * 0.72; // shifted up slightly

      subs.forEach((sub, j) => {
        const bubble = this._root.querySelector(`#bubble-sub-${sub.id}`);
        if (!bubble) return;

        const x = (w * (j + 1)) / (subs.length + 1);
        const y = subY;

        bubble.dataset.x = x;
        bubble.dataset.y = y;
        bubble.dataset.radius = subRadius;

        this._showBubble(bubble);
        bubble.style.width = `${subRadius * 2}px`;
        bubble.style.height = `${subRadius * 2}px`;
        bubble.style.left = `${x - subRadius}px`;
        bubble.style.top = `${y - subRadius}px`;
      });

      // Hide subcategories belonging to other modules
      const allSubcategoryDivs = this._root.querySelectorAll('.wizard-bubble-sub');
      allSubcategoryDivs.forEach((div) => {
        const subId = div.dataset.id;
        const isCurrentSub = subs.some((s) => s.id === subId);
        if (!isCurrentSub) {
          this._hideBubble(div, 2);
        }
      });
    }

    // Update lines using datasets
    this.updateLines();
  }

  /**
   * Draw or update the connecting SVG lines based on the bubble DOM element datasets.
   */
  updateLines() {
    const canvas = this._root.querySelector('#wizard-canvas-container');
    if (!canvas || !canvas.classList.contains('is-rendered')) return;

    const svg = d3.select(this._root.querySelector('#wizard-svg'));
    svg.selectAll('*').remove();
    const defs = svg.append('defs');

    if (this._step === 1) {
      const positions = [];

      this._modules.forEach((mod) => {
        const bubble = this._root.querySelector(`#bubble-cat-${mod.type}`);
        if (!bubble || !bubble.classList.contains('is-visible')) return;

        const x = parseFloat(bubble.dataset.x);
        const y = parseFloat(bubble.dataset.y);
        if (isNaN(x) || isNaN(y)) return;

        positions.push({ x, y, color: this.getCategoryColor(mod.type), id: mod.type });
      });

      // Draw lines between adjacent visible category bubbles
      for (let i = 0; i < positions.length - 1; i++) {
        const p1 = positions[i];
        const p2 = positions[i + 1];
        const gradId = `wiz-grad-${p1.id}-${p2.id}`;

        const grad = defs
          .append('linearGradient')
          .attr('id', gradId)
          .attr('gradientUnits', 'userSpaceOnUse')
          .attr('x1', p1.x)
          .attr('y1', p1.y)
          .attr('x2', p2.x)
          .attr('y2', p2.y);

        grad.append('stop').attr('offset', '0%').attr('stop-color', p1.color);
        grad.append('stop').attr('offset', '100%').attr('stop-color', p2.color);

        svg
          .append('line')
          .attr('x1', p1.x)
          .attr('y1', p1.y)
          .attr('x2', p2.x)
          .attr('y2', p2.y)
          .attr('stroke', `url(#${gradId})`)
          .attr('stroke-width', 2.5)
          .attr('stroke-opacity', 0.6);
      }
    } else if (this._step === 2) {
      const parentMod = this._selectedModule;
      if (!parentMod) return;

      const parentBubble = this._root.querySelector(`#bubble-cat-${parentMod.type}`);
      if (!parentBubble) return;

      const parentX = parseFloat(parentBubble.dataset.x);
      const parentY = parseFloat(parentBubble.dataset.y);
      const parentColor = this.getCategoryColor(parentMod.type);

      if (isNaN(parentX) || isNaN(parentY)) return;

      const subs = parentMod.subcategories || [];
      const subPositions = [];

      subs.forEach((sub) => {
        const bubble = this._root.querySelector(`#bubble-sub-${sub.id}`);
        if (!bubble || !bubble.classList.contains('is-visible')) return;

        const x = parseFloat(bubble.dataset.x);
        const y = parseFloat(bubble.dataset.y);
        if (isNaN(x) || isNaN(y)) return;

        const color = this.getBorderColor(sub.id);
        subPositions.push({ x, y, color, id: sub.id });
      });

      // Draw lines:
      // a) Connecting adjacent subcategories in a chain
      for (let j = 0; j < subPositions.length - 1; j++) {
        const p1 = subPositions[j];
        const p2 = subPositions[j + 1];
        const gradId = `wiz-grad-sub-${p1.id}-${p2.id}`;

        const grad = defs
          .append('linearGradient')
          .attr('id', gradId)
          .attr('gradientUnits', 'userSpaceOnUse')
          .attr('x1', p1.x)
          .attr('y1', p1.y)
          .attr('x2', p2.x)
          .attr('y2', p2.y);

        grad.append('stop').attr('offset', '0%').attr('stop-color', p1.color);
        grad.append('stop').attr('offset', '100%').attr('stop-color', p2.color);

        svg
          .append('line')
          .attr('x1', p1.x)
          .attr('y1', p1.y)
          .attr('x2', p2.x)
          .attr('y2', p2.y)
          .attr('stroke', `url(#${gradId})`)
          .attr('stroke-width', 2.2)
          .attr('stroke-opacity', 0.5);
      }

      // b) Connecting ALL subcategories to their parent category bubble
      subPositions.forEach((p) => {
        const gradId = `wiz-grad-parent-${p.id}`;

        const grad = defs
          .append('linearGradient')
          .attr('id', gradId)
          .attr('gradientUnits', 'userSpaceOnUse')
          .attr('x1', p.x)
          .attr('y1', p.y)
          .attr('x2', parentX)
          .attr('y2', parentY);

        grad.append('stop').attr('offset', '0%').attr('stop-color', p.color);
        grad.append('stop').attr('offset', '100%').attr('stop-color', parentColor);

        svg
          .append('line')
          .attr('x1', p.x)
          .attr('y1', p.y)
          .attr('x2', parentX)
          .attr('y2', parentY)
          .attr('stroke', `url(#${gradId})`)
          .attr('stroke-width', 2.2)
          .attr('stroke-opacity', 0.5);
      });
    }
  }

  /**
   * Helper to get general category primary colors.
   */
  getCategoryColor(type) {
    return this.getBorderColor(type);
  }

  /**
   * Helper to get subcategory border colors.
   */
  getBorderColor(subcategory) {
    const key = /^[a-z][a-z0-9-]*$/.test(subcategory) ? subcategory : 'default';
    return `var(--project-color-${key}, var(--project-color-default))`;
  }
}
