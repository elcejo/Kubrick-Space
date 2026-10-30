import { AppState } from '../../app-state.js';
import { API } from '../../api-service.js';
import { Modal } from '../../ui-components.js';
import { renderIcon } from '../../icons.js';
import { safeHTML } from '../../safe-html.js';
import {
  FILM_FRAME_OPTIONS,
  FILM_MAX_SECONDS,
  filmDimensions,
  filmNeedsConditioning,
  filmPictureLabel,
  filmSceneNeedsPrompt,
  filmSeconds,
  filmSummary,
  parseFilmDocument,
  prepareFilmProject,
  validateFilmDocument,
} from '../../contracts/film.js';
import { FilmJobs } from './film-jobs.js';

const RUNNING_STATES = ['queued', 'running'];
const STATUS_LABELS = Object.freeze({
  pending: 'Sin prompt',
  prompting: 'Escribiendo el prompt…',
  ready: 'Prompt listo',
  failed: 'No se pudo escribir',
});

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function glyph(icon, size = 16) {
  const span = el('span', 'film-action__icon');
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = safeHTML(renderIcon(icon, size));
  return span;
}
/** A labelled icon button. The label is the accessible name; the icon is decorative. */
function action(label, icon, onClick, className = 'btn btn-ghost') {
  const button = el('button', className);
  button.type = 'button';
  button.append(glyph(icon), el('span', null, label));
  button.setAttribute('aria-label', label);
  button.addEventListener('click', onClick);
  return button;
}
/** Icon-only button: the name lives in aria-label and title, the drawing is decorative. */
function iconButton(label, icon, onClick, className = '') {
  const button = el('button', `btn btn-ghost film-icon-button ${className}`.trim());
  button.type = 'button';
  button.append(glyph(icon, 20));
  button.setAttribute('aria-label', label);
  button.title = label;
  button.addEventListener('click', onClick);
  return button;
}
const duration = (seconds) => `${String(seconds).replace('.', ',')} s`;

/** Printable outline for the shared exporter: scenes and their prompts, no media. */
export function filmDocumentToHTML(document) {
  if (!document) return '';
  const escape = (value) =>
    String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  return (
    `<h1>${escape(document.identity.name || 'Largometraje')}</h1>` +
    document.scenes
      .filter((scene) => !scene.sourceRemoved)
      .map(
        (scene, index) =>
          `<h2>${index + 1}. ${escape(scene.title)}</h2>` +
          (scene.shot ? `<p><em>${escape(scene.shot)}</em></p>` : '') +
          (scene.prompt ? `<p>${escape(scene.prompt)}</p>` : ''),
      )
      .join('')
  );
}

/**
 * Feature film workspace: every scene of the linked screenplay is one video node with a parameters node beside it.
 * Prompts, conditioning and preview videos are made by server jobs; this class requests, observes and lets the
 * author edit, approve or redo. Approving and redoing stay available while a job runs.
 */
export class FilmWorkspace {
  constructor(node, { onChange, onBackgroundState } = {}) {
    this.node = node;
    this.onChange = onChange;
    this.onBackgroundState = onBackgroundState;
    this.projectId = AppState.currentProject.id;
    this.document = parseFilmDocument(AppState.currentProject.content) ?? this.#blank();
    this.destroyed = false;
    this.busy = true;
    this.submitting = false;
    this.statusText = 'Consultando tareas…';
    this.noticeKeys = new Set();
    this.board = null;
    this.header = null;
    this.rows = new Map();
    this.scriptId = '';
    this.node.classList.add('film-anchor');
    this.node.hidden = true;
    this.mount();
    this.jobs = new FilmJobs(this);
  }
  #blank() {
    return parseFilmDocument(prepareFilmProject(AppState.currentProject).content);
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
    this.jobs?.destroy();
    this.board?.remove();
    this.board = null;
    this.rows.clear();
    this.node.hidden = false;
    this.node.classList.remove('film-anchor');
    this.node.replaceChildren();
  }

  // ── Document ─────────────────────────────────────────────────────────
  commit() {
    this.document.identity.name = (AppState.currentProject.name || this.document.identity.name).slice(0, 120);
    this.document = validateFilmDocument(this.document);
    AppState.currentProject.content = JSON.stringify(this.document);
    this.onChange?.();
  }
  change(fn) {
    if (!this.current()) return;
    fn(this.document);
    this.document.revision++;
    this.commit();
  }
  scripts() {
    return (this.project().ingredients || []).filter(
      (item) => item.active !== false && item.type === 'book' && item.importedProjectId,
    );
  }
  hasScenes() {
    return this.document.scenes.length > 0;
  }
  canRender() {
    return this.document.scenes.some((scene) => !scene.sourceRemoved && scene.prompt);
  }

  // ── Layout ───────────────────────────────────────────────────────────
  /**
   * Rebuilds the header and only the rows whose scene changed: a clip the author is watching keeps playing while
   * another scene is being generated.
   */
  mount() {
    const intro = !this.hasScenes();
    this.wrapper?.classList.add('editor-layout-wrapper--film');
    this.wrapper?.classList.toggle('editor-layout-wrapper--film-empty', intro);
    if (!this.board) {
      this.board = el('section', 'film-board');
      this.board.setAttribute('aria-label', 'Largometraje');
      this.node.after(this.board);
    }
    const header = this.buildHeader(intro);
    if (this.header) this.header.replaceWith(header);
    else this.board.prepend(header);
    this.header = header;

    const wanted = new Map();
    for (const [index, scene] of intro ? [] : this.document.scenes.entries()) {
      const signature = JSON.stringify([scene, index]);
      // What the clip itself depends on; approving or redoing must not restart a clip the author is watching.
      const videoKey = JSON.stringify([scene.preview, scene.title, index, scene.sourceRemoved]);
      const known = this.rows.get(scene.id);
      if (known?.signature === signature) wanted.set(scene.id, known);
      else {
        const fresh = this.buildRow(scene, index);
        const node = known?.videoKey === videoKey ? this.adopt(known.node, fresh) : fresh;
        wanted.set(scene.id, { signature, videoKey, node });
      }
    }
    for (const [id, known] of this.rows) if (wanted.get(id)?.node !== known.node) known.node.remove();
    let cursor = header.nextSibling;
    for (const { node } of wanted.values()) {
      if (cursor === node) cursor = cursor.nextSibling;
      else this.board.insertBefore(node, cursor);
    }
    this.rows = wanted;
    this.updateBoard();
  }
  /** Updates a row in place around its existing video element: everything but the frame is replaced. */
  adopt(row, fresh) {
    const [video, params] = row.children;
    const [freshVideo, freshParams] = fresh.children;
    const frame = video.querySelector('.film-video-frame');
    while (frame.nextSibling) frame.nextSibling.remove();
    let next = freshVideo.querySelector('.film-video-frame').nextSibling;
    while (next) {
      const after = next.nextSibling;
      video.append(next);
      next = after;
    }
    params.replaceWith(freshParams);
    row.classList.toggle('is-removed', fresh.classList.contains('is-removed'));
    return row;
  }
  buildHeader(intro) {
    const header = el('header', 'character-node film-header');
    const title = el('div', 'film-header__title');
    title.append(el('h2', 'character-eyebrow', 'PELÍCULA'));
    if (intro) {
      title.append(
        el('h3', 'film-header__heading', 'Crea la película a partir de ingredientes'),
        el(
          'p',
          'film-header__text',
          'Cada escena del guión se convierte en un clip independiente de como máximo 10 segundos, con su prompt para MiniMax H3. Vincula el guión, los personajes y los escenarios como ingredientes.',
        ),
      );
    } else {
      const summary = filmSummary(this.document);
      const live = this.document.scenes.filter((scene) => !scene.sourceRemoved);
      const previews = live.filter((scene) => scene.preview).length;
      const approved = live.filter((scene) => scene.approved).length;
      title.append(
        el(
          'p',
          'film-header__text',
          `${summary.total} ${summary.total === 1 ? 'escena' : 'escenas'} · ${summary.ready} con prompt · ${previews} previsualizadas · ${approved} aprobadas · ${duration(Math.round(summary.seconds))} de metraje`,
        ),
      );
    }
    header.append(title);
    const controls = el('div', 'film-header__controls');
    const scripts = this.scripts();
    if (scripts.length > 1) {
      const label = el('label', 'film-field');
      label.append(el('span', 'film-field__label', 'Guión'));
      this.scriptSelect = el('select', 'input');
      for (const item of scripts) {
        const option = el('option', null, item.importedProjectName || item.label || 'Guión');
        option.value = item.importedProjectId;
        this.scriptSelect.append(option);
      }
      this.scriptSelect.value =
        this.scriptId || this.document.source?.projectId || scripts[0].importedProjectId;
      this.scriptSelect.addEventListener('change', () => {
        this.scriptId = this.scriptSelect.value;
      });
      label.append(this.scriptSelect);
      controls.append(label);
    } else this.scriptSelect = null;
    this.generateButton = action(
      intro ? 'Generar película a partir de ingredientes' : 'Actualizar desde el guión',
      intro ? 'video' : 'refresh',
      () => this.generate(),
      intro ? 'btn btn-primary' : 'btn btn-ghost',
    );
    this.renderButton = action('Generar previsualizaciones', 'play', () => this.render(), 'btn btn-primary');
    this.renderButton.hidden = intro;
    this.retryButton = action('Reintentar', 'refresh', () => void this.jobs.retry());
    this.cancelButton = action('Cancelar', 'warning', () => void this.jobs.cancel());
    this.status = el('p', 'film-header__status');
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.hint = el('p', 'film-header__hint');
    controls.append(this.generateButton, this.renderButton, this.retryButton, this.cancelButton);
    header.append(controls, this.status, this.hint);
    return header;
  }
  buildRow(scene, index) {
    const row = el('article', 'film-row');
    row.dataset.sceneId = scene.id;
    if (scene.sourceRemoved) row.classList.add('is-removed');
    row.append(this.buildVideoNode(scene, index), this.buildParamsNode(scene, index));
    return row;
  }
  renderState(scene) {
    if (scene.render === 'conditioning') return 'Preparando el conditioning…';
    if (scene.render === 'generating') return 'Generando la previsualización…';
    if (scene.redo > 0) return 'En cola para rehacerla';
    if (scene.preview && scene.conditioning && scene.preview.key !== scene.conditioning.key)
      return 'La previsualización es de un prompt anterior';
    if (scene.prompt && filmNeedsConditioning(scene)) return 'Pendiente de generar';
    return '';
  }
  buildVideoNode(scene, index) {
    const section = el('section', 'character-node film-node film-node--video');
    section.setAttribute('aria-label', `Video de la escena ${index + 1}`);
    const header = el('header', 'film-node__header');
    header.append(
      el('h2', 'character-eyebrow', `ESCENA ${index + 1}`),
      el('h3', 'film-node__title', scene.title),
    );
    const frame = el('div', 'film-video-frame');
    const working = ['conditioning', 'generating'].includes(scene.render);
    if (scene.preview) {
      frame.classList.add('has-video');
      const video = el('video', 'film-video');
      video.src = `${scene.preview.url}?v=${scene.preview.version}`;
      video.controls = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.setAttribute('aria-label', `Previsualización de la escena ${index + 1}`);
      frame.append(video);
    } else {
      frame.setAttribute('role', 'img');
      frame.setAttribute('aria-label', 'Aún sin video generado');
      frame.append(glyph('video', 56), el('span', 'film-video-frame__text', 'Sin video generado'));
    }
    const state = el('p', 'film-node__state', this.renderState(scene));
    state.setAttribute('role', 'status');
    state.hidden = !state.textContent;
    if (working) state.classList.add('is-working');
    const actions = el('div', 'film-video-actions');
    const approve = iconButton(
      scene.approved ? 'Quitar la aprobación' : 'Aprobar previsualización',
      'check',
      () => void this.sceneAction(scene, scene.approved ? 'unapprove' : 'approve'),
      scene.approved ? 'is-approved' : '',
    );
    approve.setAttribute('aria-pressed', String(scene.approved));
    approve.dataset.renderAction = 'approve';
    approve.disabled = !scene.preview || scene.sourceRemoved;
    const redo = iconButton(
      'Rehacer previsualización',
      'refresh',
      () => void this.sceneAction(scene, 'redo'),
    );
    redo.dataset.renderAction = 'redo';
    redo.disabled =
      scene.sourceRemoved || scene.redo > 0 || !scene.conditioning || filmNeedsConditioning(scene);
    const meta = filmDimensions(this.document.params);
    actions.append(
      approve,
      redo,
      el(
        'span',
        'film-node__meta',
        `${duration(filmSeconds(scene.frames))} · 24 fps · ${scene.preview?.width ?? meta.width}×${scene.preview?.height ?? meta.height}${scene.approved ? ' · Aprobada' : ''}`,
      ),
    );
    section.append(header, frame, actions, state);
    if (scene.renderError) {
      const error = el('p', 'film-node__error', scene.renderError);
      error.setAttribute('role', 'alert');
      section.append(error);
    }
    if (scene.sourceRemoved)
      section.append(
        el('p', 'film-node__notice', 'Esta escena ya no está en el guión. Se conserva por si la recuperas.'),
      );
    return section;
  }
  statusOf(scene) {
    if (scene.sourceRemoved) return 'Escena eliminada del guión';
    if (scene.status === 'ready' && filmSceneNeedsPrompt(scene)) return 'El guión cambió; se reescribirá';
    return STATUS_LABELS[scene.status];
  }
  buildParamsNode(scene, index) {
    const section = el('section', 'character-node film-node film-node--params');
    section.setAttribute('aria-label', `Parámetros de la escena ${index + 1}`);
    const header = el('header', 'film-node__header');
    header.append(el('h2', 'character-eyebrow', 'PARÁMETROS DE GENERACIÓN'));
    const chip = el('span', `film-chip film-chip--${scene.status}`, this.statusOf(scene));
    header.append(chip);
    section.append(header);

    const prompt = el('label', 'film-field film-field--prompt');
    prompt.append(
      el(
        'span',
        'film-field__label',
        scene.promptSource === 'manual' ? 'Prompt (editado por ti)' : 'Prompt generado por el modelo',
      ),
    );
    const area = el('textarea', 'input character-text-input film-prompt');
    area.value = scene.prompt;
    area.maxLength = 6000;
    area.rows = 7;
    area.placeholder = 'Aún sin prompt. Pulsa «Escribir prompt» o redáctalo tú.';
    area.spellcheck = false;
    area.addEventListener('change', () => this.editPrompt(scene.id, area.value));
    prompt.append(area);
    section.append(prompt);

    const grid = el('div', 'film-params');
    const length = el('label', 'film-field');
    length.append(el('span', 'film-field__label', 'Duración'));
    const select = el('select', 'input');
    for (const frames of FILM_FRAME_OPTIONS) {
      const option = el('option', null, `${duration(filmSeconds(frames))} (${frames} fotogramas)`);
      option.value = String(frames);
      select.append(option);
    }
    select.value = String(scene.frames);
    select.setAttribute('aria-describedby', `film-limit-${scene.id}`);
    select.addEventListener('change', () =>
      this.change((document) => {
        document.scenes.find((item) => item.id === scene.id).frames = Number(select.value);
      }),
    );
    length.append(
      select,
      Object.assign(el('small', 'film-field__help', `Máximo ${FILM_MAX_SECONDS} s por escena.`), {
        id: `film-limit-${scene.id}`,
      }),
    );
    const shot = el('label', 'film-field');
    shot.append(el('span', 'film-field__label', 'Plano'));
    const shotInput = el('input', 'input');
    shotInput.value = scene.shot;
    shotInput.readOnly = true;
    shotInput.setAttribute('aria-readonly', 'true');
    shot.append(shotInput);
    const seed = el('label', 'film-field');
    seed.append(el('span', 'film-field__label', 'Semilla'));
    const seedInput = el('input', 'input');
    seedInput.value = String(scene.preview?.seed ?? scene.seed);
    seedInput.readOnly = true;
    seedInput.setAttribute('aria-readonly', 'true');
    seed.append(seedInput);
    grid.append(length, shot, seed);
    section.append(grid);

    const references = el('div', 'film-references');
    references.append(el('span', 'film-field__label', 'Referencias'));
    if (!scene.references.length)
      references.append(
        el('p', 'film-references__empty', 'Sin personajes ni escenarios vinculados en esta escena.'),
      );
    else {
      const list = el('ul', 'film-references__list');
      for (const reference of scene.references) {
        const item = el('li', 'film-reference');
        if (reference.image) {
          const image = el('img', 'film-reference__image');
          image.src = reference.image;
          image.alt = '';
          image.loading = 'lazy';
          item.append(image);
        } else item.append(el('span', 'film-reference__image film-reference__image--empty'));
        const text = el('span', 'film-reference__text');
        text.append(
          el('strong', null, reference.name || (reference.kind === 'stage' ? 'Escenario' : 'Personaje')),
          el(
            'small',
            null,
            `${filmPictureLabel(reference)} · ${reference.kind === 'stage' ? 'Escenario' : 'Personaje'}`,
          ),
        );
        item.append(text);
        list.append(item);
      }
      references.append(list);
    }
    section.append(references);

    if (scene.error) {
      const error = el('p', 'film-node__error', scene.error);
      error.setAttribute('role', 'alert');
      section.append(error);
    }
    const buttons = el('div', 'film-node__actions');
    const write = action(
      scene.prompt ? 'Regenerar prompt' : 'Escribir prompt',
      'refresh',
      () => this.regenerate(scene),
      'btn btn-ghost film-scene-action',
    );
    write.disabled = this.busy || scene.sourceRemoved;
    write.dataset.sceneAction = 'regenerate';
    buttons.append(write);
    section.append(buttons);
    return section;
  }

  // ── Editing ──────────────────────────────────────────────────────────
  editPrompt(sceneId, value) {
    this.change((document) => {
      const scene = document.scenes.find((item) => item.id === sceneId);
      const prompt = value.trim().slice(0, 6000);
      scene.prompt = prompt;
      scene.promptSource = prompt ? 'manual' : '';
      scene.promptHash = prompt ? scene.scriptHash : '';
      scene.status = prompt ? 'ready' : 'pending';
      scene.error = '';
      scene.approved = false;
    });
    this.mount();
  }

  // ── Requests ─────────────────────────────────────────────────────────
  chosenScript() {
    return (
      this.scriptSelect?.value ||
      this.scriptId ||
      (this.scripts().length === 1 ? this.scripts()[0].importedProjectId : undefined)
    );
  }
  async generate() {
    if (!this.current() || this.busy) return;
    const scriptProjectId = this.chosenScript();
    await this.jobs.perform({ scope: 'all', ...(scriptProjectId ? { scriptProjectId } : {}) });
  }
  /** Conditioning for every scene, then one preview video at a time. */
  async render() {
    if (!this.current() || this.busy || !this.canRender()) return;
    await this.jobs.perform({}, 'render');
  }
  /** Approve, withdraw approval or redo one scene. Works while a job runs: a redo goes ahead of the rest. */
  async sceneAction(scene, kind) {
    if (!this.current() || this.submitting) return;
    try {
      const flushed = await API.filmSceneAction({
        projectId: this.projectId,
        sceneId: scene.id,
        action: kind,
      });
      if (!this.current()) return;
      await this.acceptBackgroundJob(flushed);
      if (flushed.job && RUNNING_STATES.includes(flushed.job.status) && !this.jobs.watching)
        void this.jobs.observe(flushed.job.id, flushed);
    } catch (error) {
      if (this.current()) this.showNotice(error.message, `scene:${scene.id}:${kind}:${error.message}`);
    }
  }
  regenerate(scene) {
    if (!this.current() || this.busy) return;
    const run = () => {
      Modal.hide();
      const scriptProjectId = this.chosenScript() || this.document.source?.projectId;
      void this.jobs.perform({
        scope: 'scene',
        sceneId: scene.id,
        ...(scriptProjectId ? { scriptProjectId } : {}),
      });
    };
    if (scene.promptSource !== 'manual') return run();
    const body = el('div', 'film-notice');
    body.append(
      el('p', null, 'Editaste este prompt a mano. Al regenerarlo se reemplazará por uno nuevo del modelo.'),
    );
    const buttons = el('div', 'film-node__actions');
    const confirm = action('Reemplazar', 'refresh', run, 'btn btn-primary');
    buttons.append(
      action('Cancelar', 'warning', () => Modal.hide()),
      confirm,
    );
    body.append(buttons);
    Modal.show({ title: 'Regenerar prompt', content: body, initialFocus: confirm });
  }

  updateBoard() {
    if (!this.board) return;
    const failed = this.jobs?.job && ['failed', 'interrupted'].includes(this.jobs.job.status);
    const running = Boolean(this.jobs?.job) && RUNNING_STATES.includes(this.jobs.job.status);
    const intro = !this.hasScenes();
    this.generateButton.disabled = this.busy || !this.scripts().length;
    this.renderButton.disabled = this.busy || !this.canRender();
    this.retryButton.hidden = !failed || this.busy;
    this.cancelButton.hidden = !running;
    this.hint.textContent = this.scripts().length
      ? ''
      : 'Añade un guión como ingrediente de la película (panel de ingredientes) para poder generarla.';
    this.hint.hidden = !this.hint.textContent;
    this.status.textContent = this.busy ? this.statusText || 'Trabajando…' : '';
    this.status.hidden = !this.status.textContent;
    this.board.classList.toggle('is-working', this.busy);
    this.board.setAttribute('aria-busy', String(this.busy));
    for (const button of this.board.querySelectorAll('[data-scene-action]'))
      button.disabled = this.busy || button.closest('.film-row')?.classList.contains('is-removed');
    for (const field of this.board.querySelectorAll('.film-row textarea, .film-row select'))
      field.disabled = this.busy;
    this.wrapper?.classList.toggle('editor-layout-wrapper--film-empty', intro);
  }

  async acceptBackgroundJob({ job, draft }) {
    if (!this.current()) return;
    const busy = Boolean(job) && RUNNING_STATES.includes(job.status);
    const draftChanged = Boolean(draft) && draft.revision !== this.backgroundRevision;
    if (draftChanged || busy !== this.backgroundBusyAccepted) {
      await this.onBackgroundState?.({ busy, ...(draftChanged ? { draft } : {}), mediaChanged: false });
      this.backgroundBusyAccepted = busy;
    }
    if (!this.current()) return;
    this.statusText = busy
      ? job.status === 'queued'
        ? `En cola · posición ${job.position}. Puedes salir; el servidor continuará.`
        : job.message || 'Trabajando…'
      : job?.error || '';
    this.busy = busy;
    if (draftChanged) {
      Object.assign(AppState.currentProject, draft.payload);
      this.document = parseFilmDocument(this.project().content) ?? this.document;
      this.backgroundRevision = draft.revision;
      this.mount();
    } else this.updateBoard();
    if (!busy && job?.error) this.showNotice(job.error, `job:${job.id}:${job.status}:${job.error}`);
  }
  backgroundJobError(error, mayContinue = false) {
    if (!this.current()) return;
    this.busy = mayContinue;
    this.statusText = mayContinue
      ? 'No se pudo consultar el estado. El servidor puede seguir trabajando; recarga para reconectar.'
      : error.message;
    if (!mayContinue) void this.onBackgroundState?.({ busy: false });
    this.updateBoard();
    if (!mayContinue) this.showNotice(error.message, `request:${error.message}`);
  }
  /** Errors are acknowledged in a dialog, once per cause, instead of staying on the canvas. */
  showNotice(message, key) {
    if (!this.current() || !message || this.noticeKeys.has(key)) return;
    this.noticeKeys.add(key);
    const body = el('div', 'film-notice');
    body.append(el('p', null, message));
    const ok = action('Entendido', 'check', () => Modal.hide(), 'btn btn-primary');
    body.append(ok);
    Modal.show({ title: 'No se pudo completar la película', content: body, initialFocus: ok });
  }
}
