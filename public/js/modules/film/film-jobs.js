import { API } from '../../api-service.js';
import { EventBus } from '../../event-bus.js';

const ACTIVE = ['queued', 'running'];

/** Observes the server job. Disposing it never cancels execution; the server keeps working. */
export class FilmJobs {
  constructor(host) {
    this.host = host;
    this.controller = new AbortController();
    this.job = null;
    this.watching = null;
    this.ready = this.restore();
  }
  async restore() {
    if (this.restoring || this.watching) return;
    if (this.host.submitting) return this.scheduleDiscovery();
    this.restoring = true;
    try {
      const { jobs } = await API.characterJobs(this.host.projectId, { signal: this.controller.signal });
      if (!this.host.current() || this.host.submitting || this.watching) return;
      const mine = jobs.filter((job) => job.kind === 'film' || job.kind === 'film-render');
      const job = mine.find((item) => ACTIVE.includes(item.status)) || mine[0];
      if (
        job &&
        this.job?.id === job.id &&
        this.job?.updatedAt === job.updatedAt &&
        !ACTIVE.includes(job.status)
      )
        return;
      if (job) return await this.observe(job.id);
      await this.host.acceptBackgroundJob({ job: null, draft: null });
    } catch (error) {
      if (!this.controller.signal.aborted && this.host.current()) this.host.backgroundJobError(error);
    } finally {
      this.restoring = false;
      this.scheduleDiscovery();
    }
  }
  scheduleDiscovery() {
    clearTimeout(this.discoveryTimer);
    if (this.controller.signal.aborted || !this.host.current()) return;
    this.discoveryTimer = setTimeout(
      () => {
        if (this.watching) this.scheduleDiscovery();
        else void this.restore();
      },
      this.job && ACTIVE.includes(this.job.status) ? 5000 : 15000,
    );
  }
  /** `kind` is 'film' (scenes and prompts) or 'render' (conditioning and previews). */
  async perform(input, kind = 'film') {
    if (!this.host.current() || (this.watching && ACTIVE.includes(this.job?.status))) return null;
    this.host.submitting = true;
    this.host.busy = true;
    this.host.updateBoard();
    let sent = false;
    try {
      const flushed = await EventBus.emitAsync('autosave:flush');
      const acknowledged = flushed.find((result) => result?.payload?.content !== undefined);
      if (!this.host.current()) return null;
      await this.host.onBackgroundState?.({ busy: true });
      sent = true;
      const enqueue = kind === 'render' ? API.enqueueFilmRenderJob : API.enqueueFilmJob;
      const response = await enqueue.call(API, {
        ...input,
        projectId: this.host.projectId,
        expectedContent: acknowledged?.payload.content ?? this.host.project().content,
        token: globalThis.crypto.randomUUID(),
      });
      this.host.submitting = false;
      if (!this.host.current()) return response.job;
      return await this.observe(response.job.id, response);
    } catch (error) {
      this.host.submitting = false;
      if (this.host.current()) this.host.backgroundJobError(error, sent && Boolean(error.network));
      return null;
    } finally {
      this.host.submitting = false;
    }
  }
  async retry() {
    if (!this.job || !['failed', 'interrupted'].includes(this.job.status)) return null;
    try {
      this.host.submitting = true;
      this.host.busy = true;
      this.host.updateBoard();
      const response = await API.retryCharacterJob(this.job.id, this.host.projectId);
      this.host.submitting = false;
      return await this.observe(this.job.id, response);
    } catch (error) {
      this.host.submitting = false;
      this.host.backgroundJobError(error, false);
      return null;
    }
  }
  async cancel() {
    if (!this.job || !ACTIVE.includes(this.job.status)) return;
    try {
      const response = await API.cancelBackgroundJob(this.job.id);
      await this.host.acceptBackgroundJob(response);
    } catch (error) {
      this.host.backgroundJobError(error, true);
    }
  }
  async observe(id, initial) {
    const watch = {};
    this.watching = watch;
    let response = initial;
    try {
      while (!this.controller.signal.aborted && this.host.current() && this.watching === watch) {
        response ||= await API.characterJob(id, { signal: this.controller.signal }, this.host.projectId);
        this.job = response.job;
        await this.host.acceptBackgroundJob(response);
        if (!ACTIVE.includes(response.job.status))
          return response.job.status === 'completed' ? response.job.result || {} : null;
        await new Promise((resolve) => {
          const finish = () => {
            clearTimeout(timer);
            this.controller.signal.removeEventListener('abort', finish);
            resolve();
          };
          const timer = setTimeout(finish, this.host.pollMs ?? 1500);
          this.controller.signal.addEventListener('abort', finish, { once: true });
        });
        response = null;
      }
    } catch (error) {
      if (!this.controller.signal.aborted && this.host.current()) this.host.backgroundJobError(error, true);
    } finally {
      if (this.watching === watch) this.watching = null;
    }
    return null;
  }
  destroy() {
    clearTimeout(this.discoveryTimer);
    this.controller.abort();
    this.watching = null;
  }
}
