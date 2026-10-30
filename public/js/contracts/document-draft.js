import documentContract from '../../document-contract.json' with { type: 'json' };
export const DOCUMENT_FIELDS = Object.freeze([...documentContract.documentFields]);
const MEDIA_FIELDS = new Set(documentContract.mediaFields);
/** Merge a temporary document snapshot over its permanent project record. */
export function mergeProjectDraft(project, draft) {
  if (!project || typeof project !== 'object' || Array.isArray(project))
    throw new TypeError('Se requiere un proyecto válido para abrir el documento.');
  const payload = draft?.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ...project };
  return { ...project, ...payload };
}

/** Build the editable document payload accepted by the draft/version API. */
export function createDocumentDraftPayload(project, content = project?.content) {
  if (!project || typeof project !== 'object' || Array.isArray(project))
    throw new TypeError('Se requiere un proyecto válido para crear el borrador.');
  const payload = {};
  for (const key of documentContract.documentFields) {
    if (key === 'name') {
      if (typeof project.name === 'string') payload.name = project.name;
      continue;
    }
    if (key === 'content') {
      if (typeof content === 'string') payload.content = content;
      continue;
    }
    if (key === 'ingredients') {
      payload.ingredients = Array.isArray(project.ingredients) ? project.ingredients : [];
      continue;
    }
    if (MEDIA_FIELDS.has(key)) {
      if (project[key] !== undefined) payload[key] = project[key];
      continue;
    }
    if (key === 'traits' && project.type !== 'character') continue;
    if (key === 'production' && project.type !== 'video') continue;
    if (project[key] !== undefined) payload[key] = project[key];
  }
  return payload;
}
