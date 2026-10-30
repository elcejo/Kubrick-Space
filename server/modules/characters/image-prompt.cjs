const {
  characterImageBrief,
  CHARACTER_IMAGE_WRITER_PROMPT,
  validateCharacterImageDirection,
} = require('../../../public/js/contracts/character-image-prompt.js');
const { validateCharacterDocument } = require('../../../public/js/contracts/character-model.js');
const {
  planCharacterComposition,
  CHARACTER_COMPOSITION_PROMPT,
} = require('../../../public/js/contracts/character-composition.js');

function createCharacterImagePromptOperation({
  security,
  assertProject,
  repository,
  getApiKeys,
  getLLMConfig,
  llmConfig,
  openrouterModels,
  proxyRequest,
  readCurrentProject,
}) {
  const active = new Set();
  return async function prepareCharacterImagePrompt({ body } = {}) {
    let id;
    try {
      if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        Object.keys(body).some(
          (key) =>
            ![
              'projectId',
              'document',
              'purpose',
              'referenceImage',
              'attachmentImage',
              'visualChangeKeys',
              'photoReferences',
              'assetSelection',
              'compositionRequest',
              'compositionStep',
              'visualScopes',
              'compositionForceIds',
            ].includes(key),
        )
      )
        throw security.fail('Petición de dirección visual inválida.');
      assertProject(body.projectId);
      if (repository.get(body.projectId)?.type !== 'character')
        throw security.fail('La dirección visual solo se prepara para personajes.');
      let document, brief;
      try {
        document = validateCharacterDocument(body.document);
        if (document.id !== body.projectId) throw new Error('La ficha pertenece a otro proyecto.');
        const current =
          body.assetSelection || body.compositionStep ? readCurrentProject(body.projectId) : null;
        if (
          body.assetSelection &&
          (current.covers?.[current.currentCoverIndex] || current.covers?.[0]) !== body.referenceImage
        )
          throw Error('La imagen principal cambió.');
        brief = characterImageBrief(document, { ...body, visualLibrary: current?.characterVisualLibrary });
        if (body.compositionStep) {
          const plan = planCharacterComposition(current.characterVisualLibrary, body.projectId, {
            document,
            changedKeys: body.visualChangeKeys || [],
            visualScopes: body.visualScopes || [],
            forceIds: body.compositionForceIds || [],
          });
          const proposed = body.compositionStep;
          const step = plan.steps.find(
            (step) =>
              JSON.stringify(step.items.map((item) => item.id)) ===
              JSON.stringify(proposed.items?.map((item) => item.id)),
          );
          if (!step || Object.keys(proposed).some((key) => key !== 'items'))
            throw Error('La etapa de Outfit no corresponde a las selecciones vigentes.');
          brief.appearance = [];
          delete brief.storyContext;
          brief.changed = [];
          brief.composition = {
            removed: plan.removed.map(({ id, label, description, kind }) => ({
              id,
              label,
              description,
              kind,
            })),
            items: step.items.map((item, index) => ({
              id: item.id,
              kind: item.kind,
              label: item.label,
              description: item.description,
              reference: index + 2,
              role: item.role,
              layer: item.layer,
            })),
          };
        }
      } catch (error) {
        throw security.fail(error.message);
      }
      if (active.has(body.projectId) || active.size >= 4)
        throw security.fail('Ya hay una dirección visual en preparación. Reintenta en un momento.', 409);
      const key = getApiKeys().openrouter || '';
      active.add(body.projectId);
      id = body.projectId;
      const config = getLLMConfig();
      const limits = llmConfig.functionConfig(config, 'character_image_prompt'),
        model = limits.model,
        info = openrouterModels.findModel(model);
      if (!key && !llmConfig.isLocalModel(model))
        throw security.fail('Configura OpenRouter en Inicio → Configuración.', 428);
      const tool = {
        type: 'function',
        function: {
          name: 'compose_character_portrait',
          description: 'Redacta exclusivamente la instrucción visual final de este personaje.',
          parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['prompt', 'subjectNature', 'changeKeys'],
            properties: {
              prompt: {
                type: 'string',
                minLength: 60,
                maxLength: 3000,
                description: 'Un solo párrafo natural en inglés, específico y sin metadatos ni narrativa.',
              },
              subjectNature: { type: 'string', enum: [brief.subject.nature] },
              changeKeys: {
                type: 'array',
                items: {
                  type: 'string',
                  ...(brief.changed.length ? { enum: brief.changed.map((field) => field.key) } : {}),
                },
                minItems: brief.changed.length,
                maxItems: brief.changed.length,
                uniqueItems: true,
              },
            },
          },
        },
      };
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await proxyRequest(
          'https://openrouter.ai/api/v1/chat/completions',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key.trim()}` },
            body: JSON.stringify({
              model,
              // Reasoning and the final tool call share this budget, including at low effort.
              max_tokens: Math.min(limits.maxCompletionTokens, 8192),
              tools: [tool],
              ...(info?.supportedParameters?.includes('parallel_tool_calls')
                ? { parallel_tool_calls: false }
                : {}),
              tool_choice:
                model === 'xiaomi/mimo-v2.6-pro'
                  ? 'required'
                  : { type: 'function', function: { name: 'compose_character_portrait' } },
              ...(model === 'xiaomi/mimo-v2.6-pro'
                ? {
                    provider: {
                      allow_fallbacks: true,
                      require_parameters: true,
                    },
                  }
                : {}),
              ...(info?.supportedParameters?.includes('reasoning') || model.startsWith('xiaomi/mimo-')
                ? { reasoning: { effort: 'low' } }
                : {}),
              messages: [
                {
                  role: 'system',
                  content: llmConfig.characterPrompt(
                    config,
                    'character_image_prompt',
                    body.compositionStep ? CHARACTER_COMPOSITION_PROMPT : CHARACTER_IMAGE_WRITER_PROMPT,
                  ),
                },
                { role: 'user', content: JSON.stringify(brief) },
                ...(attempt
                  ? [
                      {
                        role: 'user',
                        content:
                          'La respuesta anterior no cumplió el contrato. Devuelve UNA llamada compose_character_portrait con prompt concreto en inglés de 60 a 3000 caracteres, subjectNature EXACTAMENTE ' +
                          JSON.stringify(brief.subject.nature) +
                          ' y changeKeys EXACTAMENTE estos identificadores (ningún otro): ' +
                          JSON.stringify(brief.changed.map((field) => field.key)) +
                          '. No traduzcas la naturaleza ni los identificadores. No incluyas una plantilla, narrativa ni campos adicionales.',
                      },
                    ]
                  : []),
              ],
            }),
          },
          Math.min(limits.timeoutMs, 180000),
          { omitBody: true, completionStream: true },
        );
        if (result.error)
          return {
            status: result.status || 502,
            body: {
              error: 'No se pudo preparar la dirección visual. La ficha y la foto anterior se conservan.',
              code: 'CHARACTER_IMAGE_DIRECTION_PROVIDER_ERROR',
            },
          };
        const choice = result.data?.choices?.[0],
          rawCalls = choice?.message?.tool_calls,
          calls = Array.isArray(rawCalls)
            ? [...new Map(rawCalls.map((call) => [JSON.stringify(call.function), call])).values()]
            : rawCalls;
        if (choice?.finish_reason === 'length')
          return {
            status: 502,
            body: {
              error:
                'El modelo agotó el límite de respuesta al preparar la dirección visual. La ficha, la fotografía y la selección se conservan. Puedes reintentar; si se repite, aumenta el límite de tokens de texto en Configuración.',
              code: 'CHARACTER_IMAGE_DIRECTION_TRUNCATED',
            },
          };
        let prompt;
        try {
          if (
            !Array.isArray(calls) ||
            calls.length < 1 ||
            calls.length > 4 ||
            calls.some((call) => call.function?.name !== 'compose_character_portrait')
          )
            throw Error('Incomplete visual direction');
          // This tool only proposes text. Validate every proposal; use the final
          // validated refinement once, never execute multiple image generations.
          for (const call of calls)
            prompt = validateCharacterImageDirection(JSON.parse(call.function.arguments), brief);
        } catch (error) {
          console.warn('[Character direction] Propuesta rechazada:', {
            attempt: attempt + 1,
            reason:
              error instanceof SyntaxError
                ? 'invalid_json'
                : error.message === 'Incomplete visual direction'
                  ? 'missing_tool'
                  : 'invalid_contract',
          });
          if (attempt === 0) continue;
          return {
            status: 502,
            body: {
              error:
                'La dirección visual no es válida. La ficha y la fotografía anterior se conservan; puedes reintentar.',
              code: 'CHARACTER_IMAGE_DIRECTION_INVALID',
            },
          };
        }
        return { status: 200, headers: { 'Cache-Control': 'no-store' }, body: { prompt, model } };
      }
    } finally {
      if (id) active.delete(id);
    }
  };
}
module.exports = { createCharacterImagePromptOperation };
