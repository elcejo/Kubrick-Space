/**
 * What the local engine reports while it runs a video task, as the colored bar of the task panel needs it: the stage
 * it is in over time, the step the sampler is on with its time, and the latest preview. The vocabulary and colors
 * follow the author's Skalibur workflow timing.
 */
const STAGES = Object.freeze([
  'Workflow Preparation',
  'References',
  'Conditioning',
  'Model Loading',
  'Model Preparation',
  'Optimization',
  'Sampler Preparation',
  'Pre-Sampling',
  'Sampling',
  'Preview',
  'Latent Upscaling',
  'VAE Decoding',
  'Postprocessing',
  'Video Saving',
  'Other Nodes',
]);
const STAGE_EVENT = 'kubrick_h3_stage';
const STEP_EVENT = 'kubrick_h3_step';
const PREVIEW_EVENT = 'kubrick_h3_preview';
const MAX_SEGMENTS = 400;
const MAX_PREVIEW_BYTES = 8_000_000;

/**
 * @param stageOf  maps a node id of the submitted graph to its stage name
 * @param onUpdate called with a snapshot whenever the stage or the step changes
 * @param onPreview called with `{mime, buffer, step, total}` for every preview the engine sends
 * @param now      monotonic milliseconds, replaceable in tests
 */
function createTelemetry({
  stageOf = () => 'Other Nodes',
  onUpdate,
  onPreview,
  now = () => performance.now(),
} = {}) {
  const started = now();
  const segments = [{ stage: 'Workflow Preparation', start: started, end: null }];
  const state = { step: 0, total: 0, stepMs: null, avgStepMs: null, finished: false };

  const open = () => segments.at(-1);
  const snapshot = () => {
    const at = now();
    return {
      stage: open().stage,
      elapsedMs: Math.round((state.finished ? open().end : at) - started),
      step: state.step,
      total: state.total,
      stepMs: state.stepMs === null ? null : Math.round(state.stepMs),
      avgStepMs: state.avgStepMs === null ? null : Math.round(state.avgStepMs),
      finished: state.finished,
      segments: segments.map((segment) => ({
        stage: segment.stage,
        ms: Math.max(0, Math.round((segment.end ?? at) - segment.start)),
      })),
    };
  };
  const changed = () => onUpdate?.(snapshot());
  const enter = (stage) => {
    if (state.finished || !STAGES.includes(stage) || open().stage === stage) return;
    const at = now();
    open().end = at;
    segments.push({ stage, start: at, end: null });
    if (segments.length > MAX_SEGMENTS) segments.splice(1, 1);
    changed();
  };
  const finish = () => {
    if (state.finished) return;
    open().end = now();
    state.finished = true;
    changed();
  };
  const number = (value) => (Number.isFinite(value) ? value : null);

  /** One message of the engine's websocket, already parsed. Anything unknown is ignored. */
  function handle(message) {
    const { type, data } = message || {};
    if (type === 'executing') {
      if (data?.node === null || data?.node === undefined) return;
      enter(stageOf(String(data.node)));
    } else if (type === 'execution_success' || type === 'execution_error' || type === 'execution_interrupted')
      finish();
    else if (type === STAGE_EVENT) enter(data?.stage);
    else if (type === STEP_EVENT) {
      state.step = Number.isSafeInteger(data?.step) ? data.step : state.step;
      state.total = Number.isSafeInteger(data?.total) ? data.total : state.total;
      state.stepMs = number(data?.step_ms);
      state.avgStepMs = number(data?.avg_step_ms);
      changed();
    } else if (type === PREVIEW_EVENT) {
      if (
        !['video/mp4', 'image/jpeg'].includes(data?.mime) ||
        typeof data.image !== 'string' ||
        data.image.length > MAX_PREVIEW_BYTES * 1.4
      )
        return;
      onPreview?.({
        mime: data.mime,
        buffer: Buffer.from(data.image, 'base64'),
        step: Number.isSafeInteger(data.step) ? data.step : 0,
        total: Number.isSafeInteger(data.total) ? data.total : 0,
      });
    }
  }
  return { handle, snapshot, enter, finish };
}

module.exports = { createTelemetry, STAGES, STAGE_EVENT, STEP_EVENT, PREVIEW_EVENT };
