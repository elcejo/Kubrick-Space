import { API } from '../../api-service.js';
import { renderIcon } from '../../icons.js';
import { active, duration, kinds } from '../../job-presentation.js';
import { parseScenarioDocument, scenarioCovers } from '../../contracts/scenario.js';
import { createTaskProgress, jobProgress } from './task-progress.js';

const POLL_MS = 1500;
const ICONS = { character: 'character', stage: 'stage', video: 'video', book: 'book' };
const KINDS = ['character', 'stage', 'video', 'book'];

/** Waits between two questions to the server; it never keeps a process alive by itself. */
function pause(ms) {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms)?.unref?.();
  });
}

/** The image that stands for a project: its current cover or, for a scenario, its first angle. */
export function projectImage(project) {
  const covers = Array.isArray(project?.covers) ? project.covers : [];
  const cover = covers[project?.currentCoverIndex] || covers[0];
  const url = typeof cover === 'string' ? cover : cover?.url;
  if (url) return url;
  if (project?.type === 'stage') {
    const document = parseScenarioDocument(project.content);
    return (document && scenarioCovers(document)[0]) || '';
  }
  return '';
}

/** What the card says once the task is over, from what the server reports and what the project now has. */
export function cardSummary(job, project, image) {
  const label = kinds[job?.kind] || 'Trabajo';
  if (!job) return image ? 'Listo.' : '';
  if (job.status === 'failed' || job.status === 'interrupted')
    return job.error || 'El trabajo no terminó. Lo guardado se conserva.';
  if (job.status === 'cancelled') return 'Cancelada. Lo guardado se conserva.';
  if (job.status !== 'completed') return '';
  const took = job.timing?.totalMs ? ` · ${duration(job.timing.totalMs)}` : '';
  if (['portrait', 'interpret'].includes(job.kind))
    return (image ? 'Fotografía creada' : `${label}: terminado, sin fotografía nueva`) + took;
  if (job.kind === 'scenario')
    return (image ? 'Escenario con imágenes listas' : 'Escenario actualizado') + took;
  if (job.kind === 'continuity') return (job.message || 'Revisión terminada.') + took;
  if (job.kind === 'cover') return (image ? 'Portada creada' : 'Portada terminada') + took;
  return `${label}: terminado${took}`;
}

/**
 * A card of the chat for a task the assistant started (or, without a task, for something it finished): the project's
 * image as its background, what it is doing with a measured progress bar, and what it did once it is over.
 *
 * @param {{projectId: string, jobId?: string, kind?: string}} descriptor
 */
export function createJobCard(descriptor, { signal, pollMs = POLL_MS } = {}) {
  const card = document.createElement('article');
  card.className = 'chat-card';
  card.dataset.kind = 'book';
  card.dataset.state = descriptor.jobId ? 'running' : 'completed';
  card.setAttribute('aria-live', 'polite');

  const image = document.createElement('img');
  image.className = 'chat-card__image';
  image.alt = '';
  image.hidden = true;
  image.decoding = 'async';
  const shade = document.createElement('div');
  shade.className = 'chat-card__shade';
  const body = document.createElement('div');
  body.className = 'chat-card__body';

  const header = document.createElement('div');
  header.className = 'chat-card__header';
  const icon = document.createElement('span');
  icon.className = 'chat-card__icon';
  icon.setAttribute('aria-hidden', 'true');
  const kicker = document.createElement('span');
  kicker.className = 'chat-card__kicker';
  const time = document.createElement('span');
  time.className = 'chat-card__time';
  header.append(icon, kicker, time);

  const title = document.createElement('strong');
  title.className = 'chat-card__title';
  const summary = document.createElement('p');
  summary.className = 'chat-card__summary';
  summary.hidden = true;
  const progress = createTaskProgress();

  const footer = document.createElement('div');
  footer.className = 'chat-card__footer';
  const open = document.createElement('a');
  open.className = 'chat-card__open';
  open.href = `#/workspace/${encodeURIComponent(descriptor.projectId)}`;
  open.innerHTML = `Abrir ${renderIcon('arrow-right', 14)}`;
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'chat-card__cancel';
  cancel.innerHTML = `${renderIcon('stop', 14)} Detener`;
  footer.append(open, cancel);

  body.append(header, title, summary, progress.element, footer);
  card.append(image, shade, body);

  let project = null;
  let job = null;
  let gone = false;
  const showProject = () => {
    const type = KINDS.includes(project?.type) ? project.type : 'book';
    card.dataset.kind = type;
    icon.innerHTML = renderIcon(ICONS[type], 16);
    title.textContent = project?.name || 'Proyecto';
    card.setAttribute('aria-label', `${kicker.textContent}: ${title.textContent}`);
  };
  // An image that does not load leaves the card with its colors: the application marks the parent of a failed image
  // as a thumbnail fallback, which would restyle the whole card.
  let failedUrl = '';
  image.addEventListener('error', () => {
    failedUrl = image.getAttribute('src') || '';
    image.hidden = true;
    card.classList.remove('chat-card--photo', 'project-thumbnail-fallback');
    render();
  });
  const showImage = () => {
    const found = projectImage(project);
    const url = found && found !== failedUrl ? found : '';
    if (url && image.getAttribute('src') !== url) image.src = url;
    image.hidden = !url;
    card.classList.toggle('chat-card--photo', Boolean(url));
    return url;
  };
  const statusNow = () => {
    if (!descriptor.jobId || gone) return 'completed';
    return job?.status || 'queued';
  };
  const render = () => {
    const status = statusNow();
    const over = !active({ status });
    card.dataset.state = status;
    kicker.textContent = kinds[job?.kind || descriptor.kind] || 'Resultado';
    showProject();
    cancel.hidden = over;
    progress.element.hidden = over;
    if (!over) progress.update(jobProgress(job || { status: 'queued' }));
    const url = over ? showImage() : '';
    const text = over ? cardSummary(gone ? null : job, project, url) : '';
    summary.textContent = text;
    summary.hidden = !text;
    const start = Date.parse(job?.startedAt || job?.createdAt || '');
    const end = over ? Date.parse(job?.updatedAt || '') : Date.now();
    time.textContent =
      job && Number.isFinite(start) && Number.isFinite(end)
        ? `${Math.floor((end - start) / 60000)}:${String(Math.floor(((end - start) / 1000) % 60)).padStart(2, '0')}`
        : '';
  };

  cancel.addEventListener('click', async () => {
    cancel.disabled = true;
    try {
      const response = await API.cancelBackgroundJob(descriptor.jobId);
      job = response?.job ? { ...job, ...response.job } : job;
      render();
    } catch {
      cancel.disabled = false;
    }
  });

  const finished = () => gone || !job || !active(job);
  async function follow() {
    await Promise.resolve();
    try {
      project = await API.getProject(descriptor.projectId);
    } catch {
      project = null;
    }
    render();
    if (!descriptor.jobId) return;
    while (!signal?.aborted && card.isConnected) {
      try {
        const response = await API.characterJob(descriptor.jobId, { signal }, descriptor.projectId);
        job = response.job;
      } catch (error) {
        if (signal?.aborted) return;
        // A task the server no longer lists is over: the card falls back to what the project has now.
        if (error?.status === 404) gone = true;
        else {
          await pause(pollMs);
          continue;
        }
      }
      if (finished()) {
        try {
          project = await API.getProject(descriptor.projectId);
        } catch {
          // The previous project data stays.
        }
        render();
        return;
      }
      render();
      await pause(pollMs);
    }
  }
  render();
  void follow();
  return card;
}
