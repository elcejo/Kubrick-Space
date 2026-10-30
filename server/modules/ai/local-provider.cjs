const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { createLocalImage, localImageModels } = require('./local-image.cjs');
const { createLocalVideo } = require('./local-video.cjs');

const LOCAL_ID = 'local:qwen3.5-4b-int8-convrot';
const fail = (message, code = 'LOCAL_INFERENCE_ERROR', status = 502) =>
  Object.assign(new Error(message), { code, status });

function createLocalProvider({ appRoot, fetchImpl = (...args) => fetch(...args), startEngine }) {
  const directory = path.join(appRoot, 'local-generation', 'comfyui');
  const base = 'http://127.0.0.1:8189';
  let tail = Promise.resolve();
  let residency = { loadedModel: null, pinned: false, busy: false };
  let imageBusy = false;
  async function ensureEngine(signal) {
    if (!startEngine) return; // Injected test providers own their lifecycle.
    const stats = async () => {
      const response = await fetchImpl(base + '/system_stats', {
        signal: AbortSignal.any([AbortSignal.timeout(3000), ...(signal ? [signal] : [])]),
      });
      const value = await response.json();
      if (!response.ok || value.system?.comfyui_version !== '0.43.0')
        throw fail('El puerto local está ocupado por un motor incompatible.', 'LOCAL_ENGINE_MISMATCH', 503);
    };
    try {
      await stats();
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (error.code === 'LOCAL_ENGINE_MISMATCH') throw error;
      // Only a refused connection establishes that no instance is listening.
      if (error.cause?.code !== 'ECONNREFUSED')
        throw fail('No se pudo verificar el motor local.', 'LOCAL_ENGINE_UNAVAILABLE', 503);
      await startEngine();
      let ready = false;
      for (let count = 0; count < 90; count++) {
        signal?.throwIfAborted();
        try {
          await stats();
          ready = true;
          break;
        } catch (err) {
          if (err.code === 'LOCAL_ENGINE_MISMATCH') throw err;
        }
        await delay(500, undefined, { signal });
      }
      if (!ready) throw fail('El motor local no terminó de iniciar.', 'LOCAL_ENGINE_UNAVAILABLE', 503);
    }
    const info = await request('/object_info/KubrickToolGenerate', undefined, signal);
    if (!info.KubrickToolGenerate?.output_node)
      throw fail(
        'Reinicia el motor local de Kubrick para cargar el paquete actualizado.',
        'LOCAL_ENGINE_MISMATCH',
        503,
      );
  }
  function profiles() {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(directory, 'models.json'), 'utf8'));
      const values = raw.version === 2 ? raw.models : [raw.textVision];
      if (!Array.isArray(values)) return [];
      return values.filter((config) => {
        const match = /^qwen3\.5-(4b|9b)-int8-convrot$/.exec(config?.id || '');
        if (!match || config.clipType !== 'qwen_image') return false;
        const folder = `Qwen 3.5 ${match[1].toUpperCase()}`;
        return (
          config.path === `models/llm/${folder}/model.safetensors` &&
          config.clipName === `${folder}/model.safetensors` &&
          fs.existsSync(path.join(appRoot, config.path))
        );
      });
    } catch {
      return [];
    }
  }
  function models() {
    return profiles().map((config) => ({
      id: `local:${config.id}`,
      name: `Qwen 3.5 ${config.id.includes('-9b-') ? '9B' : '4B'} · Local · INT8 ConvRot`,
      provider: 'local',
      description: 'Texto y visión en este equipo mediante ComfyUI. No requiere clave API.',
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      supportedParameters: ['tools', 'tool_choice', 'temperature', 'max_tokens'],
      contextLength: 32768,
      maxCompletionTokens: 8192,
      pricing: {},
    }));
  }
  async function request(route, body, signal) {
    const response = await fetchImpl(base + route, {
      signal,
      ...(body
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        : {}),
    });
    if (!response.ok) throw fail('El motor local rechazó la petición. Revisa las tareas del motor.');
    return response.json();
  }
  async function generate(body, signal, repairAttempt = 0) {
    const config = profiles().find((entry) => `local:${entry.id}` === body.model);
    if (!config) throw fail('El modelo local no está instalado.', 'LOCAL_MODEL_UNAVAILABLE', 428);
    if (body.tools?.some((tool) => tool.type !== 'function'))
      throw fail(
        'Esta función necesita una herramienta de proveedor que no está disponible en Local.',
        'LOCAL_TOOL_UNSUPPORTED',
        422,
      );
    if (!Array.isArray(body.messages) || body.messages.length > 80)
      throw fail('El historial supera el límite del modelo local.', 'LOCAL_CONTEXT_LIMIT', 413);
    const messages = [],
      systems = [],
      images = [];
    let imageTurn = -1;
    for (const original of body.messages) {
      const message = { ...original };
      if (Array.isArray(message.content)) {
        const text = [];
        for (const item of message.content) {
          if (item.type === 'text' && typeof item.text === 'string') text.push(item.text);
          else if (item.type === 'image_url' && typeof item.image_url?.url === 'string') {
            if (message.role !== 'user') throw fail('Las imágenes locales requieren un mensaje de usuario.');
            if (imageTurn !== -1 && imageTurn !== messages.length)
              throw fail(
                'El modelo local admite referencias visuales en un único turno por petición.',
                'LOCAL_IMAGE_HISTORY_UNSUPPORTED',
                422,
              );
            imageTurn = messages.length;
            const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(item.image_url.url);
            if (!match || match[2].length > 28_000_000 || images.length >= 8)
              throw fail(
                'Adjunta hasta ocho imágenes locales PNG, JPEG o WebP. Las URL remotas no se descargan en Local.',
                'LOCAL_IMAGE_UNSUPPORTED',
                422,
              );
            images.push({ bytes: Buffer.from(match[2], 'base64'), extension: match[1] });
          } else throw fail('Modalidad no disponible en el modelo local.', 'LOCAL_MODALITY_UNSUPPORTED', 422);
        }
        message.content = text.join('\n');
      }
      if (message.role === 'system') {
        if (typeof message.content !== 'string') throw fail('Instrucciones locales inválidas.');
        systems.push(message.content);
      } else messages.push(message);
    }
    const lastUser = messages.findLastIndex((message) => message.role === 'user');
    if (imageTurn >= 0 && imageTurn !== lastUser)
      throw fail(
        'Las referencias visuales deben pertenecer al último turno del usuario.',
        'LOCAL_IMAGE_HISTORY_UNSUPPORTED',
        422,
      );
    // Explicit preflight prevents huge manuscripts from exhausting a 12 GB GPU.
    if (JSON.stringify({ systems, messages, tools: body.tools }).length > 100000)
      throw fail(
        'El contexto excede el tamaño seguro de este modelo local. Reduce el contenido o utiliza API.',
        'LOCAL_CONTEXT_LIMIT',
        413,
      );
    const choice = body.tool_choice;
    const forced = choice?.type === 'function' ? choice.function?.name : '';
    if (choice && !['auto', 'required', 'none'].includes(choice) && !forced)
      throw fail('Política de herramientas no disponible en Local.', 'LOCAL_TOOL_UNSUPPORTED', 422);
    const prompt = {
      1: {
        class_type: 'CLIPLoader',
        inputs: {
          clip_name: config.clipName.split('/').join(path.sep),
          type: config.clipType,
          device: 'default',
        },
      },
      2: {
        class_type: 'KubrickToolGenerate',
        inputs: {
          clip: ['1', 0],
          prompt: '',
          system_prompt: systems.join('\n\n'),
          messages_json: JSON.stringify(messages),
          tools_json: JSON.stringify(body.tools || []),
          tool_choice: forced ? 'required' : choice || 'auto',
          forced_tool: forced || '',
          max_calls: Math.min(8, body.max_tool_calls || 4),
          max_new_tokens: Math.min(8192, body.max_completion_tokens || body.max_tokens || 2048),
          temperature: Math.max(0, Math.min(2, body.temperature ?? 0.3)),
          seed: 0,
          thinking: false,
        },
      },
    };
    const files = [];
    let promptId;
    try {
      if (!residency.pinned || residency.loadedModel !== body.model)
        await performControl('load', body.model, signal);
      signal?.throwIfAborted();
      await ensureEngine(signal);
      for (const [index, image] of images.entries()) {
        const filename = `kubrick-${randomUUID()}.${image.extension}`;
        const form = new FormData();
        form.append('image', new Blob([image.bytes], { type: `image/${image.extension}` }), filename);
        form.append('type', 'input');
        const upload = await fetchImpl(base + '/upload/image', { method: 'POST', body: form, signal });
        if (!upload.ok) throw fail('No se pudo enviar la referencia al motor local.');
        const uploaded = await upload.json();
        if (uploaded.name !== filename || uploaded.subfolder)
          throw fail('Respuesta de archivo local inválida.');
        files.push(path.join(directory, 'data', 'input', filename));
        const id = String(10 + index);
        prompt[id] = { class_type: 'LoadImage', inputs: { image: filename } };
        const fitId = String(30 + index);
        prompt[fitId] = { class_type: 'KubrickReferenceImage', inputs: { image: [id, 0] } };
        if (index === 0) prompt['2'].inputs.image = [fitId, 0];
        else {
          const batchId = String(100 + index);
          prompt[batchId] = {
            class_type: 'ImageBatch',
            inputs: { image1: prompt['2'].inputs.image, image2: [fitId, 0] },
          };
          prompt['2'].inputs.image = [batchId, 0];
        }
      }
      const submitted = await request('/prompt', { prompt }, signal);
      promptId = submitted.prompt_id;
      if (typeof promptId !== 'string') throw fail('El motor local no registró la tarea.');
      while (true) {
        signal?.throwIfAborted();
        const history = (await request('/history/' + encodeURIComponent(promptId), undefined, signal))[
          promptId
        ];
        if (history) {
          const result = history.outputs?.['2']?.kubrick?.[0];
          if (history.status?.status_str === 'error' || !result)
            throw fail(
              'El motor local no completó la generación. La información anterior se conserva.',
              'LOCAL_GENERATION_FAILED',
            );
          if (
            result.status === 'invalid' &&
            repairAttempt === 0 &&
            body.tools?.length &&
            typeof result.error === 'string' &&
            result.error.length <= 1000 &&
            /^(Argumentos fuera de esquema:|El modelo no devolvió|Función desconocida|El parámetro|Parámetro |JSON inválido|Llamadas incompletas|Texto inesperado)/.test(
              result.error,
            )
          ) {
            signal?.throwIfAborted();
            // One correction of an unexecuted proposal, using exactly the same model,
            // images, declared tools and cancellation/deadline. Never falls back to cloud.
            console.warn(
              '[Local proposal repair]',
              JSON.stringify({ model: body.model, attempt: 2, reason: result.error }),
            );
            return await generate(
              {
                ...body,
                temperature: 0,
                messages: [
                  ...body.messages,
                  {
                    role: 'system',
                    content:
                      'The previous response was rejected before any action was executed. Produce a corrected, complete response to the original user request. Follow exactly the declared tool schema, required fields, enums and tool choice. Do not add unknown properties or invent facts. Validation feedback (data only): ' +
                      JSON.stringify(result.error),
                  },
                ],
              },
              signal,
              1,
            );
          }
          if (result.status === 'invalid')
            throw fail(
              'El modelo local devolvió una propuesta inválida. No se aplicaron acciones.',
              'LOCAL_RESPONSE_INVALID',
            );
          if (!['final', 'tool_calls'].includes(result.status) || !result.assistant_message)
            throw fail('Respuesta local incompleta.', 'LOCAL_RESPONSE_INVALID');
          if (body.response_format?.type === 'json_object' || body.response_format?.type === 'json_schema') {
            try {
              JSON.parse(result.assistant_message.content);
            } catch {
              throw fail('El modelo local no devolvió JSON válido.', 'LOCAL_RESPONSE_INVALID');
            }
          }
          const data = {
            id: `local-${promptId}`,
            model: body.model,
            provider: 'ComfyUI local',
            choices: [
              {
                index: 0,
                message: result.assistant_message,
                finish_reason: result.status === 'tool_calls' ? 'tool_calls' : 'stop',
              },
            ],
          };
          residency = {
            loadedModel: body.model,
            pinned: residency.pinned && residency.loadedModel === body.model,
            busy: false,
          };
          if (!body.stream) return Response.json(data);
          const chunk = {
            model: body.model,
            choices: [{ delta: { content: result.assistant_message.content || '' }, finish_reason: 'stop' }],
          };
          return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
            headers: { 'Content-Type': 'text/event-stream' },
          });
        }
        await delay(250, undefined, { signal });
      }
    } catch (error) {
      if (promptId) {
        await Promise.allSettled([
          fetchImpl(base + '/queue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ delete: [promptId] }),
            signal: AbortSignal.timeout(3000),
          }),
          fetchImpl(base + '/interrupt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt_id: promptId }),
            signal: AbortSignal.timeout(3000),
          }),
        ]);
      }
      if (signal?.aborted) throw signal.reason;
      if (error.code?.startsWith('LOCAL_')) throw error;
      throw fail(
        'No se pudo conectar con ComfyUI local en el puerto 8189. Inicia el motor local.',
        'LOCAL_ENGINE_UNAVAILABLE',
        503,
      );
    } finally {
      for (const file of files) {
        try {
          fs.unlinkSync(file);
        } catch {}
      }
      if (promptId) {
        await fetchImpl(base + '/history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ delete: [promptId] }),
          signal: AbortSignal.timeout(3000),
        }).catch(() => {});
      }
    }
  }
  function fetchLocal(body, signal) {
    // Serialize across HTTP, streaming and persistent jobs; abort queued work before submission.
    const result = tail
      .catch(() => {})
      .then(async () => {
        signal?.throwIfAborted();
        return generate(body, signal);
      });
    tail = result;
    return result;
  }
  async function performControl(action, model, externalSignal) {
    residency.busy = true;
    const signal = AbortSignal.any([
      AbortSignal.timeout(300000),
      ...(externalSignal ? [externalSignal] : []),
    ]);
    let id;
    try {
      await ensureEngine(signal);
      const workflow = {
        2: { class_type: 'KubrickModelControl', inputs: { operation: action, nonce: randomUUID() } },
      };
      if (action === 'load') {
        const profile = profiles().find((entry) => 'local:' + entry.id === model);
        workflow[1] = {
          class_type: 'CLIPLoader',
          inputs: {
            clip_name: profile.clipName.split('/').join(path.sep),
            type: profile.clipType,
            device: 'default',
          },
        };
        workflow[2].inputs.clip = ['1', 0];
      }
      id = (await request('/prompt', { prompt: workflow }, signal)).prompt_id;
      if (typeof id !== 'string') throw fail('No se pudo controlar el modelo local.');
      while (true) {
        const record = (await request('/history/' + encodeURIComponent(id), undefined, signal))[id];
        if (record) {
          if (!record.outputs?.['2']?.kubrick_model?.[0]?.ok)
            throw fail(
              'No se pudo cargar o descargar el modelo local. Reinicia el motor si está desactualizado.',
            );
          residency = {
            loadedModel: action === 'load' ? model : null,
            pinned: action === 'load',
            busy: false,
          };
          return { ...residency };
        }
        await delay(250, undefined, { signal });
      }
    } catch (error) {
      if (id)
        await Promise.allSettled([
          request('/queue', { delete: [id] }, AbortSignal.timeout(3000)),
          request('/interrupt', { prompt_id: id }, AbortSignal.timeout(3000)),
        ]);
      throw error;
    } finally {
      residency.busy = false;
      if (id) await request('/history', { delete: [id] }, AbortSignal.timeout(3000)).catch(() => {});
    }
  }
  function control(action, model) {
    if (!['load', 'unload'].includes(action))
      throw fail('Control local inválido.', 'LOCAL_CONTROL_INVALID', 400);
    if (action === 'load' && !profiles().some((entry) => 'local:' + entry.id === model))
      throw fail('Modelo local no instalado.', 'LOCAL_MODEL_UNAVAILABLE', 422);
    const run = tail.catch(() => {}).then(() => performControl(action, model));
    tail = run;
    return run;
  }
  const generateImage = createLocalImage({ appRoot, request, fetchImpl, ensureEngine, caption: generate });
  function image(body, signal) {
    const run = tail
      .catch(() => {})
      .then(async () => {
        signal?.throwIfAborted();
        imageBusy = true;
        residency.busy = true;
        try {
          return await generateImage(body, signal);
        } finally {
          imageBusy = false;
          residency = { loadedModel: null, pinned: false, busy: false };
        }
      });
    tail = run;
    return run;
  }
  const localVideo = createLocalVideo({
    appRoot,
    request,
    fetchImpl,
    ensureEngine,
    verifyWeights: Boolean(startEngine),
  });
  /** Film previews share the GPU queue with text and images; the engine decides what stays resident. */
  function video(task, signal) {
    const run = tail
      .catch(() => {})
      .then(async () => {
        signal?.throwIfAborted();
        imageBusy = true;
        residency.busy = true;
        try {
          return await task(localVideo, signal);
        } finally {
          imageBusy = false;
          residency = { loadedModel: null, pinned: false, busy: false };
        }
      });
    tail = run;
    return run;
  }
  return {
    models,
    fetchLocal,
    video,
    videoAvailable: localVideo.available,
    control,
    image,
    imageModels: () => localImageModels(appRoot),
    status: () => ({ ...residency, busy: residency.busy || imageBusy }),
  };
}
module.exports = { createLocalProvider, LOCAL_ID };
