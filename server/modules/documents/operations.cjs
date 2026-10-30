// Application operations with explicit storage/provider dependencies.
function createDocumentOperations(dependencies) {
  const { assertProject, security, documentStore, repository, projectStore } = dependencies;

  function readDraft({ params = {}, body, headers = {}, query = {} } = {}) {
    const responseHeaders = {};
    const reply = (body, status = 200) => ({ body, status, headers: responseHeaders });

    try {
      assertProject(params.id);
      return reply({ draft: documentStore.getDraft(params.id) }, 200);
    } catch (error) {
      throw error;
    }
  }

  function saveDraft({ params = {}, body, headers = {}, query = {} } = {}) {
    const responseHeaders = {};
    const reply = (body, status = 200) => ({ body, status, headers: responseHeaders });

    try {
      assertProject(params.id);
      const project = repository.read().projects.find((item) => item.id === params.id);
      const expectedProjectRevision = headers['x-project-revision'];
      if (expectedProjectRevision === undefined) throw security.fail('Falta la revisión del proyecto.', 428);
      if (expectedProjectRevision !== String(project.revision || 0))
        throw security.fail(
          'Este proyecto se guardó permanentemente en otra pestaña. Vuelve a abrirlo para conservar la última versión.',
          409,
        );
      const expectedDraftRevision = Number(headers['x-document-draft-revision']);
      const draft = documentStore.saveDraft(params.id, body, expectedDraftRevision);
      if (project.type === 'character' && Array.isArray(draft.payload?.covers))
        for (const url of draft.payload.covers) dependencies.ensureCharacterFace?.(url);
      return reply({ draft }, 200);
    } catch (error) {
      throw error;
    }
  }

  function listVersions({ params = {}, body, headers = {}, query = {} } = {}) {
    const responseHeaders = {};
    const reply = (body, status = 200) => ({ body, status, headers: responseHeaders });

    try {
      assertProject(params.id);
      return reply({ versions: documentStore.listVersions(params.id) }, 200);
    } catch (error) {
      throw error;
    }
  }

  function getVersion({ params = {}, body, headers = {}, query = {} } = {}) {
    const responseHeaders = {};
    const reply = (body, status = 200) => ({ body, status, headers: responseHeaders });

    try {
      assertProject(params.id);
      if (!security.UUID.test(params.versionId)) throw security.fail('ID de versión inválido.');
      const version = documentStore.getVersion(params.id, params.versionId);
      if (!version) throw security.fail('No se encontró la versión solicitada.', 404);
      return reply({ version }, 200);
    } catch (error) {
      throw error;
    }
  }

  function saveVersion({ params = {}, body, headers = {}, query = {} } = {}) {
    const responseHeaders = {};
    const reply = (body, status = 200) => ({ body, status, headers: responseHeaders });

    try {
      assertProject(params.id);
      const data = repository.read();
      const index = data.projects.findIndex((item) => item.id === params.id);
      if (index < 0) throw security.fail('Project not found', 404);
      const current = data.projects[index];
      const expectedProjectRevision = headers['x-project-revision'];
      if (expectedProjectRevision === undefined) throw security.fail('Falta la revisión del proyecto.', 428);
      if (expectedProjectRevision !== String(current.revision || 0))
        throw security.fail(
          'El proyecto cambió en otra pestaña. No se guardó una versión duplicada; vuelve a abrir el proyecto.',
          409,
        );
      const expectedDraftRevision = Number(headers['x-document-draft-revision']);
      const draftRevision = documentStore.getDraft(params.id)?.revision || 0;
      if (!Number.isSafeInteger(expectedDraftRevision) || expectedDraftRevision !== draftRevision)
        throw security.fail(
          'El borrador cambió en otra pestaña. Vuelve a abrir el proyecto antes de guardar una versión.',
          409,
        );

      const { versions, version } = documentStore.createVersion(params.id, body);
      const updated = {
        ...current,
        ...version.snapshot,
        revision: (current.revision || 0) + 1,
        updatedAt: version.savedAt,
      };
      data.projects[index] = updated;
      projectStore.commit(data, {
        project: updated,
        extraWrites: [{ projectId: params.id, file: 'document-versions.json', value: versions }],
        extraDeletes: [{ projectId: params.id, file: 'document-draft.json' }],
      });
      return reply({ project: updated, version: { ...version, snapshot: undefined } }, 201);
    } catch (error) {
      throw error;
    }
  }
  return { readDraft, saveDraft, listVersions, getVersion, saveVersion };
}
module.exports = { createDocumentOperations };
