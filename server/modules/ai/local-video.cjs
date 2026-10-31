const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');

const WEIGHTS = [
  'models/video/h3/model.safetensors',
  'models/video/h3/lora/turbo.safetensors',
  'models/video/h3/text encoder/model.safetensors',
  'models/video/h3/vae/video vae.safetensors',
  'models/video/h3/vae/audio vae.safetensors',
];
// ComfyUI lists the files of models/video under their folder, with the platform's separator.
const NAMES = {
  model: 'h3\\model.safetensors',
  lora: 'h3\\lora\\turbo.safetensors',
  clip: 'h3\\text encoder\\model.safetensors',
  vae: 'h3\\vae\\video vae.safetensors',
  audio: 'h3\\vae\\audio vae.safetensors',
};
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

/** Stage 2 graph: the diffusion model is loaded once and every video starts from a saved conditioning. */
function previewWorkflow({ name, width, height, frames, seed, prefix }) {
  return {
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
    7: { class_type: 'BasicGuider', inputs: { model: ['20', 0], conditioning: ['6', 0] } },
    8: {
      class_type: 'BasicScheduler',
      inputs: { model: ['20', 0], scheduler: 'simple', steps: STEPS, denoise: 1 },
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
    12: { class_type: 'VAEDecode', inputs: { samples: ['11', 1], vae: ['4', 0] } },
    13: { class_type: 'VAEDecodeAudio', inputs: { samples: ['11', 1], vae: ['5', 0] } },
    14: { class_type: 'CreateVideo', inputs: { images: ['12', 0], audio: ['13', 0], fps: 24 } },
    15: {
      class_type: 'SaveVideo',
      inputs: { video: ['14', 0], filename_prefix: prefix, format: 'auto', codec: 'auto' },
    },
  };
}

/** MiniMax H3 on the local engine: conditioning to files first, then one preview video at a time. */
function createLocalVideo({ appRoot, request, fetchImpl, ensureEngine, verifyWeights = true }) {
  const output = path.join(appRoot, 'local-generation/comfyui/data/output');
  const input = path.join(appRoot, 'local-generation/comfyui/data/input');
  const fail = (message, code = 'LOCAL_VIDEO_FAILED', status = 502) =>
    Object.assign(new Error(message), { code, status });

  async function prepare(signal) {
    if (verifyWeights && !h3WeightsAvailable(appRoot))
      throw fail('Faltan los pesos locales de MiniMax H3.', 'LOCAL_MODEL_UNAVAILABLE', 428);
    await ensureEngine(signal);
    const info = await request('/object_info/KubrickH3Optimization', undefined, signal);
    if (!info.KubrickH3Optimization)
      throw fail(
        'Reinicia el motor local de Kubrick para cargar los nodos de H3.',
        'LOCAL_ENGINE_MISMATCH',
        503,
      );
  }
  /** Submits a graph and waits for its history record, cancelling it on the engine if aborted. */
  async function execute(graph, signal) {
    let id;
    try {
      id = (await request('/prompt', { prompt: graph }, signal)).prompt_id;
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
      if (id) await request('/history', { delete: [id] }, AbortSignal.timeout(3000)).catch(() => {});
    }
  }
  const timeout = (external) =>
    AbortSignal.any([AbortSignal.timeout(40 * 60000), ...(external ? [external] : [])]);

  /** Encodes prompt and named references once and saves the result under `name`. */
  async function conditioning({ name, prompt, tags, images = [] }, externalSignal) {
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
      const record = await execute(conditioningWorkflow({ name, prompt, tags, files: references }), signal);
      const saved = record.outputs?.[22]?.kubrick_conditioning?.[0];
      if (saved?.name !== name || !(saved.bytes > 0))
        throw fail('ComfyUI no guardó el conditioning de la escena.');
      return { name, bytes: saved.bytes };
    } finally {
      for (const file of files) fs.rmSync(file, { force: true });
    }
  }

  /** Generates one preview video from a saved conditioning and returns it as a buffer. */
  async function preview({ name, width, height, frames, seed }, externalSignal) {
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
    let file;
    try {
      await prepare(signal);
      const record = await execute(previewWorkflow({ name, width, height, frames, seed, prefix }), signal);
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
  return { available: () => !verifyWeights || h3WeightsAvailable(appRoot), conditioning, preview, release };
}
module.exports = {
  LOCAL_VIDEO_ENGINE,
  createLocalVideo,
  h3WeightsAvailable,
  conditioningWorkflow,
  previewWorkflow,
};
