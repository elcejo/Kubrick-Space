// Published standard text rates in USD per million tokens, reviewed on 2026-11-06.
const openai = {
  // https://developers.openai.com/api/docs/pricing
  'gpt-6-astra': [10, 50, 20, 75],
  'gpt-6.1-sol': [2, 10, 4, 15],
  'gpt-6.1-terra': [1, 5, 2, 7.5],
  'gpt-6-luna': [0.1, 0.5, 0.2, 0.75],
  'gpt-6-sol': [2, 10, 4, 15],
  'gpt-5.6-sol': [4, 20, 8, 30],
  'gpt-5.6-terra': [2, 12, 4, 18],
  'gpt-5.6-luna': [0.2, 1.2, 0.4, 1.8],
  'gpt-5.5': [5, 30, 10, 45],
  'gpt-5.5-pro': [30, 180, 60, 270],
  'gpt-5.4': [2.5, 15, 5, 22.5],
  'gpt-5.4-pro': [30, 180, 60, 270],
  'gpt-5.4-mini': [0.75, 4.5],
  'gpt-5.4-nano': [0.2, 1.25],
  'gpt-5.2': [1.75, 14],
  'gpt-5.2-pro': [21, 168],
  'gpt-5.1': [1.25, 10],
  'gpt-5': [1.25, 10],
  'gpt-5-mini': [0.25, 2],
  'gpt-5-nano': [0.05, 0.4],
  'gpt-5-pro': [15, 120],
  'gpt-4.1': [2, 8],
  'gpt-4.1-mini': [0.4, 1.6],
  'gpt-4o': [2.5, 10],
  'gpt-4o-mini': [0.15, 0.6],
  'o3-pro': [20, 80],
  o3: [2, 8],
};

const gemini = {
  // https://ai.google.dev/gemini-api/docs/pricing/
  'gemini-3.5-flash-lite': [0.3, 2.5],
  'gemini-3.1-flash-lite': [0.25, 1.5],
  'gemini-3.1-pro-preview': [2, 12, 4, 18],
  'gemini-3.1-pro-preview-customtools': [2, 12, 4, 18],
  'gemini-3-flash-preview': [0.5, 3],
  'gemini-2.5-pro': [1.25, 10, 2.5, 15],
  'gemini-2.5-flash': [0.3, 2.5],
  'gemini-2.5-flash-lite': [0.1, 0.4],
};

const replicate = {
  // https://replicate.com/collections/language-models — prices on each model's page.
  'anthropic/claude-3.5-haiku': [1, 5],
  'anthropic/claude-4.5-haiku': [1, 5],
  'anthropic/claude-4.5-sonnet': [3, 15],
  'anthropic/claude-opus-4.6': [5, 25],
  'anthropic/claude-opus-5.5': [4, 20],
  'deepseek-ai/deepseek-r1': [3.75, 10],
  'deepseek-ai/deepseek-v3': [1.45, 1.45],
  'deepseek-ai/deepseek-v3.1': [0.672, 2.016],
  'google/gemini-2.5-flash': [0.3, 2.5],
  'google/gemini-3-pro': [2, 12, 4, 18],
  'google/gemini-3.1-pro': [2, 12, 4, 18],
  'ibm-granite/granite-3.3-8b-instruct': [0.03, 0.25],
  'meta/meta-llama-3-70b': [0.65, 2.75],
  'meta/meta-llama-3-70b-instruct': [0.65, 2.75],
  'meta/meta-llama-3-8b': [0.05, 0.25],
  'meta/meta-llama-3-8b-instruct': [0.05, 0.25],
  'moonshotai/kimi-k2.5': [0.72, 3.6],
  'openai/gpt-4.1': [2, 8],
  'openai/gpt-4.1-mini': [0.4, 1.6],
  'openai/gpt-4o': [2.5, 10],
  'openai/gpt-4o-mini': [0.15, 0.6],
  'openai/gpt-5': [1.25, 10],
  'openai/gpt-5-mini': [0.25, 2],
  'openai/gpt-5-nano': [0.05, 0.4],
  'openai/gpt-5.2': [1.75, 14],
  'openai/gpt-5.6-luna': [1, 6],
  'openai/gpt-5.6-sol': [2, 10],
  'openai/gpt-5.6-terra': [2.5, 15],
  'openai/gpt-oss-120b': [0.18, 0.72],
  'openai/gpt-oss-20b': [0.09, 0.36],
  'qwen/qwen3-235b-a22b-instruct-2507': [0.264, 1.06],
};

const replicatePerSecond = {
  'google-deepmind/gemma-2b-it': 0.000975,
  'replicate/flan-t5-xl': 0.0014,
  'replicate/llama-7b': 0.0014,
  'stability-ai/stablelm-tuned-alpha-7b': 0.0014,
  'yorickvp/llava-13b': 0.000975,
  'yorickvp/llava-v1.6-mistral-7b': 0.000975,
  'yorickvp/llava-v1.6-vicuna-13b': 0.000975,
};

const referenceRates = { openai, gemini, replicate };
const referenceNote = 'Tarifa pública de referencia consultada el 6 nov 2026.';

function tokenPricing(rates, note) {
  const pricing = {};
  for (const [index, key] of ['prompt', 'completion', 'promptMax', 'completionMax'].entries()) {
    const amount = rates[index];
    if (typeof amount === 'number' && Number.isFinite(amount) && amount >= 0) {
      pricing[key] = amount / 1_000_000;
    }
  }
  if (note && Object.keys(pricing).length) pricing.note = note;
  return pricing;
}

function textModelPricing(provider, id, catalogModel) {
  if (provider === 'opencode') {
    // The provider's model endpoint exposes cost.text in USD per million tokens.
    return tokenPricing([catalogModel.cost?.text?.input?.price, catalogModel.cost?.text?.output?.price]);
  }

  if (provider === 'replicate' && Object.hasOwn(replicatePerSecond, id)) {
    return { perSecond: replicatePerSecond[id], note: referenceNote };
  }

  if (
    provider === 'gemini' &&
    (id === 'gemini-3.8-flash' || (id === 'gemini-2.5-pro' && Date.now() >= Date.UTC(2026, 11, 1)))
  ) {
    return tokenPricing(Date.now() >= Date.UTC(2027, 0, 1) ? [1.5, 7.5] : [0.75, 3.75], referenceNote);
  }
  if (provider === 'gemini' && id === 'gemini-2.5-flash' && Date.now() >= Date.UTC(2026, 11, 1)) {
    return tokenPricing(gemini['gemini-3.5-flash-lite'], referenceNote);
  }

  const table = referenceRates[provider];
  if (!table || !Object.hasOwn(table, id)) return {};
  const rates = table[id];
  const note =
    rates.length === 4 ? referenceNote + ' El precio aumenta con el tamaño del contexto.' : referenceNote;
  return tokenPricing(rates, note);
}

module.exports = { textModelPricing };
