import { renderIcon } from '../../icons.js';
import { safeHTML, escapeHTML, safeContent } from '../../safe-html.js';
import { AppState } from '../../app-state.js';
import { EventBus } from '../../event-bus.js';
import { parseStoryBookContent } from '../story-book/story-book-document.js';
import { WorkspaceTasks } from './workspace-tasks.js';
import { openUniversalProps } from './universal-props.js';

const icons = {
  back: renderIcon('chevron-left'),
  structure: renderIcon('layers'),
  character: renderIcon('character'),
  traits: renderIcon('traits'),
  ingredients: renderIcon('ingredients'),
  'prop-library': renderIcon('prop-library'),
  stage: renderIcon('stage'),
  resource: renderIcon('folder'),
  edit: renderIcon('edit'),
  preview: renderIcon('eye'),
  code: renderIcon('code'),
  focus: renderIcon('focus'),
  close: renderIcon('close'),
};

const sectionsByType = {
  book: [
    ['structure', 'Estructura'],
    ['character', 'Personajes'],
    ['stage', 'Escenarios'],
    ['resource', 'Recursos'],
  ],
  character: [
    ['structure', 'Perfil'],
    ['character', 'Relaciones'],
    ['resource', 'Referencias'],
  ],
  stage: [
    ['structure', 'Escenario'],
    ['character', 'Personajes'],
    ['resource', 'Recursos'],
  ],
  video: [
    ['structure', 'Guion'],
    ['character', 'Personajes'],
    ['stage', 'Escenarios'],
    ['resource', 'Recursos'],
  ],
  song: [
    ['structure', 'Composición'],
    ['resource', 'Recursos'],
  ],
};

function labelFor(type) {
  return (
    { book: 'Historia', character: 'Personaje', stage: 'Escenario', video: 'Película', song: 'Música' }[
      type
    ] || 'Proyecto'
  );
}

export class WorkspaceNavigator {
  #root = null;
  #project = null;
  #sections = [];
  #navigationTabs = [];
  #active = null;
  #modulePanels = [];
  #panel = null;
  #focus = false;
  #canvas = null;
  #keyHandler = null;
  #onExternalOpen = null;
  #tasks = null;
  #propsCleanup = null;

  init(container, project, moduleConfig, canvas) {
    this.#root = container;
    this.#project = project;
    this.#canvas = canvas;
    this.#sections = sectionsByType[project.type] || [
      ['structure', 'Contenido'],
      ['resource', 'Recursos'],
    ];
    const sidebarTabs = moduleConfig?.getSidebarConfig?.()?.tabs || [];
    const tabKeys = new Set(sidebarTabs.map((tab) => String(tab.id || tab.key || '').toLowerCase()));
    this.#navigationTabs = [
      ...(tabKeys.has('traits') ? [['traits', 'Rasgos']] : []),
      ...(tabKeys.has('ingredients') || tabKeys.has('ingredientes') ? [['ingredients', 'Ingredientes']] : []),
      ...(project.type === 'character' ? [['prop-library', 'Biblioteca universal']] : []),
    ];
    this.#modulePanels = sidebarTabs.filter(
      (tab) =>
        ![
          'ingredients',
          'ingredientes',
          'traits',
          'format',
          'formato',
          'generate',
          'generacion',
          'generación',
        ].includes(String(tab.id || tab.key || '').toLowerCase()),
    );
    const isStoryBook = project.type === 'book' && (project.category === 'story-book' || !project.category);
    const codeLabel = isStoryBook ? 'JSON del libro' : 'Código HTML';
    const codeTitle = isStoryBook
      ? 'Ver la estructura JSON del libro (solo lectura)'
      : 'Ver y editar el código fuente HTML';
    this.#root.innerHTML = safeHTML(`
      <div class="workspace-nav" aria-label="Navegación del proyecto">
        <button class="workspace-nav__back" data-back="true" title="Volver al inicio" aria-label="Volver al inicio">${icons.back}</button>
        <nav class="workspace-nav__sections" aria-label="Paneles del proyecto">${this.#navigationTabs.map(([key, label]) => `<button data-section="${key}" aria-current="false" title="${escapeHTML(label)}" aria-label="${escapeHTML(label)}">${icons[key] || icons.resource}</button>`).join('')}</nav>
        ${
          this.#modulePanels.length
            ? `<div class="workspace-nav__utilities" aria-label="Herramientas del proyecto">${this.#modulePanels
                .map((tab) => {
                  const label = tab.label || tab.id || tab.key;
                  return `<button data-open-panel="${escapeHTML(tab.id || tab.key)}" title="${escapeHTML(label)}" aria-label="${escapeHTML(label)}">${renderIcon(tab.icon || tab.id || tab.key)}</button>`;
                })
                .join('')}</div>`
            : ''
        }
        <div class="workspace-nav__modes" aria-label="Modo de edición">
          <button class="workspace-tasks-trigger" data-workspace-tasks aria-expanded="false" title="Tareas activas" aria-label="Tareas activas">${renderIcon('tasks')}</button>
          <button data-mode="wysiwyg" aria-pressed="true" title="Editar" aria-label="Editar">${icons.edit}</button>
          ${['character', 'stage'].includes(project.type) || (project.type === 'video' && project.category === 'feature') ? '' : `<button data-mode="preview" aria-pressed="false" title="Vista previa" aria-label="Vista previa">${icons.preview}</button><button data-mode="markdown" aria-pressed="false" title="${escapeHTML(codeTitle)}" aria-label="${escapeHTML(codeLabel)}">${icons.code}</button>`}
        </div>
        <button class="workspace-nav__focus" data-focus="true" title="Enfoque" aria-label="Enfoque">${icons.focus}</button>
      </div>`);
    this.#root.addEventListener('click', (event) => this.#onClick(event));
    this.#tasks = new WorkspaceTasks(
      this.#root.closest('.workspace'),
      this.#root.querySelector('[data-workspace-tasks]'),
    );
    this.#keyHandler = (event) => {
      if (event.key === 'Escape' && this.#focus) this.#setFocus(false);
    };
    window.addEventListener('keydown', this.#keyHandler);
    this.#onExternalOpen = (key) => this.#showSection(key, false);
    EventBus.on('workspace:section:open', this.#onExternalOpen);
  }

  destroy() {
    this.#propsCleanup?.();
    this.#tasks?.destroy();
    window.removeEventListener('keydown', this.#keyHandler);
    EventBus.off('workspace:section:open', this.#onExternalOpen);
    this.#panel?.remove();
    this.#root?.replaceChildren();
    this.#root = null;
    this.#canvas = null;
  }

  #onClick(event) {
    const control = event.target.closest('button');
    if (!control) return;
    if (control.dataset.back) {
      window.location.hash = '#/';
      return;
    }
    if (control.dataset.section) {
      if (control.dataset.section === 'prop-library') {
        this.#closeSection();
        this.#propsCleanup?.();
        this.#propsCleanup = openUniversalProps();
        return;
      }
      if (control.dataset.section === 'ingredients') {
        this.#openIngredientCatalog();
        return;
      }
      if (control.dataset.section === 'traits') {
        this.#openModulePanel('traits');
        return;
      }
      this.#showSection(control.dataset.section);
      return;
    }
    if (control.dataset.openPanel) {
      this.#closeSection();
      this.#openModulePanel(control.dataset.openPanel);
      return;
    }
    if (control.dataset.openResources) {
      this.#closeSection();
      this.#openIngredientCatalog();
      return;
    }
    if (control.dataset.mode) this.#setMode(control.dataset.mode);
    if (control.dataset.focus) this.#setFocus(!this.#focus);
  }

  #setMode(mode) {
    this.#root
      .querySelectorAll('[data-mode]')
      .forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
    EventBus.emit('editor:setMode', mode);
  }

  #openIngredientCatalog() {
    // The compact navigation owns the visible entry point. The legacy sidebar
    // still owns the proven ingredient catalogue and its drag/drop behavior.
    const catalogTrigger = document.querySelector(
      '.floating-fab-container [data-panel-key="ingredients"], .floating-fab-container [data-panel-key="ingredientes"]',
    );
    if (catalogTrigger instanceof HTMLButtonElement) {
      catalogTrigger.click();
      return;
    }
    EventBus.emit('workspace:panel:open', 'ingredients');
  }

  #openModulePanel(key) {
    const trigger = document.querySelector(`.floating-fab-container [data-panel-key="${key}"]`);
    if (trigger instanceof HTMLButtonElement) {
      trigger.click();
      return;
    }
    EventBus.emit('workspace:panel:open', key);
  }

  #setFocus(enabled) {
    this.#focus = enabled;
    const workspace = this.#root.closest('.workspace');
    workspace?.classList.toggle('workspace--focus', enabled);
    const button = this.#root.querySelector('[data-focus]');
    button.innerHTML = safeHTML(enabled ? icons.close : icons.focus);
    button.setAttribute('aria-label', enabled ? 'Salir de enfoque' : 'Enfoque');
    button.setAttribute('aria-pressed', String(enabled));
    button.setAttribute(
      'title',
      enabled ? 'Salir de modo enfoque (Esc)' : 'Oculta paneles y encuadra el contenido',
    );
    if (enabled) requestAnimationFrame(() => this.#canvas?.fitToViewport());
  }

  #showSection(key, allowToggle = true) {
    if (!this.#sections.some(([section]) => section === key)) key = this.#sections[0][0];
    EventBus.emit('workspace:panel:close');
    if (allowToggle && this.#active === key && this.#panel?.isConnected) {
      this.#closeSection();
      return;
    }
    this.#active = key;
    this.#root
      .querySelectorAll('[data-section]')
      .forEach((button) => button.setAttribute('aria-current', String(button.dataset.section === key)));
    this.#panel?.remove();
    this.#panel = document.createElement('aside');
    this.#panel.className = 'workspace-inspector';
    const content = this.#panelContent(key);
    this.#panel.innerHTML = safeHTML(
      `<div class="workspace-inspector__header"><span>${icons[key]}</span><div><small>${escapeHTML(labelFor(this.#project.type).toUpperCase())}</small><h2>${escapeHTML(this.#sections.find(([section]) => section === key)?.[1] || 'Contenido')}</h2></div><button data-close-inspector aria-label="Cerrar panel">${icons.close}</button></div>${content}`,
    );
    this.#panel.addEventListener('click', (event) => this.#onClick(event));
    this.#panel.querySelector('[data-close-inspector]').addEventListener('click', () => this.#closeSection());
    this.#root.closest('.workspace').appendChild(this.#panel);
  }

  #closeSection() {
    this.#panel?.remove();
    this.#panel = null;
    this.#active = null;
    this.#root
      ?.querySelectorAll('[data-section]')
      .forEach((button) => button.setAttribute('aria-current', 'false'));
  }

  #panelContent(key) {
    const content = document.createElement('div');
    const isStoryBook =
      this.#project.type === 'book' && (this.#project.category === 'story-book' || !this.#project.category);
    let headings;
    if (isStoryBook) {
      const documentNode = parseStoryBookContent(this.#project.content || '');
      headings = [
        documentNode.title,
        ...documentNode.chapters.flatMap((chapter) => [
          chapter.title,
          ...chapter.themes.map((theme) => theme.title),
        ]),
      ]
        .map((node) => String(node?.text || '').trim())
        .filter(Boolean)
        .slice(0, 14);
    } else {
      content.innerHTML = safeContent(this.#project.content || '');
      headings = [...content.querySelectorAll('h1,h2,h3')]
        .map((node) => node.textContent.trim())
        .filter(Boolean)
        .slice(0, 7);
    }
    const ingredients = Array.isArray(AppState.currentProject?.ingredients)
      ? AppState.currentProject.ingredients
      : [];
    const typeForSection = { character: 'character', stage: 'stage' }[key];
    const related = typeForSection
      ? ingredients.filter((item) => item.type === typeForSection || item.ingredientType === typeForSection)
      : ingredients;
    if (key === 'structure')
      return `<div class="workspace-inspector__intro"><p>${headings.length ? 'Navega por los bloques que ya forman este proyecto.' : 'Empieza a escribir y aquí aparecerá la estructura de tu proyecto.'}</p></div>${headings.length ? `<ol class="workspace-inspector__outline">${headings.map((heading) => `<li>${escapeHTML(heading)}</li>`).join('')}</ol>` : '<p class="workspace-inspector__empty">Aún no hay títulos o secciones.</p>'}`;
    const sectionLabel = this.#sections.find(([section]) => section === key)?.[1] || 'Recursos';
    return `<div class="workspace-inspector__intro"><p>${related.length ? `${related.length} elemento${related.length === 1 ? '' : 's'} conectado${related.length === 1 ? '' : 's'} a este proyecto.` : `Añade ${sectionLabel.toLowerCase()} para construir el contexto de tu proyecto.`}</p><button data-open-resources="true">${renderIcon('plus')} Añadir ingrediente</button></div>${
      related.length
        ? `<ul class="workspace-inspector__links">${related
            .slice(0, 8)
            .map(
              (item) =>
                `<li><span>${renderIcon(item.icon || item.type)}</span>${escapeHTML(item.name || item.label || item.type || 'Sin título')}</li>`,
            )
            .join('')}</ul>`
        : '<p class="workspace-inspector__empty">Abre el catálogo para añadir o arrastrar ingredientes.</p>'
    }`;
  }
}
