const { confirmMakeupVisibility } = require('./makeup-visibility.cjs');
const { characterDonorInventoryPrompt } = require('../../../public/js/contracts/character-instructions.js');
const { randomUUID } = require('node:crypto');
const { validateCharacterDocument } = require('../../../public/js/contracts/character-model.js');
const {
  characterAssetImage,
  characterAppearanceKey,
  validateCharacterInventory,
  validateCharacterAssetPlan,
  characterAssetCategory,
  characterAssetKind,
  characterAssetSelectionMap,
  characterRequestedTraits,
  CHARACTER_AUTO_TRAITS,
  CHARACTER_ASSET_POLICY_VERSION,
} = require('../../../public/js/contracts/character-visual-library.js');

const {
  CHARACTER_INVENTORY_PROMPT: INVENTORY_PROMPT,
} = require('../../../public/js/contracts/character-instructions.js');

const {
  CHARACTER_EXTRACTION_RULES: EXTRACTION_RULES,
} = require('../../../public/js/contracts/character-instructions.js');

function createCharacterVisualLibraryOperation(dependencies) {
  const {
    security,
    assertProject,
    repository,
    getApiKeys,
    getLLMConfig,
    llmConfig,
    openrouterModels,
    proxyRequest,
    readCharacterImage,
    readCurrentProject,
  } = dependencies;
  const active = new Set();
  return async ({ body } = {}) => {
    let projectId;
    try {
      if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        Object.keys(body).some(
          (key) => !['projectId', 'document', 'sourceImage', 'extractionScope'].includes(key),
        ) ||
        (body.extractionScope !== undefined &&
          !['clothing_props', 'traits', 'all'].includes(body.extractionScope))
      )
        throw security.fail('Petición de componentes inválida.');
      assertProject(body.projectId);
      if (repository.get(body.projectId)?.type !== 'character')
        throw security.fail('Los componentes visuales pertenecen a personajes.');
      let document;
      try {
        document = validateCharacterDocument(body.document);
        if (
          document.id !== body.projectId ||
          !document.identity.base ||
          !document.identity.nature.trim() ||
          !characterAssetImage(body.sourceImage, body.projectId)
        )
          throw Error('El retrato y la ficha deben pertenecer a este personaje.');
      } catch (error) {
        throw security.fail(error.message);
      }
      if (readCurrentProject) {
        const current = readCurrentProject(body.projectId);
        const savedDocument = validateCharacterDocument(JSON.parse(current.content));
        if (
          (!body.extractionScope &&
            (current.covers?.[current.currentCoverIndex] || current.covers?.[0]) !== body.sourceImage) ||
          characterAppearanceKey(savedDocument) !== characterAppearanceKey(document) ||
          JSON.stringify(characterRequestedTraits(savedDocument)) !==
            JSON.stringify(characterRequestedTraits(document))
        )
          throw security.fail(
            'La apariencia principal cambió. Actualiza el desglose con el retrato vigente.',
            409,
          );
      }
      if (active.has(body.projectId) || active.size >= 4)
        throw security.fail('Ya se está preparando un inventario visual. Reintenta en un momento.', 409);
      const key = getApiKeys().openrouter || '';
      const config = getLLMConfig();
      const limits = llmConfig.functionConfig(config, 'character_visual_library');
      const model = limits.model,
        info = openrouterModels.findModel(model);
      if (!key && !llmConfig.isLocalModel(model))
        throw security.fail('Configura OpenRouter en Inicio → Configuración.', 428);
      if (info?.inputModalities?.length && !info.inputModalities.includes('image'))
        throw security.fail(
          'El modelo de personajes configurado debe admitir imágenes para desglosar el retrato.',
          428,
        );
      active.add(body.projectId);
      projectId = body.projectId;
      const image = readCharacterImage(projectId, body.sourceImage.split('/').pop());
      const categories =
        body.extractionScope === 'clothing_props'
          ? ['clothing', 'props']
          : body.extractionScope === 'traits'
            ? ['traits']
            : ['traits', 'clothing', 'props'];
      const tool = {
        type: 'function',
        function: {
          name: 'inventory_character_assets',
          description: 'Desglosa el retrato aceptado en referencias visuales independientes.',
          parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['items', 'visibility'],
            properties: {
              visibility: {
                type: 'object',
                additionalProperties: false,
                required: CHARACTER_AUTO_TRAITS,
                properties: Object.fromEntries(
                  CHARACTER_AUTO_TRAITS.map((kind) => [
                    kind,
                    {
                      type: 'string',
                      enum: ['visible', 'absent', 'uncertain', 'not_applicable'],
                    },
                  ]),
                ),
              },
              items: {
                type: 'array',
                maxItems: 48,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['category', 'kind', 'label', 'description', 'fieldKeys', 'prompt'],
                  properties: {
                    category: { type: 'string', enum: ['traits', 'clothing', 'props'] },
                    kind: {
                      type: 'string',
                      pattern: '^[a-z][a-z0-9-]{0,47}$',
                      description:
                        'Stable component type; face, hair, shirt, apron, shoes, glasses. Variants share the same kind.',
                    },
                    label: { type: 'string', maxLength: 100 },
                    description: { type: 'string', maxLength: 600 },
                    fieldKeys: { type: 'array', maxItems: 80, items: { type: 'string' } },
                    prompt: { type: 'string', maxLength: 900 },
                    predominantColor: {
                      type: 'string',
                      enum: ['white', 'other', 'unknown'],
                      description:
                        'Dominant actual color of this component only, excluding background, skin and mannequin. White means most of the component is white, not a few white highlights.',
                    },
                  },
                },
              },
            },
          },
        },
      };
      if (body.extractionScope) {
        tool.function.parameters.required = ['items'];
        delete tool.function.parameters.properties.visibility;
        tool.function.parameters.properties.items.items.properties.category.enum = categories;
      }
      let correction = '';
      for (let attempt = 0; attempt < 2; attempt++) {
        dependencies.backgroundSignal?.throwIfAborted();
        dependencies.reportProgress?.(
          attempt
            ? 'Revisando la integridad del inventario · intento 2 de 2…'
            : 'Analizando rasgos, ropa y props · intento 1 de 2…',
        );
        const result = await proxyRequest(
          'https://openrouter.ai/api/v1/chat/completions',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key.trim()}` },
            body: JSON.stringify({
              model,
              max_tokens: Math.min(limits.maxCompletionTokens, 12000),
              tools: [tool],
              tool_choice:
                model === 'xiaomi/mimo-v2.6-pro'
                  ? 'required'
                  : { type: 'function', function: { name: tool.function.name } },
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
                  content: body.extractionScope
                    ? llmConfig.characterPrompt(
                        config,
                        'character_visual_library',
                        characterDonorInventoryPrompt(categories),
                      )
                    : llmConfig.characterPrompt(
                        config,
                        'character_visual_library',
                        `${INVENTORY_PROMPT}\n${EXTRACTION_RULES}`,
                      ),
                },
                {
                  role: 'user',
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify(
                        body.extractionScope
                          ? { extractionScope: body.extractionScope, categories, fieldKeys: [] }
                          : {
                              subject: document.identity,
                              requestedTraits: characterRequestedTraits(document),
                              appearance: document.fields
                                .filter((field) => field.section === 'appearance')
                                .map(({ key, label, value }) => ({ key, label, value })),
                            },
                      ),
                    },
                    { type: 'image_url', image_url: { url: image, detail: 'high' } },
                  ],
                },
                ...(correction ? [{ role: 'user', content: correction }] : []),
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
              error:
                result.status === 504
                  ? `${typeof result.error === 'string' ? result.error : 'El análisis del retrato agotó el tiempo de espera.'} La fotografía se conserva; puedes reintentar.`
                  : 'No se pudo desglosar el retrato. La fotografía se conserva; puedes reintentar.',
            },
          };
        const choice = result.data?.choices?.[0],
          calls = choice?.message?.tool_calls;
        try {
          if (
            choice?.finish_reason === 'length' ||
            !Array.isArray(calls) ||
            calls.length !== 1 ||
            calls[0].function?.name !== tool.function.name
          )
            throw Error('Invalid inventory');
          const proposal = JSON.parse(calls[0].function.arguments);
          if (!body.extractionScope && attempt === 0 && proposal.visibility?.makeup === 'uncertain') {
            correction =
              'Reinspect the SAME accepted portrait at high detail to determine whether cosmetics exist at all. Natural eyelashes, eyelid shadows, skin tones, lip color, skin oil and lighting are NOT evidence of makeup. Report absent unless a real applied product boundary, paint, false lashes or cosmetic pigment can be seen. Return the full inventory and checklist again, including an independent makeup item when visible. If genuinely occluded or too small, retain uncertain. Preserve all other exact components and do not invent them.';
            continue;
          }
          const extracted = body.extractionScope
            ? validateCharacterAssetPlan(proposal, document)
            : validateCharacterInventory(proposal, document);
          if (
            body.extractionScope &&
            extracted.some((item) => !categories.includes(characterAssetCategory(item)))
          )
            throw Error('Componente fuera del alcance solicitado.');
          // A claimed cosmetic layer needs independent evidence from the portrait pixels.
          // No sheet, old component or proposed cosmetic description enters this check.
          const visibility = { ...proposal.visibility };
          let confirmed = extracted;
          if (extracted.some((item) => characterAssetKind(item) === 'makeup')) {
            dependencies.backgroundSignal?.throwIfAborted();
            dependencies.reportProgress?.('Comprobando cosméticos visibles…');
            const makeup = await confirmMakeupVisibility({ image, model, key, limits, proxyRequest });
            dependencies.backgroundSignal?.throwIfAborted();
            if (makeup !== 'visible')
              confirmed = extracted.filter((item) => characterAssetKind(item) !== 'makeup');
            visibility.makeup = makeup;
          }
          const items = confirmed.map((item) => ({
            ...item,
            kind: characterAssetKind(item),
            id: `asset_${randomUUID()}`,
            image: '',
            error: '',
          }));
          if (body.extractionScope)
            return {
              status: 200,
              headers: { 'Cache-Control': 'no-store' },
              body: {
                items: items.map((item) => ({
                  ...item,
                  category: characterAssetCategory(item),
                  fieldKeys: [],
                })),
              },
            };
          return {
            status: 200,
            headers: { 'Cache-Control': 'no-store' },
            body: {
              library: {
                version: 1,
                format: 'square-v2',
                policyVersion: CHARACTER_ASSET_POLICY_VERSION,
                requestedTraits: characterRequestedTraits(document),
                unresolvedTraits: CHARACTER_AUTO_TRAITS.filter((kind) => visibility[kind] === 'uncertain'),
                sourceImage: body.sourceImage,
                sourceKey: characterAppearanceKey(document),
                selections: characterAssetSelectionMap(items),
                appliedSelections: characterAssetSelectionMap(items),
                items,
              },
            },
          };
        } catch (error) {
          if (attempt === 0 && choice?.finish_reason !== 'length') {
            correction = body.extractionScope
              ? `Return one complete inventory_character_assets call with items only, restricted to ${categories.join(', ')}. Use the same donor, concrete short component descriptions and no invented parts or character changes.`
              : 'The inventory failed the deterministic completeness check. Reinspect the SAME portrait and return the complete corrected inventory and visibility checklist. Separate visible facial hair, makeup and head-worn accessories (earrings, hats, headbands/clips, eyewear, headphones) from face; include face and hair/bald scalp where applicable, and every visible mandatory distinctive trait. Do not invent absent features. Do not extract optional facial details unless requested.';
            if (/^Faltan piezas independientes visibles:/.test(error.message))
              correction += ` ${error.message.slice(0, 300)}`;
            continue;
          }
          return {
            status: 502,
            body: {
              error:
                'El modelo no completó un desglose visual consistente tras comprobar sus piezas. El retrato y las piezas anteriores se conservan; puedes reintentar.',
            },
          };
        }
      }
    } finally {
      if (projectId) active.delete(projectId);
    }
  };
}
module.exports = { createCharacterVisualLibraryOperation, INVENTORY_PROMPT };
