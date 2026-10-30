const { endpoint } = require('../transport/index.cjs');
const {
  SCENARIO_VIEWS,
  SCENARIO_MAX_REFERENCES,
  SCENARIO_KINDS,
  parseScenarioDocument,
  validateScenarioDocument,
  scenarioImage,
  scenarioHasContent,
  scenarioCovers,
  archiveScenarioImage,
} = require('../../../public/js/contracts/scenario.js');
const {
  SCENARIO_BRIEF_INSTRUCTION,
  SCENARIO_PANORAMA_RATIO,
  SCENARIO_VIEW_RATIO,
  scenarioBriefRequest,
  parseScenarioBrief,
  buildScenarioPanoramaPrompt,
  buildScenarioViewPrompt,
} = require('../../../public/js/contracts/scenario-prompt.js');
const { validateImageEngine } = require('../../../public/js/contracts/project-inference.js');

const SOURCES = ['description', 'image', 'change', 'regenerate'];
const SCOPES = ['all', 'views', 'view'];
const REQUEST_KEYS = [
  'projectId',
  'token',
  'expectedContent',
  'source',
  'request',
  'scope',
  'viewId',
  'references',
];

/**
 * Scenario generation: a single durable job per request. The browser only observes; every provider
 * result is checkpointed before the next stage so a retry never pays for a finished image twice.
 *
 * @param deps shared server capabilities (security, project access, draft writer, inference scope)
 * @param ports injected collaborators: `infer` (structured JSON text/vision), `makeOperations`
 *   (image generation bound to the job's signal) and `readImage` (project image → data URL)
 */
function createScenarioJobs(deps, { infer, makeOperations, readImage }) {
  const { security, assertProject, readCurrentProject, writeProject, documentStore, inference } = deps;
  const reference = (url, projectId) => {
    if (!scenarioImage(url, projectId)) throw security.fail('Referencia ajena al escenario.');
    return url;
  };
  const engineFor = (project) => {
    if (inference?.currentMode() === 'local') return { provider: 'local', model: 'flux3-klein' };
    const engine = project.inferenceSettings?.imageModel;
    if (!engine) throw security.fail('Selecciona un modelo de imagen en la barra superior.', 422);
    try {
      return validateImageEngine(engine);
    } catch {
      throw security.fail('Modelo de imagen inválido.');
    }
  };

  function register(app, queue) {
    const snapshot = (id, projectId) => ({
      job: queue.publicJob(queue.get(id)),
      draft: documentStore.getDraft(projectId),
    });
    app.post(
      '/api/jobs/scenario',
      endpoint(({ body }) => {
        if (
          !body ||
          typeof body !== 'object' ||
          Array.isArray(body) ||
          Object.keys(body).some((key) => !REQUEST_KEYS.includes(key)) ||
          !security.UUID.test(body.projectId || '') ||
          !security.UUID.test(body.token || '') ||
          !SOURCES.includes(body.source) ||
          typeof body.expectedContent !== 'string' ||
          (body.request !== undefined && (typeof body.request !== 'string' || body.request.length > 12000)) ||
          (body.scope !== undefined && !SCOPES.includes(body.scope))
        )
          throw security.fail('Trabajo de escenario inválido.');
        assertProject(body.projectId);
        const project = readCurrentProject(body.projectId);
        if (project.type !== 'stage') throw security.fail('Este trabajo necesita un escenario.');
        const duplicate = queue.list(project.id).find((job) => queue.get(job.id).token === body.token);
        if (duplicate) return { status: 202, body: snapshot(duplicate.id, project.id) };
        if (
          queue.list(project.id).some((job) => ['queued', 'running', 'awaiting_choice'].includes(job.status))
        )
          throw security.fail('Este escenario ya tiene un trabajo en curso.', 409);
        if (body.expectedContent !== project.content)
          throw security.fail('Guarda el escenario antes de encolar; su contenido cambió.', 409);
        const document = parseScenarioDocument(project.content);
        if (!document) throw security.fail('El escenario aún no está en el formato actual.', 409);
        const request = (body.request || '').trim();
        const requested = body.references ?? document.creation.references;
        if (!Array.isArray(requested) || requested.length > SCENARIO_MAX_REFERENCES)
          throw security.fail(`Hasta ${SCENARIO_MAX_REFERENCES} fotografías de referencia.`);
        const references = requested.map((url) => reference(url, project.id));
        if (new Set(references).size !== references.length) throw security.fail('Referencias repetidas.');
        const scope = body.scope || 'all';
        if (body.source === 'description' && !request && !references.length)
          throw security.fail('Describe el escenario o añade fotografías.');
        if (body.source === 'image' && !references.length)
          throw security.fail('Añade al menos una fotografía de referencia.');
        if (body.source === 'change' && (!request || !scenarioHasContent(document)))
          throw security.fail('Indica qué quieres cambiar en un escenario ya creado.');
        if (body.source === 'regenerate' && !scenarioHasContent(document))
          throw security.fail('Genera primero el escenario.');
        if (body.source === 'regenerate' && scope !== 'all' && !document.panorama)
          throw security.fail('Genera primero el panorama del escenario.');
        if (['description', 'image'].includes(body.source) && scenarioHasContent(document))
          throw security.fail('La vía de creación ya está fijada; pide los cambios al asistente.');
        if (
          document.creation.mode &&
          ['description', 'image'].includes(body.source) &&
          document.creation.mode !== body.source
        )
          throw security.fail('La vía de creación ya está fijada.');
        if (body.source === 'regenerate' && scope === 'view') {
          if (!SCENARIO_VIEWS.some((view) => view.id === body.viewId))
            throw security.fail('Ángulo desconocido.');
          if (!document.views.some((view) => view.id === body.viewId))
            throw security.fail('Ese ángulo todavía no existe.');
        } else if (body.viewId !== undefined) throw security.fail('El ángulo solo aplica a regenerar uno.');
        const engine = engineFor(project);
        return {
          status: 202,
          body: snapshot(
            queue.enqueue({
              projectId: project.id,
              kind: 'scenario',
              token: body.token,
              payload: {
                source: body.source,
                request,
                scope: body.source === 'regenerate' ? scope : 'all',
                viewId: body.viewId,
                references,
                expectedContent: project.content,
                engine,
                category: project.category,
                textConfig: deps.getLLMConfig(),
                inferenceMode: inference?.currentMode() || 'api',
                inferenceSettings: inference?.currentSettings() || {},
                localModel: inference?.currentLocalModel(),
              },
            }).id,
            project.id,
          ),
        };
      }),
    );
  }

  async function run(job, ctx) {
    const p = job.payload;
    const projectId = job.projectId;
    const operations = makeOperations(p.textConfig, ctx);
    const local = p.inferenceMode === 'local';
    const failure = (message, status = 422) => security.fail(message, status);
    // All writes are serialized and compare-and-set against the last content this job wrote.
    let tail = Promise.resolve();
    const commit = (mutate) => {
      const operation = tail.then(() => {
        ctx.throwIfAborted();
        const current = readCurrentProject(projectId);
        const expected = ctx.state.content ?? p.expectedContent;
        if (current.content !== expected)
          throw failure('El escenario cambió fuera del trabajo. No se sobrescribieron esos cambios.', 409);
        const draft = mutate(structuredClone(parseScenarioDocument(current.content)));
        draft.identity.name = current.name || draft.identity.name;
        const document = validateScenarioDocument(draft);
        const content = JSON.stringify(document);
        writeProject(
          projectId,
          { content, covers: scenarioCovers(document), currentCoverIndex: 0 },
          expected,
        );
        ctx.state.content = content;
        ctx.checkpoint();
        return document;
      });
      tail = operation.catch(() => {});
      return operation;
    };
    const engine = p.engine;
    const generate = async ({ prompt, inputImages, aspectRatio }) => {
      const response = await operations.generateImage({
        body: {
          projectId,
          imageType: 'cover',
          aspectRatio,
          prompt,
          inputImages,
          backend: local ? 'local' : 'api',
          ...engine,
        },
      });
      if (response.status >= 400 || !response.body?.imageUrl)
        throw security.fail(
          response.body?.error || response.body?.message || 'No se pudo generar la imagen.',
          response.status >= 400 && response.status < 500 ? response.status : 502,
        );
      if (!scenarioImage(response.body.imageUrl, projectId))
        throw failure('El proveedor devolvió una imagen inválida.', 502);
      return response.body.imageUrl;
    };

    const current = parseScenarioDocument(readCurrentProject(projectId).content);
    // A redo of existing angles reuses their stored prompts: no new design and no new panorama.
    const reuse = p.source === 'regenerate' && p.scope !== 'all';

    // 1. Brief: sheet fields plus the image prompts. A single-angle redo reuses its stored prompt.
    let brief = null;
    if (!reuse) {
      ctx.progress(
        p.source === 'change' ? 'Actualizando la ficha del escenario…' : 'Diseñando el escenario…',
      );
      brief = await ctx.step('scenario-brief', async () => {
        const images = p.references.slice(0, SCENARIO_MAX_REFERENCES).map((url) => {
          const match = /^\/projects\/([a-f0-9-]{36})\/content\/([^/]+)$/.exec(url);
          return readImage(match[1], match[2]);
        });
        const sheet = scenarioHasContent(current)
          ? {
              name: current.identity.name,
              kind: current.identity.kind,
              fields: current.fields,
              description: current.description,
            }
          : null;
        const lock = Object.hasOwn(SCENARIO_KINDS, p.category)
          ? `\nThe author already chose "${p.category}"; keep kind as "${p.category}".`
          : '';
        const model = p.textConfig.functions.chat.model;
        const value = await infer(
          {
            model,
            stage: 'del escenario',
            maxTokens: Math.min(p.textConfig.functions.chat.maxCompletionTokens || 4000, 4000),
            messages: [
              { role: 'system', content: SCENARIO_BRIEF_INSTRUCTION },
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text:
                      scenarioBriefRequest({
                        source: p.source === 'regenerate' ? 'regeneration with the same sheet' : p.source,
                        request: p.request,
                        current: sheet,
                        referenceCount: images.length,
                      }) + lock,
                  },
                  ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
                ],
              },
            ],
          },
          ctx,
        );
        try {
          return parseScenarioBrief(value);
        } catch (error) {
          throw failure(`${error.message} No se generó ninguna imagen; reintenta el trabajo.`);
        }
      });
    }

    // 2. Sheet first, so the design is visible while the pictures render.
    if (brief) {
      await ctx.step('scenario-sheet', async () => {
        await commit((document) => {
          document.fields = brief.fields;
          document.description = brief.description;
          document.identity.kind = Object.hasOwn(SCENARIO_KINDS, p.category) ? p.category : brief.kind;
          if (!document.creation.mode && ['description', 'image'].includes(p.source))
            document.creation.mode = p.source;
          if (p.source === 'image') document.creation.references = [...p.references];
          else if (p.references.length) document.creation.references = [...p.references];
          if (document.creation.initialState !== 'complete' && !scenarioHasContent(current))
            document.creation.initialState = 'pending';
          return document;
        });
        return { saved: true };
      });
    }

    // 3. Panorama (not for a single-angle redo).
    let panoramaUrl = current.panorama?.url || '';
    if (!reuse) {
      ctx.progress('Generando la imagen 360°…');
      const generated = await ctx.step('scenario-panorama', async () => {
        const prompt = buildScenarioPanoramaPrompt({
          panoramaPrompt: brief.panoramaPrompt,
          references: p.references.length,
        });
        return {
          url: await generate({ prompt, inputImages: p.references, aspectRatio: SCENARIO_PANORAMA_RATIO }),
          prompt,
        };
      });
      await ctx.step('scenario-panorama-save', async () => {
        await commit((document) => {
          // The picture being replaced goes to the trash with its slot, so it can be restored.
          const next = document.panorama
            ? archiveScenarioImage(document, { ...document.panorama, slot: 'panorama' })
            : document;
          next.panorama = {
            url: generated.url,
            prompt: generated.prompt,
            generatedAt: new Date().toISOString(),
          };
          return next;
        });
        return { saved: true };
      });
      panoramaUrl = generated.url;
    }
    if (!panoramaUrl) throw failure('El escenario no tiene panorama de referencia.');

    // 4. Four angles that share the panorama as their reference. Local renders one at a time (VRAM).
    const targets =
      reuse && p.scope === 'view' ? SCENARIO_VIEWS.filter((view) => view.id === p.viewId) : SCENARIO_VIEWS;
    ctx.progress('Generando los ángulos del escenario…');
    const renderView = async (view) => {
      const generated = await ctx.step(`scenario-view-${view.id}`, async () => {
        const stored = current.views.find((item) => item.id === view.id);
        const prompt = reuse
          ? stored?.prompt || buildScenarioViewPrompt({ viewId: view.id, viewPrompt: current.description })
          : buildScenarioViewPrompt({ viewId: view.id, viewPrompt: brief.viewPrompts[view.id] });
        return {
          url: await generate({ prompt, inputImages: [panoramaUrl], aspectRatio: SCENARIO_VIEW_RATIO }),
          prompt,
        };
      });
      await ctx.step(`scenario-view-${view.id}-save`, async () => {
        await commit((document) => {
          const previous = document.views.find((item) => item.id === view.id);
          const next = previous ? archiveScenarioImage(document, { ...previous, slot: view.id }) : document;
          next.views = [
            ...next.views.filter((item) => item.id !== view.id),
            {
              id: view.id,
              label: view.label,
              url: generated.url,
              prompt: generated.prompt,
              generatedAt: new Date().toISOString(),
            },
          ];
          return next;
        });
        return { saved: true };
      });
    };
    const outcomes = [];
    if (local)
      for (const view of targets)
        outcomes.push(
          await renderView(view).then(
            () => null,
            (error) => error,
          ),
        );
    else
      outcomes.push(
        ...(await Promise.all(
          targets.map((view) =>
            renderView(view).then(
              () => null,
              (error) => error,
            ),
          ),
        )),
      );
    ctx.throwIfAborted();
    const errors = outcomes.filter(Boolean);
    if (errors.length) {
      const names = targets
        .filter((_, index) => outcomes[index])
        .map((view) => view.label)
        .join(', ');
      const message = `No se generaron algunos ángulos (${names}): ${errors[0].message} El panorama y los demás ángulos se conservan; reintenta el trabajo.`;
      throw Object.assign(failure(message, 502), { publicMessage: message });
    }

    // 5. Close the turn: the request becomes history and the creation state is complete.
    ctx.progress('Guardando el escenario…');
    await ctx.step('scenario-finish', async () => {
      await commit((document) => {
        document.request = '';
        document.creation.initialState = 'complete';
        document.revision += 1;
        document.history = [
          ...document.history,
          {
            id: `turn_${job.id}`,
            source: p.source,
            text: p.request || (p.source === 'image' ? 'Escenario a partir de fotografías' : 'Nueva versión'),
            status: 'applied',
            message: '',
            at: new Date().toISOString(),
          },
        ].slice(-40);
        return document;
      });
      return { saved: true };
    });
    return { message: 'Escenario guardado.' };
  }

  return { register, run };
}
module.exports = { createScenarioJobs };
