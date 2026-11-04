import { AppState } from '../../app-state.js';
import { API } from '../../api-service.js';
import { EventBus } from '../../event-bus.js';
import { Modal } from '../../ui-components.js';
import { renderIcon } from '../../icons.js';
import { safeHTML } from '../../safe-html.js';
import {
  FILM_ASPECT_RATIOS,
  FILM_CONTINUITY_MODES,
  FILM_FRAME_OPTIONS,
  FILM_MAX_SECONDS,
  filmDimensions,
  filmContinuityMode,
  filmFinalBlocked,
  filmGuideKey,
  filmFinalDimensions,
  filmFinalState,
  filmNeedsConditioning,
  filmNeedsFinal,
  filmPictureLabel,
  filmPreviewOutdated,
  filmSceneNeedsPrompt,
  filmScenesOf,
  filmSeconds,
  filmSummary,
  parseFilmDocument,
  prepareFilmProject,
  validateFilmDocument,
} from '../../contracts/film.js';
import { filmRecomposePrompt } from '../../contracts/film-prompt.js';
import { enhanceSelect } from '../../custom-select.js';
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
/** The resolutions offered for the final video, in megapixels (1 MP = 1024 × 1024). */
const FINAL_MEGAPIXELS = Object.freeze([0.5, 0.8, 1, 1.5, 2, 3, 4]);
/** The resolutions offered for the previews, the quick low-resolution pass. */
const PREVIEW_MEGAPIXELS = Object.freeze([0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1]);
/** A rectangle with the proportion of `ratio` ('16:9'), from the registered aspect-frame drawing. */
function aspectFrame(ratio, size = 18) {
  const span = el('span', 'film-aspect');
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = safeHTML(renderIcon('aspect-frame', size));
  const [w, h] = ratio.split(':').map(Number);
  const width = w >= h ? 20 : Math.max(4, Math.round((20 * w) / h));
  const height = w >= h ? Math.max(4, Math.round((20 * h) / w)) : 20;
  const rect = span.querySelector('rect');
  if (rect) {
    rect.setAttribute('x', String(12 - width / 2));
    rect.setAttribute('y', String(12 - height / 2));
    rect.setAttribute('width', String(width));
    rect.setAttribute('height', String(height));
  }
  return span;
}
/** What each way of joining the previous clip does, as the tooltip of the mode selector says it. */
const MODE_HELP = Object.freeze({
  auto: 'Automática: el sistema elige por ti según el guión. Otra escena = escena nueva; otro plano de la misma escena = corte con continuidad. El primer clip de la película no sigue a nadie.',
  take: 'Continuación (misma toma): para un plano que sigue la misma toma que el anterior, sin cambio de cámara (por ejemplo una acción larga que partiste en dos planos). Se genera con 22 fotogramas extra que repiten el final del clip anterior y guían su arranque; esos fotogramas no se reproducen. Necesita el clip anterior de su escena, se genera después de él y queda desactualizado si lo rehaces.',
  cut: 'Corte con continuidad: otro plano de la misma escena con cambio de encuadre (de general a primer plano). El modelo escribe una nota con cómo está la acción al empezar (dónde está cada personaje, su postura, gesto y mirada, y de dónde viene la luz) a partir del final del clip anterior; puedes editarla. Opcionalmente, el último fotograma del anterior viaja como referencia.',
  keyframe:
    'Con fotograma inicial: el modelo de imagen genera un fotograma de arranque para este plano a partir del final del anterior, las fotos de los personajes y el escenario. Lo ves y lo cambias o regeneras antes de gastar GPU en el video, y el video arranca de él. Es el modo con más control; necesita el modelo de imagen de la barra superior.',
  new: 'Escena nueva: otro lugar o momento, sin continuidad de postura ni de gesto con el clip anterior. Solo se conserva el aspecto de la escena (luz, clima, vestuario y objetos).',
});
/** Where a clip starts playing: after the frames that repeat the end of the clip it continues. */
const playFrom = (media) => (media.overlap ? `#t=${(media.overlap / 24).toFixed(3)}` : '');
const sceneKey = (projectId) => `kubrick-film-scene:${projectId}`;

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
 * Feature film workspace. The film is worked one dramatic scene of the script at a time: its clips (shots and their
 * parts) are rows of three nodes, the preview on the left, the prompt and parameters in the middle and the final video,
 * enlarged by the H3 latent upscaler, on the right; arrows go to the previous and next scene. Prompts, conditioning,
 * previews and final videos are made by server jobs that run for the scene on screen; this class requests, observes
 * and lets the author edit, approve or redo. Approving and redoing stay available while a job runs.
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
    this.sceneId = '';
    try {
      this.sceneId = sessionStorage.getItem(sceneKey(this.projectId)) || '';
    } catch {
      // Without storage the film opens on its first scene.
    }
    this.footerNav = null;
    this.selectControls = [];
    this.sceneMode = '';
    this.sceneVideo = null;
    this.node.classList.add('film-anchor');
    this.node.hidden = true;
    // The top bar decides: switching mode or the video model updates the buttons at once.
    this.settingsListener = ({ key }) => {
      if (['inferenceMode', 'inferenceSettings'].includes(key) && this.current()) this.updateBoard();
    };
    EventBus.on('state:change', this.settingsListener);
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
    EventBus.off('state:change', this.settingsListener);
    this.jobs?.destroy();
    this.board?.remove();
    this.board = null;
    for (const { control } of this.selectControls) control.destroy({ restore: false });
    this.selectControls = [];
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
  /** Previews run with the local video model chosen in the top bar, whatever the text and image providers. */
  videoReady() {
    return this.project().inferenceSettings?.videoModel?.model === 'minimax-h3';
  }
  videoHint() {
    return 'Elige el modelo de video local en la barra superior para generar las previsualizaciones.';
  }
  /** The scene of the script on screen: the stored one, or the first when it left the script. */
  pickScene(groups) {
    const group = groups.find((item) => item.id === this.sceneId) || groups[0] || null;
    this.sceneId = group?.id || '';
    return group;
  }
  currentGroup() {
    return this.pickScene(filmScenesOf(this.document));
  }
  goToScene(id) {
    if (!this.current() || id === this.sceneId) return;
    this.sceneId = id;
    try {
      sessionStorage.setItem(sceneKey(this.projectId), id);
    } catch {
      // The choice only lasts while the workspace is open.
    }
    this.mount();
  }
  /** Previews are made for the scene on screen only. */
  canRender() {
    return Boolean(this.currentGroup()?.clips.some((scene) => !scene.sourceRemoved && scene.prompt));
  }
  /** Final videos are made for the approved previews of the scene on screen. */
  canFinalize() {
    return Boolean(
      this.currentGroup()?.clips.some((scene) =>
        filmNeedsFinal(scene, this.document.params, filmGuideKey(this.document, scene)),
      ),
    );
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
    const groups = filmScenesOf(this.document);
    const group = this.pickScene(groups);
    const header = this.buildHeader(intro, groups, group);
    if (this.header) this.header.replaceWith(header);
    else this.board.prepend(header);
    this.header = header;
    const sceneNode = intro ? null : this.syncSceneVideo(group);
    if (!sceneNode) {
      this.sceneVideo?.node.remove();
      this.sceneVideo = null;
    } else if (sceneNode.nextSibling !== header) this.board.insertBefore(sceneNode, header);

    const wanted = new Map();
    for (const [index, scene] of intro ? [] : group.clips.entries()) {
      const signature = JSON.stringify([scene, index]);
      // What each video node depends on; approving or redoing must not restart a clip the author is watching.
      const keys = [
        JSON.stringify([scene.preview, scene.title, index, scene.sourceRemoved]),
        '',
        JSON.stringify([scene.final, scene.title, index, scene.sourceRemoved]),
      ];
      const known = this.rows.get(scene.id);
      if (known?.signature === signature) wanted.set(scene.id, known);
      else {
        const fresh = this.buildRow(scene, index);
        wanted.set(scene.id, {
          signature,
          keys,
          node: known ? this.adopt(known, fresh, keys) : fresh,
        });
      }
    }
    for (const [id, known] of this.rows) if (wanted.get(id)?.node !== known.node) known.node.remove();
    this.footerNav?.remove();
    let cursor = header.nextSibling;
    for (const { node } of wanted.values()) {
      if (cursor === node) cursor = cursor.nextSibling;
      else this.board.insertBefore(node, cursor);
    }
    this.footerNav = intro ? null : this.buildSceneNav(groups, group);
    if (this.footerNav) this.board.append(this.footerNav);
    this.rows = wanted;
    this.sweepSelects();
    this.updateBoard();
  }
  /**
   * Updates a row in place: a video node whose video did not change keeps its element, so a clip the author is
   * watching keeps playing; everything else is replaced.
   */
  adopt(known, fresh, keys) {
    const row = known.node;
    const olds = [...row.children];
    const news = [...fresh.children];
    for (const [index, old] of olds.entries()) {
      const next = news[index];
      const frame = old.querySelector('.film-video-frame');
      if (index === 1 || !frame || known.keys[index] !== keys[index]) {
        old.replaceWith(next);
        continue;
      }
      while (frame.nextSibling) frame.nextSibling.remove();
      let rest = next.querySelector('.film-video-frame').nextSibling;
      while (rest) {
        const after = rest.nextSibling;
        old.append(rest);
        rest = after;
      }
    }
    row.classList.toggle('is-removed', fresh.classList.contains('is-removed'));
    return row;
  }
  /**
   * The video of the whole scene: its clips played one after another, either the previews or the final videos. A
   * version plays only when every clip of the scene has it; until then the node says how many are missing. The node is
   * rebuilt only when what it plays changes, so a scene being watched is not restarted by unrelated edits.
   */
  syncSceneVideo(group) {
    const params = this.document.params;
    const live = group.clips.filter((clip) => !clip.sourceRemoved);
    const versions = {
      preview: live.map((clip) =>
        clip.preview && !filmPreviewOutdated(clip, params, filmGuideKey(this.document, clip))
          ? `${clip.preview.url}?v=${clip.preview.version}${playFrom(clip.preview)}`
          : null,
      ),
      final: live.map((clip) =>
        clip.final && filmFinalState(clip, params) === 'ready'
          ? `${clip.final.url}?v=${clip.final.version}${playFrom(clip.final)}`
          : null,
      ),
    };
    const complete = (mode) => live.length > 0 && versions[mode].every(Boolean);
    const mode = this.sceneMode || (complete('final') ? 'final' : 'preview');
    const signature = JSON.stringify([group.id, mode, versions]);
    if (this.sceneVideo?.signature === signature) return this.sceneVideo.node;
    const section = el('section', 'character-node film-node film-node--scene');
    section.setAttribute('aria-label', `Video de la escena ${group.number}`);
    const header = el('header', 'film-node__header');
    header.append(el('h2', 'character-eyebrow', `VIDEO DE LA ESCENA ${group.number}`));
    const nav = el('nav', 'film-scene-nav');
    nav.setAttribute('aria-label', 'Versión de la escena completa');
    const previous = iconButton('Ver la escena en previsualización', 'chevron-left', () =>
      this.showSceneVersion('preview'),
    );
    previous.dataset.sceneVersion = 'preview';
    previous.disabled = mode === 'preview';
    const next = iconButton('Ver la escena en resolución final', 'chevron-right', () =>
      this.showSceneVersion('final'),
    );
    next.dataset.sceneVersion = 'final';
    next.disabled = mode === 'final';
    const label = el('p', 'film-scene-nav__label');
    label.append(
      el('strong', null, 'ESCENA COMPLETA'),
      el('span', null, mode === 'final' ? 'Resolución final' : 'Previsualización'),
    );
    label.setAttribute('aria-live', 'polite');
    nav.append(previous, label, next);
    const frame = el('div', 'film-video-frame film-video-frame--scene');
    const urls = versions[mode];
    const missing = urls.filter((url) => !url).length;
    const caption = el('p', 'film-node__state');
    caption.setAttribute('role', 'status');
    if (complete(mode)) {
      frame.classList.add('has-video');
      const video = el('video', 'film-video');
      video.controls = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.setAttribute('aria-label', `Escena ${group.number} completa`);
      let at = 0;
      const show = () => {
        video.src = urls[at];
        caption.textContent = `Clip ${at + 1} de ${urls.length}`;
      };
      // The clips follow one another; after the last one the scene is ready to play again from the first.
      video.addEventListener('ended', () => {
        const last = at >= urls.length - 1;
        at = last ? 0 : at + 1;
        show();
        if (!last) void video.play?.()?.catch?.(() => {});
      });
      show();
      frame.append(video);
    } else {
      frame.setAttribute('role', 'img');
      frame.setAttribute('aria-label', 'La escena completa aún no está disponible');
      frame.append(glyph('video', 56), el('span', 'film-video-frame__text', 'Escena aún no disponible'));
      caption.textContent = !live.length
        ? 'Esta escena no tiene clips.'
        : mode === 'final'
          ? `Faltan ${missing} de ${urls.length} videos finales para ver la escena completa en resolución final.`
          : `Faltan ${missing} de ${urls.length} previsualizaciones para ver la escena completa.`;
    }
    section.append(header, nav, frame, caption);
    if (this.sceneVideo?.node.isConnected) this.sceneVideo.node.replaceWith(section);
    this.sceneVideo = { signature, node: section };
    return section;
  }
  showSceneVersion(mode) {
    if (!this.current() || this.sceneMode === mode) return;
    this.sceneMode = mode;
    this.mount();
  }
  /** Arrows at both ends: the previous and the next scene of the script, when there is one. */
  buildSceneNav(groups, group) {
    const nav = el('nav', 'film-scene-nav');
    nav.setAttribute('aria-label', 'Escenas de la película');
    const at = groups.indexOf(group);
    const previous = iconButton('Escena anterior', 'chevron-left', () => this.goToScene(groups[at - 1].id));
    previous.dataset.sceneNav = 'previous';
    previous.disabled = at <= 0;
    const next = iconButton('Escena siguiente', 'chevron-right', () => this.goToScene(groups[at + 1].id));
    next.dataset.sceneNav = 'next';
    next.disabled = at < 0 || at >= groups.length - 1;
    const label = el('p', 'film-scene-nav__label');
    label.append(
      el('strong', null, `ESCENA ${group.number} DE ${groups.length}`),
      el('span', null, group.place || ''),
    );
    label.setAttribute('aria-live', 'polite');
    nav.append(previous, label, next);
    return nav;
  }
  buildHeader(intro, groups = [], group = null) {
    const header = el('header', 'character-node film-header');
    const title = el('div', 'film-header__title');
    title.append(el('h2', 'character-eyebrow', intro ? 'PELÍCULA' : 'CONTROL DE ESCENA'));
    if (intro) {
      title.append(
        el('h3', 'film-header__heading', 'Crea la película a partir de ingredientes'),
        el(
          'p',
          'film-header__text',
          'Cada plano del guión se convierte en un clip independiente de como máximo 10 segundos, agrupado por su escena, con su prompt para MiniMax H3. Vincula el guión, los personajes y los escenarios como ingredientes.',
        ),
      );
    } else {
      const summary = filmSummary(this.document);
      const live = this.document.scenes.filter((scene) => !scene.sourceRemoved);
      const previews = live.filter((scene) => scene.preview).length;
      const approved = live.filter((scene) => scene.approved).length;
      const finals = live.filter((scene) => filmFinalState(scene, this.document.params) === 'ready').length;
      const failed = live.filter((scene) => scene.status === 'failed').length;
      title.append(
        el(
          'p',
          'film-header__text',
          `${groups.length} ${groups.length === 1 ? 'escena' : 'escenas'} · ${summary.total} ${summary.total === 1 ? 'clip' : 'clips'} · ${summary.ready} con prompt${failed ? ` · ${failed} sin poder escribirse` : ''} · ${previews} previsualizados · ${approved} aprobados · ${finals} en video final · ${duration(Math.round(summary.seconds))} de metraje`,
        ),
      );
    }
    header.append(title);
    if (!intro && group) header.append(this.buildSceneNav(groups, group));
    const fields = el('div', 'film-header__fields');
    const scripts = this.scripts();
    if (scripts.length > 1) {
      const label = this.field(
        'Guión',
        scripts.map((item) => ({
          value: item.importedProjectId,
          text: item.importedProjectName || item.label || 'Guión',
        })),
        this.scriptId || this.document.source?.projectId || scripts[0].importedProjectId,
        (value) => {
          this.scriptId = value;
        },
      );
      this.scriptSelect = label.querySelector('select');
      fields.append(label);
    } else this.scriptSelect = null;
    if (!intro) fields.append(...this.buildResolutionFields());
    const controls = el('div', 'film-header__controls');
    this.generateButton = action(
      intro ? 'Generar película a partir de ingredientes' : 'Actualizar desde el guión',
      intro ? 'video' : 'refresh',
      () => this.generate(),
      intro ? 'btn btn-primary' : 'btn btn-ghost',
    );
    this.renderButton = action('Generar previsualizaciones', 'play', () => this.render(), 'btn btn-primary');
    this.renderButton.hidden = intro;
    this.finalButton = action('Generar videos finales', 'play', () => this.renderFinal(), 'btn btn-primary');
    this.finalButton.hidden = intro;
    this.discardRemovedButton = action(
      'Descartar los clips fuera del guión',
      'close',
      () => void this.discardRemoved(),
    );
    this.discardRemovedButton.hidden = !this.document.scenes.some((scene) => scene.sourceRemoved);
    this.retryButton = action('Reintentar', 'refresh', () => void this.jobs.retry());
    this.retryFailedButton = action('Reintentar los fallidos', 'refresh', () => void this.retryFailed());
    this.retryFailedButton.hidden = true;
    this.cancelButton = action('Cancelar', 'warning', () => void this.jobs.cancel());
    this.status = el('p', 'film-header__status');
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.hint = el('p', 'film-header__hint');
    controls.append(
      this.generateButton,
      this.retryFailedButton,
      this.renderButton,
      this.finalButton,
      this.discardRemovedButton,
      this.retryButton,
      this.cancelButton,
    );
    header.append(fields, controls, this.status, this.hint);
    const look = group && this.document.looks[group.id];
    if (!intro && look)
      header.append(el('p', 'film-header__hint film-header__look', `Aspecto de la escena · ${look.text}`));
    const failed = this.document.scenes.filter((scene) => scene.status === 'failed' && !scene.sourceRemoved);
    if (failed.length) header.append(this.buildFailures(failed));
    return header;
  }
  /**
   * A labelled selector in the application's own glass design (never the browser's). `choices` are
   * `{value, text, aspect?}`; an aspect choice is drawn with a rectangle of its proportion.
   */
  field(labelText, choices, value, onChange, { searchable = false } = {}) {
    const label = el('label', 'film-field');
    label.append(el('span', 'film-field__label', labelText));
    const select = el('select', 'input');
    for (const choice of choices) {
      const option = el('option', null, choice.text);
      option.value = choice.value;
      if (choice.aspect) option.dataset.aspect = choice.aspect;
      if (choice.title) option.title = choice.title;
      select.append(option);
    }
    select.value = value;
    select.title = choices.find((choice) => choice.value === value)?.title || '';
    select.addEventListener('change', () => onChange(select.value));
    label.append(select);
    this.enhance(select, {
      searchable,
      label: (option) => {
        if (!option?.dataset.aspect) return null;
        const row = el('span', 'film-aspect-option');
        row.append(aspectFrame(option.dataset.aspect), el('span', null, option.textContent));
        return row;
      },
    });
    return label;
  }
  /** Turns a select into the application's own control; it is released when its select leaves the page. */
  enhance(select, options) {
    this.selectControls.push({ select, control: enhanceSelect(select, options) });
  }
  /** Releases the controls whose select is no longer in the page (a rebuilt header or row). */
  sweepSelects() {
    this.selectControls = this.selectControls.filter(({ select, control }) => {
      if (select.isConnected) return true;
      control.destroy({ restore: false });
      return false;
    });
  }
  /** Aspect ratio, preview resolution and final resolution of the film, as selectors. */
  buildResolutionFields() {
    const params = this.document.params;
    const sizeLabel = (megapixels) => {
      const { width, height } = filmDimensions({ ...params, megapixels });
      return `${String(megapixels).replace('.', ',')} MP · ${width}×${height}`;
    };
    const megapixelChoices = (list, current) =>
      [...new Set([...list, current])]
        .sort((a, b) => a - b)
        .map((value) => ({ value: String(value), text: sizeLabel(value) }));
    const aspects = FILM_ASPECT_RATIOS.some((item) => item.value === params.aspectRatio)
      ? FILM_ASPECT_RATIOS
      : [...FILM_ASPECT_RATIOS, { value: params.aspectRatio, name: 'Personalizada' }];
    const set = (key) => (value) => {
      this.change((document) => {
        document.params[key] = key === 'aspectRatio' ? value : Number(value);
      });
      this.mount();
    };
    return [
      this.field(
        'Relación de aspecto',
        aspects.map((item) => ({
          value: item.value,
          text: `${item.value} · ${item.name}`,
          aspect: item.value,
        })),
        params.aspectRatio,
        set('aspectRatio'),
        { searchable: true },
      ),
      this.field(
        'Resolución previsualización',
        megapixelChoices(PREVIEW_MEGAPIXELS, params.megapixels),
        String(params.megapixels),
        set('megapixels'),
      ),
      this.field(
        'Resolución final',
        megapixelChoices(FINAL_MEGAPIXELS, params.finalMegapixels),
        String(params.finalMegapixels),
        set('finalMegapixels'),
      ),
    ];
  }
  /** What could not be written, in the board and not in a dialog: each clip with its reason. */
  buildFailures(failed) {
    const box = el('section', 'film-failures');
    box.setAttribute('role', 'alert');
    box.append(
      el(
        'h3',
        'film-failures__title',
        `${failed.length} ${failed.length === 1 ? 'clip no tiene' : 'clips no tienen'} prompt todavía`,
      ),
    );
    const list = el('ul', 'film-failures__list');
    for (const scene of failed.slice(0, 5)) {
      const item = el('li', 'film-failures__item');
      item.append(
        el('strong', null, scene.title),
        el('span', null, scene.error || 'No se pudo escribir el prompt.'),
      );
      list.append(item);
    }
    if (failed.length > 5) list.append(el('li', 'film-failures__item', `Y ${failed.length - 5} más.`));
    box.append(
      list,
      el(
        'p',
        'film-failures__hint',
        'Lo demás está guardado. Corrige el motivo y reintenta solo los que fallaron.',
      ),
    );
    return box;
  }
  buildRow(scene, index) {
    const row = el('article', 'film-row');
    row.dataset.sceneId = scene.id;
    row.dataset.sourceSceneId = scene.sourceSceneId;
    row.dataset.sourceShotId = scene.sourceShotId;
    if (scene.sourceRemoved) row.classList.add('is-removed');
    row.append(
      this.buildVideoNode(scene, index),
      this.buildParamsNode(scene, index),
      this.buildFinalNode(scene, index),
    );
    return row;
  }
  /** The right node: the approved preview enlarged and refined by the H3 latent upscaler. */
  buildFinalNode(scene, index) {
    const params = this.document.params;
    const section = el('section', 'character-node film-node film-node--final');
    section.setAttribute('aria-label', `Video final del plano ${index + 1}`);
    const header = el('header', 'film-node__header');
    header.append(
      el('h2', 'character-eyebrow', 'VIDEO FINAL · H3 LUP'),
      el('h3', 'film-node__title', scene.title),
    );
    const frame = el('div', 'film-video-frame');
    const state = filmFinalState(scene, params);
    if (scene.final) {
      frame.classList.add('has-video');
      const video = el('video', 'film-video');
      video.src = `${scene.final.url}?v=${scene.final.version}`;
      video.controls = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.setAttribute('aria-label', `Video final del plano ${index + 1}`);
      frame.append(video);
    } else {
      frame.setAttribute('role', 'img');
      frame.setAttribute('aria-label', 'Aún sin video final');
      frame.append(glyph('video', 56), el('span', 'film-video-frame__text', 'Sin video final'));
    }
    const blocked = filmFinalBlocked(scene, params, filmGuideKey(this.document, scene));
    const text =
      scene.render === 'finalizing'
        ? 'Escalando con H3 LUp…'
        : state === 'stale'
          ? 'El video final es de una previsualización o resolución anterior'
          : state === 'none' && blocked
            ? blocked
            : state === 'none'
              ? 'Pendiente de generar el video final'
              : '';
    const note = el('p', 'film-node__state', text);
    note.setAttribute('role', 'status');
    note.hidden = !text;
    if (scene.render === 'finalizing') note.classList.add('is-working');
    const target = scene.preview ? filmFinalDimensions(scene.preview, params.finalMegapixels) : null;
    const meta = el(
      'span',
      'film-node__meta',
      scene.final
        ? `${duration(filmSeconds(scene.final.frames))} · 24 fps · ${scene.final.width}×${scene.final.height}${state === 'ready' ? ' · Al día' : ''}`
        : target
          ? `Destino ${target.width}×${target.height}`
          : '',
    );
    const actions = el('div', 'film-video-actions');
    actions.append(meta);
    section.append(header, frame, actions, note);
    return section;
  }
  renderState(scene) {
    if (scene.render === 'conditioning') return 'Preparando el conditioning…';
    if (scene.render === 'generating') return 'Generando la previsualización…';
    if (scene.redo > 0) return 'En cola para rehacerla';
    if (scene.preview && scene.conditioning && scene.preview.key !== scene.conditioning.key)
      return 'La previsualización es de un prompt anterior';
    if (scene.preview && filmPreviewOutdated(scene, this.document.params, filmGuideKey(this.document, scene)))
      return 'La previsualización es de otra resolución, proporción o continuidad';
    if (scene.prompt && filmNeedsConditioning(scene)) return 'Pendiente de generar';
    return '';
  }
  buildVideoNode(scene, index) {
    const section = el('section', 'character-node film-node film-node--video');
    section.setAttribute('aria-label', `Video del plano ${index + 1}`);
    const header = el('header', 'film-node__header');
    header.append(
      el(
        'h2',
        'character-eyebrow',
        `PREVISUALIZACIÓN · PLANO ${
          [
            ...new Set(
              this.document.scenes
                .filter((item) => item.sourceSceneId === scene.sourceSceneId)
                .map((item) => item.sourceShotId),
            ),
          ].indexOf(scene.sourceShotId) + 1
        }${scene.sourceParts > 1 ? ` · PARTE ${scene.sourcePart}/${scene.sourceParts}` : ''}`,
      ),
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
      video.setAttribute('aria-label', `Previsualización del plano ${index + 1}`);
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
    redo.dataset.rerunOk = 'false';
    redo.disabled =
      scene.sourceRemoved || scene.redo > 0 || !scene.conditioning || filmNeedsConditioning(scene);
    const meta = filmDimensions(this.document.params);
    actions.append(
      approve,
      redo,
      el(
        'span',
        'film-node__meta',
        `${duration(filmSeconds(scene.preview ? scene.preview.frames - (scene.preview.overlap || 0) : scene.frames))} · 24 fps · ${scene.preview?.width ?? meta.width}×${scene.preview?.height ?? meta.height}${scene.approved ? ' · Aprobada' : ''}`,
      ),
    );
    section.append(header, frame, actions, state);
    // How the clip starts after the previous one lives with its preview, which fills the node under the video.
    section.append(this.buildContinuity(scene));
    if (scene.renderError) {
      const error = el('p', 'film-node__error', scene.renderError);
      error.setAttribute('role', 'alert');
      section.append(error);
    }
    if (scene.sourceRemoved) {
      section.append(
        el(
          'p',
          'film-node__notice film-node__notice--removed',
          'Este clip ya no está en el guión (suele pasar con un plano que se dividió en partes). Se conserva por si lo recuperas; puedes descartarlo.',
        ),
      );
      const discard = action(
        'Descartar este clip',
        'close',
        () => void this.discard(scene),
        'btn btn-primary',
      );
      discard.dataset.filmDiscard = 'true';
      section.append(discard);
    }
    return section;
  }
  statusOf(scene) {
    if (scene.sourceRemoved) return 'Plano eliminado del guión';
    if (scene.status === 'ready' && filmSceneNeedsPrompt(scene)) return 'El guión cambió; se reescribirá';
    return STATUS_LABELS[scene.status];
  }
  buildParamsNode(scene, index) {
    const section = el('section', 'character-node film-node film-node--params');
    section.setAttribute('aria-label', `Parámetros del plano ${index + 1}`);
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
      Object.assign(el('small', 'film-field__help', `Máximo ${FILM_MAX_SECONDS} s por plano.`), {
        id: `film-limit-${scene.id}`,
      }),
    );
    this.enhance(select, { searchable: false });
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
        el('p', 'film-references__empty', 'Sin personajes ni escenarios vinculados en este plano.'),
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
    for (const note of scene.referenceNotes || []) {
      const warning = el('p', 'film-references__warning', note);
      warning.setAttribute('role', 'note');
      references.append(warning);
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

  /** Changes one clip and puts its prompt together again, for what the prompt is made of (mode, note, references). */
  updateClip(id, fn) {
    this.change((document) => {
      const node = document.scenes.find((item) => item.id === id);
      fn(node, document);
      node.prompt = filmRecomposePrompt(document, node);
    });
    this.mount();
  }
  /** How the clip joins the previous one: the mode, the note, the last frame as a reference and the start frame. */
  buildContinuity(scene) {
    const box = el('div', 'film-continuity');
    box.append(el('span', 'film-field__label', 'Continuidad con el plano anterior'));
    const mode = filmContinuityMode(this.document, scene);
    if (mode === 'none') {
      box.append(el('p', 'film-references__empty', 'Es el primer clip de la película: no sigue a otro.'));
      return box;
    }
    const names = {
      take: 'Continuación (misma toma)',
      cut: 'Corte con continuidad',
      keyframe: 'Con fotograma inicial',
      new: 'Escena nueva',
    };
    const choices = FILM_CONTINUITY_MODES.map((value) => ({
      value,
      text: value === 'auto' ? `Automática · ${names[mode]}` : names[value],
      title: MODE_HELP[value],
    }));
    box.append(
      this.field('Modo', choices, scene.continuity.mode, (value) =>
        this.updateClip(scene.id, (node) => {
          node.continuity.mode = value;
        }),
      ),
    );
    const hint = {
      take: 'El clip sigue la misma toma: se genera con 22 fotogramas más que repiten el final del anterior y guían su arranque. Esos fotogramas no se reproducen.',
      cut: 'Otro plano de la misma escena: la nota describe cómo está la acción al empezar, y el último fotograma del anterior puede ir como referencia.',
      keyframe:
        'Se genera un fotograma inicial para el plano, a partir del final del anterior y de las referencias, y el video arranca de él.',
      new: 'Otra escena: solo se conserva el aspecto de la escena (luz, clima, vestuario).',
    }[mode];
    if (hint) box.append(el('small', 'film-field__help', hint));
    if (['cut', 'keyframe', 'take'].includes(mode)) {
      const label = el('label', 'film-field film-field--note');
      label.append(
        el(
          'span',
          'film-field__label',
          scene.continuity.noteSource === 'manual'
            ? 'Nota de continuidad (editada por ti)'
            : 'Nota de continuidad',
        ),
      );
      const area = el('textarea', 'input character-text-input film-note');
      area.value = scene.continuity.note;
      area.maxLength = 900;
      area.rows = 3;
      area.placeholder = 'Dónde está cada personaje, cómo está y qué sostiene al empezar este plano.';
      area.spellcheck = false;
      area.addEventListener('change', () =>
        this.updateClip(scene.id, (node) => {
          node.continuity.note = area.value.trim().slice(0, 900);
          node.continuity.noteSource = node.continuity.note ? 'manual' : '';
        }),
      );
      label.append(area);
      box.append(label);
      const write = action(
        'Escribir la nota con IA',
        'refresh',
        () => void this.writeContinuity(scene),
        'btn btn-ghost film-scene-action',
      );
      write.dataset.sceneAction = 'continuity';
      write.disabled = this.busy;
      box.append(write);
    }
    if (mode === 'cut') {
      const frame = action(
        `Último fotograma del plano anterior como referencia: ${scene.continuity.frame ? 'sí' : 'no'}`,
        'check',
        () =>
          this.updateClip(scene.id, (node) => {
            node.continuity.frame = !node.continuity.frame;
          }),
        `btn btn-ghost${scene.continuity.frame ? ' is-active' : ''}`,
      );
      frame.setAttribute('aria-pressed', String(scene.continuity.frame));
      frame.dataset.continuityFrame = 'true';
      box.append(frame);
    }
    if (mode === 'keyframe') {
      const start = scene.continuity.start;
      const preview = el('div', 'film-keyframe');
      if (start) {
        const image = el('img', 'film-keyframe__image');
        image.src = start.url;
        image.alt = 'Fotograma inicial del plano';
        image.loading = 'lazy';
        preview.append(image);
      } else preview.append(el('p', 'film-references__empty', 'Aún sin fotograma inicial.'));
      box.append(preview);
      const make = action(
        start ? 'Generar otro fotograma inicial' : 'Generar el fotograma inicial',
        'refresh',
        () => void this.makeKeyframe(scene),
        'btn btn-ghost film-scene-action',
      );
      make.dataset.sceneAction = 'keyframe';
      make.disabled = this.busy;
      box.append(make);
      if (start)
        box.append(
          action(
            'Quitar el fotograma inicial',
            'close',
            () =>
              this.updateClip(scene.id, (node) => {
                node.continuity.start = null;
                node.approved = false;
              }),
            'btn btn-ghost',
          ),
        );
    }
    return box;
  }
  /** The note of continuity written again by the model, from how the previous clip ends. */
  async writeContinuity(scene) {
    if (!this.current() || this.busy) return;
    const scriptProjectId = this.chosenScript() || this.document.source?.projectId;
    await this.jobs.perform({
      scope: 'continuity',
      sceneId: scene.id,
      ...(scriptProjectId ? { scriptProjectId } : {}),
    });
  }
  /** A start frame for the shot, made by the image model of the top bar. The clip takes the keyframe mode. */
  async makeKeyframe(scene) {
    if (!this.current() || this.busy) return;
    if (scene.continuity.mode !== 'keyframe')
      this.updateClip(scene.id, (node) => {
        node.continuity.mode = 'keyframe';
      });
    const scriptProjectId = this.chosenScript() || this.document.source?.projectId;
    await this.jobs.perform({
      scope: 'keyframe',
      sceneId: scene.id,
      ...(scriptProjectId ? { scriptProjectId } : {}),
    });
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
  /** Takes a clip that left the script out of the film, with its prompt; its video stays on disk. */
  async discard(scene) {
    if (!this.current() || this.busy) return;
    const confirmed = await Modal.confirm({
      title: 'Descartar clip',
      message: `«${scene.title}» ya no está en el guión. Se quitará de la película con su prompt y su aprobación; su video sigue en el disco.\n\n¿Descartarlo?`,
      confirmLabel: 'Descartar',
      type: 'warning',
    });
    if (!confirmed || !this.current()) return;
    this.change((document) => {
      document.scenes = document.scenes.filter((item) => item.id !== scene.id);
    });
    this.mount();
  }
  /** Writes again only the prompts that could not be written. */
  async retryFailed() {
    if (!this.current() || this.busy) return;
    const scriptProjectId = this.chosenScript() || this.document.source?.projectId;
    await this.jobs.perform({ scope: 'failed', ...(scriptProjectId ? { scriptProjectId } : {}) });
  }
  /** Conditioning for the clips of the scene on screen, then one preview video at a time. */
  async render() {
    if (!this.current() || this.busy || !this.canRender()) return;
    await this.jobs.perform({ sourceSceneId: this.sceneId, stage: 'preview' }, 'render');
  }
  /** The approved previews of the scene on screen, enlarged and refined by the H3 latent upscaler. */
  async renderFinal() {
    if (!this.current() || this.busy || !this.canFinalize()) return;
    await this.jobs.perform({ sourceSceneId: this.sceneId, stage: 'final' }, 'render');
  }
  /** Takes every clip that left the script out of the film, after the author confirms. */
  async discardRemoved() {
    if (!this.current() || this.busy) return;
    const gone = this.document.scenes.filter((scene) => scene.sourceRemoved);
    if (!gone.length) return;
    const confirmed = await Modal.confirm({
      title: 'Descartar clips',
      message: `${gone.length === 1 ? 'Hay 1 clip que ya no está' : `Hay ${gone.length} clips que ya no están`} en el guión (suelen ser planos que se dividieron en partes). Se quitarán de la película con sus prompts y aprobaciones; sus videos siguen en el disco.\n\n¿Descartarlos?`,
      confirmLabel: 'Descartar',
      type: 'warning',
    });
    if (!confirmed || !this.current()) return;
    this.change((document) => {
      document.scenes = document.scenes.filter((scene) => !scene.sourceRemoved);
    });
    this.mount();
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
    this.renderButton.disabled = this.busy || !this.canRender() || !this.videoReady();
    this.finalButton.disabled = this.busy || !this.canFinalize() || !this.videoReady();
    this.discardRemovedButton.disabled = this.busy;
    for (const { select } of this.selectControls) select.disabled = this.busy;
    this.retryButton.hidden = !failed || this.busy;
    this.retryFailedButton.hidden =
      this.busy || !this.document.scenes.some((scene) => scene.status === 'failed' && !scene.sourceRemoved);
    this.retryFailedButton.disabled = !this.scripts().length;
    this.cancelButton.hidden = !running;
    this.hint.textContent = !this.scripts().length
      ? 'Añade un guión como ingrediente de la película (panel de ingredientes) para poder generarla.'
      : this.canRender() && !this.videoReady()
        ? this.videoHint()
        : '';
    // A redo needs the same video model, on top of the per-scene conditions.
    for (const button of this.board.querySelectorAll('[data-render-action="redo"]')) {
      if (button.dataset.baseDisabled === undefined) button.dataset.baseDisabled = String(button.disabled);
      button.disabled = button.dataset.baseDisabled === 'true' || !this.videoReady();
      button.title =
        this.videoReady() || button.dataset.baseDisabled === 'true'
          ? 'Rehacer previsualización'
          : this.videoHint();
    }
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
    // Prompts that could not be written are listed in the board with their reasons; a dialog is for the rest.
    const listed = this.document.scenes.some((scene) => scene.status === 'failed' && !scene.sourceRemoved);
    if (!busy && job?.error && !listed)
      this.showNotice(job.error, `job:${job.id}:${job.status}:${job.error}`);
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
