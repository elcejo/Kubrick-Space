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
module.exports = { createBackgroundDraftWriter };
