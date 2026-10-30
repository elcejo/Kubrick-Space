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
  scenario: 'Generar escenario',
  film: 'Preparar película',
  'film-render': 'Previsualizar película',
  book: 'Escribir y revisar libro',
  interpret: 'Interpretar personaje',
  portrait: 'Generar fotografía',
  assets: 'Generar Outfit',
  regenerate: 'Regenerar pieza',
  manage: 'Gestionar personajes',
  lore: 'Lore y referencias del personaje',
};

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
  return summary + hint + `<ol class="workspace-task__stages">${stages}</ol>${loose}`;
}
