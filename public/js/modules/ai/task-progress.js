import { states } from '../../job-presentation.js';

/**
 * The progress bar of the tasks the assistant runs. It shows only what the server measured: a percentage when the task
 * has a real total (words against the goal, round against the estimated rounds, pieces of an outfit) and an
 * indeterminate bar, with no number, when it does not.
 */
const number = (value) => Math.round(Number(value) || 0).toLocaleString('es');

/** What a task of the server reports, as {value: 0..100 | null, label, detail}. */
export function jobProgress(job) {
  const status = job?.status || 'queued';
  const parts = [];
  let value = null;
  if (job?.assetProgress?.total) {
    const { completed = 0, failed = 0, total } = job.assetProgress;
    value = Math.min(100, Math.round(((completed + failed) / total) * 100));
    parts.push(`${completed} de ${total} piezas${failed ? ` · ${failed} con error` : ''}`);
  } else if (job?.kind === 'edit') {
    if (Number.isFinite(job.progress) && job.progress > 0) value = Math.min(99, Math.round(job.progress));
    if (job.round)
      parts.push(
        `Ronda ${job.round}${job.estimatedRounds ? ` de ~${Math.max(job.estimatedRounds, job.round)}` : ''}`,
      );
    if (job.targetWords) parts.push(`${number(job.words)} de ${number(job.targetWords)} palabras`);
    else if (job.words) parts.push(`${number(job.words)} palabras`);
  } else if (job?.kind === 'continuity') {
    if (Number.isFinite(job.progress)) value = Math.min(99, Math.round(job.progress));
    if (job.parts) parts.push(`Parte ${job.part} de ${job.parts}`);
    if (job.findings) parts.push(`${job.findings} hallazgos`);
  } else if (status === 'queued' && job?.position > 1) parts.push(`Posición ${job.position} en la cola`);
  if (status === 'completed') value = 100;
  return {
    value: ['queued', 'awaiting_choice'].includes(status) ? null : value,
    label: (status === 'running' && job?.message) || states[status] || status,
    detail: parts.join(' · '),
    status,
  };
}

/** The bar itself: {element, update({value, label, detail, status})}. */
export function createTaskProgress() {
  const element = document.createElement('div');
  element.className = 'task-progress';
  element.setAttribute('role', 'progressbar');
  element.setAttribute('aria-valuemin', '0');
  element.setAttribute('aria-valuemax', '100');
  const head = document.createElement('div');
  head.className = 'task-progress__head';
  const label = document.createElement('span');
  label.className = 'task-progress__label';
  const value = document.createElement('span');
  value.className = 'task-progress__value';
  head.append(label, value);
  const track = document.createElement('div');
  track.className = 'task-progress__track';
  const fill = document.createElement('div');
  fill.className = 'task-progress__fill';
  track.append(fill);
  const detail = document.createElement('div');
  detail.className = 'task-progress__detail';
  element.append(head, track, detail);
  return {
    element,
    update({ value: percent = null, label: text = '', detail: more = '', status = 'running' } = {}) {
      const measured = Number.isFinite(percent);
      element.dataset.state = status;
      element.dataset.indeterminate = String(!measured && ['queued', 'running'].includes(status));
      label.textContent = text;
      detail.textContent = more;
      detail.hidden = !more;
      if (measured) {
        const clamped = Math.max(0, Math.min(100, percent));
        element.setAttribute('aria-valuenow', String(Math.round(clamped)));
        fill.style.width = `${clamped}%`;
        value.textContent = `${Math.round(clamped)} %`;
      } else {
        element.removeAttribute('aria-valuenow');
        fill.style.width = '';
        value.textContent = '';
      }
      element.setAttribute(
        'aria-valuetext',
        [text, measured ? value.textContent : '', more].filter(Boolean).join(' · '),
      );
    },
  };
}
