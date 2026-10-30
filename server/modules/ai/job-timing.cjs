const { randomUUID } = require('node:crypto');
const { cleanRequestMetric } = require('./request-metrics.cjs');
const ms = (end, start) => Math.max(0, (Date.parse(end) || 0) - (Date.parse(start) || 0));
const finite = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0);
const iso = (value) => (typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null);
const clean = (value) =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, '').slice(0, 180) : '';

function ensureTiming(job, now) {
  if (!job.timing || job.timing.version !== 1)
    job.timing = {
      version: 1,
      observedAt: now,
      partial: job.createdAt !== now,
      queueMs: 0,
      executionMs: 0,
      reusedSteps: 0,
      attempts: 0,
      stages: [],
      requests: [],
    };
  return job.timing;
}
function queueTiming(job, now) {
  const t = ensureTiming(job, now);
  t.queuedAt = now;
  t.runStartedAt = null;
  t.finishedAt = null;
}
function startTiming(job, now) {
  const t = ensureTiming(job, now);
  t.queueMs += t.queuedAt ? ms(now, t.queuedAt) : 0;
  t.queuedAt = null;
  t.runStartedAt = now;
  t.attempts++;
}
function finishTiming(job, now) {
  const t = ensureTiming(job, now);
  if (t.queuedAt) t.queueMs += ms(now, t.queuedAt);
  if (t.runStartedAt) t.executionMs += ms(now, t.runStartedAt);
  t.queuedAt = null;
  t.runStartedAt = null;
  t.finishedAt = now;
}

/** Explicit telemetry capability supplied to a runner, never an implicit process-global context. */
function timingContext(job, { now, persist, writable }) {
  const active = [];
  const track = (info, stage = active.at(-1)) => {
    if (!writable()) return () => {};
    const t = ensureTiming(job, now());
    if (t.requests.length >= 512) {
      t.requests.shift();
      t.partial = true;
    }
    const record = {
      id: randomUUID(),
      stageId: stage?.id || null,
      startedAt: now(),
      ...cleanRequestMetric(info),
      status: 'running',
    };
    t.requests.push(record);
    t.revision = (t.revision || 0) + 1;
    persist(job);
    return (patch) => {
      if (!writable() || !t.requests.includes(record)) return;
      Object.assign(record, cleanRequestMetric(patch));
      if (record.status !== 'running') record.finishedAt ||= now();
      t.revision++;
      persist(job);
    };
  };
  return {
    reuse() {
      ensureTiming(job, now()).reusedSteps++;
    },
    begin(name) {
      const t = ensureTiming(job, now());
      const stage = {
        id: randomUUID(),
        name: clean(name),
        label: clean(job.message || name),
        startedAt: now(),
        finishedAt: null,
        status: 'running',
        attempt: t.attempts,
      };
      if (t.stages.length >= 256) {
        t.stages.shift();
        t.partial = true;
      }
      t.stages.push(stage);
      active.push(stage);
      const end = (status) => {
        stage.finishedAt = now();
        stage.status = status;
        stage.durationMs = ms(stage.finishedAt, stage.startedAt);
        const index = active.indexOf(stage);
        if (index >= 0) active.splice(index, 1);
      };
      end.trackRequest = (info) => track(info, stage);
      return end;
    },
    trackRequest(info) {
      return track(info);
    },
  };
}

function publicTiming(job, now, details = true) {
  const t = job.timing;
  if (!t || t.version !== 1) return null;
  const end = iso(t.finishedAt) || now;
  const queueMs = finite(t.queueMs) + (iso(t.queuedAt) ? ms(now, t.queuedAt) : 0);
  const executionMs = finite(t.executionMs) + (iso(t.runStartedAt) ? ms(now, t.runStartedAt) : 0);
  const totalMs = ms(end, iso(t.observedAt) || job.createdAt);
  const requests = (Array.isArray(t.requests) ? t.requests : []).slice(-512).map((r) => ({
    id: clean(r.id),
    stageId: clean(r.stageId),
    startedAt: iso(r.startedAt),
    finishedAt: iso(r.finishedAt),
    ...cleanRequestMetric(r),
    durationMs: r.status === 'running' ? ms(now, r.startedAt) : finite(r.durationMs),
  }));
  return {
    version: 1,
    revision: finite(t.revision),
    partial: !!t.partial,
    totalMs,
    queueMs,
    executionMs,
    otherMs: Math.max(0, totalMs - queueMs - executionMs),
    requestMs: requests.reduce((sum, r) => sum + r.durationMs, 0),
    attempts: finite(t.attempts),
    reusedSteps: finite(t.reusedSteps),
    stageCount: Array.isArray(t.stages) ? t.stages.length : 0,
    requestCount: requests.length,
    ...(details
      ? {
          stages: (Array.isArray(t.stages) ? t.stages : []).slice(-256).map((s) => ({
            id: clean(s.id),
            name: clean(s.name),
            label: clean(s.label),
            status: ['running', 'completed', 'failed', 'cancelled', 'interrupted'].includes(s.status)
              ? s.status
              : 'interrupted',
            attempt: finite(s.attempt),
            startedAt: iso(s.startedAt),
            finishedAt: iso(s.finishedAt),
            durationMs: s.status === 'running' ? ms(now, s.startedAt) : finite(s.durationMs),
          })),
          requests,
        }
      : {}),
  };
}
module.exports = { queueTiming, startTiming, finishTiming, timingContext, publicTiming };
