const {
  emptyCharacterDocument,
  parseCharacterDocument,
  validateCharacterDocument,
  CHARACTER_NARRATIVE,
} = require('../../../public/js/contracts/character-model.js');
const { legacyScenarioDocument, parseScenarioDocument } = require('../../../public/js/contracts/scenario.js');
/** Reuses the character recipe inline: waiting for a child queued on the same serial queue would deadlock. */
function createNarrativeResources(deps, workflow) {
  async function prepare(resource, record, job, ctx) {
    const project = deps.readCurrentProject(record.id);
    if (!record.created) return project;
    if (record.type !== 'character') {
      const warn = (message) => {
        ctx.state.warnings = [...new Set([...(ctx.state.warnings || []), record.name + ': ' + message])];
        ctx.checkpoint();
      };
      ctx.state.stageJobs ??= {};
      const state = (ctx.state.stageJobs[record.id] ??= {});
      if (deps.runScenario && !state.ready) {
        const mode = deps.inference?.currentImageMode?.() || 'api';
        const engine =
          mode === 'local'
            ? { provider: 'local', model: 'flux3-klein' }
            : deps.inference?.currentSettings?.().imageModel;
        if (!engine)
          warn(
            'no tiene imagen principal porque no hay un modelo de imagen seleccionado en la barra superior.',
          );
        else {
          try {
            if (!state.expectedContent) {
              // The pipeline designs the sheet itself; the shell only needs the current scenario format.
              const shell = JSON.stringify(legacyScenarioDocument(project, ''));
              deps.writeProject(record.id, { content: shell }, project.content);
              state.expectedContent = shell;
              ctx.checkpoint();
            }
            const prefix = 'resource-' + record.id + '-';
            const result = await deps.runScenario(
              {
                id: job.id,
                projectId: record.id,
                kind: 'scenario',
                payload: {
                  source: 'description',
                  request: resource.description,
                  scope: 'all',
                  references: [],
                  expectedContent: state.expectedContent,
                  engine,
                  category: project.category,
                  textConfig: job.payload.textConfig,
                  inferenceMode: job.payload.inferenceMode,
                  inferenceSettings: job.payload.inferenceSettings,
                  localModel: job.payload.localModel,
                  stopAfterPanorama: true,
                },
              },
              {
                ...ctx,
                state,
                step: (name, operation) => ctx.step(prefix + name, operation),
                progress: (message) => ctx.progress(record.name + ' · ' + message),
              },
            );
            ctx.throwIfAborted();
            ctx.state.viewJobs ??= {};
            ctx.state.viewJobs[record.id] = { viewPrompts: result?.viewPrompts || {}, engine };
          } catch (error) {
            ctx.throwIfAborted();
            // The story goes on without the picture; it can be generated later from the scenario itself.
            warn('no se pudo crear su imagen principal (' + (error?.message || 'error del proveedor') + ').');
          }
        }
        state.ready = true;
        ctx.checkpoint();
      }
      const latest = deps.readCurrentProject(record.id);
      const doc =
        parseScenarioDocument(latest.content) || legacyScenarioDocument(latest, resource.description);
      if (!doc.description) {
        doc.description = resource.description.slice(0, 4000);
        deps.writeProject(record.id, { content: JSON.stringify(doc) }, latest.content);
      }
      return deps.readCurrentProject(record.id);
    }
    ctx.state.resourceJobs ??= {};
    const state = (ctx.state.resourceJobs[record.id] ??= {});
    if (state.ready) return deps.readCurrentProject(record.id);
    const original = parseCharacterDocument(project.content);
    if (!original?.creation.mode) {
      const doc = original || emptyCharacterDocument({ id: record.id, name: record.name });
      doc.creation.mode = 'description';
      deps.writeProject(
        record.id,
        { content: JSON.stringify(validateCharacterDocument(doc)) },
        project.content,
      );
    }
    state.expectedContent ??= deps.readCurrentProject(record.id).content;
    ctx.checkpoint();
    const choice = ctx.state.resourceModels?.[record.id];
    if (!choice) throw deps.security.fail('Falta elegir modo y modelo para el personaje nuevo.', 428);
    const prefix = 'resource-' + record.id + '-';
    const childCtx = {
      ...ctx,
      state,
      step: (name, operation) => ctx.step(prefix + name, operation),
      progress: (message) => ctx.progress(record.name + ' · ' + message),
    };
    const childJob = {
      ...job,
      id: job.id,
      projectId: record.id,
      kind: 'interpret',
      payload: {
        ...job.payload,
        source: 'description',
        request: resource.description,
        expectedContent: state.expectedContent,
        managementDisabled: true,
        stopAfterPortrait: true,
        inferenceMode: choice.mode,
        inferenceSettings: { ...job.payload.inferenceSettings, imageMode: choice.mode },
        engine: choice.engine,
      },
    };
    await workflow.run(childJob, childCtx);
    ctx.throwIfAborted();
    const ready = deps.readCurrentProject(record.id);
    if (!ready.covers?.length)
      throw deps.security.fail(
        'El personaje complementario aún no tiene una fotografía válida. Continúa el trabajo para reintentar.',
        422,
      );
    state.ready = true;
    ctx.checkpoint();
    return ready;
  }
  function narrative(projectId, fields, expectedContent) {
    const project = deps.readCurrentProject(projectId),
      doc = parseCharacterDocument(project?.content);
    if (
      !doc ||
      project.deletedAt ||
      !fields ||
      typeof fields !== 'object' ||
      Array.isArray(fields) ||
      !Object.keys(fields).length ||
      Object.keys(fields).some(
        (key) =>
          !Object.hasOwn(CHARACTER_NARRATIVE, key) ||
          typeof fields[key] !== 'string' ||
          fields[key].length > 12000,
      )
    )
      throw deps.security.fail('Actualización narrativa de personaje inválida.', 422);
    if (project.content !== expectedContent)
      throw deps.security.fail('La narrativa del personaje cambió fuera del asistente. Se conserva.', 409);
    Object.assign(doc.narrative, fields);
    doc.enabledNarrative = [
      ...new Set([
        ...(doc.enabledNarrative || []),
        ...Object.keys(fields).filter((key) => fields[key].trim()),
      ]),
    ];
    doc.revision++;
    deps.writeProject(
      projectId,
      { content: JSON.stringify(validateCharacterDocument(doc)) },
      expectedContent,
    );
    return deps.readCurrentProject(projectId);
  }
  return { prepare, narrative };
}
module.exports = { createNarrativeResources };
