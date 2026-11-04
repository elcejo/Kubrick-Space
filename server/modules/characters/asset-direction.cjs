const {
  CHARACTER_ASSET_DIRECTION_PROMPT,
} = require('../../../public/js/contracts/character-instructions.js');
const { checkToolArguments, toolCorrection } = require('../../../public/js/contracts/tool-call.js');

const PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  required: ['visible', 'label', 'description', 'prompt'],
  properties: {
    visible: { type: 'boolean' },
    label: { type: 'string', minLength: 1, maxLength: 100 },
    description: { type: 'string', minLength: 1, maxLength: 2000 },
    prompt: { type: 'string', minLength: 60, maxLength: 3000 },
    predominantColor: { type: 'string', enum: ['white', 'other', 'unknown'] },
  },
};

/** Vision writer for a single Outfit extraction; the selected donor is authoritative. */
function createCharacterAssetDirectionOperation({
  security,
  readCharacterImage,
  getApiKeys,
  getLLMConfig,
  llmConfig,
  openrouterModels,
  proxyRequest,
}) {
  return async ({ body }) => {
    if (
      !body ||
      Object.keys(body).some((key) => !['projectId', 'referenceImage', 'item'].includes(key)) ||
      !body.referenceImage?.startsWith(`/projects/${body.projectId}/content/`) ||
      !security.IMAGE_NAME.test(body.referenceImage.split('/').pop())
    )
      throw security.fail('Referencia de pieza inválida.');
    const key = getApiKeys().openrouter || '';
    const config = getLLMConfig();
    const limits = llmConfig.functionConfig(config, 'character_asset_direction');
    if (!key && !llmConfig.isLocalModel(limits.model))
      throw security.fail('Configura OpenRouter para interpretar la referencia.', 428);
    const info = openrouterModels?.findModel(limits.model);
    if (info?.inputModalities?.length && !info.inputModalities.includes('image'))
      throw security.fail('El modelo de personajes debe admitir imágenes para interpretar la pieza.', 428);
    const image = readCharacterImage(body.projectId, body.referenceImage.split('/').pop());
    const name = 'compose_character_asset';
    const send = (extra = []) =>
      proxyRequest(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key.trim()}` },
          body: JSON.stringify({
            model: limits.model,
            ...(limits.model === 'xiaomi/mimo-v2.6-pro'
              ? {
                  provider: { allow_fallbacks: true, require_parameters: true },
                  reasoning: { effort: 'low' },
                }
              : {}),
            max_tokens: Math.min(limits.maxCompletionTokens, 4096),
            tool_choice: 'required',
            tools: [
              {
                type: 'function',
                function: {
                  name,
                  description:
                    'Describe e instruye la extracción precisa de una sola pieza de la imagen elegida.',
                  parameters: PARAMETERS,
                },
              },
            ],
            messages: [
              {
                role: 'system',
                content: llmConfig.characterPrompt(
                  config,
                  'character_asset_direction',
                  CHARACTER_ASSET_DIRECTION_PROMPT,
                ),
              },
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      kind: body.item.kind,
                      category: body.item.category,
                      label: body.item.label,
                      priorDescription: body.item.description,
                    }),
                  },
                  { type: 'image_url', image_url: { url: image, detail: 'high' } },
                ],
              },
              ...extra,
            ],
          }),
        },
        Math.min(limits.timeoutMs, 180000),
        { omitBody: true },
      );
    let response = await send();
    for (let attempt = 0; ; attempt++) {
      if (response.error)
        return {
          status: response.status || 502,
          body: { error: 'No se pudo interpretar la referencia de la pieza. La pieza anterior se conserva.' },
        };
      const choice = response.data?.choices?.[0],
        calls = choice?.message?.tool_calls;
      let feedback = '';
      if (choice?.finish_reason !== 'length' && calls?.length === 1 && calls[0].function?.name === name) {
        const checked = checkToolArguments(PARAMETERS, calls[0].function.arguments);
        if (checked.problems.length) feedback = checked.text;
        else if (checked.value.visible !== true) feedback = '';
        else return { status: 200, body: checked.value };
        // A piece the model reports as not identifiable is a legitimate answer, not a format error.
        if (!feedback) break;
        if (attempt === 0) {
          response = await send([
            { role: 'assistant', content: null, tool_calls: calls },
            {
              role: 'tool',
              tool_call_id: calls[0].id,
              content: JSON.stringify({ error: toolCorrection(feedback) }),
            },
          ]);
          if (!response.error) continue;
        }
      }
      break;
    }
    return {
      status: 422,
      body: {
        error: 'La referencia no permite identificar esa pieza con precisión. Adjunta otra fotografía.',
      },
    };
  };
}
module.exports = { createCharacterAssetDirectionOperation };
