const { matchBenchmark } = require('./artificial-analysis-models.cjs');
/** Per-instance, credential-scoped discovery. Never exposes keys or guesses image prices. */
function createImageCatalog({ getApiKeys, fetchImpl = (...args) => fetch(...args) }) {
  let cached,
    signature,
    until = 0,
    pending;
  const request = async (url, key) => {
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/json',
        ...(url.startsWith('https://generativelanguage.googleapis.com/')
          ? { 'x-goog-api-key': key }
          : { Authorization: `Bearer ${key}` }),
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('Catálogo no disponible');
    return response.json();
  };
  const entry = (provider, model, name, extra = {}) => ({
    provider,
    model,
    id: `${provider}:${model}`,
    label: name,
    name,
    imageTypes: ['cover', 'character'],
    editing: true,
    maxReferences: 8,
    price: null,
    ...extra,
  });
  async function discover(keys) {
    const models = [],
      warnings = [];
    await Promise.allSettled(
      ['openrouter', 'replicate', 'openai', 'gemini']
        .filter((p) => keys[p])
        .map(async (provider) => {
          try {
            if (provider === 'openrouter') {
              const data = await request('https://openrouter.ai/api/v1/images/models', keys[provider]);
              await Promise.allSettled(
                (data.data || []).map(async (m) => {
                  if (
                    !/^[a-zA-Z0-9._/-]+$/.test(m.id) ||
                    !m.architecture?.output_modalities?.includes('image')
                  )
                    return;
                  const params = m.supported_parameters || {};
                  const count = params.input_references?.max || 0;
                  const editing = m.architecture.input_modalities?.includes('image') && count >= 2;
                  const endpoints = await request(
                    `https://openrouter.ai/api/v1/images/models/${m.id}/endpoints`,
                    keys[provider],
                  );
                  const eligible = (endpoints.endpoints || endpoints.data?.endpoints || []).filter(
                    (e) => !editing || (e.supported_parameters?.input_references?.max || 0) >= 2,
                  );
                  if (!eligible.length) return;
                  const rates = eligible.flatMap((e) =>
                    (e.pricing || [])
                      .filter(
                        (p) =>
                          p.billable === 'output_image' &&
                          p.unit === 'image' &&
                          Number.isFinite(Number(p.cost_usd)) &&
                          Number(p.cost_usd) >= 0,
                      )
                      .map((p) => Number(p.cost_usd)),
                  );
                  const extraCharges = eligible.some((e) =>
                    (e.pricing || []).some((p) => p.billable !== 'output_image' && Number(p.cost_usd) > 0),
                  );
                  const ratios = params.aspect_ratio?.values;
                  const character =
                    editing &&
                    (!ratios || ['1:1', '2:3'].every((r) => ratios.includes(r))) &&
                    !(params.input_references?.min > 0);
                  models.push(
                    entry(provider, m.id, m.name || m.id, {
                      editing: !!editing,
                      maxReferences: editing
                        ? Math.min(8, ...eligible.map((e) => e.supported_parameters.input_references.max))
                        : 0,
                      imageTypes: character ? ['cover', 'character'] : ['cover'],
                      price: rates.length ? Math.min(...rates) : null,
                      priceFrom: extraCharges || new Set(rates).size > 1,
                      protocol: 'images',
                      providerTags: eligible.map((e) => e.provider_tag).filter(Boolean),
                    }),
                  );
                }),
              );
            } else if (provider === 'replicate') {
              const collection = await request(
                'https://api.replicate.com/v1/collections/image-editing',
                keys[provider],
              );
              await Promise.allSettled(
                (collection.models || []).map(async (item) => {
                  const id = `${item.owner}/${item.name}`;
                  const m = item.latest_version?.openapi_schema
                    ? item
                    : await request(`https://api.replicate.com/v1/models/${id}`, keys[provider]);
                  const schema = m.latest_version?.openapi_schema?.components?.schemas?.Input;
                  const fields = schema?.properties || {};
                  const refs = ['image_input', 'input_images', 'images'].find(
                    (k) => fields[k]?.type === 'array' && (fields[k].maxItems || 8) >= 2,
                  );
                  // Models needing a mask, vendor key, or unsupported required inputs cannot run this workflow.
                  if (
                    !refs ||
                    !fields.prompt ||
                    (schema.required || []).some(
                      (k) => !['prompt', refs].includes(k) && fields[k]?.default === undefined,
                    )
                  )
                    return;
                  models.push(
                    entry(provider, id, m.name || id, {
                      referenceField: refs,
                      maxReferences: Math.min(8, fields[refs].maxItems || 8),
                      price: id === 'bytedance/seedream-4.5' ? 0.04 : null,
                      aspectRatios: fields.aspect_ratio?.enum || [],
                    }),
                  );
                }),
              );
            } else if (provider === 'gemini') {
              let next = '';
              do {
                const data = await request(
                  `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000${next ? '&pageToken=' + encodeURIComponent(next) : ''}`,
                  keys[provider],
                );
                for (const m of data.models || []) {
                  if (
                    !m.name?.includes('-image') ||
                    !m.supportedGenerationMethods?.includes('generateContent')
                  )
                    continue;
                  models.push(
                    entry(provider, m.name.replace(/^models\//, ''), m.displayName || m.name, {
                      protocol: 'gemini',
                    }),
                  );
                }
                next = data.nextPageToken || '';
              } while (next);
            } else {
              const data = await request('https://api.openai.com/v1/models', keys[provider]);
              for (const m of data.data || []) {
                if (!/^gpt-image-(?:1(?:\.5|-mini)?|2(?:\.[0-9]+)?(?:-[a-z]+)?)$/.test(m.id)) continue;
                models.push(entry(provider, m.id, m.id, { protocol: 'openai-images' }));
              }
            }
          } catch {
            warnings.push(provider);
          }
        }),
    );
    let benchmark = { available: false, sourceUrl: 'https://artificialanalysis.ai/' };
    if (keys['artificial-analysis']) {
      const result = await Promise.allSettled(
        ['image-editing', 'text-to-image'].map(async (category) => {
          const response = await fetchImpl(
            `https://artificialanalysis.ai/api/v2/media/${category}/models/free`,
            {
              headers: { Accept: 'application/json', 'x-api-key': keys['artificial-analysis'] },
              signal: AbortSignal.timeout(15000),
            },
          );
          if (!response.ok) throw Error('Ranking no disponible');
          const payload = await response.json();
          const ranked = (payload.data || [])
            .filter((m) => typeof m.elo === 'number' && Number.isFinite(m.elo))
            .sort((a, b) => b.elo - a.elo);
          return {
            category,
            models: ranked.map((m) => ({
              id: m.id,
              name: m.name,
              slug: m.slug,
              score: m.elo,
              rank: ranked.findIndex((other) => other.elo === m.elo) + 1,
            })),
          };
        }),
      );
      const categories = result.filter((r) => r.status === 'fulfilled').map((r) => r.value);
      benchmark = {
        ...benchmark,
        available: categories.length > 0,
        categories: categories.map((c) => c.category),
      };
      for (const m of models) {
        const category = m.editing ? 'image-editing' : 'text-to-image';
        const match = matchBenchmark(
          { id: m.model, name: m.name },
          categories.find((c) => c.category === category)?.models || [],
        );
        if (match)
          m.artificialAnalysis = {
            rank: match.rank,
            intelligenceScore: match.score,
            modelName: match.name,
            metric:
              category === 'image-editing'
                ? 'Artificial Analysis · Image Editing Elo'
                : 'Artificial Analysis · Text to Image Elo',
          };
      }
    }
    for (const m of models)
      m.label +=
        m.price === null
          ? ' · costo variable / imagen'
          : ` · ${m.priceFrom ? 'desde ' : ''}US$${m.price.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')} / imagen`;
    return {
      api: models.sort((a, b) => a.provider.localeCompare(b.provider) || a.label.localeCompare(b.label)),
      warnings,
      benchmark,
      keys: Object.fromEntries(Object.entries(keys).map(([p, key]) => [p, { configured: !!key }])),
    };
  }
  async function list() {
    const keys = getApiKeys(),
      next = JSON.stringify(
        ['openrouter', 'replicate', 'openai', 'gemini', 'artificial-analysis'].map((p) => keys[p] || ''),
      );
    if (signature === next && cached && Date.now() < until) return cached;
    if (signature === next && pending) return pending;
    if (signature !== next) cached = null;
    signature = next;
    const work = discover(keys)
      .then((result) => {
        if (signature === next) {
          cached = result;
          until = Date.now() + (result.warnings.length ? 10000 : 15 * 60000);
        }
        return result;
      })
      .finally(() => {
        if (pending === work) pending = null;
      });
    pending = work;
    return work;
  }
  return {
    list,
    find: async (provider, model) =>
      (await list()).api.find((m) => m.provider === provider && m.model === model),
  };
}
module.exports = { createImageCatalog };
