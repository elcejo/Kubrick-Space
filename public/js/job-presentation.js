import { escapeHTML } from './safe-html.js';

export const active = (job) => ['queued', 'running', 'awaiting_choice'].includes(job.status);
export const states = {
  queued: 'En cola',
  running: 'En curso',
  awaiting_choice: 'Espera tu elección',
  completed: 'Completada',
  failed: 'Error',
  interrupted: 'Interrumpida',
  cancelled: 'Cancelada',
};
export const kinds = {
  cover: 'Generar portada',
  continuity: 'Revisar continuidad',
  scenario: 'Generar escenario',
  film: 'Preparar película',
  'film-render': 'Previsualizar película',
  book: 'Escribir y revisar libro',
  edit: 'Editar y revisar proyecto',
  interpret: 'Interpretar personaje',
  portrait: 'Generar fotografía',
  assets: 'Generar Outfit',
  regenerate: 'Regenerar pieza',
  manage: 'Gestionar personajes',
  lore: 'Lore y referencias del personaje',
};

/**
 * The stages of a video task of the local engine, in the vocabulary and colors of the Skalibur workflow timing. The
 * colors are fixed here: nothing that reaches the markup chooses one.
 */
const PHASES = Object.freeze({
  'Workflow Preparation': ['Preparación', '#94a3b8'],
  References: ['Referencias', '#38bdf8'],
  Conditioning: ['Conditioning', '#818cf8'],
  'Model Loading': ['Carga del modelo', '#f59e0b'],
  'Model Preparation': ['Preparación del modelo', '#fbbf24'],
  Optimization: ['Optimización', '#d97706'],
  'Sampler Preparation': ['Preparación del muestreo', '#fb923c'],
  'Pre-Sampling': ['Pre-muestreo', '#fbbf24'],
  Sampling: ['Inferencia', '#a855f7'],
  Preview: ['Previsualización', '#ec4899'],
  'Latent Upscaling': ['Escalado LUp', '#06b6d4'],
  'VAE Decoding': ['Decodificación VAE', '#60a5fa'],
  Postprocessing: ['Posproceso', '#c084fc'],
  'Video Saving': ['Guardado del video', '#f43f5e'],
  'Other Nodes': ['Otros', '#78716c'],
});
const phase = (stage) => PHASES[stage] || PHASES['Other Nodes'];
const PHASE_KINDS = { conditioning: 'Conditioning', preview: 'Previsualización', final: 'Video final' };

/** The colored bar of a video task: how long each stage took, plus the legend with the total of each one. */
export function phaseBarMarkup(segments, totalMs) {
  const parts = (Array.isArray(segments) ? segments : []).filter((s) => Number(s.ms) > 0);
  const total = totalMs > 0 ? totalMs : parts.reduce((sum, s) => sum + Number(s.ms), 0);
  if (!parts.length || !(total > 0)) return '';
  const totals = new Map();
  for (const s of parts) totals.set(s.stage, (totals.get(s.stage) || 0) + Number(s.ms));
  const bar = parts
    .map((s) => {
      const [name, color] = phase(s.stage);
      return `<span class="workspace-task__phase" style="flex:${Number(s.ms)} 0 0;background:${color}" title="${escapeHTML(name)}: ${duration(s.ms)}"></span>`;
    })
    .join('');
  const legend = [...totals]
    .map(([stage, ms]) => {
      const [name, color] = phase(stage);
      return `<li><i style="background:${color}"></i>${escapeHTML(name)} <b>${duration(ms)}</b></li>`;
    })
    .join('');
  return `<div class="workspace-task__phase-bar" role="img" aria-label="Tiempo por etapa: ${escapeHTML([...totals].map(([stage, ms]) => `${phase(stage)[0]} ${duration(ms)}`).join(', '))}">${bar}</div><ul class="workspace-task__phase-legend">${legend}</ul>`;
}

/** The line under a live video task: stage, step and the time it has been running. */
export function liveStageText(live, elapsedMs) {
  const [name] = phase(live.stage);
  const step = live.total
    ? `Paso ${Number(live.step)} de ${Number(live.total)}${live.avgStepMs ? ` · ${duration(live.avgStepMs)} por paso` : ''}`
    : '';
  return `${name}${step ? ` · ${step}` : ''} · ${duration(elapsedMs)}`;
}
/** The segments of a live task with `extraMs` more on the stage that is running now (the time since it was read). */
export function liveSegments(live, extraMs = 0) {
  const segments = (live.segments || []).map((segment) => ({ ...segment }));
  if (extraMs > 0 && !live.finished && segments.length) segments[segments.length - 1].ms += extraMs;
  return segments;
}
/** The preview of a live task, as the address of the latest frame; empty until the engine sends one. */
export const livePreviewURL = (job) =>
  job.live?.previewVersion
    ? `/api/jobs/${encodeURIComponent(job.id)}/live-preview?v=${Number(job.live.previewVersion)}`
    : '';
/**
 * What of a live task decides the panel's structure; the moving parts (stage, step, times, bar) are updated in place
 * every second so the preview video is not rebuilt each time they change.
 */
export const liveShape = (job) =>
  job.live
    ? { kind: job.live.kind, label: job.live.label, preview: Number(job.live.previewVersion) || 0 }
    : null;

/**
 * What the engine is doing right now for an active video task. The video lives in `data-live-media` and the changing
 * text and bar in `data-live-stage` and `data-live-bar`: the panel fills them and keeps them current.
 */
export function liveMarkup(job) {
  const live = job.live;
  if (!live) return '';
  return `<div class="workspace-task__live" data-live-job="${escapeHTML(job.id)}"><p><strong>${escapeHTML(PHASE_KINDS[live.kind] || 'Video')}</strong> · ${escapeHTML(live.label || '')}</p><p class="workspace-task__live-stage" data-live-stage>${escapeHTML(liveStageText(live, live.elapsedMs))}</p><div class="workspace-task__live-media" data-live-media="${escapeHTML(job.id)}" data-src="${escapeHTML(livePreviewURL(job))}"></div><div data-live-bar>${phaseBarMarkup(liveSegments(live), live.elapsedMs)}</div></div>`;
}

/** The finished videos of a task with the time of each stage, for the Tiempos section. */
export function phasesMarkup(job) {
  const done = Array.isArray(job.phases) ? job.phases : [];
  if (!done.length) return '';
  return `<div class="workspace-task__phases"><h4>Etapas del motor local</h4>${done
    .map(
      (item) =>
        `<div class="workspace-task__phase-item"><p><strong>${escapeHTML(PHASE_KINDS[item.kind] || 'Video')}</strong> · ${escapeHTML(item.label || '')} <span>${duration(item.totalMs)}${item.avgStepMs ? ` · ${duration(item.avgStepMs)} por paso` : ''}${item.outcome && item.outcome !== 'completed' ? ' · ' + (item.outcome === 'cancelled' ? 'cancelado' : 'fallido') : ''}</span></p>${phaseBarMarkup(item.segments, item.totalMs)}</div>`,
    )
    .join('')}</div>`;
}

export function duration(ms) {
  const seconds = Math.max(0, Number(ms) || 0) / 1000;
  return seconds < 60
    ? `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`
    : `${Math.floor(seconds / 60)} min ${Math.floor(seconds % 60)} s`;
}
export function timingMarkup(job, trace, error = '') {
  const t = job.timing;
  if (!t) return '<p class="workspace-task__timing-empty">Sin tiempos registrados.</p>';
  const summary = `<dl class="workspace-task__metrics"><div><dt>Cola</dt><dd>${duration(t.queueMs)}</dd></div><div><dt>Ejecución</dt><dd>${duration(t.executionMs)}</dd></div><div><dt>Total medido</dt><dd>${duration(t.totalMs)}</dd></div></dl>`;
  const hint = `<p class="workspace-task__timing-note">${t.partial ? 'Medición parcial. ' : ''}${t.reusedSteps ? `${Number(t.reusedSteps)} etapas reutilizadas. ` : ''}${t.otherMs > 1000 ? `Pausas y espera de decisión: ${duration(t.otherMs)}. ` : ''}Las llamadas externas forman parte de la ejecución.</p>`;
  if (error)
    return (
      summary +
      hint +
      `<button type="button" data-load-timing="${escapeHTML(job.id)}">Reintentar consulta de tiempos</button>`
    );
  if (!trace)
    return summary + hint + '<p class="workspace-task__timing-note" role="status">Consultando etapas…</p>';
  const requests = trace.requests || [];
  const requestMarkup = (request) => {
    const link =
      (request.firstTokenMs !== undefined ? `<p>Primer avance ${duration(request.firstTokenMs)}</p>` : '') +
      (/^gen-[A-Za-z0-9-]{1,140}$/.test(request.generationId || '')
        ? `<a class="workspace-task__generation" href="https://openrouter.ai/workspaces/default/logs?transaction=${encodeURIComponent(request.generationId)}" target="_blank" rel="noopener noreferrer">${escapeHTML(request.generationId)}</a>`
        : '');
    return `<div class="workspace-task__request" data-request-status="${escapeHTML(request.status || '')}"><div><strong>${escapeHTML(request.service || 'Proveedor')} · ${escapeHTML(request.operation || 'Solicitud')}</strong><span>${duration(request.durationMs)}</span></div><p>${escapeHTML(request.model || 'Modelo no informado')}${request.provider ? ` · ${escapeHTML(request.provider)}` : ' · Proveedor no informado'}</p><p>${request.httpStatus ? `HTTP ${Number(request.httpStatus)} · ` : ''}${escapeHTML(request.status === 'completed' ? 'Respondió' : request.status === 'running' ? 'En curso' : request.status === 'timeout' ? 'Tiempo agotado' : 'Interrumpida o fallida')}${request.fallbacks !== undefined ? ` · ${Number(request.fallbacks)} cambios de proveedor` : ''}${request.latencyMs !== undefined ? ` · Latencia reportada ${duration(request.latencyMs)}` : ''}${request.generationMs !== undefined ? ` · Generación ${duration(request.generationMs)}` : ''}</p>${link}</div>`;
  };
  const stages = (trace.stages || [])
    .map(
      (stage) =>
        `<li><div class="workspace-task__stage-top"><strong>${escapeHTML(stage.label || stage.name)}</strong><span>${duration(stage.durationMs)}</span></div><small>${stage.status === 'completed' ? 'Completada' : stage.status === 'running' ? 'En curso' : stage.status === 'failed' ? 'Fallida' : 'Interrumpida'} · intento ${Number(stage.attempt) || 1}</small>${requests
          .filter((r) => r.stageId === stage.id)
          .map(requestMarkup)
          .join('')}</li>`,
    )
    .join('');
  const loose = requests
    .filter((r) => !(trace.stages || []).some((s) => s.id === r.stageId))
    .map(requestMarkup)
    .join('');
  return summary + hint + phasesMarkup(job) + `<ol class="workspace-task__stages">${stages}</ol>${loose}`;
}
