const { createDocumentDraftPayload } = require('../../../public/js/contracts/document-draft.js');

/** Synchronous CAS writes keep queue stages independent of an open browser. */
function createBackgroundDraftWriter({ assertProject, readCurrentProject, documentStore, security }) {
  return (id, patch, expectedContent) => {
    assertProject(id);
    const current = readCurrentProject(id);
    if (Object.entries(patch).every(([key, value]) => JSON.stringify(current[key]) === JSON.stringify(value)))
      return documentStore.getDraft(id);
    if (expectedContent !== undefined && current.content !== expectedContent)
      throw security.fail('La ficha cambió fuera del trabajo. No se sobrescribieron esos cambios.', 409);
    const draft = documentStore.getDraft(id);
    return documentStore.saveDraft(
      id,
      createDocumentDraftPayload({ ...current, ...patch }),
      draft?.revision || 0,
    );
  };
}
/**
 * The version every change starts from: before an AI job edits a project, the state it has now (permanent record plus
 * draft) is kept as a version with a note saying why, so the change can always be undone. Empty projects have nothing
 * to keep; the same state twice is kept once.
 */
function createSafetyVersionWriter({ assertProject, readCurrentProject, documentStore }) {
  return (id, note) => {
    assertProject(id);
    const current = readCurrentProject(id);
    if (typeof current.content !== 'string' || !current.content.trim()) return null;
    return documentStore.appendVersion(id, createDocumentDraftPayload(current), note);
  };
}
module.exports = { createBackgroundDraftWriter, createSafetyVersionWriter };
