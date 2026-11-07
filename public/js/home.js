import { renderIcon } from './icons.js';
import { HomeSettings } from './home-settings.js';
import { enhanceSelect } from './custom-select.js';
import { safeHTML, escapeHTML as esc } from './safe-html.js';
import { AppState, replaceProjects, removeProjectSummary, setTheme } from './app-state.js';
import { EventBus } from './event-bus.js';
import { getAllModules } from './modules/workspaces/project-module-registry.js';
import { API } from './api-service.js';
import { Router } from './router.js';
import { Alert, Loader, Toast, Modal } from './ui-components.js';
import { SpaceControls } from './modules/library/space-controls.js';
import { renderDiscovery, DEMO_FILMS } from './modules/library/home-discovery.js';
import { BubbleMap } from './bubble-map.js';

const types = {
  all: {
    label: 'Todos los assets',
    short: 'Todos',
    color: '#a69bff',
  },
  book: {
    label: 'Historias y guiones',
    short: 'Historias',
    color: '#e6b877',
  },
  character: {
    label: 'Personajes',
    short: 'Personajes',
    color: '#ac9cf7',
  },
  stage: {
    label: 'Escenarios',
    short: 'Escenarios',
    color: '#77cdb9',
  },
  video: {
    label: 'Películas y videos',
    short: 'Películas',
    color: '#83b8ef',
  },
  song: {
    label: 'Música',
    short: 'Música',
    color: '#df9abc',
  },
};
const icon = (type) => renderIcon(type, 21);
const readPreference = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const writePreference = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Browsing without persistence remains usable. */
  }
};
const timestamp = (project) => Date.parse(project.updatedAt || project.createdAt) || 0;
const normalize = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es');
const cover = (project) => {
  const covers = Array.isArray(project.covers) ? project.covers : [];
  const value =
    project.type === 'character' && project.previewFaceImage
      ? project.previewFaceImage
      : typeof project.previewImage === 'string'
        ? project.previewImage
        : covers[project.currentCoverIndex] || covers[0];
  return typeof value === 'string' && /^(\/projects\/|https:\/\/)/.test(value) ? value : '';
};
const dateLabel = (project) =>
  timestamp(project)
    ? new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }).format(
        timestamp(project),
      )
    : 'Sin fecha registrada';

export class Home {
  async mount(container, isCurrent = () => true, options = {}) {
    this.root = container.querySelector('.studio-home');
    this.type = 'all';
    this.page = options.page || 'home';
    this.folderId = options.folderId || '';
    this.profileTab = options.tab || 'assets';
    this.space = null;
    this.query = '';
    this.sort = 'recent';
    this.selected = null;
    this.view = readPreference('kai-home-view') === 'map' ? 'map' : 'library';
    this.categories = {};
    this.abort = new AbortController();
    this.settings = new HomeSettings(this.root);
    this.controls = new SpaceControls({
      getSpace: () => this.space,
      onSpace: (value) => {
        this.space = value;
        if (this.folderId && !this.currentFolder()) {
          Router.navigate('#/profile/projects');
          return;
        }
        this.render();
      },
      artwork: (asset) => this.artwork(asset),
    });
    this.root.querySelectorAll('[data-home-icon]').forEach((el) => {
      el.innerHTML = safeHTML(renderIcon(el.dataset.homeIcon, 22));
    });
    this.root.querySelectorAll('[data-nav]').forEach((el) => {
      if (
        el.dataset.nav ===
        (this.page === 'home' ? 'explore' : this.profileTab === 'projects' ? 'projects' : 'profile')
      )
        el.setAttribute('aria-current', 'page');
    });
    if (this.page === 'home') this.disconnectDiscovery = renderDiscovery(this.root);
    const modules = await getAllModules();
    if (!isCurrent()) return this;
    for (const module of modules)
      for (const category of module.subcategories) this.categories[category.id] = category.label;
    this.categories['story-book'] = 'Narrativa';
    this.categories.screenplay = 'Guion cinematográfico';
    this.map = new BubbleMap('bubble-map-canvas-container', 'bubble-map-svg', 'bubble-map-nodes');
    this.onState = ({ key }) => {
      if (key === 'projects') this.render();
    };
    EventBus.on('state:change', this.onState);
    this.root.addEventListener('click', (event) => this.onClick(event), { signal: this.abort.signal });
    this.root.querySelector('#home-search').addEventListener(
      'input',
      (event) => {
        this.query = event.target.value;
        this.renderResults();
      },
      { signal: this.abort.signal },
    );
    this.sortControl = enhanceSelect(this.root.querySelector('#home-sort'), { searchable: false });
    this.root.querySelector('#home-sort').addEventListener(
      'change',
      (event) => {
        this.sort = event.target.value;
        this.renderResults();
      },
      { signal: this.abort.signal },
    );
    this.render();
    // Refresh on return from an editor so names, covers and dates stay current.
    void this.refresh();
    return this;
  }

  async refresh() {
    const results = await Promise.allSettled([API.getProjects(), API.getLibrarySpace()]);
    if (this.abort.signal.aborted) return;
    if (results[1].status === 'fulfilled') this.space = results[1].value;
    if (results[0].status === 'fulfilled') {
      const result = results[0].value;
      replaceProjects(Array.isArray(result) ? result : result.projects || []);
    }
    const error = this.root.querySelector('#home-load-error');
    error.hidden = results.every((result) => result.status === 'fulfilled');
    if (!error.hidden)
      error.innerHTML = safeHTML(
        'No se pudo actualizar Mi espacio. <button data-action="retry">Reintentar</button>',
      );
    this.render();
  }
  currentFolder() {
    return this.space?.folders.find((folder) => folder.id === this.folderId);
  }
  renderProfile() {
    if (this.page !== 'profile') return;
    const profile = this.space?.profile || { displayName: 'Mi espacio', handle: 'creador', bio: '' };
    this.root.querySelector('#space-profile-name').textContent = profile.displayName;
    this.root.querySelector('#space-profile-handle').textContent = '@' + profile.handle;
    this.root.querySelector('#space-profile-bio').textContent = profile.bio;
    this.root.querySelector('#space-asset-total').textContent = AppState.projects.length;
    const totalFolders = this.space?.folders.length || 0;
    this.root.querySelector('#space-folder-total').textContent = totalFolders;
    this.root.querySelector('#space-folder-total').nextSibling.textContent =
      totalFolders === 1 ? ' proyecto' : ' proyectos';
    const folders = this.root.querySelector('#space-folders');
    folders.hidden = this.profileTab !== 'projects';
    this.root.querySelector('.studio-library').hidden = this.profileTab === 'projects';
    this.root.querySelector('.space-asset-toolbar').hidden = this.profileTab === 'projects';
    this.root.querySelectorAll('[data-profile-tab]').forEach((el) => {
      if (el.dataset.profileTab === this.profileTab) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    });
    const heading = this.root.querySelector('#space-folder-heading'),
      folder = this.currentFolder();
    heading.hidden = !this.folderId;
    if (this.folderId)
      heading.innerHTML = safeHTML(
        folder
          ? `<div><a href="#/profile/projects">${renderIcon('chevron-left', 18)} Proyectos</a><h2>${esc(folder.name)}</h2><p>${folder.assetIds.length} ${folder.assetIds.length === 1 ? 'asset' : 'assets'}</p></div><div class="space-folder-actions"><button class="studio-button k-create-button" data-action="pick-assets">${renderIcon('plus', 18)} Añadir assets</button><button class="k-icon-button" data-edit-folder="${esc(folder.id)}" aria-label="Renombrar proyecto">${renderIcon('edit', 18)}</button><button class="k-icon-button" data-remove-folder="${esc(folder.id)}" aria-label="Eliminar carpeta">${renderIcon('trash', 18)}</button></div>`
          : '<p>Este proyecto ya no está disponible. <a href="#/profile/projects">Volver a proyectos</a></p>',
      );
    const grid = this.root.querySelector('#space-folder-grid');
    grid.innerHTML = safeHTML(
      (this.space?.folders || [])
        .map((item) => {
          const assets = AppState.projects.filter((p) => item.assetIds.includes(p.id)).slice(0, 4);
          return `<article class="space-folder-card"><a href="#/profile/folders/${encodeURIComponent(item.id)}"><span class="space-folder-collage">${assets.length ? assets.map((p) => `<span>${this.artwork(p)}</span>`).join('') : renderIcon('folder', 56)}</span><span class="space-folder-copy"><strong>${esc(item.name)}</strong><small>${item.assetIds.length} ${item.assetIds.length === 1 ? 'asset' : 'assets'}</small></span></a><details class="studio-card-menu"><summary aria-label="Opciones de ${esc(item.name)}">${renderIcon('more', 20)}</summary><button data-edit-folder="${esc(item.id)}">Renombrar</button><button data-remove-folder="${esc(item.id)}">Eliminar carpeta</button></details></article>`;
        })
        .join('') ||
        '<div class="space-folder-empty"><h3>Una historia. Todas sus piezas.</h3><p>Reúne libros, guiones, personajes y escenarios en un proyecto.</p><button class="studio-button k-create-button" data-action="new-folder">Crear mi primer proyecto</button></div>',
    );
    this.root
      .querySelectorAll('[data-action="new-folder"],[data-action="edit-profile"],[data-action="pick-assets"]')
      .forEach((button) => {
        button.disabled = !this.space;
      });
  }

  category(project) {
    return this.categories[project.category] || types[project.type]?.short || 'Asset';
  }
  artwork(project) {
    const url = cover(project);
    return `<span class="studio-art-symbol">${icon(project.type)}</span>${url ? `<img src="${esc(url)}" alt="" loading="lazy">` : '<span class="studio-art-lines" aria-hidden="true"></span>'}`;
  }
  open(id) {
    Router.navigate(`#/workspace/${encodeURIComponent(id)}`);
  }
  related(project) {
    const outgoing = new Set((project.ingredients || []).map((item) => item.importedProjectId));
    return AppState.projects.filter(
      (other) =>
        other.id !== project.id &&
        (outgoing.has(other.id) || other.ingredients?.some((item) => item.importedProjectId === project.id)),
    );
  }
  render() {
    this.root.querySelector('#home-type-nav').innerHTML = safeHTML(
      Object.entries(types)
        .map(([type, config]) => {
          const count = AppState.projects.filter(
            (p) =>
              (!this.folderId || this.currentFolder()?.assetIds.includes(p.id)) &&
              (type === 'all' || p.type === type),
          ).length;
          return `<button data-type="${type}" aria-pressed="${this.type === type}" style="--type-color:${config.color}">${icon(type)}<span>${config.label}</span><small>${count}</small></button>`;
        })
        .join(''),
    );
    const last = readPreference('kai-last-project');
    const recent =
      AppState.projects.find((p) => p.id === last) ||
      [...AppState.projects].sort((a, b) => timestamp(b) - timestamp(a))[0];
    const resume = this.root.querySelector('#home-resume');
    resume.hidden = !recent || this.page !== 'home';
    if (recent)
      resume.innerHTML = safeHTML(
        `<div class="studio-resume-art" data-kind="${esc(recent.type)}">${this.artwork(recent)}</div><div class="studio-resume-copy"><p class="studio-eyebrow">CONTINÚA DONDE LO DEJASTE</p><h2>${esc(recent.name || 'Sin título')}</h2><p>${esc(this.category(recent))} · ${esc(dateLabel(recent))}</p></div><button class="studio-button" data-open="${esc(recent.id)}">Continuar ${renderIcon('arrow-up-right', 20)}</button>`,
      );
    this.renderProfile();
    if (this.page !== 'home') this.renderResults();
  }
  renderResults() {
    const projects = AppState.projects.filter(
      (project) =>
        (!this.folderId || this.currentFolder()?.assetIds.includes(project.id)) &&
        (this.type === 'all' || project.type === this.type) &&
        normalize(`${project.name} ${this.category(project)} ${types[project.type]?.label}`).includes(
          normalize(this.query),
        ),
    );
    projects.sort(
      this.sort === 'name'
        ? (a, b) => (a.name || '').localeCompare(b.name || '', 'es')
        : this.sort === 'oldest'
          ? (a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0)
          : (a, b) => timestamp(b) - timestamp(a),
    );
    this.root.querySelector('#home-library-title').innerHTML = safeHTML(
      `${types[this.type].label} <span id="project-count">${projects.length}</span>`,
    );
    this.root.querySelector('#home-library-description').textContent =
      this.view === 'map'
        ? 'Explora los vínculos entre las piezas de tu historia.'
        : 'Cada pieza de tu próximo gran relato.';
    this.root
      .querySelectorAll('[data-view]')
      .forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.view === this.view)));
    this.root
      .querySelectorAll('[data-type]')
      .forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.type === this.type)));
    this.root.querySelector('#home-result-count').textContent = this.query
      ? `${projects.length} resultado${projects.length === 1 ? '' : 's'} para “${this.query}”`
      : '';
    const list = this.root.querySelector('#project-list-container');
    const map = this.root.querySelector('#home-map');
    const empty = this.root.querySelector('#home-empty');
    list.hidden = this.view !== 'library' || !projects.length;
    map.hidden = this.view !== 'map' || !projects.length;
    empty.hidden = !!projects.length;
    this.map.destroy();
    if (!projects.length) {
      empty.innerHTML = safeHTML(
        `${icon(this.type)}<h3>${AppState.projects.length ? 'No hay assets en esta selección' : 'Tu próxima historia empieza aquí'}</h3><p>${AppState.projects.length ? 'Prueba otro nombre o explora todos tus assets.' : 'Crea una historia, un personaje o el primer escenario de tu mundo.'}</p><button class="studio-button studio-primary" data-action="${AppState.projects.length ? 'reset' : 'new'}">${AppState.projects.length ? 'Ver todos los assets' : 'Crear mi primer asset'}</button>`,
      );
      return;
    }
    if (this.view === 'library') {
      list.innerHTML = safeHTML(
        projects
          .map(
            (project) =>
              `<article class="studio-card" style="--type-color:${(types[project.type] || types.all).color}"><a class="studio-card-link" href="#/workspace/${encodeURIComponent(project.id)}" aria-label="Abrir ${esc(project.name)}"><div class="studio-card-art" data-kind="${esc(project.type)}">${this.artwork(project)}<span class="studio-category">${icon(project.type)}${esc(this.category(project))}</span></div><div class="studio-card-copy"><h3>${esc(project.name || 'Sin título')}</h3><p>${esc(dateLabel(project))}<span aria-hidden="true">${renderIcon('arrow-up-right')}</span></p></div></a><div class="studio-card-bottom"><span class="studio-status"><i></i>${esc(project.status || 'Borrador')}</span><details class="studio-card-menu"><summary aria-label="Opciones de ${esc(project.name)}">${renderIcon('more')}</summary><button data-folder-asset="${esc(project.id)}">Añadir a proyecto…</button>${this.folderId ? `<button data-unlink-asset="${esc(project.id)}">Quitar de este proyecto</button>` : ''}<button data-delete="${esc(project.id)}">Eliminar asset…</button></details></div></article>`,
          )
          .join(''),
      );
    } else {
      this.root.querySelector('#home-map-legend').innerHTML = safeHTML(
        Object.entries(types)
          .filter(([type]) => projects.some((p) => p.type === type))
          .map(([type, config]) => `<span style="--type-color:${config.color}"><i></i>${config.short}</span>`)
          .join(''),
      );
      this.map.init(
        projects,
        (id) => this.select(id),
        (id) => this.remove(id),
      );
      this.select(projects.some((p) => p.id === this.selected) ? this.selected : projects[0].id);
    }
  }
  select(id) {
    this.selected = id;
    const project = AppState.projects.find((p) => p.id === id);
    if (!project) return;
    const related = this.related(project);
    this.root
      .querySelectorAll('.bubble-node')
      .forEach((node) => node.setAttribute('aria-pressed', String(node.dataset.projectId === id)));
    this.root.querySelector('#home-map-detail').innerHTML = safeHTML(
      `<p class="studio-eyebrow">ASSET SELECCIONADO</p><span class="studio-detail-category" style="--type-color:${(types[project.type] || types.all).color}">${icon(project.type)}${esc(this.category(project))}</span><h3>${esc(project.name || 'Sin título')}</h3><p class="studio-detail-date">Modificado el ${esc(dateLabel(project))}</p><button class="studio-button studio-primary" data-open="${esc(project.id)}">Abrir asset <span aria-hidden="true">${renderIcon('arrow-up-right')}</span></button><h4>Assets relacionados <span>${related.length}</span></h4>${related.length ? `<ul>${related.map((other) => `<li><button data-select="${esc(other.id)}">${icon(other.type)}<span>${esc(other.name)}</span><span aria-hidden="true">${renderIcon('arrow-right')}</span></button></li>`).join('')}</ul>` : '<p class="studio-detail-empty">Sin conexiones todavía. Los assets que vincules como ingredientes aparecerán aquí.</p>'}`,
    );
  }
  onClick(event) {
    const button = event.target.closest('button');
    if (!button) return;
    const folder = this.currentFolder();
    if (button.dataset.action === 'theme') {
      setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
      return;
    }
    if (button.dataset.demoFilm !== undefined) {
      const film = DEMO_FILMS[Number(button.dataset.demoFilm)];
      if (film) {
        const content = document.createElement('div');
        content.className = 'space-demo';
        content.innerHTML = safeHTML(
          `<img src="/assets/home/${film.image}" alt="${esc(film.title)}"><p>Vista previa de la galería de la comunidad. Las películas y publicaciones de otros creadores estarán disponibles próximamente.</p>`,
        );
        Modal.show({
          title: film.title,
          content,
          actions: [{ label: 'Cerrar', class: 'btn-primary', onClick: () => Modal.hide() }],
        });
      }
      return;
    }
    if (['new-folder', 'edit-profile', 'pick-assets'].includes(button.dataset.action) && !this.space) return;
    if (button.dataset.action === 'new-folder') {
      this.controls.createFolder();
      return;
    }
    if (button.dataset.action === 'edit-profile') {
      this.controls.editProfile();
      return;
    }
    if (button.dataset.action === 'pick-assets' && folder) {
      this.controls.pickAssets(folder);
      return;
    }
    if (button.dataset.editFolder) {
      const item = this.space?.folders.find((f) => f.id === button.dataset.editFolder);
      if (item) this.controls.editFolder(item);
      return;
    }
    if (button.dataset.removeFolder) {
      const item = this.space?.folders.find((f) => f.id === button.dataset.removeFolder);
      if (item) void this.controls.removeFolder(item);
      return;
    }
    if (button.dataset.folderAsset) {
      const asset = AppState.projects.find((p) => p.id === button.dataset.folderAsset);
      if (asset && this.space) this.controls.assignAsset(asset);
      return;
    }
    if (button.dataset.unlinkAsset && folder) {
      void this.controls.save(() =>
        API.updateProjectFolder(folder.id, {
          revision: this.space.revision,
          assetIds: folder.assetIds.filter((id) => id !== button.dataset.unlinkAsset),
        }),
      );
      return;
    }
    if (button.id === 'btn-new-project' || button.dataset.action === 'new') Router.navigate('#/wizard');
    else if (button.dataset.type) {
      this.type = button.dataset.type;
      this.renderResults();
    } else if (button.dataset.view) {
      this.view = button.dataset.view;
      writePreference('kai-home-view', this.view);
      this.renderResults();
    } else if (button.dataset.open) this.open(button.dataset.open);
    else if (button.dataset.delete) this.remove(button.dataset.delete);
    else if (button.dataset.select) {
      this.type = 'all';
      this.query = '';
      this.root.querySelector('#home-search').value = '';
      this.selected = button.dataset.select;
      this.renderResults();
    } else if (button.dataset.action === 'reset') {
      this.type = 'all';
      this.query = '';
      this.root.querySelector('#home-search').value = '';
      this.renderResults();
    } else if (button.dataset.action === 'settings') this.settings.open();
    else if (button.dataset.action === 'trash') this.showTrash();
    else if (button.dataset.action === 'retry') this.refresh();
  }
  async showTrash(selected = new Set()) {
    try {
      const { projects } = await API.getTrash();
      if (this.abort.signal.aborted) return;
      const ids = new Set(projects.map((project) => project.id));
      for (const id of selected) if (!ids.has(id)) selected.delete(id);
      const content = document.createElement('div');
      content.className = 'check-panel';
      const explanation = document.createElement('p');
      explanation.className = 'check-panel__intro';
      explanation.textContent = projects.length
        ? 'Estos assets conservan sus archivos. Restáuralos para volver a trabajar con ellos o elimínalos para siempre.'
        : 'La papelera está vacía.';
      content.append(explanation);
      const countLabel = document.createElement('span');
      const all = document.createElement('input');
      all.type = 'checkbox';
      all.id = 'trash-select-all';
      const boxes = new Map();
      if (projects.length) {
        const toolbar = document.createElement('div');
        toolbar.className = 'check-panel__toolbar';
        const allLabel = document.createElement('label');
        allLabel.className = 'check-panel__all';
        allLabel.htmlFor = all.id;
        allLabel.append(all, document.createTextNode('Seleccionar todos'));
        countLabel.className = 'check-panel__count';
        countLabel.setAttribute('aria-live', 'polite');
        toolbar.append(allLabel, countLabel);
        const list = document.createElement('ul');
        list.className = 'check-panel__list';
        for (const project of projects) {
          const item = document.createElement('li');
          const label = document.createElement('label');
          label.className = 'check-panel__row';
          const box = document.createElement('input');
          box.type = 'checkbox';
          box.checked = selected.has(project.id);
          box.setAttribute('aria-label', 'Seleccionar ' + project.name);
          boxes.set(project.id, box);
          const text = document.createElement('span');
          text.className = 'check-panel__text';
          const name = document.createElement('strong');
          name.textContent = project.name || 'Sin título';
          const meta = document.createElement('small');
          const when = project.deletedAt
            ? new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }).format(
                new Date(project.deletedAt),
              )
            : '';
          meta.textContent = [(types[project.type] || types.all).short, when && 'Eliminado ' + when]
            .filter(Boolean)
            .join(' · ');
          text.append(name, meta);
          label.append(box, text);
          item.append(label);
          list.append(item);
        }
        content.append(toolbar, list);
      }
      const dialog = Modal.show({
        title: 'Papelera',
        content,
        actions: [
          { label: 'Restaurar', class: 'btn-secondary btn-md', onClick: () => restore() },
          { label: 'Eliminar definitivamente', class: 'btn-danger btn-md', onClick: () => purge() },
        ],
      });
      dialog.classList.add('modal-content--check');
      const [restoreButton, purgeButton] = dialog.querySelectorAll('.modal-footer .btn');
      const update = () => {
        const n = selected.size;
        all.checked = n > 0 && n === projects.length;
        all.indeterminate = n > 0 && n < projects.length;
        countLabel.textContent = n ? (n === 1 ? '1 seleccionado' : n + ' seleccionados') : '';
        restoreButton.textContent = n > 1 ? 'Restaurar (' + n + ')' : 'Restaurar';
        purgeButton.textContent = n > 1 ? 'Eliminar definitivamente (' + n + ')' : 'Eliminar definitivamente';
        restoreButton.disabled = purgeButton.disabled = n === 0;
      };
      for (const [id, box] of boxes)
        box.addEventListener('change', () => {
          box.checked ? selected.add(id) : selected.delete(id);
          update();
        });
      all.addEventListener('change', () => {
        for (const [id, box] of boxes) {
          box.checked = all.checked;
          all.checked ? selected.add(id) : selected.delete(id);
        }
        update();
      });
      if (!projects.length) dialog.querySelector('.modal-footer').hidden = true;
      update();
      const restore = async () => {
        const chosen = projects.filter((project) => selected.has(project.id));
        restoreButton.disabled = purgeButton.disabled = true;
        let failed = 0;
        for (const project of chosen) {
          try {
            await API.restoreProject(project.id);
            selected.delete(project.id);
          } catch {
            failed++;
          }
        }
        await this.refresh();
        const done = chosen.length - failed;
        if (done) Toast.show(done === 1 ? 'Asset restaurado.' : done + ' assets restaurados.', 'success');
        if (failed) Toast.show('No se pudieron restaurar ' + failed + '.', 'error');
        await this.showTrash(selected);
      };
      const purge = () => {
        const chosen = projects.filter((project) => selected.has(project.id));
        Alert.deleteProjects(
          chosen.map((project) => project.name || 'Sin título'),
          async (phrase, keepProps) => {
            Loader.show();
            let failed = 0;
            for (const project of chosen) {
              try {
                await API.deleteProjectFull(project.id, phrase, keepProps);
                selected.delete(project.id);
              } catch {
                failed++;
              }
            }
            Loader.hide();
            const done = chosen.length - failed;
            if (done) Toast.show(done === 1 ? 'Asset eliminado.' : done + ' assets eliminados.', 'success');
            if (failed) Toast.show('No se pudieron eliminar ' + failed + '.', 'error');
            await this.showTrash(selected);
          },
          {
            characters: chosen.filter((project) => project.type === 'character').length,
            onCancel: () => this.showTrash(selected),
          },
        );
      };
    } catch (error) {
      Toast.show('No se pudo abrir la papelera: ' + error.message, 'error');
    }
  }

  remove(id) {
    const project = AppState.projects.find((p) => p.id === id);
    if (!project) return;
    this.root.querySelectorAll('details[open]').forEach((menu) => menu.removeAttribute('open'));
    const perform = async (phrase, keepProps) => {
      try {
        Loader.show();
        if (phrase !== undefined) await API.deleteProjectFull(id, phrase, keepProps);
        else await API.deleteProject(id);
        removeProjectSummary(id);
        Toast.show(
          phrase !== undefined ? 'Asset y archivos eliminados' : 'Asset movido a la papelera',
          'success',
        );
      } catch {
        Toast.show('No se pudo eliminar el asset', 'error');
      } finally {
        Loader.hide();
      }
    };
    Alert.deleteProject(
      project.name,
      () => perform(),
      (phrase, keepProps) => perform(phrase, keepProps),
      { character: project.type === 'character' },
    );
  }
  unmount() {
    this.controls?.destroy();
    this.disconnectDiscovery?.();
    this.sortControl?.destroy({ restore: false });
    this.settings?.destroy();
    this.abort.abort();
    this.map?.destroy();
    EventBus.off('state:change', this.onState);
  }
}
