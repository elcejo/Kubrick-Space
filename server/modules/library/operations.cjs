// Application operations with explicit storage/provider dependencies.
function createLibraryOperations(dependencies) {
  const {
    repository,
    ROOT_DIR,
    security,
    projectStore,
    uuidv4,
    decorateProject = (p) => p,
    previewProject = (p) => p,
    prepareProjectArtwork = (p) => p,
    beforeDeleteProject,
  } = dependencies;

  function listProjects({ params = {}, body, headers = {}, query = {} } = {}) {
    const responseHeaders = {};
    const reply = (body, status = 200) => ({ body, status, headers: responseHeaders });

    try {
      const data = repository.read();
      return reply({ projects: data.projects.map(previewProject) }, 200);
    } catch (err) {
      console.error('GET /api/projects error:', err);
      return reply({ error: 'Failed to read projects' }, 500);
    }
  }

  function listTrash({ params = {}, body, headers = {}, query = {} } = {}) {
    const responseHeaders = {};
    const reply = (body, status = 200) => ({ body, status, headers: responseHeaders });

    try {
      const data = repository.read();
      return reply(
        {
          projects: require('./trash.cjs')
            .listTrash(ROOT_DIR, data)
            .map(({ id, name, type, category, deletedAt }) => ({ id, name, type, category, deletedAt })),
        },
        200,
      );
    } catch (error) {
      throw error;
    }
  }

  function restoreProject({ params = {}, body, headers = {}, query = {} } = {}) {
    const responseHeaders = {};
    const reply = (body, status = 200) => ({ body, status, headers: responseHeaders });

    try {
      const data = repository.read();
      if (data.projects.some((p) => p.id === params.id))
        throw security.fail('El proyecto ya está en la biblioteca.', 409);
      const previous = require('./trash.cjs')
        .listTrash(ROOT_DIR, data)
        .find((p) => p.id === params.id);
      if (!previous) throw security.fail('No se encontró el proyecto en la papelera.', 404);
      const restored = prepareProjectArtwork({
        ...previous,
        revision: (previous.revision || 0) + 1,
        updatedAt: new Date().toISOString(),
      });
      delete restored.deletedAt;
      data.projects.push(restored);
      data.trashedProjects = (data.trashedProjects || []).filter((p) => p.id !== restored.id);
      projectStore.commit(data, { project: restored });
      return reply(restored, 200);
    } catch (error) {
      throw error;
    }
  }

  function createProject({ params = {}, body, headers = {}, query = {} } = {}) {
    const responseHeaders = {};
    const reply = (body, status = 200) => ({ body, status, headers: responseHeaders });
    body = security.validateProject(body, false);

    try {
      const { name, type, category } = body;

      if (!name || !type || !category) {
        return reply({ error: 'Fields name, type and category are required' }, 400);
      }

      const id = uuidv4();
      const now = new Date().toISOString();

      const project = prepareProjectArtwork({
        id,
        name,
        type,
        category,
        status: 'Borrador',
        revision: 1,
        createdAt: now,
        updatedAt: now,
      });

      const data = repository.read();
      data.projects.push(project);
      projectStore.commit(data, { project });

      return reply(project, 201);
    } catch (err) {
      console.error('POST /api/projects error:', err);
      return reply({ error: 'Failed to create project' }, 500);
    }
  }

  function getProject({ params = {}, body, headers = {}, query = {} } = {}) {
    const responseHeaders = {};
    const reply = (body, status = 200) => ({ body, status, headers: responseHeaders });

    try {
      const data = repository.read();
      const project = data.projects.find((p) => p.id === params.id);

      if (!project) {
        return reply({ error: 'Project not found' }, 404);
      }

      return reply(decorateProject(project), 200);
    } catch (err) {
      console.error('GET /api/projects/:id error:', err);
      return reply({ error: 'Failed to read project' }, 500);
    }
  }

  function updateInference({ params, body }) {
    let patch;
    try {
      patch = require('../../../public/js/contracts/project-inference.js').validateProjectInference(body);
    } catch {
      throw security.fail('Preferencias de inferencia inválidas.');
    }
    const data = repository.read();
    const project = data.projects.find((item) => item.id === params.id);
    if (!project) throw security.fail('Proyecto no encontrado.', 404);
    project.inferenceSettings = { ...project.inferenceSettings, ...patch };
    // Routing preferences are metadata. Do not invalidate the content revision,
    // replace the draft or include them in historical document snapshots.
    projectStore.commit(data, { project });
    return { status: 200, body: { inferenceSettings: project.inferenceSettings } };
  }

  function updateProject({ params = {}, body, headers = {}, query = {} } = {}) {
    const responseHeaders = {};
    const reply = (body, status = 200) => ({ body, status, headers: responseHeaders });
    body = security.validateProject(body, true);
    if (body.characterMediaDeletions?.some((url) => !url.startsWith(`/projects/${params.id}/content/`)))
      throw security.fail('El registro de eliminación contiene imágenes de otro proyecto.');
    if (body.characterVisualLibrary) {
      try {
        require('../../../public/js/contracts/character-visual-library.js').validateCharacterVisualLibrary(
          body.characterVisualLibrary,
          params.id,
        );
      } catch {
        throw security.fail('Los componentes visuales deben pertenecer a este personaje.');
      }
    }
    if (body.characterImageTrash?.some((url) => !url.startsWith(`/projects/${params.id}/content/`)))
      throw security.fail('La papelera contiene una imagen de otro proyecto.');
    if (body.lastCharacterImage && !body.lastCharacterImage.startsWith(`/projects/${params.id}/content/`))
      throw security.fail('La referencia visual pertenece a otro proyecto.');
    const character = require('../../../public/js/contracts/character-model.js').parseCharacterDocument(
      body.content || '',
    );
    if (character && character.id !== params.id)
      throw security.fail('La ficha de personaje pertenece a otro proyecto.');

    try {
      const data = repository.read();
      const idx = data.projects.findIndex((p) => p.id === params.id);

      if (idx === -1) {
        return reply({ error: 'Project not found' }, 404);
      }

      const revision = data.projects[idx].revision || 0;
      const expected = headers['x-project-revision'];
      if (expected === undefined)
        return reply(
          { error: 'Actualiza la aplicación antes de guardar: falta la versión del proyecto.' },
          428,
        );
      if (expected !== String(revision))
        return reply(
          {
            error:
              'Este proyecto cambió en otra pestaña. No se sobrescribió la versión guardada. Conserva tus cambios antes de volver a abrirlo.',
          },
          409,
        );

      // Merge incoming fields, refresh updatedAt
      const updated = prepareProjectArtwork({
        ...data.projects[idx],
        ...body,
        revision: revision + 1,
        id: data.projects[idx].id, // prevent id override
        updatedAt: new Date().toISOString(),
      });

      data.projects[idx] = updated;
      projectStore.commit(data, { project: updated });

      return reply(updated, 200);
    } catch (err) {
      console.error('PUT /api/projects/:id error:', err);
      return reply({ error: 'Failed to update project' }, 500);
    }
  }

  function trashProject({ params = {}, body, headers = {}, query = {} } = {}) {
    const responseHeaders = {};
    const reply = (body, status = 200) => ({ body, status, headers: responseHeaders });

    try {
      const data = repository.read();
      const idx = data.projects.findIndex((p) => p.id === params.id);

      if (idx === -1) {
        return reply({ error: 'Project not found' }, 404);
      }

      const [project] = data.projects.splice(idx, 1);
      const trashed = {
        ...project,
        deletedAt: new Date().toISOString(),
        revision: (project.revision || 0) + 1,
      };
      data.trashedProjects = [...(data.trashedProjects || []).filter((p) => p.id !== project.id), trashed];
      projectStore.commit(data, { project: trashed });

      return reply({ success: true }, 200);
    } catch (err) {
      console.error('DELETE /api/projects/:id error:', err);
      return reply({ error: 'Failed to delete project' }, 500);
    }
  }

  function deleteProject({ params = {}, body, headers = {}, query = {} } = {}) {
    const responseHeaders = {};
    const reply = (body, status = 200) => ({ body, status, headers: responseHeaders });

    let preparation;
    try {
      const { confirmPhrase } = body;
      if (body.keepProps !== undefined && typeof body.keepProps !== 'boolean')
        throw security.fail('Conservación de props inválida.');

      if (confirmPhrase !== 'eliminar proyecto completo') {
        return reply(
          {
            error: 'Confirmation phrase must be exactly "eliminar proyecto completo"',
          },
          400,
        );
      }

      const data = repository.read();
      const idx = data.projects.findIndex((p) => p.id === params.id);

      const trash = require('./trash.cjs').listTrash(ROOT_DIR, data);
      if (idx === -1 && !trash.some((p) => p.id === params.id))
        return reply({ error: 'Project not found' }, 404);
      const deleting = idx === -1 ? trash.find((p) => p.id === params.id) : data.projects[idx];
      if (deleting.type === 'character')
        preparation = beforeDeleteProject?.(deleting, body.keepProps !== false);
      if (idx !== -1) data.projects.splice(idx, 1);
      data.trashedProjects = (data.trashedProjects || []).filter((p) => p.id !== params.id);
      projectStore.commit(data, { deleteId: params.id });
      preparation?.commit?.();

      return reply({ success: true }, 200);
    } catch (err) {
      preparation?.rollback?.();
      console.error('DELETE /api/projects/:id/full error:', err);
      return reply({ error: 'Failed to fully delete project' }, 500);
    }
  }
  return {
    listProjects,
    listTrash,
    restoreProject,
    createProject,
    getProject,
    updateProject,
    updateInference,
    trashProject,
    deleteProject,
  };
}
module.exports = { createLibraryOperations };
