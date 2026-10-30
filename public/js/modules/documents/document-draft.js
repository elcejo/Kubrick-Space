import { mergeProjectDraft, createDocumentDraftPayload } from '../../contracts/document-draft.js';
import { AppState } from '../../app-state.js';
import { EventBus } from '../../event-bus.js';
import { API } from '../../api-service.js';

const mediaWrites = new Map();

/** Save through the active autosaver, or the originating project's draft
 * when an image finishes after leaving its workspace. */
export function updateDocumentDraft(projectId, transform) {
  if (typeof transform !== 'function')
    throw new TypeError('La actualización del borrador requiere una transformación.');
  const task = (mediaWrites.get(projectId) || Promise.resolve())
    .catch(() => {})
    .then(async () => {
      if (AppState.currentProject?.id === projectId) {
        const results = await EventBus.emitAsync('autosave:patch', { projectId, transform });
        const project = results.find((result) => result?.id === projectId);
        if (!project) throw new Error('No hay un borrador activo para guardar este cambio.');
        return project;
      }
      const project = await API.getProject(projectId);
      const draft = await API.getProjectDraft(projectId);
      const current = mergeProjectDraft(project, draft);
      const patch = transform(current);
      if (!patch || typeof patch !== 'object' || Array.isArray(patch))
        throw new TypeError('La actualización del borrador debe devolver un objeto de cambios.');
      const updated = { ...current, ...patch };
      await API.saveProjectDraft(projectId, createDocumentDraftPayload(updated), draft?.revision || 0);
      return updated;
    });
  mediaWrites.set(projectId, task);
  task
    .finally(() => {
      if (mediaWrites.get(projectId) === task) mediaWrites.delete(projectId);
    })
    .catch(() => {});
  return task;
}

export { mergeProjectDraft, createDocumentDraftPayload };
