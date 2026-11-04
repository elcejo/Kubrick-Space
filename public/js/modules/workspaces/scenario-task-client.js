import { API } from '../../api-service.js';
import { AppState } from '../../app-state.js';
import { EventBus } from '../../event-bus.js';
import { createDocumentDraftPayload } from '../../contracts/document-draft.js';
import {
  SCENARIO_MAX_REFERENCES,
  SCENARIO_VIEWS,
  purgeScenarioImages,
  removeScenarioReference,
  restoreScenarioImage,
  emptyScenarioDocument,
  parseScenarioDocument,
  scenarioHasContent,
} from '../../contracts/scenario.js';

/** The images of a scenario as the assistant needs to name them: the ones in use, the references and the trash. */
const imagesOf = (document) => ({
  panorama: document.panorama?.url ?? null,
  views: document.views.map((view) => ({ id: view.id, url: view.url })),
  references: document.creation.references,
  trash: document.archive.map(({ url, slot, archivedAt }) => ({ url, slot, archivedAt })),
});
const NO_CONTENT = /aún no tiene contenido/;

/**
 * What a person does with the images of a scenario besides generating them: see them, bring one back from the trash,
 * add or remove references, empty the trash. It works on the open scenario through its workspace, and on any other one
 * through its draft; the state it had is kept as a version first. Emptying the trash is for good: the caller asks the
 * person before calling.
 */
export async function manageScenarioImages(action, { workspace = null } = {}) {
  if (!/^[a-f0-9-]{36}$/.test(action?.projectId || '')) throw new Error('Acción de escenario inválida.');
  const project = await API.getProject(action.projectId);
  if (project.type !== 'stage') throw new Error('El destino debe ser un escenario.');
  const draft = workspace ? null : await API.getProjectDraft(action.projectId);
  const current = { ...project, ...draft?.payload };
  const document = workspace ? workspace.document : parseScenarioDocument(current.content);
  if (!document) throw new Error('El escenario aún no tiene contenido: no hay imágenes que gestionar.');
  if (action.action === 'list_images') return { status: 'listed', ...imagesOf(document) };
  const urls = [...new Set(action.urls || [])];
  if (!urls.length) throw new Error('Indica las imágenes (urls).');
  let next = structuredClone(document);
  if (action.action === 'restore_image') for (const url of urls) next = restoreScenarioImage(next, url);
  else if (action.action === 'add_reference') {
    const references = [...new Set([...next.creation.references, ...urls])];
    if (references.length > SCENARIO_MAX_REFERENCES)
      throw new Error('Un escenario admite hasta ' + SCENARIO_MAX_REFERENCES + ' referencias.');
    next.creation.references = references;
  } else if (action.action === 'remove_reference')
    for (const url of urls) next = removeScenarioReference(next, url);
  else if (action.action === 'purge_images') {
    const kept = new Set(next.archive.map((entry) => entry.url));
    const missing = urls.filter((url) => !kept.has(url));
    if (missing.length)
      throw new Error('Solo se eliminan imágenes de la papelera; no está en ella: ' + missing[0]);
    next = purgeScenarioImages(next, urls);
  } else throw new Error('Acción de imágenes desconocida.');
  try {
    await API.saveProjectSnapshot(project.id, 'Antes de gestionar imágenes del escenario con el asistente');
  } catch (error) {
    if (!NO_CONTENT.test(error.message)) throw error;
  }
  if (workspace) {
    workspace.applyDocument(next);
    workspace.mount();
  } else {
    await API.saveProjectDraft(
      project.id,
      createDocumentDraftPayload(current, JSON.stringify(next)),
      draft?.revision || 0,
    );
  }
  let disk = null;
  if (action.action === 'purge_images') {
    await EventBus.emitAsync('autosave:flush');
    disk = await API.purgeScenarioTrash(project.id, urls);
  }
  return {
    status: 'done',
    action: action.action,
    count: urls.length,
    ...(disk
      ? {
          removed: disk.removed?.length ?? 0,
          retained: disk.retained?.length ?? 0,
          failed: disk.failed?.length ?? 0,
        }
      : {}),
    ...imagesOf(next),
  };
}

/**
 * What the general assistant's ESCENARIO command asks of a scenario: the same server job the scenario workspace's
 * own buttons enqueue, for any scenario of the library, open or not. Nothing here generates anything: it decides which
 * kind of job the state of the scenario calls for, and the server runs and checkpoints it.
 */
export async function enqueueRemoteScenarioAction(action, { signal } = {}) {
  if (!action || !/^[a-f0-9-]{36}$/.test(action.projectId || ''))
    throw new Error('Acción de escenario inválida.');
  signal?.throwIfAborted();
  await EventBus.emitAsync('autosave:flush');
  const project = await API.getProject(action.projectId);
  if (project.type !== 'stage') throw new Error('El destino debe ser un escenario.');
  const draft = await API.getProjectDraft(action.projectId);
  let current = { ...project, ...draft?.payload };
  let document = parseScenarioDocument(current.content);
  if (!document) {
    // A scenario created empty by the assistant gets its sheet the first time something is asked of it.
    if (typeof current.content === 'string' && current.content.trim())
      throw new Error('El escenario no está en el formato actual.');
    document = emptyScenarioDocument({ id: project.id, name: project.name, kind: project.category });
    const saved = await API.saveProjectDraft(
      project.id,
      {
        name: project.name,
        content: JSON.stringify(document),
        ingredients: current.ingredients || [],
        covers: [],
        currentCoverIndex: -1,
      },
      draft?.revision || 0,
    );
    current = { ...current, ...saved?.payload, content: JSON.stringify(document) };
  }
  const request = (action.request || '').trim();
  const missingViews = SCENARIO_VIEWS.filter((view) => !document.views.some((item) => item.id === view.id));
  let job;
  if (action.action === 'change') job = { source: 'change' };
  else if (action.action === 'regenerate')
    job = {
      source: 'regenerate',
      scope: action.scope || (action.viewId ? 'view' : 'all'),
      ...(action.viewId ? { viewId: action.viewId } : {}),
    };
  else if (!scenarioHasContent(document)) job = { source: 'description' };
  else if (!document.panorama) job = { source: 'regenerate', scope: 'all' };
  else if (missingViews.length) job = { source: 'regenerate', scope: 'views' };
  else
    return {
      status: 'complete',
      message: 'El escenario ya tiene ficha, panorama y los cuatro ángulos; no se generó nada.',
    };
  if (job.source === 'description' && !request) job.request = `Escenario «${project.name}».`;
  signal?.throwIfAborted();
  const response = await API.enqueueScenarioJob({
    projectId: project.id,
    ...(AppState.currentProject?.id && AppState.currentProject.id !== project.id
      ? { workspaceProjectId: AppState.currentProject.id }
      : {}),
    ...job,
    ...(request ? { request } : {}),
    expectedContent: current.content,
    token: crypto.randomUUID(),
  });
  return {
    status: 'queued',
    jobId: response.job.id,
    message:
      'Trabajo de escenario aceptado por el servidor. Consulta Tareas activas; aún no está completado.',
  };
}
