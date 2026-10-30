import { API } from '../../api-service.js';
import { EventBus } from '../../event-bus.js';

/** Disposing the observer never cancels server execution. */
export class CharacterJobs {
  constructor(host) {
    this.host = host;
    this.controller = new AbortController();
    this.job = null;
    this.watching = null;
    this.ready = this.restore();
  }
  async restore() {
    if (this.restoring || this.watching) return;
    if (this.host.submitting) {
      this.scheduleDiscovery();
      return;
    }
    this.restoring = true;
    try {
      const { jobs } = await API.characterJobs(this.host.projectId, { signal: this.controller.signal });
      if (!this.host.current() || this.host.submitting || this.watching) return;
      const job =
        jobs.find((job) => ['queued', 'running', 'awaiting_choice'].includes(job.status)) || jobs[0];
      if (
        job &&
        this.job?.id === job.id &&
        this.job?.updatedAt === job.updatedAt &&
        !['queued', 'running', 'awaiting_choice'].includes(job.status)
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
      this.job && ['queued', 'running', 'awaiting_choice'].includes(this.job.status) ? 5000 : 15000,
    );
  }
  async perform(input) {
    if (
      !this.host.current() ||
      (this.watching && ['queued', 'running', 'awaiting_choice'].includes(this.job?.status))
    )
      return null;
    this.host.submitting = true;
    this.host.busy = true;
    this.host.updateComposer();
    let sent = false;
    try {
      const flushed = await EventBus.emitAsync('autosave:flush');
      const acknowledged = flushed.find((result) => result?.payload?.content !== undefined);
      if (!this.host.current()) return null;
      await this.host.onBackgroundState?.({ busy: true });
      sent = true;
      const response = await API.enqueueCharacterJob({
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
      if (this.host.current()) this.host.backgroundJobError(error, sent);
      return null;
    } finally {
      this.host.submitting = false;
    }
  }
  async retry() {
    if (!this.job || !['failed', 'interrupted'].includes(this.job.status)) return null;
    try {
      this.host.beginSubmission?.();
      this.host.busy = true;
      this.host.updateComposer();
      const response = await API.retryCharacterJob(this.job.id, this.host.projectId);
      this.host.submitting = false;
      return await this.observe(this.job.id, response);
    } catch (error) {
      this.host.submitting = false;
      this.host.backgroundJobError(error, true);
      return null;
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
        if (response.job.status === 'awaiting_choice') {
          const choice = await this.host.onBackgroundChoice?.(response.job);
          if (!choice || !this.host.current()) return null;
          response = await API.characterJob(id, { signal: this.controller.signal }, this.host.projectId);
          if (response.job.status !== 'awaiting_choice') continue;
          response = await API.chooseCharacterJob(id, choice);
          continue;
        }
        if (!['queued', 'running'].includes(response.job.status))
          return response.job.status === 'completed' ? response.job.result || {} : null;
        await new Promise((resolve) => {
          const finish = () => {
            clearTimeout(timer);
            this.controller.signal.removeEventListener('abort', finish);
            resolve();
          };
          const timer = setTimeout(finish, 1200);
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
