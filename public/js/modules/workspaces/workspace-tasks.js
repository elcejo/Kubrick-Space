import { API } from '../../api-service.js';
import { renderIcon } from '../../icons.js';
import { safeHTML, escapeHTML } from '../../safe-html.js';

import {
  active,
  states,
  kinds,
  liveMarkup,
  liveSegments,
  liveShape,
  liveStageText,
  livePreviewURL,
  phaseBarMarkup,
  timingMarkup,
} from '../../job-presentation.js';

/** Observes the server queue independently of the current editor; never owns execution. */
export class WorkspaceTasks {
  constructor(root, trigger) {
    this.root = root;
    this.trigger = trigger;
    this.controller = new AbortController();
    this.jobs = [];
    this.pending = new Set();
    this.epoch = 0;
    this.openTiming = new Set();
    this.traces = new Map();
    this.loadingTiming = new Set();
    // The preview video of each running task stays in place while the panel redraws.
    this.liveVideos = new Map();
    this.liveLoading = new Map();
    trigger.addEventListener('click', () => this.toggle(), { signal: this.controller.signal });
    window.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape' && this.panel) {
          this.close();
          trigger.focus();
        }
      },
      { signal: this.controller.signal },
    );
    void this.poll();
  }
  async poll() {
    if (this.polling || this.controller.signal.aborted) return;
    this.polling = true;
    const epoch = this.epoch;
    clearTimeout(this.timer);
    try {
      const { jobs, activeCount } = await API.sidebarJobs({ signal: this.controller.signal });
      if (this.controller.signal.aborted || epoch !== this.epoch) return;
      this.jobs = jobs.slice(0, 10);
      this.fetchedAt = Date.now();
      this.activeCount = activeCount;
      for (const job of jobs) if (this.panel && this.openTiming.has(job.id)) void this.loadTiming(job.id);
      this.error = '';
      this.update();
    } catch (error) {
      if (this.controller.signal.aborted) return;
      this.error = 'No se pudo consultar el servidor. Reintentando…';
      this.render();
    } finally {
      this.polling = false;
      clearTimeout(this.timer);
      if (!this.controller.signal.aborted)
        this.timer = setTimeout(() => void this.poll(), this.panel ? 2500 : 8000);
    }
  }
  update() {
    const count = this.activeCount ?? this.jobs.filter(active).length;
    this.trigger.dataset.count = count ? String(count) : '';
    this.trigger.setAttribute('aria-label', count ? `Tareas activas: ${count}` : 'Tareas activas');
    this.trigger.classList.toggle('workspace-tasks-trigger--active', count > 0);
    this.render();
  }
  toggle() {
    if (this.panel) {
      this.close();
      return;
    }
    this.panel = document.createElement('aside');
    this.panel.className = 'workspace-tasks liquid-glass';
    this.panel.setAttribute('aria-label', 'Tareas del servidor');
    this.panel.innerHTML = safeHTML(
      `<header class="workspace-tasks__header"><h2>Tareas activas</h2><button type="button" data-close-tasks aria-label="Cerrar tareas">${renderIcon('close')}</button></header><p class="workspace-tasks__status" role="status"></p><div class="workspace-tasks__list"></div>`,
    );
    this.panel.addEventListener('click', (event) => {
      if (event.target.closest('[data-close-tasks]')) this.close();
      const control = event.target.closest('[data-cancel-job]');
      if (control) void this.cancel(control.dataset.cancelJob);
      const dismiss = event.target.closest('[data-dismiss-job]');
      if (dismiss) void this.dismiss(dismiss.dataset.dismissJob);
      const reload = event.target.closest('[data-load-timing]');
      if (reload) void this.loadTiming(reload.dataset.loadTiming, true);
    });
    this.panel.addEventListener(
      'toggle',
      (event) => {
        const details = event.target.closest('[data-timing-job]');
        if (!details || !details.isConnected) return;
        const id = details.dataset.timingJob;
        if (details.open === this.openTiming.has(id)) return;
        if (details.open) {
          this.openTiming.add(id);
          void this.loadTiming(id);
        } else this.openTiming.delete(id);
        this.signature = '';
        this.render();
      },
      true,
    );
    this.root.append(this.panel);
    this.ticker = setInterval(() => this.tick(), 1000);
    this.trigger.setAttribute('aria-expanded', 'true');
    this.signature = '';
    this.render();
    this.panel.querySelector('[data-close-tasks]').focus();
    // Only one observer request at a time; the existing timer will refresh shortly.
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.poll(), 100);
  }
  render() {
    if (!this.panel) return;
    this.panel.querySelector('.workspace-tasks__status').textContent = this.error || '';
    // What moves every second (times, stage, step, the bar) is updated in place and is not part of the structure.
    const shape = (job) => ({
      ...job,
      updatedAt: undefined,
      timing: this.openTiming.has(job.id) ? job.timing : job.timing && { revision: job.timing.revision },
      live: liveShape(job),
    });
    const signature = JSON.stringify([this.jobs.map(shape), [...this.pending], [...this.traces]]);
    if (this.signature !== signature) {
      const focusedId = this.panel.contains(document.activeElement)
        ? document.activeElement.dataset.cancelJob
        : null;
      const focusedTiming = this.panel.contains(document.activeElement)
        ? document.activeElement.closest('[data-timing-job]')?.dataset.timingJob
        : null;
      const list = this.panel.querySelector('.workspace-tasks__list'),
        scrollTop = list.scrollTop;
      this.signature = signature;
      const row = (job) =>
        [
          `<article class="workspace-task" data-status="${escapeHTML(job.status)}"><div class="workspace-task__top"><span>${escapeHTML(states[job.status] || job.status)}</span>`,
          `<time data-job-time="${escapeHTML(job.id)}"></time><button type="button" data-dismiss-job="${escapeHTML(job.id)}" ${this.pending.has(job.id) ? 'disabled' : ''} aria-label="Quitar tarea de ${escapeHTML(job.projectName)} del panel" title="Quitar del panel">${renderIcon('close', 14)}</button>`,
          `</div><a href="#/workspace/${encodeURIComponent(job.projectId)}">${escapeHTML(job.projectName)}</a><strong>${escapeHTML(kinds[job.kind] || 'Trabajo de personaje')}</strong>${job.error || active(job) ? `<p>${escapeHTML(job.error || job.message || '')}</p>` : ''}${active(job) ? liveMarkup(job) : ''}${active(job) ? `<div class="workspace-task__bottom"><small>${job.status === 'queued' ? `Posición ${Number(job.position) || 1}` : ''}</small><button type="button" data-cancel-job="${escapeHTML(job.id)}" ${this.pending.has(job.id) ? 'disabled' : ''} aria-label="Cancelar tarea de ${escapeHTML(job.projectName)}">${renderIcon('stop')} ${this.pending.has(job.id) ? 'Cancelando…' : 'Cancelar'}</button></div>` : ''}</article>`,
        ].join('');
      const timingRow = (job) =>
        `<details class="workspace-task__timing" data-timing-job="${escapeHTML(job.id)}" ${this.openTiming.has(job.id) ? 'open' : ''}><summary>${renderIcon('chevron-right')} Tiempos</summary>${this.openTiming.has(job.id) ? timingMarkup(job, this.traces.get(job.id)?.timing, this.traces.get(job.id)?.error) : ''}</details>`;
      list.innerHTML = safeHTML(
        this.jobs.length
          ? this.jobs.map((job) => row(job).replace('</article>', timingRow(job) + '</article>')).join('')
          : '<p class="workspace-tasks__empty">No hay tareas recientes.</p>',
      );
      list.scrollTop = scrollTop;
      if (focusedId)
        [...this.panel.querySelectorAll('[data-cancel-job]')]
          .find((button) => button.dataset.cancelJob === focusedId)
          ?.focus();
      else if (focusedTiming)
        [...list.querySelectorAll('[data-timing-job]')]
          .find((n) => n.dataset.timingJob === focusedTiming)
          ?.querySelector('summary')
          .focus({ preventScroll: true });
    }
    this.tick();
  }
  /** The elapsed time of every task, the stage, step and bar of the running video tasks and their preview. */
  tick() {
    if (!this.panel) return;
    this.syncLiveMedia();
    const extra = Date.now() - (this.fetchedAt || Date.now());
    for (const box of this.panel.querySelectorAll('[data-live-job]')) {
      const job = this.jobs.find((item) => item.id === box.dataset.liveJob);
      if (!job?.live) continue;
      const elapsed = job.live.elapsedMs + (job.live.finished ? 0 : extra);
      box.querySelector('[data-live-stage]').textContent = liveStageText(job.live, elapsed);
      box.querySelector('[data-live-bar]').innerHTML = safeHTML(
        phaseBarMarkup(liveSegments(job.live, extra), elapsed),
      );
    }
    for (const time of this.panel.querySelectorAll('[data-job-time]')) {
      const job = this.jobs.find((job) => job.id === time.dataset.jobTime);
      const seconds = Math.max(
        0,
        Math.floor(
          ((active(job) ? Date.now() : Date.parse(job.updatedAt)) -
            Date.parse(job.startedAt || job.createdAt)) /
            1000,
        ),
      );
      time.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
      time.title = 'Tiempo transcurrido';
    }
  }
  /**
   * The preview of the sampling plays in its own element, which survives redraws of the list. A newer preview is
   * loaded off screen and replaces the old one only when its first frame is ready, so nothing flashes.
   */
  syncLiveMedia() {
    const seen = new Set();
    for (const box of this.panel.querySelectorAll('[data-live-media]')) {
      const id = box.dataset.liveMedia;
      const src = box.dataset.src;
      const job = this.jobs.find((item) => item.id === id);
      const wanted = job ? livePreviewURL(job) : '';
      seen.add(id);
      const shown = this.liveVideos.get(id);
      if (shown && box.firstElementChild !== shown.video) {
        box.replaceChildren(shown.video);
        void shown.video.play?.()?.catch?.(() => {});
      }
      if (!wanted || shown?.src === wanted || this.liveLoading.get(id) === wanted) continue;
      this.liveLoading.set(id, wanted);
      const video = document.createElement('video');
      video.className = 'workspace-task__live-preview';
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;
      video.setAttribute('aria-label', 'Previsualización en vivo (TAEH3)');
      video.addEventListener(
        'loadeddata',
        () => {
          if (this.liveLoading.get(id) !== wanted) return;
          this.liveLoading.delete(id);
          const target = this.panel?.querySelector(`[data-live-media="${CSS.escape(id)}"]`);
          if (!target) return;
          target.replaceChildren(video);
          this.liveVideos.set(id, { video, src: wanted });
          void video.play?.()?.catch?.(() => {});
        },
        { once: true },
      );
      video.addEventListener('error', () => this.liveLoading.delete(id), { once: true });
      video.src = wanted || src;
    }
    for (const id of [...this.liveVideos.keys()]) if (!seen.has(id)) this.liveVideos.delete(id);
  }
  async loadTiming(id, force = false) {
    const job = this.jobs.find((j) => j.id === id);
    if (!job || !job.timing || this.loadingTiming.has(id)) return;
    const stamp = `${job.updatedAt}:${job.timing.revision}:${active(job) ? Math.floor(job.timing.totalMs / 1000) : ''}`;
    if (!force && this.traces.get(id)?.stamp === stamp && !active(job)) return;
    if (!force && this.traces.get(id)?.stamp === stamp && this.traces.get(id)?.timing) return;
    this.loadingTiming.add(id);
    try {
      const { job: detail } = await API.jobRecord(id, job.projectId, { signal: this.controller.signal });
      if (this.controller.signal.aborted) return;
      this.traces.set(id, { stamp, timing: detail.timing });
    } catch {
      if (!this.controller.signal.aborted) this.traces.set(id, { stamp, error: 'No se pudo consultar' });
    } finally {
      this.loadingTiming.delete(id);
      if (!this.controller.signal.aborted) {
        this.signature = '';
        this.render();
      }
    }
  }
  async cancel(id) {
    if (this.pending.has(id)) return;
    this.epoch++;
    this.pending.add(id);
    this.render();
    try {
      const { job } = await API.cancelBackgroundJob(id);
      if (this.controller.signal.aborted) return;
      this.jobs = this.jobs.map((old) => (old.id === id ? { ...old, ...job } : old));
      this.activeCount = Math.max(0, (this.activeCount ?? 1) - 1);
      this.error = '';
    } catch (error) {
      this.error = error.message || 'No se pudo cancelar. Consulta el estado antes de reintentar.';
    } finally {
      this.pending.delete(id);
      if (!this.controller.signal.aborted) this.update();
    }
  }
  async dismiss(id) {
    const job = this.jobs.find((item) => item.id === id);
    if (!job || this.pending.has(id)) return;
    this.epoch++;
    this.pending.add(id);
    this.render();
    try {
      await API.dismissJob(id, job.projectId);
      if (this.controller.signal.aborted) return;
      this.jobs = this.jobs.filter((item) => item.id !== id);
      this.openTiming.delete(id);
      this.traces.delete(id);
      this.error = '';
    } catch (error) {
      this.error = error.message || 'No se pudo quitar la tarea.';
    } finally {
      this.pending.delete(id);
      if (!this.controller.signal.aborted) {
        this.update();
        this.panel?.querySelector('[data-dismiss-job], [data-close-tasks]')?.focus({ preventScroll: true });
        void this.poll();
      }
    }
  }
  close() {
    clearInterval(this.ticker);
    this.panel?.remove();
    this.panel = null;
    this.liveVideos.clear();
    this.liveLoading.clear();
    this.trigger.setAttribute('aria-expanded', 'false');
  }
  destroy() {
    this.controller.abort();
    clearTimeout(this.timer);
    this.close();
  }
}
