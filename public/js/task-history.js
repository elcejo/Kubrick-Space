import { API } from './api-service.js';
import { renderIcon } from './icons.js';
import { safeHTML, escapeHTML } from './safe-html.js';
import { active, states, kinds, timingMarkup } from './job-presentation.js';

/** General settings own the complete history; dismissing a sidebar item never deletes it. */
export class TaskHistory {
  constructor(root) {
    this.controller = new AbortController();
    this.offset = 0;
    this.limit = 25;
    this.jobs = [];
    this.total = 0;
    this.openTiming = new Set();
    this.traces = new Map();
    this.loadingTiming = new Set();
    this.element = document.createElement('div');
    this.element.className = 'task-history';
    this.element.innerHTML = safeHTML(
      `<div class="task-history__toolbar"><span data-history-count></span><button type="button" data-refresh-history aria-label="Actualizar historial" title="Actualizar">${renderIcon('refresh', 18)}</button></div><p class="task-history__status" role="status"></p><div class="task-history__list"></div><footer class="task-history__pages"><button type="button" data-history-prev>Anterior</button><span data-history-page></span><button type="button" data-history-next>Siguiente</button></footer>`,
    );
    root.append(this.element);
    this.list = this.element.querySelector('.task-history__list');
    this.element.addEventListener('click', (event) => {
      if (event.target.closest('[data-refresh-history]')) void this.load();
      const remove = event.target.closest('[data-delete-job-record]');
      if (remove) void this.remove(remove.dataset.deleteJobRecord);
      if (event.target.closest('[data-history-prev]')) {
        this.offset = Math.max(0, this.offset - this.limit);
        void this.load();
      }
      if (event.target.closest('[data-history-next]')) {
        this.offset += this.limit;
        void this.load();
      }
      const timing = event.target.closest('[data-load-timing]');
      if (timing) void this.loadTiming(timing.dataset.loadTiming, true);
    });
    this.list.addEventListener(
      'toggle',
      (event) => {
        const details = event.target.closest('[data-history-timing]');
        if (!details?.isConnected) return;
        const id = details.dataset.historyTiming;
        if (details.open === this.openTiming.has(id)) return;
        if (details.open) {
          this.openTiming.add(id);
          void this.loadTiming(id);
        } else this.openTiming.delete(id);
      },
      true,
    );
  }
  setActive(value) {
    this.visible = value;
    clearTimeout(this.timer);
    if (value) void this.load();
  }
  async load() {
    if (this.busy || this.controller.signal.aborted) return;
    clearTimeout(this.timer);
    this.busy = true;
    this.controls();
    try {
      let response = await API.jobHistory(
        { offset: this.offset, limit: this.limit },
        { signal: this.controller.signal },
      );
      if (this.controller.signal.aborted) return;
      if (this.offset && !response.jobs.length) {
        this.offset = Math.max(0, Math.floor((response.total - 1) / this.limit) * this.limit);
        response = await API.jobHistory(
          { offset: this.offset, limit: this.limit },
          { signal: this.controller.signal },
        );
        if (this.controller.signal.aborted) return;
      }
      this.jobs = response.jobs;
      this.total = response.total;
      this.error = '';
      this.render();
      for (const id of this.openTiming)
        if (this.jobs.some((job) => job.id === id && active(job))) void this.loadTiming(id, true);
    } catch (error) {
      if (!this.controller.signal.aborted) this.error = error.message || 'No se pudo cargar el historial.';
    } finally {
      this.busy = false;
      if (!this.controller.signal.aborted) {
        this.controls();
        if (this.visible) this.timer = setTimeout(() => void this.load(), 5000);
      }
    }
  }
  controls() {
    this.element.querySelector('.task-history__status').textContent = this.error || '';
    this.element.querySelector('[data-refresh-history]').disabled = Boolean(this.busy);
    this.element.querySelector('[data-history-prev]').disabled = this.busy || this.offset === 0;
    this.element.querySelector('[data-history-next]').disabled =
      this.busy || this.offset + this.limit >= this.total;
    this.element.querySelector('[data-history-count]').textContent = `${this.total} tareas`;
    this.element.querySelector('[data-history-page]').textContent = this.total
      ? `${this.offset + 1}–${Math.min(this.offset + this.limit, this.total)} de ${this.total}`
      : '';
    for (const button of this.element.querySelectorAll('[data-delete-job-record]')) {
      const job = this.jobs.find((job) => job.id === button.dataset.deleteJobRecord);
      button.disabled = this.busy || !job || active(job);
    }
  }
  render() {
    const signature = JSON.stringify([this.jobs, [...this.openTiming], [...this.traces]]);
    if (signature === this.signature) return;
    this.signature = signature;
    const scroll = this.list.scrollTop;
    const focused = document.activeElement?.dataset.deleteJobRecord;
    this.list.innerHTML = safeHTML(
      this.jobs.length
        ? this.jobs
            .map((job) => {
              const date = new Date(job.createdAt).toLocaleString('es-MX', {
                dateStyle: 'medium',
                timeStyle: 'short',
              });
              return [
                `<article class="workspace-task task-history__item" data-status="${escapeHTML(job.status)}"><div class="task-history__item-header"><div><a href="#/workspace/${encodeURIComponent(job.projectId)}">${escapeHTML(job.projectName)}</a>`,
                `<span>${escapeHTML(kinds[job.kind] || 'Tarea')}</span></div><button type="button" data-delete-job-record="${escapeHTML(job.id)}" aria-label="Eliminar tarea de ${escapeHTML(job.projectName)} del historial" title="Eliminar del historial" ${active(job) ? 'disabled' : ''}>${renderIcon('trash', 16)}</button>`,
                `</div><div class="task-history__meta"><span>${escapeHTML(states[job.status] || job.status)}</span><time datetime="${escapeHTML(job.createdAt)}">${escapeHTML(date)}</time>`,
                `</div>${job.error ? `<p>${escapeHTML(job.error)}</p>` : ''}<details class="workspace-task__timing" data-history-timing="${escapeHTML(job.id)}" ${this.openTiming.has(job.id) ? 'open' : ''}>`,
                `<summary>${renderIcon('chevron-right', 14)} Tiempos</summary>${this.openTiming.has(job.id) ? timingMarkup(job, this.traces.get(job.id)?.timing, this.traces.get(job.id)?.error) : ''}</details>`,
                `</article>`,
              ].join('');
            })
            .join('')
        : '<p class="task-history__empty">Sin tareas registradas.</p>',
    );
    this.list.scrollTop = scroll;
    if (focused)
      [...this.list.querySelectorAll('[data-delete-job-record]')]
        .find((button) => button.dataset.deleteJobRecord === focused)
        ?.focus({ preventScroll: true });
  }
  async loadTiming(id, force = false) {
    const job = this.jobs.find((job) => job.id === id);
    if (!job?.timing || this.loadingTiming.has(id) || (!force && this.traces.get(id)?.timing)) return;
    this.loadingTiming.add(id);
    try {
      const response = await API.jobRecord(id, job.projectId, { signal: this.controller.signal });
      if (!this.controller.signal.aborted) this.traces.set(id, { timing: response.job.timing });
    } catch {
      if (!this.controller.signal.aborted) this.traces.set(id, { error: 'No se pudo consultar.' });
    } finally {
      this.loadingTiming.delete(id);
      if (!this.controller.signal.aborted) this.render();
    }
  }
  async remove(id) {
    const job = this.jobs.find((job) => job.id === id);
    if (!job || active(job) || this.busy) return;
    clearTimeout(this.timer);
    this.busy = true;
    this.controls();
    try {
      await API.deleteJobRecord(id, job.projectId);
      if (this.controller.signal.aborted) return;
      this.openTiming.delete(id);
      this.traces.delete(id);
      this.error = '';
    } catch (error) {
      this.error = error.message || 'No se pudo eliminar el registro.';
      return;
    } finally {
      this.busy = false;
      if (!this.controller.signal.aborted) {
        this.controls();
        if (this.visible) this.timer = setTimeout(() => void this.load(), 5000);
      }
    }
    await this.load();
  }
  destroy() {
    this.visible = false;
    this.controller.abort();
    clearTimeout(this.timer);
    this.element.remove();
  }
}
