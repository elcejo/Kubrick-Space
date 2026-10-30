const {
  validateCharacterLore,
  validateCharacterDocument,
  applyCharacterLore,
  characterLoreVisualKind,
} = require('../../../public/js/contracts/character-model.js');
const {
  validateCharacterVisualLibrary,
  characterAppearanceKey,
} = require('../../../public/js/contracts/character-visual-library.js');

const { CHARACTER_LORE_PROMPT: PROMPT } = require('../../../public/js/contracts/character-instructions.js');

function createCharacterLoreOperations({
  security,
  assertProject,
  readCurrentProject,
  writeProject,
  getApiKeys,
  getLLMConfig,
  llmConfig,
  proxyRequest,
  enqueueLoreApproval,
}) {
  return {
    async discover({ body }) {
      assertProject(body.projectId);
      const document = validateCharacterDocument(body.document);
      if (document.id !== body.projectId) throw security.fail('La ficha pertenece a otro personaje.');
      const settings = getLLMConfig();
      const config = llmConfig.functionConfig(settings, 'character_lore');
      if (llmConfig.isLocalModel(config.model))
        return {
          status: 200,
          body: { lore: null, unavailable: 'La búsqueda en línea requiere un modelo API.' },
        };
      const key = getApiKeys().openrouter;
      if (!key) throw security.fail('Configura OpenRouter para buscar lore.', 428);
      const response = await proxyRequest(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key.trim()}` },
          body: JSON.stringify({
            model: config.model,
            max_tokens: Math.min(config.maxCompletionTokens, 8192),
            max_tool_calls: 2,
            ...(config.model === 'xiaomi/mimo-v2.6-pro'
              ? {
                  provider: {
                    allow_fallbacks: true,
                    require_parameters: true,
                  },
                  reasoning: { effort: 'low' },
                }
              : {}),
            tools: [
              {
                type: 'openrouter:web_search',
                parameters: {
                  engine: 'exa',
                  max_uses: 1,
                  max_results: 3,
                  max_total_results: 3,
                  max_characters: 3000,
                },
              },
            ],
            messages: [
              { role: 'system', content: llmConfig.characterPrompt(settings, 'character_lore', PROMPT) },
              {
                role: 'user',
                content: JSON.stringify({
                  name: document.identity.name,
                  nature: document.identity.nature,
                  request: String(body.request || '').slice(0, 12000),
                  appearance: document.fields
                    .filter((f) => f.section === 'appearance')
                    .map(({ label, value }) => ({ label, value })),
                }),
              },
            ],
          }),
        },
        Math.min(config.timeoutMs, 180000),
        { omitBody: true },
      );
      if (response.error)
        throw security.fail(
          'No se pudo consultar el lore. La creación del personaje se conserva.',
          response.status || 502,
        );
      try {
        const choice = response.data?.choices?.[0];
        if (!choice || choice.finish_reason === 'length' || typeof choice.message?.content !== 'string')
          throw Error('Incomplete lore');
        const raw = JSON.parse(
          choice.message.content
            .trim()
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/\s*```$/, ''),
        );
        for (const fact of raw.facts || []) {
          if (['age', 'height'].includes(fact.kind) && typeof fact.value === 'string') {
            const match = fact.value
              .trim()
              .match(
                fact.kind === 'age'
                  ? /^(\d+(?:[.,]\d+)?)\s*(?:años?|years?)?$/i
                  : /^(\d+(?:[.,]\d+)?)\s*(?:cm|cent[ií]metros?)?$/i,
              );
            if (match) fact.value = Number(match[1].replace(',', '.'));
          }
        }
        const proposal = validateCharacterLore(raw);
        if (!['offered', 'not_found', 'ambiguous'].includes(proposal.status))
          throw Error('Invalid discovery state');
        if (proposal.status !== 'offered' && proposal.facts.length)
          throw Error('Facts require an identified fictional character');
        if (proposal.status === 'offered') {
          const cited = new Set(
            (choice.message.annotations || [])
              .filter((annotation) => annotation.type === 'url_citation')
              .map((annotation) => annotation.url_citation?.url),
          );
          if (proposal.sources.some((source) => !cited.has(source.url)))
            throw Error('Lore without search evidence');
        }
        return { status: 200, body: { lore: proposal } };
      } catch {
        throw security.fail(
          'La búsqueda no devolvió una propuesta de lore verificable. La ficha se conserva.',
          502,
        );
      }
    },
    approve({ body }) {
      if (
        !body ||
        Object.keys(body).some((key) => !['projectId', 'expectedContent', 'ids', 'dismiss'].includes(key))
      )
        throw security.fail('Aprobación de lore inválida.');
      assertProject(body.projectId);
      const project = readCurrentProject(body.projectId);
      if (project.type !== 'character' || project.content !== body.expectedContent)
        throw security.fail('La ficha cambió antes de aprobar el lore.', 409);
      let document = validateCharacterDocument(JSON.parse(project.content));
      if (body.dismiss === true) {
        if (!document.lore) throw security.fail('No hay propuesta de lore.');
        document.lore.status = 'dismissed';
        document.revision++;
      } else {
        const approved = applyCharacterLore(document, body.ids);
        if (document.lore.facts.some((fact) => body.ids.includes(fact.id) && characterLoreVisualKind(fact))) {
          if (!enqueueLoreApproval)
            throw security.fail('Las referencias visuales requieren la cola del servidor.', 428);
          return { status: 202, body: enqueueLoreApproval(project, body.ids) };
        }
        document = approved;
      }
      return {
        status: 200,
        body: writeProject(
          body.projectId,
          {
            content: JSON.stringify(document),
            ...(project.characterVisualLibrary &&
            project.characterVisualLibrary.sourceImage ===
              (project.covers?.[project.currentCoverIndex] || project.covers?.[0])
              ? {
                  characterVisualLibrary: {
                    ...validateCharacterVisualLibrary(project.characterVisualLibrary, project.id),
                    sourceKey: characterAppearanceKey(document),
                  },
                }
              : {}),
          },
          project.content,
        ),
      };
    },
  };
}
module.exports = { createCharacterLoreOperations };
