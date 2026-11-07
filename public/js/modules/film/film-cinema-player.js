import { FILM_FPS } from '../../contracts/film.js';
import { renderIcon } from '../../icons.js';
import { safeHTML } from '../../safe-html.js';

const cinemaNode = (tag, className, text) => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const cinemaTime = (seconds) => {
  const value = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
};

/** A scene playlist with one seekable clock. Playback state never enters the film document. */
export class FilmCinemaPlayer {
  constructor({ clips, sceneNumber, mode, missing = 0, aspectRatio = '16:9' }) {
    this.clips = clips;
    this.at = 0;
    this.destroyed = false;
    this.playing = false;
    this.pendingSeek = null;
    this.abort = new AbortController();
    this.lengths = clips.map((clip) => Math.max(0, (clip.frames - (clip.overlap || 0)) / FILM_FPS));
    this.element = cinemaNode('div', 'film-cinema');
    this.element.style.aspectRatio = aspectRatio.replace(':', ' / ');
    const heading = cinemaNode('header', 'film-cinema__heading');
    heading.append(cinemaNode('h2', 'character-eyebrow', 'MODO CINE'));
    heading.append(
      cinemaNode(
        'span',
        'film-cinema__version',
        `Escena ${sceneNumber} · ${mode === 'final' ? 'Final' : 'Previsualización'}`,
      ),
    );
    this.element.append(heading);
    this.status = cinemaNode('p', 'film-cinema__status');
    this.status.setAttribute('role', 'status');
    if (missing || !clips.length) {
      this.element.classList.add('is-empty');
      const message = !clips.length
        ? 'Esta escena no tiene clips.'
        : mode === 'final'
          ? `Faltan ${missing} de ${clips.length} videos finales para ver la escena completa.`
          : `Faltan ${missing} de ${clips.length} previsualizaciones para ver la escena completa.`;
      this.status.textContent = message;
      this.element.append(this.status);
      return;
    }
    const video = (this.video = cinemaNode('video', 'film-cinema__video'));
    video.controls = false;
    video.playsInline = true;
    video.preload = 'metadata';
    video.setAttribute('aria-label', `Reproducir o pausar la escena ${sceneNumber}`);
    video.setAttribute('role', 'button');
    video.tabIndex = 0;
    this.listen(video, 'click', () => this.toggle());
    this.listen(video, 'keydown', (event) => {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        this.toggle();
      }
    });
    const controls = cinemaNode('div', 'film-cinema__controls');
    this.seek = cinemaNode('input', 'film-cinema__seek');
    this.seek.type = 'range';
    this.seek.min = '0';
    this.seek.step = '0.01';
    this.seek.value = '0';
    this.seek.setAttribute('aria-label', 'Posición en la escena completa');
    this.listen(this.seek, 'input', () => this.seekTo(Number(this.seek.value)));
    const buttons = cinemaNode('div', 'film-cinema__buttons');
    this.playButton = this.button('Reproducir', 'play', () => this.toggle());
    this.clock = cinemaNode('output', 'film-cinema__clock');
    this.clipLabel = cinemaNode('span', 'film-cinema__clip');
    this.muteButton = this.button('Silenciar', 'volume', () => {
      video.muted = !video.muted;
      this.update();
    });
    this.volume = cinemaNode('input', 'film-cinema__volume');
    this.volume.type = 'range';
    this.volume.min = '0';
    this.volume.max = '1';
    this.volume.step = '0.05';
    this.volume.value = '1';
    this.volume.setAttribute('aria-label', 'Volumen');
    this.listen(this.volume, 'input', () => {
      video.volume = Number(this.volume.value);
      video.muted = video.volume === 0;
      this.update();
    });
    this.fullscreen = this.button('Pantalla completa', 'expand', async () => {
      try {
        if (document.fullscreenElement === this.element) await document.exitFullscreen?.();
        else await this.element.requestFullscreen?.();
      } catch {
        this.status.textContent = 'No se pudo abrir la pantalla completa.';
      }
    });
    this.listen(document, 'fullscreenchange', () => {
      this.fullscreen.title =
        document.fullscreenElement === this.element ? 'Salir de pantalla completa' : 'Pantalla completa';
      this.fullscreen.setAttribute('aria-label', this.fullscreen.title);
    });
    buttons.append(
      this.playButton,
      this.clock,
      this.clipLabel,
      this.muteButton,
      this.volume,
      this.fullscreen,
    );
    controls.append(this.seek, buttons);
    this.loader = cinemaNode('span', 'film-cinema__loader');
    this.loader.setAttribute('aria-hidden', 'true');
    this.loader.innerHTML = safeHTML(renderIcon('kubrick', 48));
    this.loader.hidden = true;
    this.element.append(video, this.loader, controls, this.status);
    this.listen(video, 'loadedmetadata', () => {
      const clip = this.clips[this.at];
      const offset = (clip.overlap || 0) / FILM_FPS;
      if (Number.isFinite(video.duration) && video.duration > offset)
        this.lengths[this.at] = video.duration - offset;
      if (video.videoWidth && video.videoHeight)
        this.element.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
      this.applySeek();
      this.update();
    });
    this.listen(video, 'timeupdate', () => this.update());
    this.listen(video, 'play', () => {
      this.playing = true;
      this.update();
    });
    this.listen(video, 'pause', () => {
      if (!video.ended) this.playing = false;
      this.update();
    });
    this.listen(video, 'waiting', () => {
      this.loader.hidden = false;
    });
    this.listen(video, 'playing', () => {
      this.loader.hidden = true;
      this.status.textContent = '';
    });
    this.listen(video, 'canplay', () => {
      this.loader.hidden = true;
    });
    this.listen(video, 'volumechange', () => this.update());
    this.listen(video, 'error', () => {
      this.playing = false;
      this.loader.hidden = true;
      this.status.textContent = 'No se pudo cargar este clip. Pulsa reproducir para reintentar.';
      this.update();
    });
    this.listen(video, 'ended', () => {
      if (this.at < this.clips.length - 1) this.show(this.at + 1, 0, true);
      else {
        this.playing = false;
        this.seek.value = String(this.total());
        this.clock.textContent = `${cinemaTime(this.total())} / ${cinemaTime(this.total())}`;
        this.setPlayIcon();
      }
    });
    this.show(0, 0, false);
  }
  listen(target, event, callback) {
    target.addEventListener(event, callback, { signal: this.abort.signal });
  }
  button(label, icon, callback) {
    const button = cinemaNode('button', 'film-cinema__button');
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = safeHTML(renderIcon(icon, 22));
    this.listen(button, 'click', callback);
    return button;
  }
  total() {
    return this.lengths.reduce((sum, length) => sum + length, 0);
  }
  before(index) {
    return this.lengths.slice(0, index).reduce((sum, length) => sum + length, 0);
  }
  show(index, seconds, autoplay) {
    if (this.destroyed) return;
    this.at = index;
    this.playing = autoplay;
    this.pendingSeek = seconds + (this.clips[index].overlap || 0) / FILM_FPS;
    const clip = this.clips[index];
    const fragment = clip.overlap ? `#t=${(clip.overlap / FILM_FPS).toFixed(3)}` : '';
    this.video.src = clip.url + fragment;
    this.status.textContent = '';
    this.applySeek();
    this.update();
    if (autoplay) void this.play();
  }
  applySeek() {
    if (this.pendingSeek === null || !this.video.readyState) return;
    try {
      this.video.currentTime = this.pendingSeek;
      this.pendingSeek = null;
    } catch {
      /* Wait for metadata. */
    }
  }
  seekTo(seconds) {
    if (!this.video || this.destroyed) return;
    const value = Math.max(0, Math.min(this.total(), seconds));
    let index = 0;
    while (index < this.lengths.length - 1 && value >= this.before(index + 1)) index++;
    const local = value - this.before(index);
    if (index !== this.at) this.show(index, local, this.playing);
    else {
      this.pendingSeek = local + (this.clips[index].overlap || 0) / FILM_FPS;
      this.applySeek();
      this.update();
    }
  }
  async play() {
    try {
      await this.video.play();
    } catch (error) {
      if (this.destroyed || error?.name === 'AbortError') return;
      this.playing = false;
      this.status.textContent = 'Pulsa reproducir para continuar.';
      this.update();
    }
  }
  toggle() {
    if (this.playing) {
      this.playing = false;
      this.video.pause();
      this.update();
    } else {
      if (this.video.error) this.show(this.at, 0, false);
      else if (this.video.ended && this.at === this.clips.length - 1) this.show(0, 0, false);
      this.playing = true;
      this.update();
      void this.play();
    }
  }
  setPlayIcon() {
    this.playButton.innerHTML = safeHTML(renderIcon(this.playing ? 'pause' : 'play', 22));
    this.playButton.title = this.playing ? 'Pausar' : 'Reproducir';
    this.playButton.setAttribute('aria-label', this.playButton.title);
    this.element.classList.toggle('is-playing', this.playing);
  }
  update() {
    if (!this.video || this.destroyed) return;
    const local = Math.max(
      0,
      (this.pendingSeek ?? this.video.currentTime) - (this.clips[this.at].overlap || 0) / FILM_FPS,
    );
    const elapsed = Math.min(this.total(), this.before(this.at) + local);
    this.seek.max = String(this.total());
    this.seek.value = String(elapsed);
    this.seek.style.setProperty('--film-progress', `${this.total() ? (elapsed / this.total()) * 100 : 0}%`);
    this.seek.setAttribute('aria-valuetext', `${cinemaTime(elapsed)} de ${cinemaTime(this.total())}`);
    this.clock.textContent = `${cinemaTime(elapsed)} / ${cinemaTime(this.total())}`;
    this.clipLabel.textContent = `Clip ${this.at + 1} de ${this.clips.length}`;
    this.muteButton.title = this.video.muted ? 'Activar sonido' : 'Silenciar';
    this.muteButton.setAttribute('aria-label', this.muteButton.title);
    this.muteButton.setAttribute('aria-pressed', String(this.video.muted));
    this.volume.value = String(this.video.muted ? 0 : this.video.volume);
    this.setPlayIcon();
  }
  destroy() {
    this.destroyed = true;
    this.abort.abort();
    if (this.video) {
      this.video.pause();
      this.video.removeAttribute('src');
      this.video.load();
    }
  }
}
