const { validateImageEngine } = require('../../../public/js/contracts/project-inference.js');
const { endpoint } = require('../transport/index.cjs');
const { parseCharacterDocument } = require('../../../public/js/contracts/character-model.js');
const { characterAssetImage } = require('../../../public/js/contracts/character-visual-library.js');

function registerJobRoutes(
  app,
  {
    queue,
    workflow,
    management,
    copyCharacterImage,
    readCurrentProject,
    documentStore,
    assertProject,
    security,
    getLLMConfig,
    inference,
  },
) {
  const get = (id) => {
    const job = queue.get(id);
    if (!job) throw security.fail('Trabajo no encontrado.', 404);
    assertProject(job.projectId);
    return job;
  };
  const snapshot = (job, projectId = job.projectId) => {
    if (![job.projectId, ...(job.projectIds || [])].includes(projectId))
      throw security.fail('El trabajo no pertenece a este personaje.', 404);
    return { job: queue.publicJob(job), draft: documentStore.getDraft(projectId) };
  };
  // History also contains deleted projects. Scope access to the exact project ID
  // of a validated, persisted job from this server's fixed data root. These routes
  // expose only job metadata; project/draft access still requires assertProject.
  const historyRecord = (id, projectId) => {
    if (!security.UUID.test(projectId || '')) throw security.fail('Falta el proyecto del registro.');
    const job = queue.get(id);
    if (!job || job.projectId !== projectId)
      throw security.fail('El registro no pertenece a este proyecto.', 404);
    return job;
  };
  app.post(
    '/api/characters/reference',
    endpoint(({ body }) => {
      if (!body || Object.keys(body).some((key) => !['sourceProjectId', 'projectId', 'image'].includes(key)))
        throw security.fail('Referencia inválida.');
      return {
        status: 200,
        body: { image: copyCharacterImage(body.sourceProjectId, body.image, body.projectId) },
      };
    }),
  );
  app.get(
    '/api/characters/catalogue',
    endpoint(() => ({
      status: 200,
      body: management.session('').read('inspect_characters', { projectIds: [] }),
    })),
  );
  app.post(
    '/api/jobs/character',
    endpoint(({ body }) => {
      const keys = [
        'projectId',
        'kind',
        'token',
        'expectedContent',
        'engine',
        'source',
        'request',
        'referenceImage',
        'attachmentImage',
        'gallery',
        'photoReferences',
        'visualChangeKeys',
        'variation',
        'assetSelection',
        'assetId',
        'refreshAssets',
        'actions',
      ];
      if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        Object.keys(body).some((key) => !keys.includes(key)) ||
        !security.UUID.test(body.projectId) ||
        !security.UUID.test(body.token) ||
        !['interpret', 'portrait', 'assets', 'regenerate', 'manage', 'lore'].includes(body.kind)
      )
        throw security.fail('Trabajo inválido.');
      assertProject(body.projectId);
      const project = readCurrentProject(body.projectId),
        doc = parseCharacterDocument(project.content);
      if (project.type !== 'character' || (!doc && typeof project.content !== 'string'))
        throw security.fail('Este trabajo necesita un personaje.');
      const duplicate = queue.list(body.projectId).find((job) => queue.get(job.id).token === body.token);
      if (duplicate) return { status: 202, body: snapshot(get(duplicate.id)) };
      if (typeof body.expectedContent !== 'string' || body.expectedContent !== project.content)
        throw security.fail('Guarda la ficha antes de encolar; su contenido cambió.', 409);
      if (
        JSON.stringify(body).length > 500000 ||
        (body.request !== undefined && (typeof body.request !== 'string' || body.request.length > 12000))
      )
        throw security.fail('Petición demasiado extensa.');
      if (
        body.kind === 'interpret' &&
        !['description', 'image', 'options', 'ingredients', 'summary'].includes(body.source)
      )
        throw security.fail('Vía de creación inválida.');
      for (const key of ['referenceImage', 'attachmentImage'])
        if (body[key] && !characterAssetImage(body[key], body.projectId))
          throw security.fail('Referencia de otro proyecto.');
      const engine =
        inference?.currentMode() === 'local'
          ? { provider: 'local', model: 'flux3-klein' }
          : project.inferenceSettings?.imageModel || body.engine || project.characterImageGeneration;
      if (engine) {
        try {
          validateImageEngine(engine);
        } catch {
          throw security.fail('Modelo de imagen inválido.');
        }
      }
      if (body.variation !== undefined && typeof body.variation !== 'boolean')
        throw security.fail('Variación inválida.');
      if (
        body.refreshAssets !== undefined &&
        (typeof body.refreshAssets !== 'boolean' || body.kind !== 'assets')
      )
        throw security.fail('Regeneración de props inválida.');
      if (
        body.visualChangeKeys !== undefined &&
        (!Array.isArray(body.visualChangeKeys) ||
          body.visualChangeKeys.length > 82 ||
          body.visualChangeKeys.some(
            (key) => typeof key !== 'string' || !/^[a-z][a-z0-9_.-]{0,79}$/.test(key),
          ))
      )
        throw security.fail('Atributos visuales inválidos.');
      if (
        body.assetId !== undefined &&
        (typeof body.assetId !== 'string' || !/^asset_[A-Za-z0-9_-]{1,100}$/.test(body.assetId))
      )
        throw security.fail('Pieza inválida.');
      const { projectId, kind, token, ...payload } = body;
      if (kind === 'manage') {
        if (!Array.isArray(body.actions)) throw security.fail('Faltan las acciones de gestión.');
        const session = management.session(projectId);
        const ids = [
          ...new Set(
            body.actions.flatMap((action) => [action?.projectId, action?.sourceProjectId].filter(Boolean)),
          ),
        ];
        for (let i = 0; i < ids.length; i += 8)
          session.read('inspect_characters', { projectIds: ids.slice(i, i + 8) });
        payload.management = session.plan({ actions: body.actions, message: '' });
      } else if (body.actions !== undefined)
        throw security.fail('Las acciones solo se aceptan en trabajos de gestión.');
      payload.textConfig = getLLMConfig();
      payload.engine = engine;
      payload.inferenceSettings = inference?.currentSettings() || {};
      payload.inferenceMode = inference?.currentMode() || 'hybrid';
      payload.localModel = inference?.currentLocalModel();
      // Repeating Apply with unchanged inputs resumes its saved review, not a paid new portrait.
      const resumable =
        kind === 'portrait' &&
        payload.assetSelection &&
        queue
          .list(projectId)
          .find(
            (job) =>
              (queue.get(job.id).payload.inferenceMode || 'hybrid') === payload.inferenceMode &&
              workflow.canResumeReview?.(queue.get(job.id), payload, project),
          );
      if (resumable) {
        queue.retry(resumable.id);
        return { status: 202, body: snapshot(get(resumable.id)) };
      }
      const created = queue.enqueue({ projectId, kind, token, payload });
      return { status: 202, body: snapshot(get(created.id)) };
    }),
  );
  app.get(
    '/api/jobs',
    endpoint(({ query }) => {
      if (query.projectId !== undefined) assertProject(query.projectId);
      if (query.view !== undefined && !['sidebar', 'history'].includes(query.view))
        throw security.fail('Vista de tareas inválida.');
      const all = queue.list(query.projectId);
      const activeCount = all.filter((job) =>
        ['queued', 'running', 'awaiting_choice'].includes(job.status),
      ).length;
      const offset = query.offset === undefined ? 0 : Number(query.offset);
      const limit = query.limit === undefined ? 25 : Number(query.limit);
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 100
      )
        throw security.fail('Paginación de tareas inválida.');
      const jobs =
        query.view === 'sidebar'
          ? all.filter((job) => !job.sidebarHidden).slice(0, 10)
          : query.view === 'history'
            ? all.slice(offset, offset + limit)
            : query.projectId
              ? all.slice(0, 30)
              : [
                  ...all.filter((job) => ['queued', 'running', 'awaiting_choice'].includes(job.status)),
                  ...all
                    .filter((job) => !['queued', 'running', 'awaiting_choice'].includes(job.status))
                    .slice(0, 15),
                ];
      return {
        status: 200,
        headers: { 'Cache-Control': 'no-store' },
        body: {
          total: all.length,
          activeCount,
          ...(query.view === 'history' ? { offset, limit } : {}),
          jobs: jobs.map((job) => {
            let projectName = 'Proyecto no disponible';
            try {
              projectName = readCurrentProject(job.projectId).name || 'Sin nombre';
            } catch {
              /* Deleted project history. */
            }
            return { ...job, projectName };
          }),
        },
      };
    }),
  );
  app.post(
    '/api/jobs/:jobId/dismiss',
    endpoint(({ params, query, body }) => {
      const job = historyRecord(params.jobId, query.recordProjectId);
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length)
        throw security.fail('Solicitud inválida.');
      return { status: 200, body: { job: queue.dismiss(job.id) } };
    }),
  );
  app.get(
    '/api/jobs/:jobId/record',
    endpoint(({ params, query }) => ({
      status: 200,
      body: { job: queue.publicJob(historyRecord(params.jobId, query.recordProjectId)) },
      headers: { 'Cache-Control': 'no-store' },
    })),
  );
  app.delete(
    '/api/jobs/:jobId',
    endpoint(({ params, query }) => {
      const job = historyRecord(params.jobId, query.recordProjectId);
      queue.remove(job.id);
      return { status: 200, body: { success: true } };
    }),
  );
  app.post(
    '/api/jobs/:jobId/cancel',
    endpoint(({ params, body }) => {
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length)
        throw security.fail('Cancelación inválida.');
      get(params.jobId);
      queue.cancel(params.jobId);
      return { status: 200, body: snapshot(get(params.jobId)) };
    }),
  );
  app.get(
    '/api/jobs/:jobId',
    endpoint(({ params, query }) => ({
      status: 200,
      body: snapshot(get(params.jobId), query.projectId || get(params.jobId).projectId),
      headers: { 'Cache-Control': 'no-store' },
    })),
  );
  app.post(
    '/api/jobs/:jobId/retry',
    endpoint(({ params, query }) => {
      get(params.jobId);
      queue.retry(params.jobId);
      return {
        status: 202,
        body: snapshot(get(params.jobId), query.projectId || get(params.jobId).projectId),
      };
    }),
  );
  app.post(
    '/api/jobs/:jobId/choice',
    endpoint(({ params, body }) => {
      if (!body || Object.keys(body).some((key) => key !== 'choice'))
        throw security.fail('Elección inválida.');
      const job = get(params.jobId);
      workflow.choose(job, body.choice);
      queue.resume(job);
      return { status: 202, body: snapshot(job) };
    }),
  );
}
module.exports = { registerJobRoutes };
