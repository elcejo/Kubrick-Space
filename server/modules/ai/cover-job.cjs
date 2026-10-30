const { endpoint } = require('../transport/index.cjs');
const { narrative } = require('./context.cjs');
const { coverArtInstruction } = require('../../../public/js/contracts/text-instructions.js');
const {
  parseCoverBrief,
  buildCoverImagePrompt,
  sanitizeMuseCoverScene,
  detectBookLanguage,
} = require('../../../public/js/contracts/cover-prompt.js');

/** Covers use the same durable queue as characters; no browser owns execution. */
function createCoverJobs(deps, makeOperations) {
  const { security, assertProject, readCurrentProject, writeProject, aiContexts, inference } = deps;
  function register(app, queue) {
    app.post(
      '/api/jobs/cover',
      endpoint(({ body }) => {
        const allowed = [
          'projectId',
          'token',
          'mode',
          'selectedText',
          'customPrompt',
          'includeText',
          'inputImages',
          'referenceLabels',
          'referenceProjectIds',
          'referenceNames',
        ];
        if (
          !body ||
          Array.isArray(body) ||
          Object.keys(body).some((key) => !allowed.includes(key)) ||
          !security.UUID.test(body.projectId || '') ||
          !security.UUID.test(body.token || '') ||
          !['proyecto', 'seleccion', 'personalizado'].includes(body.mode) ||
          typeof body.includeText !== 'boolean'
        )
          throw security.fail('Solicitud de portada inválida.');
        assertProject(body.projectId);
        const project = readCurrentProject(body.projectId);
        if (project.category === 'screenplay')
          throw security.fail('Las portadas de guión se crean automáticamente.', 422);
        if (project.type !== 'book') throw security.fail('La portada requiere un libro o guión.');
        for (const key of ['selectedText', 'customPrompt'])
          if (body[key] !== undefined && (typeof body[key] !== 'string' || body[key].length > 12000))
            throw security.fail('Texto de portada inválido.');
        if (
          (body.mode === 'seleccion' && !body.selectedText?.trim()) ||
          (body.mode === 'personalizado' && !body.customPrompt?.trim())
        )
          throw security.fail('Falta el texto de portada.');
        for (const key of ['inputImages', 'referenceLabels', 'referenceProjectIds', 'referenceNames'])
          if (
            !Array.isArray(body[key]) ||
            body[key].length > 8 ||
            body[key].some((value) => typeof value !== 'string' || value.length > 1000)
          )
            throw security.fail('Referencias de portada inválidas.');
        // References must belong to the book or an explicitly linked, active ingredient.
        const ids = new Set([
          project.id,
          ...(project.ingredients || [])
            .filter((i) => i.active !== false)
            .map((i) => i.importedProjectId)
            .filter(Boolean),
        ]);
        if (
          body.referenceProjectIds.some((id) => !ids.has(id)) ||
          body.inputImages.some((url) => {
            const match = /^\/projects\/([a-f0-9-]{36})\/content\/([^/]+)$/.exec(url);
            return !match || !ids.has(match[1]) || !security.IMAGE_NAME.test(match[2]);
          })
        )
          throw security.fail('Referencia ajena a los ingredientes del proyecto.');
        const prior = queue.list(project.id).find((job) => queue.get(job.id).token === body.token);
        if (prior) return { status: 202, body: { job: prior } };
        if ((project.covers?.length || 0) >= 100 || (project.coverVersions?.length || 0) >= 100)
          throw security.fail('El historial admite 100 portadas.');
        if (inference?.currentMode() !== 'local' && !inference?.currentSettings()?.imageModel)
          throw security.fail('Selecciona un modelo de imagen en la barra superior.', 422);
        let document = '';
        try {
          const parsed = JSON.parse(project.content);
          if (['code-kai.story-book', 'code-kai.screenplay'].includes(parsed?.schema))
            document = project.content;
        } catch {
          /* Legacy HTML remains source prose, not a structured document. */
        }
        return {
          status: 202,
          body: {
            job: queue.enqueue({
              projectId: project.id,
              kind: 'cover',
              token: body.token,
              payload: {
                ...body,
                inferenceMode: inference?.currentMode() || 'api',
                inferenceSettings: inference?.currentSettings() || {},
                localModel: inference?.currentLocalModel(),
                textConfig: deps.getLLMConfig(),
                snapshot: {
                  content: narrative(project.content).text,
                  document,
                  tags: [],
                  blocks: [],
                  ingredients: project.ingredients || [],
                },
                title:
                  narrative(project.content).nodes.find((node) => node.kind === 'title')?.text ||
                  project.name ||
                  'Libro',
                category: project.category || 'General',
              },
            }),
          },
        };
      }),
    );
  }
  async function run(job, ctx) {
    if (readCurrentProject(job.projectId).category === 'screenplay')
      throw security.fail('Las portadas de guión se crean automáticamente.', 422);
    const p = job.payload;
    const operations = makeOperations(p.textConfig, ctx);
    const rules = p.referenceLabels.length
      ? 'Only these visual references may appear; preserve identity, not their pose or composition:\n' +
        p.referenceLabels.join('\n')
      : 'No visual references were selected. Choose a concept that does not depict a named person.';
    ctx.progress('Diseñando composición y tipografía…');
    const brief = await ctx.step('cover-art-direction', async () => {
      if (p.mode === 'personalizado') return { visualPrompt: p.customPrompt.trim(), tagline: '' };
      const session = aiContexts.sync(job.projectId, p.snapshot, { fresh: true });
      const response = await operations.generateText({
        body: {
          projectId: job.projectId,
          contextSessionId: session.sessionId,
          contextVersion: session.contextVersion,
          instruction: coverArtInstruction(p.includeText, rules),
          action: 'portada_prompt_unificado',
          contextScope: p.mode === 'seleccion' ? 'selection' : 'project',
          selectedText: p.selectedText || '',
          coverReferenceIds: p.referenceProjectIds,
          coverReferenceNames: p.referenceNames,
          promptVariables: { selectedReferenceRules: rules },
          content:
            'Book title: ' +
            p.title +
            '\nCategory: ' +
            p.category +
            '\nWrite visualPrompt in English and the tagline in ' +
            detectBookLanguage(p.title + '\n' + (p.selectedText || p.snapshot.content)) +
            '.\n' +
            rules,
          options: { max_tokens: 1600, temperature: 0.3 },
        },
      });
      if (response.status >= 400)
        throw security.fail(response.body?.error || 'No se pudo preparar la portada.', response.status);
      return parseCoverBrief(response.body);
    });
    ctx.progress('Generando portada…');
    const result = await ctx.step('cover-image', async () => {
      const engine =
        p.inferenceMode === 'local'
          ? { provider: 'local', model: 'flux3-klein' }
          : p.inferenceSettings.imageModel;
      const scene =
        engine?.model === 'meta/muse-image' ? sanitizeMuseCoverScene(brief.visualPrompt) : brief.visualPrompt;
      const prompt = buildCoverImagePrompt({
        scene,
        title: p.title,
        tagline: brief.tagline,
        includeText: p.includeText,
        references: p.referenceLabels,
      });
      const response = await operations.generateImage({
        body: {
          projectId: job.projectId,
          imageType: 'cover',
          aspectRatio: '2:3',
          prompt,
          inputImages: p.inputImages,
          backend: p.inferenceMode === 'local' ? 'local' : 'api',
          ...engine,
        },
      });
      if (response.status >= 400 || !response.body?.imageUrl)
        throw security.fail(
          response.body?.error || response.body?.message || 'No se pudo generar la portada.',
          response.status >= 400 ? response.status : 502,
        );
      return { imageUrl: response.body.imageUrl };
    });
    ctx.progress('Guardando portada…');
    await ctx.step('cover-save', () => {
      ctx.throwIfAborted();
      const current = readCurrentProject(job.projectId);
      const covers = [...(current.covers || [])];
      if (!covers.includes(result.imageUrl)) {
        if (covers.length >= 100) throw security.fail('El historial admite 100 portadas.');
        covers.push(result.imageUrl);
      }
      // Merge only artwork fields into the latest draft; never replace edited prose.
      writeProject(job.projectId, {
        covers,
        currentCoverIndex: covers.indexOf(result.imageUrl),
        lastCoverPrompt: brief.visualPrompt,
        lastCoverGenerationMode: p.mode,
      });
    });
    return { ...result, message: 'Portada guardada.' };
  }
  return { register, run };
}
module.exports = { createCoverJobs };
