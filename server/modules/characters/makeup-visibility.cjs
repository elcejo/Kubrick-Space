const {
  CHARACTER_MAKEUP_VISIBILITY_PROMPT,
} = require('../../../public/js/contracts/character-instructions.js');
const { checkToolArguments } = require('../../../public/js/contracts/tool-call.js');

const PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  required: ['visible', 'confidence', 'evidence'],
  properties: {
    visible: { type: 'boolean' },
    confidence: { type: 'string', enum: ['high', 'low'] },
    evidence: { type: 'string', minLength: 1, maxLength: 400 },
  },
};

/** Confirm only proposed cosmetics from the original pixels, without inventory/description bias. */
async function confirmMakeupVisibility({ image, model, key, limits, proxyRequest }) {
  try {
    const name = 'verify_character_makeup';
    const result = await proxyRequest(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key.trim()}` },
        body: JSON.stringify({
          model,
          max_tokens: Math.min(limits.maxCompletionTokens, 768),
          tool_choice: 'required',
          tools: [
            {
              type: 'function',
              function: {
                name,
                description: 'Check actual applied cosmetics, without generating or extracting anything.',
                parameters: PARAMETERS,
              },
            },
          ],
          messages: [
            { role: 'system', content: CHARACTER_MAKEUP_VISIBILITY_PROMPT },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Are applied cosmetics actually visible? Describe only direct pixel evidence, not natural features.',
                },
                { type: 'image_url', image_url: { url: image, detail: 'high' } },
              ],
            },
          ],
        }),
      },
      Math.min(limits.timeoutMs, 60000),
      { omitBody: true, completionStream: true },
    );
    if (result.error) return 'uncertain';
    const choice = result.data?.choices?.[0],
      calls = choice?.message?.tool_calls;
    if (choice?.finish_reason === 'length' || calls?.length !== 1 || calls[0].function?.name !== name)
      return 'uncertain';
    // Unknown fields are dropped; anything the schema declares must hold, or the layer is not confirmed.
    const checked = checkToolArguments(PARAMETERS, calls[0].function.arguments);
    if (checked.problems.length || !checked.value.evidence.trim()) return 'uncertain';
    const value = checked.value;
    if (value.confidence !== 'high') return 'uncertain';
    return value.visible ? 'visible' : 'absent';
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    // An unconfirmed optional layer must not fabricate cosmetics or block all the other pieces.
    return 'uncertain';
  }
}
module.exports = { confirmMakeupVisibility };
