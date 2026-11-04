const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { createTelemetry } = require('./local-video-telemetry.cjs');

const WEIGHTS = [
  'models/video/h3/model.safetensors',
  'models/video/h3/lora/turbo.safetensors',
  'models/video/h3/text encoder/model.safetensors',
  'models/video/h3/vae/video vae.safetensors',
  'models/video/h3/vae/audio vae.safetensors',
];
/** The H3 latent upscaler (LUp) is only needed for the final videos. */
const LUP_WEIGHT = 'models/video/h3/lup/model.safetensors';
// ComfyUI lists the files of models/video under their folder, with the platform's separator.
const NAMES = {
  model: 'h3\\model.safetensors',
  lora: 'h3\\lora\\turbo.safetensors',
  clip: 'h3\\text encoder\\model.safetensors',
  vae: 'h3\\vae\\video vae.safetensors',
  audio: 'h3\\vae\\audio vae.safetensors',
  lup: 'h3\\lup\\model.safetensors',
  tiny: 'taeh3.safetensors',
};
// The live preview of the sampling: a short loop decoded with the tiny H3 decoder (TAEH3, in models/video/h3/preview).
const PREVIEW_FRAMES = 16;
const PREVIEW_FPS = 12;
// The frames of the previous clip that guide a clip that continues it (17k + 5): they equal FILM_TAIL_FRAMES of the film.
const TAIL_FRAMES = 22;
const GUIDE_KINDS = Object.freeze({ start: /\.(?:png|jpe?g|webp)$/i, tail: /\.mp4$/i });
// The latent upscaler refines with one of its fixed sigma schedules.
const LUP_STEPS = [3, 4, 5];
// Base generation: the "simple" scheduler over the optimized (sigma-shifted) model, four steps, Euler. The fixed
// 3/4/5-step sigma presets belong to the latent upscaler, not to the first pass.
const STEPS = 4;
// Memory and speed optimizations (Skalibur "H3 Optimization"): the author's low-VRAM maximum of 56 attention
// chunks and 4 feedforward chunks. Measured on the RTX 3060: 101 s -> 80 s per 5 s preview with the model loaded.
const OPTIMIZATION = {
  optimized_attention: true,
  low_vram: true,
  feedforward: true,
  fp16_accumulation: true,
  // Sparse attention is off: the author found it costs too much quality for the time it saves.
  sparse_attention: false,
  low_vram_chunks: 56,
  feedforward_chunks: 4,
  shift_video: 12,
  shift_audio: 3,
};
const FRAME_OPTIONS = [124, 141, 158, 175, 192, 209, 226];
/** The model offered in the top bar for the film's preview flow. */
const LOCAL_VIDEO_ENGINE = { provider: 'local', model: 'minimax-h3' };
const CONDITIONING_NAME = /^[A-Za-z0-9_-]{1,100}$/;

function h3WeightsAvailable(appRoot) {
  return WEIGHTS.every((file) => fs.existsSync(path.join(appRoot, file)));
}
function lupWeightAvailable(appRoot) {
  return fs.existsSync(path.join(appRoot, LUP_WEIGHT));
}

/** Stage 1 graph: the text encoder runs once for a scene and its conditioning is saved to a file. */
function conditioningWorkflow({ name, prompt, tags, files }) {
  const graph = {
    3: { class_type: 'CLIPLoader', inputs: { clip_name: NAMES.clip, type: 'minimax' } },
    4: { class_type: 'VAELoader', inputs: { vae_name: NAMES.vae } },
    21: {
      class_type: 'KubrickH3Conditioning',
      inputs: { clip: ['3', 0], prompt, vae: ['4', 0], tags_json: JSON.stringify(tags) },
    },
    22: { class_type: 'KubrickSaveConditioning', inputs: { conditioning: ['21', 0], name } },
  };
  for (const [index, filename] of files.entries()) {
    graph[String(30 + index)] = { class_type: 'LoadImage', inputs: { image: filename } };
    graph[21].inputs[`ref_images.ref_image_${index + 1}`] = [String(30 + index), 0];
  }
  return graph;
}

/** The base pass: one video of the saved conditioning at the preview size, sampled with the optimized model. */
function basePass({ name, width, height, frames, seed, live = null, guide = null }) {
  // With the live preview node the sampler uses the model it wraps; nothing else changes.
  const model = live ? ['40', 0] : ['20', 0];
  // A guide anchors the start of the clip: a generated start frame (start) or the last frames of the previous clip (tail).
  const conditioning = guide ? ['51', 0] : ['6', 0];
  return {
    ...(guide
      ? {
          50:
            guide.kind === 'start'
              ? { class_type: 'LoadImage', inputs: { image: guide.filename } }
              : { class_type: 'KubrickH3Tail', inputs: { filename: guide.filename, count: TAIL_FRAMES } },
          51: {
            class_type: 'MiniMaxH3AddGuide',
            inputs: { positive: ['6', 0], vae: ['4', 0], latent: ['16', 0], image: ['50', 0], frame_idx: 0 },
          },
        }
      : {}),
    ...(live
      ? {
          40: {
            class_type: 'KubrickH3Preview',
            inputs: {
              model: ['20', 0],
              preview_frames: PREVIEW_FRAMES,
              preview_fps: PREVIEW_FPS,
              tiny_vae: live.tinyVae,
            },
          },
        }
      : {}),
    1: { class_type: 'UNETLoader', inputs: { unet_name: NAMES.model, weight_dtype: 'default' } },
    2: {
      class_type: 'LoraLoaderModelOnly',
      inputs: { model: ['1', 0], lora_name: NAMES.lora, strength_model: 1 },
    },
    4: { class_type: 'VAELoader', inputs: { vae_name: NAMES.vae } },
    5: { class_type: 'VAELoader', inputs: { vae_name: NAMES.audio } },
    6: { class_type: 'KubrickLoadConditioning', inputs: { name } },
    16: { class_type: 'EmptyMiniMaxH3LatentAV', inputs: { width, height, length: frames } },
    20: { class_type: 'KubrickH3Optimization', inputs: { model: ['2', 0], ...OPTIMIZATION } },
    7: { class_type: 'BasicGuider', inputs: { model, conditioning } },
    8: {
      class_type: 'BasicScheduler',
      inputs: { model, scheduler: 'simple', steps: STEPS, denoise: 1 },
    },
    17: { class_type: 'SplitSigmas', inputs: { sigmas: ['8', 0], step: STEPS } },
    9: { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
    10: { class_type: 'RandomNoise', inputs: { noise_seed: seed } },
    11: {
      class_type: 'SamplerCustomAdvanced',
      inputs: {
        noise: ['10', 0],
        guider: ['7', 0],
        sampler: ['9', 0],
        sigmas: ['17', 0],
        latent_image: ['16', 0],
      },
    },
  };
}

/** Stage 2 graph: the diffusion model is loaded once and every video starts from a saved conditioning. */
function previewWorkflow({ name, width, height, frames, seed, prefix, live = null, guide = null }) {
  return {
    ...basePass({ name, width, height, frames, seed, live, guide }),
    12: { class_type: 'VAEDecode', inputs: { samples: ['11', 1], vae: ['4', 0] } },
    13: { class_type: 'VAEDecodeAudio', inputs: { samples: ['11', 1], vae: ['5', 0] } },
    14: { class_type: 'CreateVideo', inputs: { images: ['12', 0], audio: ['13', 0], fps: 24 } },
    15: {
      class_type: 'SaveVideo',
      inputs: { video: ['14', 0], filename_prefix: prefix, format: 'auto', codec: 'auto' },
    },
  };
}

/**
 * Stage 3 graph: the approved preview's base pass (same conditioning, seed, size and length, optimized model without
 * sparse attention) goes through the H3 latent upscaler, which enlarges its latent and refines it with the fixed sigma
 * schedule and decodes the video. The base pass itself is not decoded.
 */
function finalWorkflow({
  name,
  width,
  height,
  frames,
  seed,
  megapixels,
  steps,
  prefix,
  live = null,
  guide = null,
}) {
  return {
    ...basePass({ name, width, height, frames, seed, live, guide }),
    30: {
      class_type: 'KubrickH3LatentUpscaler',
      inputs: {
        model: live ? ['40', 0] : ['20', 0],
        noise: ['10', 0],
        denoised_input: ['11', 1],
        conditioning: guide ? ['51', 0] : ['6', 0],
        video_vae: ['4', 0],
        audio_vae: ['5', 0],
        upscale_model: NAMES.lup,
        target_megapixels: megapixels,
        steps,
      },
    },
    15: {
      class_type: 'SaveVideo',
      inputs: { video: ['30', 0], filename_prefix: prefix, format: 'auto', codec: 'auto' },
    },
  };
}

/** The stage each node of a graph belongs to, for the timing bar of the task panel. */
const STAGE_OF_NODE = Object.freeze({
  conditioning: (id) =>
    ({ 3: 'Model Loading', 4: 'Model Loading', 21: 'Conditioning', 22: 'Conditioning' })[id] ||
    (Number(id) >= 30 ? 'References' : 'Other Nodes'),
  preview: (id) =>
    ({
      1: 'Model Loading',
      2: 'Model Loading',
      4: 'Model Loading',
      5: 'Model Loading',
      6: 'Model Loading',
      16: 'Sampler Preparation',
      20: 'Optimization',
      40: 'Optimization',
      7: 'Sampler Preparation',
      8: 'Sampler Preparation',
      17: 'Sampler Preparation',
      9: 'Sampler Preparation',
      10: 'Sampler Preparation',
      11: 'Sampling',
      12: 'VAE Decoding',
      13: 'VAE Decoding',
      14: 'Postprocessing',
      15: 'Video Saving',
      30: 'Latent Upscaling',
      50: 'References',
      51: 'Sampler Preparation',
    })[id] || 'Other Nodes',
});
STAGE_OF_NODE.final = STAGE_OF_NODE.preview;

/**
 * MiniMax H3 on the local engine: conditioning to files first, then one preview video at a time. The engine's
 * websocket (only when `webSocket` is given) reports the stage, the step times and a live preview to `hooks`.
 */
function createLocalVideo({
  appRoot,
  request,
  fetchImpl,
  ensureEngine,
  verifyWeights = true,
  webSocket = verifyWeights ? globalThis.WebSocket : undefined,
}) {
  const output = path.join(appRoot, 'local-generation/comfyui/data/output');
  const input = path.join(appRoot, 'local-generation/comfyui/data/input');
  const fail = (message, code = 'LOCAL_VIDEO_FAILED', status = 502) =>
    Object.assign(new Error(message), { code, status });

  async function prepare(signal, { upscaler = false } = {}) {
    if (verifyWeights && !h3WeightsAvailable(appRoot))
      throw fail('Faltan los pesos locales de MiniMax H3.', 'LOCAL_MODEL_UNAVAILABLE', 428);
    if (upscaler && verifyWeights && !lupWeightAvailable(appRoot))
      throw fail(
        'Falta el modelo de escalado H3 LUp en models/video/h3/lup.',
        'LOCAL_MODEL_UNAVAILABLE',
        428,
      );
    await ensureEngine(signal);
    if (
      upscaler &&
      !(await request('/object_info/KubrickH3LatentUpscaler', undefined, signal)).KubrickH3LatentUpscaler
    )
      throw fail(
        'Reinicia el motor local de Kubrick para cargar el escalador H3 LUp.',
        'LOCAL_ENGINE_MISMATCH',
        503,
      );
    const info = await request('/object_info/KubrickH3Optimization', undefined, signal);
    if (!info.KubrickH3Optimization)
      throw fail(
        'Reinicia el motor local de Kubrick para cargar los nodos de H3.',
        'LOCAL_ENGINE_MISMATCH',
        503,
      );
    return { live: await liveNode(signal) };
  }
  /**
   * The live preview node, when the engine has loaded it. It uses the tiny H3 decoder when the engine lists it and the
   * approximate color preview otherwise; an engine started before the node existed simply has no live preview.
   */
  async function liveNode(signal) {
    try {
      const node = (await request('/object_info/KubrickH3Preview', undefined, signal)).KubrickH3Preview;
      if (!node) return null;
      // The engine lists a combo either as an array of values or as `['COMBO', {options}]`.
      const spec = node.input?.required?.tiny_vae;
      const listed = Array.isArray(spec?.[0]) ? spec[0] : spec?.[1]?.options;
      return { tinyVae: Array.isArray(listed) && listed.includes(NAMES.tiny) ? NAMES.tiny : 'none' };
    } catch {
      return null;
    }
  }
  /** Listens to the engine for one prompt; resolves to a function that stops listening. */
  async function listen(clientId, telemetry, signal) {
    if (!webSocket) return () => {};
    return new Promise((resolve) => {
      let socket;
      let settled = false;
      const done = (stop) => {
        if (settled) return;
        settled = true;
        resolve(stop);
      };
      const stop = () => {
        try {
          socket?.close();
        } catch {
          // Already closed.
        }
      };
      try {
        socket = new webSocket(`ws://127.0.0.1:8189/ws?clientId=${clientId}`);
      } catch {
        done(() => {});
        return;
      }
      socket.addEventListener('open', () => done(stop));
      socket.addEventListener('error', () => done(() => {}));
      socket.addEventListener('message', (event) => {
        if (typeof event.data !== 'string') return;
        try {
          telemetry.handle(JSON.parse(event.data));
        } catch {
          // A message that is not for us.
        }
      });
      signal.addEventListener('abort', stop, { once: true });
      setTimeout(() => done(stop), 3000).unref?.();
    });
  }
  /** Submits a graph and waits for its history record, cancelling it on the engine if aborted. */
  async function execute(graph, signal, { kind, hooks = {} } = {}) {
    let id;
    const clientId = randomUUID();
    const telemetry = createTelemetry({
      stageOf: STAGE_OF_NODE[kind] || (() => 'Other Nodes'),
      onUpdate: (snapshot) => hooks.onTelemetry?.(snapshot),
      onPreview: (frame) => hooks.onPreview?.(frame),
    });
    const stopListening = await listen(clientId, telemetry, signal);
    try {
      id = (await request('/prompt', { prompt: graph, client_id: clientId }, signal)).prompt_id;
      if (typeof id !== 'string') throw fail('ComfyUI no registró la tarea de video.');
      for (;;) {
        signal.throwIfAborted();
        const record = (await request('/history/' + encodeURIComponent(id), undefined, signal))[id];
        if (record) {
          if (record.status?.status_str === 'error') {
            const detail = record.status.messages
              ?.find((message) => message[0] === 'execution_error')?.[1]
              ?.exception_message?.toString()
              .slice(0, 300);
            throw fail(
              'ComfyUI no pudo completar la tarea de video. Revisa la memoria disponible.' +
                (detail ? ` Detalle: ${detail}` : ''),
            );
          }
          return record;
        }
        await delay(1000, undefined, { signal });
      }
    } catch (error) {
      if (id)
        await Promise.allSettled([
          request('/queue', { delete: [id] }, AbortSignal.timeout(3000)),
          request('/interrupt', { prompt_id: id }, AbortSignal.timeout(3000)),
        ]);
      throw error;
    } finally {
      stopListening();
      telemetry.finish();
      if (id) await request('/history', { delete: [id] }, AbortSignal.timeout(3000)).catch(() => {});
    }
  }
  const timeout = (external) =>
    AbortSignal.any([AbortSignal.timeout(40 * 60000), ...(external ? [external] : [])]);

  /**
   * Puts the file of a guide in the engine's input folder under a name of its own: the guide is a file of the
   * project (a start frame or the previous clip) that the engine reads by name. Returns the name and how to remove it.
   */
  function stageGuide(guide) {
    if (!guide) return { guide: null, cleanup: () => {} };
    const pattern = GUIDE_KINDS[guide.kind];
    if (
      !pattern ||
      typeof guide.file !== 'string' ||
      !path.isAbsolute(guide.file) ||
      !pattern.test(guide.file)
    )
      throw fail('Guía de video inválida.', 'LOCAL_VIDEO_INVALID', 400);
    if (!fs.existsSync(guide.file))
      throw fail('La guía de continuidad ya no existe.', 'LOCAL_VIDEO_INVALID', 422);
    const filename = `kubrick-guide-${randomUUID()}${path.extname(guide.file).toLowerCase()}`;
    fs.mkdirSync(input, { recursive: true });
    fs.copyFileSync(guide.file, path.join(input, filename));
    return {
      guide: { kind: guide.kind, filename },
      cleanup: () => fs.rmSync(path.join(input, filename), { force: true }),
    };
  }

  /** Encodes prompt and named references once and saves the result under `name`. */
  async function conditioning({ name, prompt, tags, images = [] }, externalSignal, hooks) {
    if (
      !CONDITIONING_NAME.test(name) ||
      typeof prompt !== 'string' ||
      !prompt.trim() ||
      prompt.length > 6000 ||
      !Array.isArray(tags) ||
      tags.length !== images.length ||
      images.length > 4
    )
      throw fail('Solicitud de conditioning inválida.', 'LOCAL_VIDEO_INVALID', 400);
    const signal = timeout(externalSignal);
    const files = [];
    const references = [];
    const prefix = 'kubrick-film-' + randomUUID();
    try {
      await prepare(signal);
      for (const url of images) {
        const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(url);
        if (!match || url.length > 28_000_000)
          throw fail('Referencia de video inválida.', 'LOCAL_VIDEO_INVALID', 400);
        const filename = `${prefix}-${references.length}.${match[1]}`;
        const form = new FormData();
        form.append(
          'image',
          new Blob([Buffer.from(match[2], 'base64')], { type: `image/${match[1]}` }),
          filename,
        );
        form.append('type', 'input');
        const response = await fetchImpl('http://127.0.0.1:8189/upload/image', {
          method: 'POST',
          body: form,
          signal,
        });
        const file = await response.json();
        if (!response.ok || file.name !== filename || file.subfolder)
          throw fail('Referencia de video inválida.');
        references.push(filename);
        files.push(path.join(input, filename));
      }
      const record = await execute(conditioningWorkflow({ name, prompt, tags, files: references }), signal, {
        kind: 'conditioning',
        hooks,
      });
      const saved = record.outputs?.[22]?.kubrick_conditioning?.[0];
      if (saved?.name !== name || !(saved.bytes > 0))
        throw fail('ComfyUI no guardó el conditioning de la escena.');
      return { name, bytes: saved.bytes };
    } finally {
      for (const file of files) fs.rmSync(file, { force: true });
    }
  }

  /** Generates one preview video from a saved conditioning and returns it as a buffer. */
  async function preview({ name, width, height, frames, seed, guide }, externalSignal, hooks) {
    if (
      !CONDITIONING_NAME.test(name) ||
      !FRAME_OPTIONS.includes(frames) ||
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      !Number.isSafeInteger(seed) ||
      seed < 0
    )
      throw fail('Solicitud de video inválida.', 'LOCAL_VIDEO_INVALID', 400);
    const signal = timeout(externalSignal);
    const prefix = 'kubrick-film-' + randomUUID();
    const staged = stageGuide(guide);
    let file;
    try {
      const { live } = await prepare(signal);
      const record = await execute(
        previewWorkflow({ name, width, height, frames, seed, prefix, live, guide: staged.guide }),
        signal,
        {
          kind: 'preview',
          hooks,
        },
      );
      const video = record.outputs?.[15]?.images?.[0];
      if (
        !video ||
        video.type !== 'output' ||
        video.subfolder ||
        !new RegExp(`^${prefix}_[0-9]+_\\.mp4$`).test(video.filename)
      )
        throw fail('ComfyUI devolvió un video inválido.');
      file = path.join(output, video.filename);
      if (fs.statSync(file).size > 300_000_000) throw fail('El video supera el tamaño admitido.');
      return { buffer: fs.readFileSync(file), width, height, frames, seed };
    } finally {
      staged.cleanup();
      if (file) fs.rmSync(file, { force: true });
    }
  }

  /** Generates the final video: the preview's base pass enlarged by the latent upscaler to `megapixels`. */
  async function finalVideo(
    { name, width, height, frames, seed, megapixels, steps, guide },
    externalSignal,
    hooks,
  ) {
    if (
      !CONDITIONING_NAME.test(name) ||
      !FRAME_OPTIONS.includes(frames) ||
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      !Number.isSafeInteger(seed) ||
      seed < 0 ||
      typeof megapixels !== 'number' ||
      !(megapixels >= 0.1 && megapixels <= 16) ||
      !LUP_STEPS.includes(steps)
    )
      throw fail('Solicitud de video final inválida.', 'LOCAL_VIDEO_INVALID', 400);
    const signal = timeout(externalSignal);
    const prefix = 'kubrick-film-' + randomUUID();
    const staged = stageGuide(guide);
    let file;
    try {
      const { live } = await prepare(signal, { upscaler: true });
      const record = await execute(
        finalWorkflow({
          name,
          width,
          height,
          frames,
          seed,
          megapixels,
          steps,
          prefix,
          live,
          guide: staged.guide,
        }),
        signal,
        { kind: 'final', hooks },
      );
      const video = record.outputs?.[15]?.images?.[0];
      if (
        !video ||
        video.type !== 'output' ||
        video.subfolder ||
        !new RegExp(`^${prefix}_[0-9]+_\\.mp4$`).test(video.filename)
      )
        throw fail('ComfyUI devolvió un video inválido.');
      file = path.join(output, video.filename);
      if (fs.statSync(file).size > 1_000_000_000) throw fail('El video supera el tamaño admitido.');
      return { buffer: fs.readFileSync(file) };
    } finally {
      staged.cleanup();
      if (file) fs.rmSync(file, { force: true });
    }
  }

  /** Frees the text encoder and any other resident model before the diffusion model loads. */
  async function release(externalSignal) {
    const signal = timeout(externalSignal);
    await ensureEngine(signal);
    await fetchImpl('http://127.0.0.1:8189/free', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
      signal,
    });
  }
  return {
    available: () => !verifyWeights || h3WeightsAvailable(appRoot),
    upscalerAvailable: () => !verifyWeights || lupWeightAvailable(appRoot),
    conditioning,
    preview,
    final: finalVideo,
    release,
  };
}
module.exports = {
  LOCAL_VIDEO_ENGINE,
  createLocalVideo,
  h3WeightsAvailable,
  conditioningWorkflow,
  previewWorkflow,
  finalWorkflow,
  TAIL_FRAMES,
  lupWeightAvailable,
  LUP_STEPS,
};
