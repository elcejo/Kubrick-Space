import { AppState } from '../../app-state.js';
import { API } from '../../api-service.js';
import { EventBus } from '../../event-bus.js';
import { Modal, Toast } from '../../ui-components.js';
import { renderIcon } from '../../icons.js';
import { safeHTML, escapeHTML } from '../../safe-html.js';
import {
  SCENARIO_FIELDS,
  SCENARIO_KINDS,
  SCENARIO_MAX_REFERENCES,
  SCENARIO_VIEWS,
  legacyScenarioDocument,
  purgeScenarioImages,
  removeScenarioReference,
  restoreScenarioImage,
  scenarioCovers,
  scenarioSlotLabel,
  parseScenarioDocument,
  scenarioAssistedCreation,
  scenarioHasContent,
  scenarioImage,
  scenarioNeedsCreationChoice,
  validateScenarioDocument,
} from '../../contracts/scenario.js';
import {
  scenarioElement as el,
  scenarioAction as action,
  setScenarioNodeWorking,
  readImageFile,
  SCENARIO_IMAGE_TYPES,
  SCENARIO_IMAGE_BYTES,
} from './scenario-ui.js';
import { PanoramaViewer } from './scenario-panorama.js';
import { ScenarioJobs } from './scenario-jobs.js';

const RUNNING_STATES = ['queued', 'running'];
const METHODS = Object.freeze([
  ['description', 'Descripción', 'agent', 'Cuenta cómo es el lugar.'],
  ['image', 'Fotografía', 'image', 'Una o varias fotos como referencia.'],
  ['options', 'Opciones', 'grid', 'Diseña con un catálogo visual.'],
  ['ingredients', 'Ingredientes', 'ingredients', 'Combina las referencias del proyecto.'],
]);

/** Legacy stage prose is retained as a note; nothing is rewritten or invented. */
export function prepareScenarioProject(project) {
  const existing = parseScenarioDocument(project.content || '');
  if (existing) {
    project.content = JSON.stringify(existing);
    return project;
  }
  const legacy = project.content
    ? new DOMParser().parseFromString(project.content, 'text/html').body.textContent.trim()
    : '';
  project.content = JSON.stringify(legacyScenarioDocument(project, legacy));
  return project;
}

/** Printable sheet for the shared exporter: fields only, images stay in the project folder. */
export function scenarioDocumentToHTML(document) {
  if (!document) return '';
  const rows = SCENARIO_FIELDS.filter(({ key }) => document.fields[key])
    .map(({ key, label }) => `<h2>${escapeHTML(label)}</h2><p>${escapeHTML(document.fields[key])}</p>`)
    .join('');
  return (
    `<h1>${escapeHTML(document.identity.name || 'Escenario')}</h1>` +
    (document.identity.kind ? `<p>${escapeHTML(SCENARIO_KINDS[document.identity.kind])}</p>` : '') +
    (document.description ? `<p>${escapeHTML(document.description)}</p>` : '') +
    rows
  );
}

/**
 * Scenario workspace: a design sheet, the reference photographs, one 360° panorama and four angles
 * of the same place. Generation always runs as a server job; this class only requests and observes.
 */
export class ScenarioWorkspace {
  constructor(node, { onChange, onCreationSelected, onBackgroundState } = {}) {
    this.node = node;
    this.onChange = onChange;
    this.onCreationSelected = onCreationSelected;
    this.onBackgroundState = onBackgroundState;
    this.projectId = AppState.currentProject.id;
    this.document = parseScenarioDocument(AppState.currentProject.content) ?? prepareScenarioDocument();
    this.controller = new AbortController();
    this.destroyed = false;
    this.busy = true;
    this.uploading = false;
    this.submitting = false;
    this.showTrash = false;
    this.statusText = 'Consultando tareas…';
    this.nodes = {};
    this.noticeKeys = new Set();
    this.node.classList.add('scenario-workspace', 'character-node');
    this.mount();
    this.jobs = new ScenarioJobs(this);
  }
  project() {
    return AppState.currentProject;
  }
  current() {
    return !this.destroyed && AppState.currentProject?.id === this.projectId;
  }
  get wrapper() {
    return this.node.parentElement;
  }
  destroy() {
    this.destroyed = true;
    this.controller.abort();
    this.jobs?.destroy();
    this.viewer?.destroy();
    this.dialogCleanup?.();
    this.removeNodes();
    this.node.hidden = false;
    this.wrapper?.classList.remove('editor-layout-wrapper--scenario-single-node');
    this.node.replaceChildren();
  }
  removeNodes() {
    this.viewer?.destroy();
    this.viewer = null;
    for (const node of Object.values(this.nodes)) node?.remove();
    this.nodes = {};
  }

  // ── Document ─────────────────────────────────────────────────────────
  commit() {
    this.document.identity.name = (AppState.currentProject.name || this.document.identity.name).slice(0, 120);
    this.document = validateScenarioDocument(this.document);
    AppState.currentProject.content = JSON.stringify(this.document);
    this.onChange?.();
  }
  /** Replace the document with the result of a pure contract operation and keep the gallery in step. */
  applyDocument(next) {
    if (!this.current()) return;
    this.document = next;
    this.document.revision++;
    const covers = scenarioCovers(this.document);
    AppState.currentProject.covers = covers;
    AppState.currentProject.currentCoverIndex = covers.length ? 0 : -1;
    this.commit();
  }
  change(fn) {
    if (!this.current()) return;
    fn(this.document);
    this.document.revision++;
    this.commit();
  }

  // ── Layout ───────────────────────────────────────────────────────────
  intro() {
    return !scenarioHasContent(this.document);
  }
  mount() {
    this.removeNodes();
    this.node.replaceChildren();
    const intro = this.intro();
    this.node.hidden = intro;
    this.wrapper?.classList.toggle('editor-layout-wrapper--scenario-single-node', intro);
    this.nodes.composer = this.buildComposer(intro);
    this.wrapper.append(this.nodes.composer);
    if (!intro) {
      this.renderDesign();
      this.nodes.references = this.buildReferencesNode();
      this.nodes.panorama = this.buildPanoramaNode();
      this.nodes.views = this.buildViewsNode();
      this.node.after(this.nodes.references, this.nodes.panorama, this.nodes.views);
    }
    this.updateComposer();
  }

  renderDesign() {
    const header = el('header', 'character-workspace__header');
    header.append(el('h2', 'character-eyebrow', 'DISEÑO'));
    const body = el('section', 'character-design character-node__body scenario-design');
    body.setAttribute('aria-label', 'Características del escenario');
    const readOnly = (label, value, multiline = true) => {
      const wrapper = el('label', 'character-field');
      const control = el(multiline ? 'textarea' : 'input', 'input character-text-input');
      control.value = value;
      control.readOnly = true;
      if (multiline) control.rows = 1;
      control.setAttribute('aria-readonly', 'true');
      wrapper.append(el('span', 'character-field__label', label), control);
      return wrapper;
    };
    body.append(readOnly('Tipo', SCENARIO_KINDS[this.document.identity.kind] || 'Sin definir', false));
    for (const { key, label } of SCENARIO_FIELDS)
      if (this.document.fields[key]) body.append(readOnly(label, this.document.fields[key]));
    const summary = el('section', 'character-summary');
    summary.append(
      el('h3', null, 'Descripción'),
      el('p', null, this.document.description || 'Aún sin descripción.'),
    );
    body.append(summary);
    if (this.document.legacyText) {
      const legacy = el('details', 'character-legacy');
      legacy.append(
        el('summary', null, 'Ficha anterior conservada'),
        el('p', null, this.document.legacyText),
      );
      body.append(legacy);
    }
    this.node.append(header, body);
  }

  node_(name, label) {
    const section = el('section', `character-node scenario-node scenario-node--${name}`);
    section.setAttribute('aria-label', label);
    return section;
  }
  buildPanoramaNode() {
    const section = this.node_('panorama', 'Panorama 360°');
    const header = el('header', 'character-workspace__header scenario-node__header');
    header.append(el('h2', 'character-eyebrow', 'PANORAMA 360°'));
    const panorama = this.document.panorama;
    if (panorama) {
      const download = el('a', 'btn btn-ghost scenario-node__download');
      download.href = panorama.url;
      download.download = `${(this.project().name || 'escenario').replace(/[^\w.-]+/g, '-')}-360.png`;
      const icon = el('span', 'scenario-action__icon');
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = safeHTML(renderIcon('download', 16));
      download.append(icon, el('span', null, 'Descargar'));
      header.append(download);
    }
    section.append(header);
    if (panorama) {
      this.viewer = new PanoramaViewer(section, {
        url: panorama.url,
        label: `Panorama 360° de ${this.project().name}`,
      });
    } else
      section.append(
        el(
          'p',
          'character-empty',
          'La imagen 360° aún no se ha generado. Pulsa Reintentar o Generar de nuevo.',
        ),
      );
    return section;
  }
  buildViewsNode() {
    const section = this.node_('views', 'Ángulos del escenario');
    const header = el('header', 'character-workspace__header scenario-node__header');
    this.regenerateAll = null;
    const trashCount = this.document.archive.length;
    const toggle = action(
      this.showTrash ? 'Volver a los ángulos' : `Papelera · ${trashCount}`,
      this.showTrash ? 'chevron-left' : 'trash',
      () => {
        this.showTrash = !this.showTrash;
        this.refreshViewsNode();
      },
      'btn btn-ghost scenario-trash__toggle',
    );
    toggle.setAttribute('aria-pressed', String(this.showTrash));
    if (this.showTrash) {
      header.append(el('h2', 'character-eyebrow', 'PAPELERA'));
      const empty = action(
        'Vaciar papelera',
        'trash',
        () => void this.purgeFromTrash(this.document.archive.map((entry) => entry.url)),
        'btn btn-ghost scenario-trash__empty',
      );
      empty.disabled = this.busy || !trashCount;
      header.append(empty, toggle);
      section.append(header, this.buildTrash());
      return section;
    }
    header.append(el('h2', 'character-eyebrow', 'ÁNGULOS'));
    header.append(
      action(
        'Regenerar los cuatro',
        'refresh',
        () => void this.regenerate('views'),
        'btn btn-ghost scenario-views__all',
      ),
    );
    this.regenerateAll = header.lastChild;
    header.append(toggle);
    const grid = el('div', 'scenario-views');
    for (const definition of SCENARIO_VIEWS) {
      const view = this.document.views.find((item) => item.id === definition.id);
      const tile = el('figure', 'scenario-view');
      tile.dataset.viewId = definition.id;
      if (view) {
        const open = el('button', 'scenario-view__open');
        open.type = 'button';
        open.setAttribute('aria-label', `Ampliar ${definition.label}`);
        const image = el('img');
        image.src = view.url;
        image.alt = `${definition.label} de ${this.project().name}`;
        image.loading = 'lazy';
        open.append(image);
        open.addEventListener('click', () => this.openView(view));
        tile.append(open);
      } else tile.append(el('div', 'scenario-view__empty', 'Pendiente'));
      const caption = el('figcaption', 'scenario-view__caption');
      caption.append(el('span', null, definition.label));
      const redo = action(
        `Regenerar ${definition.label}`,
        'refresh',
        () => void this.regenerate('view', definition.id),
        'btn btn-ghost scenario-view__redo',
      );
      redo.disabled = !this.document.panorama;
      caption.append(redo);
      tile.append(caption);
      grid.append(tile);
    }
    section.append(header, grid);
    return section;
  }
  /** Replaced and removed pictures: restore swaps them back into their slot, delete is permanent. */
  buildTrash() {
    const list = el('ul', 'scenario-trash');
    list.setAttribute('aria-label', 'Imágenes en la papelera');
    const entries = [...this.document.archive].reverse();
    if (!entries.length) {
      list.append(
        el(
          'li',
          'scenario-trash__empty-state',
          'Papelera vacía. Aquí llegan las imágenes que reemplazas o quitas.',
        ),
      );
      return list;
    }
    for (const entry of entries) {
      const label = scenarioSlotLabel(entry.slot);
      const item = el('li', 'scenario-trash__item');
      item.dataset.slot = entry.slot;
      const open = el('button', 'scenario-trash__open');
      open.type = 'button';
      open.setAttribute('aria-label', `Ampliar ${label} de la papelera`);
      const image = el('img');
      image.src = entry.url;
      image.alt = `${label} en la papelera`;
      image.loading = 'lazy';
      open.append(image);
      open.addEventListener('click', () => this.openView({ url: entry.url, label }));
      const caption = el('div', 'scenario-trash__caption');
      const when = entry.archivedAt ? new Date(entry.archivedAt).toLocaleString('es') : '';
      caption.append(el('strong', null, label), el('span', null, when));
      const actions = el('div', 'scenario-trash__actions');
      const restore = action(
        `Restaurar ${label}`,
        'refresh',
        () => void this.restoreFromTrash(entry.url),
        'btn btn-secondary scenario-trash__restore',
      );
      restore.disabled = this.busy || !entry.slot;
      if (!entry.slot) restore.title = 'Esta imagen no recuerda su lugar; solo puede eliminarse.';
      const remove = action(
        `Eliminar ${label} definitivamente`,
        'trash',
        () => void this.purgeFromTrash([entry.url]),
        'btn btn-ghost scenario-trash__delete',
      );
      remove.disabled = this.busy;
      actions.append(restore, remove);
      item.append(open, caption, actions);
      list.append(item);
    }
    return list;
  }
  refreshViewsNode() {
    if (!this.nodes.views) return;
    const fresh = this.buildViewsNode();
    this.nodes.views.replaceWith(fresh);
    this.nodes.views = fresh;
    this.updateComposer();
  }
  restoreFromTrash(url) {
    if (!this.current() || this.busy) return;
    try {
      this.applyDocument(restoreScenarioImage(this.document, url));
    } catch (error) {
      Toast.show(error.message, 'warning');
      return;
    }
    this.mount();
  }
  async purgeFromTrash(urls) {
    if (!this.current() || this.busy || !urls.length) return;
    const confirmed = await Modal.confirm({
      title: 'Eliminar imágenes definitivamente',
      message: `Se eliminarán ${urls.length} ${urls.length === 1 ? 'imagen de esta papelera' : 'imágenes de esta papelera'}. Esta acción no se puede deshacer. Los archivos que todavía utilicen versiones guardadas u otros proyectos se conservarán para no dañarlos.`,
      confirmLabel: 'Eliminar definitivamente',
      type: 'danger',
      signal: this.controller.signal,
    });
    if (!confirmed || !this.current()) return;
    this.applyDocument(purgeScenarioImages(this.document, urls));
    this.refreshViewsNode();
    try {
      await EventBus.emitAsync('autosave:flush');
      if (!this.current()) return;
      const { removed, retained, failed } = await API.purgeScenarioTrash(this.projectId, urls);
      if (failed.length) Toast.show(`No se pudieron borrar ${failed.length} archivos del disco.`, 'warning');
      else if (retained.length)
        Toast.show(
          `Se vació la papelera. ${retained.length} ${retained.length === 1 ? 'archivo se conserva' : 'archivos se conservan'} porque lo usan versiones guardadas.`,
          'info',
        );
      else
        Toast.show(
          removed.length === 1 ? 'Imagen eliminada.' : `${removed.length} imágenes eliminadas.`,
          'success',
        );
    } catch (error) {
      if (this.current())
        Toast.show(`Se vació la papelera, pero los archivos siguen en el disco: ${error.message}`, 'warning');
    }
  }
  openView(view) {
    const body = el('div', 'scenario-lightbox');
    const image = el('img');
    image.src = view.url;
    image.alt = view.label;
    body.append(image);
    Modal.show({ title: view.label, content: body });
  }

  // ── References ───────────────────────────────────────────────────────
  buildReferencesNode() {
    const section = this.node_('references', 'Fotografías de referencia');
    const header = el('header', 'character-workspace__header scenario-node__header');
    header.append(el('h2', 'character-eyebrow', 'REFERENCIAS'));
    section.append(header);
    section.append(this.buildReferencePicker());
    return section;
  }
  buildReferencePicker() {
    const holder = el('div', 'scenario-references');
    holder.dataset.referencePicker = 'true';
    const references = this.document.creation.references;
    const grid = el('ul', 'scenario-references__grid');
    references.forEach((url, index) => {
      const item = el('li', 'scenario-reference');
      const image = el('img');
      image.src = url;
      image.alt = `Referencia ${index + 1}`;
      image.loading = 'lazy';
      const remove = action(
        `Quitar referencia ${index + 1}`,
        'close',
        () => void this.removeReference(url),
        'btn btn-ghost scenario-reference__remove',
      );
      item.append(image, remove);
      grid.append(item);
    });
    if (!references.length) grid.append(el('li', 'scenario-references__empty', 'Aún sin fotografías.'));
    const file = el('input');
    file.type = 'file';
    file.multiple = true;
    file.hidden = true;
    file.accept = SCENARIO_IMAGE_TYPES.join(',');
    file.setAttribute('aria-label', 'Fotografías de referencia');
    file.addEventListener('change', () => {
      const files = [...(file.files || [])];
      file.value = '';
      void this.addFiles(files);
    });
    const actions = el('div', 'scenario-references__actions');
    this.addButton = action('Añadir fotografías', 'upload', () => file.click(), 'btn btn-secondary');
    this.urlButton = action('Pegar URL', 'link', () => this.askForURL(), 'btn btn-ghost');
    actions.append(this.addButton, this.urlButton);
    holder.append(
      grid,
      file,
      actions,
      el(
        'p',
        'character-composer__hint',
        `${references.length}/${SCENARIO_MAX_REFERENCES} fotografías. Se combinan en un único escenario; no se copian sus personas.`,
      ),
    );
    const locked = this.busy || this.uploading;
    const full = references.length >= SCENARIO_MAX_REFERENCES;
    holder.querySelectorAll('button').forEach((button) => {
      button.disabled = locked || (full && (button === this.addButton || button === this.urlButton));
    });
    return holder;
  }
  refreshReferences() {
    for (const holder of this.wrapper.querySelectorAll('[data-reference-picker]'))
      holder.replaceWith(this.buildReferencePicker());
    this.updateComposer();
  }
  async addFiles(files) {
    if (!files.length || !this.current() || this.busy || this.uploading) return;
    const room = SCENARIO_MAX_REFERENCES - this.document.creation.references.length;
    const accepted = files.filter(
      (file) => SCENARIO_IMAGE_TYPES.includes(file.type) && file.size <= SCENARIO_IMAGE_BYTES,
    );
    if (accepted.length < files.length)
      Toast.show('Solo PNG, JPEG, WebP, GIF o BMP de hasta 15 MB.', 'warning');
    this.uploading = true;
    this.refreshReferences();
    const uploaded = [];
    try {
      for (const file of accepted.slice(0, Math.max(0, room))) {
        const data = await readImageFile(file);
        if (!this.current()) return;
        const result = await API.uploadBase64(this.projectId, data, null, { signal: this.controller.signal });
        if (!scenarioImage(result.imageUrl, this.projectId))
          throw new Error('La imagen no pertenece a este escenario.');
        uploaded.push(result.imageUrl);
      }
      if (accepted.length > room)
        Toast.show(`Se admiten hasta ${SCENARIO_MAX_REFERENCES} fotografías.`, 'warning');
    } catch (error) {
      if (this.current()) Toast.show(error.message, 'error');
    } finally {
      if (this.current()) {
        this.uploading = false;
        if (uploaded.length) this.addReferences(uploaded);
        else this.refreshReferences();
      }
    }
  }
  addReferences(urls) {
    this.change((doc) => {
      doc.creation.references = [...new Set([...doc.creation.references, ...urls])].slice(
        0,
        SCENARIO_MAX_REFERENCES,
      );
    });
    this.refreshReferences();
  }
  removeReference(url) {
    if (this.busy) return;
    try {
      this.applyDocument(removeScenarioReference(this.document, url));
    } catch (error) {
      Toast.show(error.message, 'warning');
      return;
    }
    this.refreshReferences();
    this.refreshViewsNode();
  }
  askForURL() {
    if (this.busy || this.uploading) return;
    const root = el('div', 'scenario-url-dialog');
    const input = el('input', 'input');
    input.type = 'url';
    input.placeholder = 'https://ejemplo.com/lugar.jpg';
    input.setAttribute('aria-label', 'URL de la fotografía');
    const status = el('p', 'character-empty');
    status.setAttribute('role', 'status');
    const submit = action('Usar fotografía', 'check', () => void save(), 'btn btn-primary');
    const cancel = action('Cancelar', 'close', () => Modal.hide(), 'btn btn-ghost');
    const row = el('div', 'character-photo-dialog__actions');
    row.append(cancel, submit);
    root.append(
      input,
      el(
        'p',
        'character-empty',
        'Pega el enlace directo a una imagen pública. Se guardará una copia en este proyecto.',
      ),
      status,
      row,
    );
    const save = async () => {
      let parsed;
      try {
        parsed = new URL(input.value.trim());
        if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password)
          throw Error();
      } catch {
        status.textContent = 'Escribe una URL http o https válida de una imagen pública.';
        return;
      }
      submit.disabled = true;
      status.textContent = 'Descargando fotografía…';
      try {
        const result = await API.importCharacterPhoto(this.projectId, parsed.href, {
          signal: this.controller.signal,
        });
        if (!this.current()) return;
        if (!scenarioImage(result.imageUrl, this.projectId))
          throw Error('La fotografía importada no pertenece a este escenario.');
        Modal.hide();
        this.addReferences([result.imageUrl]);
      } catch (error) {
        status.textContent = error.message || 'No se pudo importar la fotografía.';
        submit.disabled = false;
      }
    };
    Modal.show({ title: 'Fotografía por URL', content: root, initialFocus: input });
  }

  // ── Composer ─────────────────────────────────────────────────────────
  buildComposer(intro) {
    const document_ = this.document;
    const choosing = scenarioNeedsCreationChoice(document_);
    const mode = document_.creation.mode;
    const element = el('section', 'character-node character-composer scenario-composer');
    element.setAttribute('aria-label', 'Asistente de escenario');
    if (intro) element.classList.add(choosing ? 'character-creation-picker' : 'character-description-intro');
    const heading = el(
      'h2',
      mode || !intro ? 'character-eyebrow' : null,
      mode || !intro ? 'ASISTENTE DE ESCENARIO' : '¿Cómo quieres crear tu escenario?',
    );
    const routes = el(
      'div',
      mode || !intro ? 'character-methods character-methods--compact' : 'character-methods',
    );
    routes.setAttribute('role', 'group');
    routes.setAttribute('aria-label', 'Método de creación');
    this.methodButtons = [];
    for (const [id, label, icon, description] of METHODS) {
      const button = el('button', 'character-method');
      button.type = 'button';
      button.dataset.creationMode = id;
      const soon = ['options', 'ingredients'].includes(id);
      if (soon) {
        button.dataset.comingSoon = 'true';
        button.disabled = true;
        button.title = 'Disponible en la próxima versión';
      }
      button.setAttribute('aria-pressed', String(id === mode));
      const glyph = el('span', 'character-method__icon');
      glyph.innerHTML = safeHTML(renderIcon(icon, 32));
      button.append(glyph, el('strong', null, label));
      if (!mode) button.append(el('span', null, description));
      if (soon) button.append(el('span', 'character-method__soon', 'Próximamente'));
      button.addEventListener('click', () => this.setCreationMode(id));
      routes.append(button);
      this.methodButtons.push(button);
    }
    // Once the sheet exists the route is fixed, exactly as in the character workspace.
    routes.hidden = !intro;
    if (mode || !intro) {
      const top = el('header', 'character-composer__header');
      top.append(heading, routes);
      element.append(top);
    } else element.append(heading, routes);
    if (mode === 'image' && intro) element.append(this.buildReferencePicker());

    const area = el('div', 'character-composer__input-area');
    this.prompt = el('textarea', 'input character-composer__input');
    this.prompt.maxLength = 12000;
    this.prompt.rows = 2;
    this.prompt.value = document_.request;
    this.prompt.setAttribute('aria-label', 'Describe el escenario o pide un cambio');
    this.prompt.placeholder = !intro
      ? 'Pide un cambio: «de noche y con lluvia», «añade una barra de madera»…'
      : mode === 'image'
        ? 'Añade indicaciones sobre las fotografías (opcional)…'
        : 'Describe el escenario: lugar, época, materiales, luz, atmósfera…';
    this.prompt.addEventListener('input', () => {
      this.change((doc) => {
        doc.request = this.prompt.value;
      });
      this.updateComposer();
    });
    this.prompt.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        void this.submit();
      }
    });
    area.append(this.prompt);
    this.hint = el('p', 'character-composer__hint');
    this.status = el('p', 'character-composer__status');
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    const footer = el('div', 'character-composer__actions');
    this.retryButton = action(
      'Reintentar trabajo',
      'refresh',
      () => void this.jobs.retry(),
      'btn btn-secondary',
    );
    this.regenerateButton = action(
      'Generar de nuevo',
      'brush',
      () => void this.regenerate('all'),
      'btn btn-secondary',
    );
    this.submitButton = action('Interpretar', 'agent', () => void this.submit(), 'btn btn-primary');
    footer.append(this.retryButton, this.regenerateButton, this.submitButton);
    element.append(area, this.hint, footer, this.status);
    area.hidden = this.hint.hidden = footer.hidden = !mode && intro;
    return element;
  }
  setCreationMode(mode) {
    if (!this.current() || this.busy || this.uploading || scenarioAssistedCreation(this.document)) return;
    if (!['description', 'image'].includes(mode)) return;
    const wasChoosing = scenarioNeedsCreationChoice(this.document);
    this.change((doc) => {
      doc.creation.mode = mode;
    });
    this.mount();
    if (wasChoosing) this.onCreationSelected?.();
    this.prompt.focus();
  }
  sourceForSubmit() {
    return this.intro() ? this.document.creation.mode : 'change';
  }
  canSubmit() {
    const document_ = this.document;
    const text = this.prompt.value.trim();
    const source = this.sourceForSubmit();
    if (!source) return false;
    if (source === 'description') return Boolean(text) || document_.creation.references.length > 0;
    if (source === 'image') return document_.creation.references.length > 0;
    return Boolean(text);
  }
  updateComposer() {
    if (!this.prompt?.isConnected && !this.nodes.composer) return;
    const busy = this.busy || this.uploading;
    const intro = this.intro();
    const failed = this.jobs?.job && ['failed', 'interrupted'].includes(this.jobs.job.status);
    this.prompt.disabled = busy || (intro && !this.document.creation.mode);
    this.submitButton.disabled = busy || !this.canSubmit();
    this.submitButton.lastChild.textContent = intro ? 'Crear escenario' : 'Aplicar cambios';
    this.submitButton.setAttribute('aria-label', this.submitButton.lastChild.textContent);
    this.regenerateButton.hidden = intro && !this.document.panorama;
    this.regenerateButton.disabled = busy || !scenarioHasContent(this.document);
    this.retryButton.hidden = !failed || busy;
    this.methodButtons?.forEach((button) => {
      button.disabled =
        busy || button.dataset.comingSoon === 'true' || scenarioAssistedCreation(this.document);
    });
    if (this.regenerateAll) this.regenerateAll.disabled = busy || !this.document.panorama;
    this.hint.textContent =
      this.document.creation.mode === 'image' && intro && !this.document.creation.references.length
        ? 'Añade al menos una fotografía para crear el escenario.'
        : '';
    // Failures are acknowledged in a dialog; the line below the composer never repeats them.
    this.status.textContent =
      !busy && this.document.creation.initialState === 'pending' && scenarioHasContent(this.document)
        ? 'La primera generación no terminó. Pulsa Reintentar o Generar de nuevo.'
        : '';
    this.status.hidden = !this.status.textContent;
    const working = this.busy;
    const label = this.statusText || 'Trabajando…';
    setScenarioNodeWorking(
      this.nodes.composer,
      working || this.uploading,
      working ? label : 'Subiendo fotografías…',
    );
    // A finished panorama stays visible while its angles render; only the stage in progress is covered.
    const panoramaWorking =
      working && (!this.document.panorama || /360|Diseñando|Actualizando/.test(this.statusText));
    if (this.nodes.panorama) setScenarioNodeWorking(this.nodes.panorama, panoramaWorking, label);
    if (this.nodes.views) setScenarioNodeWorking(this.nodes.views, working, label);
    if (this.nodes.references) this.nodes.references.inert = working;
    this.node.inert = working;
  }

  // ── Requests ─────────────────────────────────────────────────────────
  async submit() {
    if (!this.current() || this.busy || !this.canSubmit()) return;
    const source = this.sourceForSubmit();
    await this.jobs.perform({
      source,
      request: this.prompt.value.trim(),
      references: this.document.creation.references,
    });
  }
  async regenerate(scope, viewId) {
    if (!this.current() || this.busy) return;
    await this.jobs.perform({
      source: 'regenerate',
      scope,
      ...(viewId ? { viewId } : {}),
      request: '',
      references: this.document.creation.references,
    });
  }
  async acceptBackgroundJob({ job, draft }) {
    if (!this.current()) return;
    const wasIntro = this.intro();
    const busy = Boolean(job) && RUNNING_STATES.includes(job.status);
    const draftChanged = Boolean(draft) && draft.revision !== this.backgroundRevision;
    const mediaChanged =
      draftChanged &&
      ['covers', 'currentCoverIndex'].some(
        (key) => JSON.stringify(this.project()[key]) !== JSON.stringify(draft.payload[key]),
      );
    if (draftChanged || busy !== this.backgroundBusyAccepted) {
      await this.onBackgroundState?.({ busy, ...(draftChanged ? { draft } : {}), mediaChanged });
      this.backgroundBusyAccepted = busy;
    }
    if (!this.current()) return;
    this.backgroundJob = job;
    this.statusText = busy
      ? job.status === 'queued'
        ? `En cola · posición ${job.position}. Puedes salir; el servidor continuará.`
        : job.message || 'Trabajando…'
      : job?.error || '';
    this.busy = busy;
    if (draftChanged) {
      Object.assign(AppState.currentProject, draft.payload);
      this.document = parseScenarioDocument(this.project().content) ?? this.document;
      this.backgroundRevision = draft.revision;
    }
    if (draftChanged || wasIntro !== this.intro()) {
      const prompt = this.prompt?.value;
      this.mount();
      if (!draftChanged && prompt) this.prompt.value = prompt;
    }
    if (wasIntro !== this.intro()) this.onCreationSelected?.();
    this.refreshReferences();
    if (!busy && job?.error) this.showNotice(job.error, `job:${job.id}:${job.status}:${job.error}`);
  }
  backgroundJobError(error, mayContinue = false) {
    if (!this.current()) return;
    this.busy = mayContinue;
    this.statusText = mayContinue
      ? 'No se pudo consultar el estado. El servidor puede seguir trabajando; recarga para reconectar.'
      : error.message;
    if (!mayContinue) void this.onBackgroundState?.({ busy: false });
    this.updateComposer();
    if (!mayContinue) this.showNotice(error.message, `request:${error.message}`);
  }
  /** Errors are acknowledged in a dialog, once per cause, instead of staying on the canvas. */
  showNotice(message, key) {
    if (!this.current() || !message || this.noticeKeys.has(key)) return;
    this.noticeKeys.add(key);
    const body = el('div', 'scenario-notice');
    body.append(el('p', null, message));
    const ok = action('Entendido', 'check', () => Modal.hide(), 'btn btn-primary');
    body.append(ok);
    Modal.show({ title: 'No se pudo completar el escenario', content: body, initialFocus: ok });
  }
}

function prepareScenarioDocument() {
  const project = prepareScenarioProject(AppState.currentProject);
  return parseScenarioDocument(project.content);
}
