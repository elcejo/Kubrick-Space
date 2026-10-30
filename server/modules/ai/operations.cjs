const { createProvider } = require('./provider.cjs');
const { createTextContext } = require('./text-context.cjs');
const { createImageStorage } = require('../media/index.cjs');
const {
  CHARACTER_MANNEQUIN_REFERENCES,
} = require('../../../public/js/contracts/character-visual-library.js');
// AI

const COVER_TEXT_ACTIONS = new Set(['portada_prompt_unificado']);
const LUNA_FAST_MODEL = 'openai/gpt-5.6-luna';
const LUNA_PRO_MODEL = 'openai/gpt-5.6-luna-pro';
const FAST_TEXT_ACTIONS = new Set(['corregir', 'chat']);

// Landscape requests (scenario panoramas and views) must never fall back to a portrait frame.
const LANDSCAPE_RATIOS = ['2:1', '21:9', '16:9', '3:2', '4:3'];
const isLandscape = (ratio) => LANDSCAPE_RATIOS.includes(ratio);
function supportedRatio(ratio, supported = []) {
  if (supported.includes(ratio)) return ratio;
  return isLandscape(ratio) ? LANDSCAPE_RATIOS.find((candidate) => supported.includes(candidate)) : undefined;
}
const openAISize = (ratio) =>
  ratio === '1:1' ? '1024x1024' : isLandscape(ratio) ? '1536x1024' : '1024x1536';
const geminiRatio = (ratio) => (ratio === '2:1' ? '21:9' : ratio || '2:3');

function reasoningMode(model, modelInfo) {
  if (modelInfo) {
    if (modelInfo.supportedParameters.includes('reasoning_effort')) return 'reasoning_effort';
    if (modelInfo.supportedParameters.includes('reasoning')) return 'reasoning';
    return null;
  }
  return model === LUNA_FAST_MODEL || model === LUNA_PRO_MODEL ? 'reasoning_effort' : null;
}

function validCoverBriefText(value) {
  const text =
    typeof value === 'string'
      ? value
          .trim()
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```$/, '')
          .trim()
      : '';
  try {
    const brief = JSON.parse(text);
    return Boolean(
      brief &&
      typeof brief.visualPrompt === 'string' &&
      brief.visualPrompt.trim().length >= 80 &&
      brief.visualPrompt.length <= 2500 &&
      typeof brief.tagline === 'string' &&
      brief.tagline.trim() &&
      brief.tagline.length <= 150 &&
      brief.tagline.trim().split(/\s+/).length <= 8,
    );
  } catch {
    return false;
  }
}

function createAIOperations(dependencies) {
  const {
    security,
    llmConfig,
    openrouterModels,
    LUNA_PRO_MAX_COMPLETION_TOKENS,
    getApiKeys,
    getLLMConfig,
    aiContexts,
    assertProject,
  } = dependencies;

  // ---------------------------------------------------------------------------
  // AI Proxy Endpoints (mock fallback when key is empty)
  // ---------------------------------------------------------------------------

  /**
   * Generic helper that makes a fetch call to an external AI API. If the
   * relevant key is empty it returns null so the caller can fall back to a
   * mock response.
   */
  const { request: proxyRequest } = createProvider(dependencies);
  function requireMediaModel() {
    if (dependencies.inference?.currentMode() === 'local')
      throw security.fail(
        'No hay un modelo local configurado para generar imágenes, audio o video. Selecciona API o Híbrido para esta función.',
        422,
      );
  }
  const prepareText = createTextContext(dependencies);
  const { saveImageLocally, referenceImage, referenceAsset, saveGeneratedImage } = createImageStorage({
    ...dependencies,
    referenceAssets: CHARACTER_MANNEQUIN_REFERENCES,
  });

  // POST /api/ai/text — OpenRouter Luna/Luna Pro

  function syncContext({ body: inputBody, params = {}, headers = {}, query = {} } = {}, ports = {}) {
    const responseHeaders = {};
    const reply = (body, status = 200) => ({ body, status, headers: responseHeaders });

    try {
      if (
        !inputBody ||
        Object.keys(inputBody).some((k) => !['projectId', 'snapshot', 'fresh'].includes(k)) ||
        (inputBody.fresh !== undefined && typeof inputBody.fresh !== 'boolean')
      )
        throw security.fail('Petición de contexto inválida');
      assertProject(inputBody.projectId);
      responseHeaders['Cache-Control'] = 'no-store';
      return reply(
        aiContexts.sync(inputBody.projectId, inputBody.snapshot, { fresh: inputBody.fresh === true }),
        200,
      );
    } catch (error) {
      throw error;
    }
  }

  async function generateText({ body: inputBody, params = {}, headers = {}, query = {} } = {}, ports = {}) {
    const responseHeaders = {};
    const reply = (body, status = 200) => ({ body, status, headers: responseHeaders });

    try {
      const { prepared, keys, runtimeConfig, messages } = prepareText(inputBody);
      if (
        dependencies.inference?.currentMode() === 'api' &&
        !keys.openrouter &&
        !COVER_TEXT_ACTIONS.has(inputBody.action)
      )
        throw security.fail('Configura OpenRouter para usar el modo API.', 428);
      if (
        keys.openrouter ||
        llmConfig.isLocalModel(
          llmConfig.functionConfig(
            runtimeConfig,
            inputBody.action || prepared?.action || (inputBody.message ? 'chat' : 'edit'),
          ).model,
        )
      ) {
        const isWorkspaceChat = Boolean(inputBody.message && !inputBody.instruction);
        const requestedAction =
          typeof inputBody.action === 'string' && inputBody.action ? inputBody.action : prepared?.action;
        const isCoverPrompt = COVER_TEXT_ACTIONS.has(requestedAction);
        const action = requestedAction || (isWorkspaceChat ? 'chat' : 'edit');
        const functionLimits = llmConfig.functionConfig(runtimeConfig, action);
        const useFastModel = isWorkspaceChat || FAST_TEXT_ACTIONS.has(action);
        const model = functionLimits.model || (useFastModel ? LUNA_FAST_MODEL : LUNA_PRO_MODEL);
        const modelInfo = openrouterModels.findModel(model);
        const selectedReasoningMode = reasoningMode(model, modelInfo);
        const reasoningEffort = selectedReasoningMode ? (useFastModel ? 'none' : 'max') : null;
        const requestOptions = { ...(inputBody.options || {}) };
        const requestedMaxTokens = requestOptions.max_completion_tokens ?? requestOptions.max_tokens;
        delete requestOptions.max_tokens;
        delete requestOptions.max_completion_tokens;
        // OpenRouter's reasoning models reject sampling controls such as
        // temperature/top_p. Keep those controls for fast Luna, but omit them
        // from Luna Pro requests so the provider can apply its reasoning policy.
        if (!useFastModel && selectedReasoningMode) {
          delete requestOptions.temperature;
          delete requestOptions.top_p;
        }
        delete requestOptions.model;
        delete requestOptions.messages;
        delete requestOptions.reasoning;
        delete requestOptions.reasoning_effort;
        const defaultMaxCompletionTokens =
          functionLimits.maxCompletionTokens || (isWorkspaceChat ? 2048 : LUNA_PRO_MAX_COMPLETION_TOKENS);
        // Reasoning tokens count toward max_completion_tokens. The previous
        // 8,192-token ceiling could be exhausted before Luna Pro returned the
        // screenplay or structured cover brief. Use the provider's documented
        // ceiling for every Pro task; this is a cap, not a request to generate
        // that much text.
        const providerMaxCompletionTokens = modelInfo?.maxCompletionTokens || LUNA_PRO_MAX_COMPLETION_TOKENS;
        const maxCompletionTokens = useFastModel
          ? Math.min(
              requestedMaxTokens || defaultMaxCompletionTokens,
              functionLimits.maxCompletionTokens,
              providerMaxCompletionTokens,
            )
          : Math.min(functionLimits.maxCompletionTokens, providerMaxCompletionTokens);
        const requestText = inputBody.stream
          ? (url, options, timeoutMs) => {
              console.log(
                security.redact(
                  JSON.stringify({ type: 'AI_STREAM_REQUEST', ...JSON.parse(options.body) }),
                  Object.values(keys),
                ),
              );
              return ports.streamText(url, options, {
                timeoutMs,
                fetchImpl: dependencies.fetchImpl || ((...args) => fetch(...args)),
                redact: (value) => security.redact(value, Object.values(keys)),
                debug: {
                  model,
                  ...(prepared
                    ? {
                        context: {
                          projectId: prepared.projectId,
                          version: prepared.contextVersion,
                          sessionId: prepared.sessionId,
                          action: prepared.action,
                          scope: prepared.policy.scope,
                        },
                      }
                    : { messages }),
                  keys: Object.keys(keys).filter((k) => !!keys[k]),
                },
              });
            }
          : proxyRequest;
        const result = await requestText(
          'https://openrouter.ai/api/v1/chat/completions',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(keys.openrouter ? { Authorization: `Bearer ${keys.openrouter.trim()}` } : {}),
            },
            body: JSON.stringify({
              ...requestOptions,
              model,
              ...(inputBody.stream ? { stream: true, stream_options: { include_usage: true } } : {}),
              ...(prepared ? { session_id: prepared.sessionId } : {}),
              messages: messages,
              max_completion_tokens: maxCompletionTokens,
              ...(reasoningEffort
                ? selectedReasoningMode === 'reasoning'
                  ? { reasoning: { effort: reasoningEffort } }
                  : { reasoning_effort: reasoningEffort }
                : {}),
              ...(inputBody.action === 'portada_prompt_unificado'
                ? { response_format: { type: 'json_object' } }
                : {}),
            }),
          },
          // Complete-book adaptation can be long and uses maximum reasoning.
          // Keep shorter guards for ordinary editor actions and cover briefs.
          functionLimits.timeoutMs,
        );

        if (inputBody.stream) return;

        if (result.error) {
          return reply({ error: result.error, ...(result.code ? { code: result.code } : {}) }, result.status);
        }

        const choice = result.data.choices?.[0];
        if (prepared && (typeof choice?.message?.content !== 'string' || !choice.message.content.trim())) {
          if (choice?.finish_reason === 'length') {
            return reply(
              {
                code: 'AI_RESPONSE_TRUNCATED',
                error:
                  'Luna Pro agotó el presupuesto de razonamiento antes de devolver texto utilizable. No se ha aplicado ningún cambio; vuelve a intentarlo.',
              },
              502,
            );
          }
          return reply(
            {
              code: 'AI_EMPTY_RESPONSE',
              error: 'El proveedor no devolvió texto utilizable. No se ha aplicado ningún cambio.',
            },
            502,
          );
        }
        if ((isCoverPrompt || prepared) && choice?.finish_reason === 'length') {
          return reply(
            {
              code: 'AI_RESPONSE_TRUNCATED',
              error:
                'El proveedor agotó el límite y devolvió una respuesta incompleta. No se ha aplicado. Reduce el fragmento objetivo e inténtalo de nuevo.',
            },
            502,
          );
        }
        if (inputBody.action === 'portada_prompt_unificado') {
          if (!validCoverBriefText(choice?.message?.content || '')) {
            return reply(
              {
                code: 'AI_INVALID_COVER_BRIEF',
                error:
                  'El proveedor devolvió un prompt de portada vacío o inválido. La imagen no se ha generado.',
              },
              502,
            );
          }
        }
        return reply(
          {
            text: result.data.choices?.[0]?.message?.content || JSON.stringify(result.data),
            debug: {
              model: result.data.model || model,
              finishReason: choice?.finish_reason || null,
              usage: result.data.usage || null,
              ...(prepared
                ? {
                    context: {
                      projectId: prepared.projectId,
                      version: prepared.contextVersion,
                      sessionId: prepared.sessionId,
                      action: prepared.action,
                      scope: prepared.policy.scope,
                    },
                  }
                : {}),
              ...(!prepared ? { messages } : {}),
              keys: Object.keys(keys).filter((k) => !!keys[k]),
            },
          },
          200,
        );
      }

      // Cover prompts require a real text model; the mock cannot produce a
      // useful structured art direction.
      if (COVER_TEXT_ACTIONS.has(inputBody.action)) {
        return reply(
          {
            code: 'OPENROUTER_REQUIRED_FOR_COVER',
            error:
              'Configura una clave de OpenRouter en Inicio > Configuración > Claves API para preparar la dirección artística de la portada.',
          },
          428,
        );
      }

      if (['generate_character', 'character_portrait_prompt'].includes(inputBody.action)) {
        return reply(
          {
            code: 'OPENROUTER_REQUIRED_FOR_CHARACTER',
            error:
              'Configura una clave de OpenRouter para generar la ficha o la descripción visual del personaje.',
          },
          428,
        );
      }

      // Mock response
      let mockText =
        'Esta es una respuesta simulada del modelo de IA. Configura una clave de OpenRouter para activar GPT-5.6 Luna.';

      return reply(
        {
          text: mockText,
          debug: {
            ...(!prepared ? { messages } : {}),
            ...(prepared
              ? {
                  context: {
                    projectId: prepared.projectId,
                    version: prepared.contextVersion,
                    sessionId: prepared.sessionId,
                    action: prepared.action,
                    scope: prepared.policy.scope,
                  },
                }
              : {}),
            mock: true,
          },
        },
        200,
      );
    } catch (err) {
      console.error('POST /api/ai/text error:', err);
      return reply(
        {
          error: err.status ? err.message : 'AI text generation failed',
          ...(err.code ? { code: err.code } : {}),
        },
        err.status || 500,
      );
    }
  }

  async function generateVideo({ body: inputBody, params = {}, headers = {}, query = {} } = {}, ports = {}) {
    requireMediaModel();
    const responseHeaders = {};
    const reply = (body, status = 200) => ({ body, status, headers: responseHeaders });

    try {
      const keys = getApiKeys();

      if (keys.replicate) {
        const result = await proxyRequest('https://api.replicate.com/v1/predictions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${keys.replicate}`,
          },
          body: JSON.stringify({
            version: inputBody.version || '',
            input: inputBody.input || {},
          }),
        });

        if (result.error) {
          return reply({ error: result.error }, result.status);
        }

        return reply(
          {
            videoUrl: result.data.output || null,
            status: result.data.status || 'processing',
            predictionId: result.data.id,
          },
          200,
        );
      }

      // Mock response
      return reply(
        {
          videoUrl: null,
          status: 'mock',
          message: 'Generación de video simulada. Configure su API key de Replicate para activar.',
        },
        200,
      );
    } catch (err) {
      console.error('POST /api/ai/video error:', err);
      return reply({ error: 'AI video generation failed' }, 500);
    }
  }

  async function generateMultimodal(
    { body: inputBody, params = {}, headers = {}, query = {} } = {},
    ports = {},
  ) {
    const responseHeaders = {};
    const reply = (body, status = 200) => ({ body, status, headers: responseHeaders });

    try {
      const keys = getApiKeys();
      const runtimeConfig = getLLMConfig();
      if (
        dependencies.inference?.currentMode() === 'api' &&
        !keys.openrouter &&
        !COVER_TEXT_ACTIONS.has(inputBody.action)
      )
        throw security.fail('Configura OpenRouter para usar el modo API.', 428);

      if (
        keys.openrouter ||
        llmConfig.isLocalModel(llmConfig.functionConfig(runtimeConfig, inputBody.action || 'chat').model)
      ) {
        const contents =
          Array.isArray(inputBody.contents) && inputBody.contents.length
            ? inputBody.contents
            : [{ role: 'user', parts: [{ text: inputBody.prompt || '' }] }];
        const messages = contents.map((item) => ({
          role: item.role === 'model' ? 'assistant' : item.role === 'system' ? 'system' : 'user',
          content: item.parts.map((part) =>
            part.text !== undefined
              ? { type: 'text', text: part.text }
              : {
                  type: 'image_url',
                  image_url: { url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` },
                },
          ),
        }));
        const options = { ...(inputBody.options || {}) };
        // Multimodal compatibility requests historically use the fast model
        // when no explicit function is supplied (for example, face cropping).
        const functionLimits = llmConfig.functionConfig(runtimeConfig, inputBody.action || 'chat');
        const model = functionLimits.model || LUNA_FAST_MODEL;
        const modelInfo = openrouterModels.findModel(model);
        const selectedReasoningMode = reasoningMode(model, modelInfo);
        const requestedMaxTokens = options.max_completion_tokens ?? options.max_tokens;
        delete options.max_tokens;
        delete options.max_completion_tokens;
        delete options.model;
        delete options.messages;
        delete options.reasoning;
        delete options.reasoning_effort;
        const url = 'https://openrouter.ai/api/v1/chat/completions';
        const result = await proxyRequest(
          url,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(keys.openrouter ? { Authorization: `Bearer ${keys.openrouter.trim()}` } : {}),
            },
            body: JSON.stringify({
              ...options,
              model,
              messages,
              max_completion_tokens: Math.min(
                requestedMaxTokens || functionLimits.maxCompletionTokens,
                functionLimits.maxCompletionTokens,
                modelInfo?.maxCompletionTokens || LUNA_PRO_MAX_COMPLETION_TOKENS,
              ),
              ...(selectedReasoningMode === 'reasoning'
                ? { reasoning: { effort: 'none' } }
                : selectedReasoningMode
                  ? { reasoning_effort: 'none' }
                  : {}),
            }),
          },
          functionLimits.timeoutMs,
        );

        if (result.error) {
          return reply({ error: result.error }, result.status);
        }

        return reply(
          {
            text: result.data.choices?.[0]?.message?.content || JSON.stringify(result.data),
          },
          200,
        );
      }

      // Mock response
      return reply(
        {
          text: 'Respuesta multimodal simulada. Configure su API key de OpenRouter para activar GPT-5.6 Luna.',
          status: 'mock',
        },
        200,
      );
    } catch (err) {
      console.error('POST /api/ai/multimodal error:', err);
      return reply({ error: 'AI multimodal generation failed' }, 500);
    }
  }

  async function generateImage({ body: inputBody, params = {}, headers = {}, query = {} } = {}, ports = {}) {
    const local = dependencies.inference?.currentMode() === 'local';
    const settings = dependencies.inference?.currentSettings();
    const selectedImage =
      !settings?.projectId || settings.projectId === inputBody.projectId ? settings?.imageModel : null;
    if (selectedImage) inputBody = { ...inputBody, ...selectedImage };
    const responseHeaders = {};
    const reply = (body, status = 200) => ({ body, status, headers: responseHeaders });

    try {
      if (local) {
        if (inputBody.projectId) assertProject(inputBody.projectId);
        if (inputBody.imageType && !['cover', 'character'].includes(inputBody.imageType))
          throw security.fail('Tipo de imagen inválido.');
        const processedImages = [];
        const images = inputBody.inputImages || [];
        if (!Array.isArray(images) || images.length > 8)
          throw security.fail('Hasta ocho referencias locales.');
        for (const image of images) {
          if (typeof image !== 'string') throw security.fail('Referencia local inválida.');
          const own = /^\/projects\/([^/]+)\/content\/([^/]+)$/.exec(image);
          if (CHARACTER_MANNEQUIN_REFERENCES.includes(image)) processedImages.push(referenceAsset(image));
          else if (own) processedImages.push(referenceImage(own[1], own[2]));
          else if (image.startsWith('data:')) {
            security.decodeImage(image);
            processedImages.push(image);
          } else throw security.fail('Importa las referencias al proyecto antes de generar en Local.');
        }
        const result = await dependencies.inference.generateLocalImage(
          {
            prompt: inputBody.prompt,
            inputImages: processedImages,
            aspectRatio: inputBody.aspectRatio || '2:3',
            imageType: inputBody.imageType || 'cover',
            promptReady: inputBody.promptReady === true,
            model: 'flux3-klein',
          },
          dependencies.backgroundSignal || ports.signal,
        );
        security.imageType(result.buffer);
        const imageUrl = inputBody.projectId
          ? saveGeneratedImage(inputBody.projectId, result.buffer)
          : `data:image/png;base64,${result.buffer.toString('base64')}`;
        if (inputBody.imageType === 'character' && inputBody.aspectRatio !== '1:1')
          await dependencies.ensureCharacterFace?.(imageUrl);
        return reply({ ...result, buffer: undefined, imageUrl, status: 'success', backend: 'local' });
      }
      if (inputBody.backend !== 'api')
        return reply(
          {
            error: 'El backend solicitado no coincide con el modo API del proyecto.',
          },
          400,
        );
      const keys = getApiKeys();
      const projectId = inputBody.projectId;
      const prompt = inputBody.prompt || '';
      const imageType = inputBody.imageType || 'cover'; // 'cover' or 'character'
      const inputImages = inputBody.inputImages || [];
      const requestedProvider = inputBody.provider || null;
      if (requestedProvider && !['replicate', 'openai', 'openrouter', 'gemini'].includes(requestedProvider)) {
        return reply({ error: 'Proveedor de imágenes no válido.' }, 400);
      }

      const selectedModel =
        requestedProvider && dependencies.imageCatalog
          ? await dependencies.imageCatalog.find(
              requestedProvider,
              inputBody.model ||
                {
                  openrouter: 'meta/muse-image',
                  replicate: imageType === 'character' ? 'bytedance/seedream-4.5' : 'openai/gpt-image-2',
                  openai: 'gpt-image-1',
                }[requestedProvider],
            )
          : null;
      if (requestedProvider && dependencies.imageCatalog && !selectedModel)
        return reply(
          { error: 'El modelo no está disponible para este flujo. Actualiza el catálogo y selecciona otro.' },
          422,
        );
      if (
        selectedModel &&
        (!selectedModel.imageTypes.includes(imageType) || inputImages.length > selectedModel.maxReferences)
      )
        return reply(
          {
            error: `Este modelo admite hasta ${selectedModel.maxReferences} referencias y no es compatible con esta solicitud.`,
          },
          422,
        );
      // Both providers receive validated references directly; no public file host.
      const processedImages = [];
      if (!Array.isArray(inputImages) || inputImages.length > 8)
        return reply({ error: 'Up to 8 reference images are supported' }, 400);
      for (const imgUrl of inputImages) {
        if (typeof imgUrl !== 'string') return reply({ error: 'Invalid reference image' }, 400);
        const local = /^\/projects\/([^/]+)\/content\/([^/]+)$/.exec(imgUrl);
        if (CHARACTER_MANNEQUIN_REFERENCES.includes(imgUrl)) {
          processedImages.push(referenceAsset(imgUrl));
        } else if (local) {
          processedImages.push(referenceImage(local[1], local[2]));
        } else if (imgUrl.startsWith('data:')) {
          security.decodeImage(imgUrl);
          processedImages.push(imgUrl);
        } else {
          const remote = new URL(imgUrl);
          if (
            remote.protocol !== 'https:' ||
            remote.username ||
            remote.password ||
            !['images.unsplash.com', 'replicate.delivery'].some(
              (host) => remote.hostname === host || remote.hostname.endsWith(`.${host}`),
            )
          )
            return reply({ error: 'Import the reference image into the project first' }, 400);
          processedImages.push(remote.href);
        }
      }

      if (keys.gemini && requestedProvider === 'gemini') {
        const model = inputBody.model;
        const parts = [{ text: prompt }];
        for (const image of processedImages) {
          if (!image.startsWith('data:'))
            return reply({ error: 'Importa las referencias al proyecto antes de editar.' }, 400);
          parts.push({
            inlineData: { mimeType: image.slice(5, image.indexOf(';')), data: image.split(',')[1] },
          });
        }
        const result = await proxyRequest(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': keys.gemini },
            body: JSON.stringify({
              contents: [{ role: 'user', parts }],
              generationConfig: {
                responseModalities: ['TEXT', 'IMAGE'],
                imageConfig: { aspectRatio: geminiRatio(inputBody.aspectRatio) },
              },
            }),
          },
        );
        if (result.error) return reply({ error: result.error }, result.status);
        const image = result.data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
        if (!image?.data) return reply({ error: 'Gemini no devolvió una imagen.' }, 502);
        const data = `data:${image.mimeType};base64,${image.data}`;
        const decoded = security.decodeImage(data);
        return reply({
          imageUrl: projectId ? saveGeneratedImage(projectId, decoded.buffer, 'gemini') : data,
          status: 'success',
          provider: 'gemini',
          model,
        });
      }
      if (keys.openrouter && requestedProvider === 'openrouter') {
        const model = inputBody.model || 'meta/muse-image';
        if (model !== 'meta/muse-image' && !selectedModel)
          return reply({ error: 'Modelo de OpenRouter no válido para esta integración.' }, 400);
        if (!['cover', 'character'].includes(imageType))
          return reply({ error: 'Tipo de imagen no válido.' }, 400);
        console.log(`Sending image generation request to OpenRouter using model: ${model}...`);
        const imageRequest = {
          model,
          prompt,
          n: 1,
          aspect_ratio: inputBody.aspectRatio || '2:3',
          ...(selectedModel?.providerTags?.length ? { provider: { only: selectedModel.providerTags } } : {}),
          ...(processedImages.length
            ? { input_references: processedImages.map((url) => ({ type: 'image_url', image_url: { url } })) }
            : {}),
        };
        const result = await proxyRequest('https://openrouter.ai/api/v1/images', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${keys.openrouter.trim()}`,
            'X-Title': 'Kubrick Space',
          },
          body: JSON.stringify(imageRequest),
        });
        if (result.error) {
          const providerError = JSON.stringify(result.error);
          if (/content management policy|content policy|safety filter|prompt.*filter/i.test(providerError)) {
            return reply(
              {
                error:
                  'Meta/Muse bloqueó la solicitud con sus filtros de contenido, pero no indicó el motivo específico. Esto no confirma que la imagen contenga desnudez ni que la hayas solicitado. La fotografía de referencia y la ficha se conservan.',
                code: 'IMAGE_PROMPT_FILTERED',
                provider: 'openrouter',
                model,
              },
              result.status,
            );
          }
          return reply({ error: result.error }, result.status);
        }

        const imageData = result.data?.data?.[0];
        const base64Data = imageData?.b64_json;
        if (typeof base64Data !== 'string' || !base64Data) {
          console.error(
            'OpenRouter Images output has no b64_json image. Response:',
            JSON.stringify(result.data),
          );
          return reply({ error: 'OpenRouter no devolvió datos de imagen.' }, 502);
        }
        const mediaType = typeof imageData.media_type === 'string' ? imageData.media_type : 'image/png';
        const decoded = security.decodeImage(`data:${mediaType};base64,${base64Data}`);
        let imageUrl;
        if (projectId) {
          imageUrl = saveGeneratedImage(projectId, decoded.buffer, 'muse');
        } else {
          const outputType =
            mediaType === 'image/jpeg' || mediaType === 'image/jpg'
              ? 'jpeg'
              : mediaType.replace('image/', '');
          imageUrl = `data:image/${outputType};base64,${decoded.buffer.toString('base64')}`;
        }
        return reply(
          {
            imageUrl,
            status: 'success',
            backend: 'api',
            provider: 'openrouter',
            model,
            message: 'Imagen generada con Muse Image vía OpenRouter.',
            data: result.data,
          },
          200,
        );
      }

      if (
        keys.replicate &&
        requestedProvider !== 'openai' &&
        requestedProvider !== 'openrouter' &&
        requestedProvider !== 'gemini'
      ) {
        const model =
          inputBody.model || (imageType === 'character' ? 'bytedance/seedream-4.5' : 'openai/gpt-image-2');
        console.log(`Sending image generation request to Replicate using model: ${model}...`);

        const input = { prompt };
        if (model === 'bytedance/seedream-4.5') {
          input.size = '2K';
          input.aspect_ratio = inputBody.aspectRatio || '2:3';
          input.max_images = 1;
          input.image_input = processedImages;
          input.sequential_image_generation = 'disabled';
        } else if (selectedModel) {
          input[selectedModel.referenceField] = processedImages;
          const ratio = supportedRatio(inputBody.aspectRatio || '2:3', selectedModel.aspectRatios);
          if (ratio) input.aspect_ratio = ratio;
        } else {
          input.aspect_ratio = '2:3';
          if (processedImages.length > 0) {
            input.input_images = processedImages;
          }
        }

        const result = await proxyRequest(`https://api.replicate.com/v1/models/${model}/predictions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${keys.replicate}`,
            Prefer: 'wait',
          },
          body: JSON.stringify({ input }),
        });

        if (result.error) {
          return reply({ error: result.error }, result.status);
        }

        let prediction = result.data;

        // If the prediction is still starting or processing, we poll for the result
        if (prediction && (prediction.status === 'starting' || prediction.status === 'processing')) {
          console.log(
            `Replicate prediction ${prediction.id} is still processing. Starting polling fallback...`,
          );
          let attempts = 0;
          const maxAttempts = 30; // 30 * 4s = 120s (2 minutes)

          while (
            (prediction.status === 'starting' || prediction.status === 'processing') &&
            attempts < maxAttempts
          ) {
            // Wait 4 seconds
            await new Promise((resolve) => {
              setTimeout(resolve, 4000);
            });
            attempts++;

            console.log(
              `Polling Replicate prediction ${prediction.id} (attempt ${attempts}/${maxAttempts})...`,
            );

            const pollResult = await proxyRequest(
              `https://api.replicate.com/v1/predictions/${prediction.id}`,
              {
                method: 'GET',
                headers: {
                  Authorization: `Bearer ${keys.replicate}`,
                },
              },
            );

            if (pollResult.error) {
              console.error(`Replicate polling error on attempt ${attempts}:`, pollResult.error);
              break;
            }

            prediction = pollResult.data;
          }
        }

        if (!prediction) {
          return reply({ error: 'Replicate returned empty prediction data.' }, 400);
        }

        if (prediction.status === 'failed') {
          console.error('Replicate prediction failed:', prediction.error);
          return reply({ error: `Replicate prediction failed: ${prediction.error || 'Unknown error'}` }, 400);
        }

        let outputUrl = null;
        if (Array.isArray(prediction.output)) {
          outputUrl = prediction.output[0];
        } else if (typeof prediction.output === 'string') {
          outputUrl = prediction.output;
        }

        if (!outputUrl) {
          console.error(
            'Replicate prediction finished but returned no output URL. Status:',
            prediction.status,
            'Data:',
            JSON.stringify(prediction),
          );
          return reply({ error: 'Replicate did not return a valid output image URL.' }, 400);
        }

        let imageUrl = outputUrl;
        if (projectId) {
          imageUrl = await saveImageLocally(projectId, outputUrl);
        }

        return reply(
          {
            imageUrl: imageUrl,
            status: 'success',
            message: `Imagen generada con éxito por ${model} en Replicate.`,
            data: prediction,
          },
          200,
        );
      }

      if (
        keys.openai &&
        requestedProvider !== 'replicate' &&
        requestedProvider !== 'openrouter' &&
        requestedProvider !== 'gemini'
      ) {
        const model = inputBody.model || 'gpt-image-1';
        const options = { method: 'POST', headers: { Authorization: `Bearer ${keys.openai}` } };
        if (processedImages.length) {
          const form = new FormData();
          form.set('model', model);
          form.set('prompt', prompt);
          form.set('n', '1');
          form.set('size', openAISize(inputBody.aspectRatio));
          for (let i = 0; i < processedImages.length; i++) {
            const data = processedImages[i];
            if (!data.startsWith('data:'))
              return reply({ error: 'Importa las referencias al proyecto antes de editar.' }, 400);
            const decoded = security.decodeImage(data);
            form.append(
              'image[]',
              new Blob([decoded.buffer], { type: data.slice(5, data.indexOf(';')) }),
              `reference-${i}.png`,
            );
          }
          options.body = form;
        } else {
          options.headers['Content-Type'] = 'application/json';
          options.body = JSON.stringify({
            model,
            prompt,
            n: 1,
            size: openAISize(inputBody.aspectRatio),
          });
        }
        const result = await proxyRequest(
          `https://api.openai.com/v1/images/${processedImages.length ? 'edits' : 'generations'}`,
          options,
        );

        if (result.error) {
          return reply({ error: result.error }, result.status);
        }

        const outputArray = result.data?.output || [];
        const base64Data = result.data?.data?.[0]?.b64_json || null;

        if (!base64Data) {
          console.error(
            'OpenAI Responses output has no image_generation_call result. Output:',
            JSON.stringify(outputArray),
          );
          return reply({ error: 'No image data returned from OpenAI Responses API' }, 400);
        }

        let imageUrl = null;
        if (projectId) {
          try {
            const decoded = security.decodeImage(`data:image/png;base64,${base64Data}`);
            imageUrl = saveGeneratedImage(projectId, decoded.buffer);
          } catch (saveErr) {
            console.error('Error saving base64 image locally:', saveErr);
            imageUrl = `data:image/png;base64,${base64Data}`;
          }
        } else {
          imageUrl = `data:image/png;base64,${base64Data}`;
        }

        return reply(
          {
            imageUrl: imageUrl,
            status: 'success',
            message: 'Imagen generada con éxito por OpenAI Responses API.',
            data: result.data,
          },
          200,
        );
      }

      if (requestedProvider) {
        const providerLabel =
          { replicate: 'Replicate', openai: 'OpenAI', openrouter: 'OpenRouter' }[requestedProvider] ||
          requestedProvider;
        return reply({ error: `La clave de ${providerLabel} no está configurada.` }, 409);
      }

      // Mock response
      const mockImages = [
        'https://images.unsplash.com/photo-1543002588-bfa74002ed7e?auto=format&fit=crop&w=780&q=80',
        'https://images.unsplash.com/photo-1506880018603-83d5b814b5a6?auto=format&fit=crop&w=780&q=80',
        'https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&w=780&q=80',
        'https://images.unsplash.com/photo-1516979187457-637abb4f9353?auto=format&fit=crop&w=780&q=80',
        'https://images.unsplash.com/photo-1474932430478-367db26836c1?auto=format&fit=crop&w=780&q=80',
        'https://images.unsplash.com/photo-1532012197267-da84d127e765?auto=format&fit=crop&w=780&q=80',
      ];
      let imageUrl = mockImages[Math.floor(Math.random() * mockImages.length)];

      if (projectId) {
        imageUrl = await saveImageLocally(projectId, imageUrl);
      }

      return reply(
        {
          imageUrl: imageUrl,
          status: 'mock',
          message: 'Generación de imagen simulada.',
        },
        200,
      );
    } catch (err) {
      console.error('POST /api/ai/image error:', err);
      return reply(
        { error: err.status ? err.message : 'Invalid image request or generation failed' },
        err.status || 400,
      );
    }
  }

  async function generateFlux({ body: inputBody, params = {}, headers = {}, query = {} } = {}, ports = {}) {
    if (dependencies.inference?.currentMode() === 'local')
      return generateImage(
        { body: { ...inputBody, ...inputBody.input, prompt: inputBody.prompt || inputBody.input?.prompt } },
        ports,
      );
    requireMediaModel();
    const responseHeaders = {};
    const reply = (body, status = 200) => ({ body, status, headers: responseHeaders });

    try {
      const keys = getApiKeys();

      if (keys.replicate) {
        const result = await proxyRequest('https://api.replicate.com/v1/predictions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${keys.replicate}`,
          },
          body: JSON.stringify({
            version: inputBody.version || '',
            input: inputBody.input || {},
          }),
        });

        if (result.error) {
          return reply({ error: result.error }, result.status);
        }

        return reply(
          {
            imageUrl: result.data.output || null,
            status: result.data.status || 'processing',
            predictionId: result.data.id,
          },
          200,
        );
      }

      // Mock response
      return reply(
        {
          imageUrl: null,
          status: 'mock',
          message: 'Generación de imagen FLUX simulada. Configure su API key de Replicate para activar.',
        },
        200,
      );
    } catch (err) {
      console.error('POST /api/ai/image-flux error:', err);
      return reply({ error: 'AI FLUX image generation failed' }, 500);
    }
  }

  async function generateAudio({ body: inputBody, params = {}, headers = {}, query = {} } = {}, ports = {}) {
    requireMediaModel();
    const responseHeaders = {};
    const reply = (body, status = 200) => ({ body, status, headers: responseHeaders });

    try {
      const keys = getApiKeys();

      if (keys.minimax) {
        // MiniMax audio generation — placeholder for the real endpoint.
        // The actual MiniMax audio API URL / payload would be configured here.
        return reply(
          {
            audioUrl: null,
            status: 'not_implemented',
            message: 'MiniMax audio endpoint detected key but real integration is pending.',
          },
          200,
        );
      }

      // Mock response
      return reply(
        {
          audioUrl: null,
          status: 'mock',
          message: 'Generación de audio simulada. Configure su API key de MiniMax para activar.',
        },
        200,
      );
    } catch (err) {
      console.error('POST /api/ai/audio error:', err);
      return reply({ error: 'AI audio generation failed' }, 500);
    }
  }
  return {
    syncContext,
    generateText,
    generateVideo,
    generateMultimodal,
    generateImage,
    generateFlux,
    generateAudio,
  };
}
module.exports = { createAIOperations };
