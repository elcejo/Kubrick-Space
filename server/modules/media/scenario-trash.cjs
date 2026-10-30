/**
 * Physically remove scenario images the author has emptied from the trash. The client first removes them
 * from the document and flushes the draft; this operation then refuses anything the project still uses
 * and keeps files that saved versions or other projects still reference.
 */
function createScenarioTrashOperation({
  security,
  assertProject,
  repository,
  documentStore,
  readCurrentProject,
  fs,
  path,
  PROJECTS_DIR,
}) {
  const mentions = (value, url) => {
    if (typeof value === 'string') return value.includes(url);
    if (Array.isArray(value)) return value.some((entry) => mentions(entry, url));
    return (
      Boolean(value) &&
      typeof value === 'object' &&
      Object.values(value).some((entry) => mentions(entry, url))
    );
  };
  return ({ body } = {}) => {
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => !['projectId', 'images'].includes(key))
    )
      throw security.fail('Petición de eliminación inválida.');
    assertProject(body.projectId);
    const current = readCurrentProject(body.projectId);
    if (
      current.type !== 'stage' ||
      !Array.isArray(body.images) ||
      !body.images.length ||
      body.images.length > 100 ||
      new Set(body.images).size !== body.images.length
    )
      throw security.fail('Selección de eliminación inválida.');
    const prefix = `/projects/${body.projectId}/content/`;
    for (const url of body.images)
      if (
        typeof url !== 'string' ||
        !url.startsWith(prefix) ||
        url.includes('..') ||
        !security.IMAGE_NAME.test(url.slice(prefix.length))
      )
        throw security.fail('Imagen de eliminación inválida.');
    const live = [current, documentStore.getDraft(body.projectId)?.payload].filter(Boolean);
    for (const url of body.images)
      if (live.some((snapshot) => mentions(snapshot, url)))
        throw security.fail('Solo se pueden eliminar imágenes que el escenario ya no usa.', 409);
    const history = repository
      .read()
      .projects.flatMap((project) => [
        project,
        documentStore.getDraft(project.id)?.payload,
        ...documentStore.getVersions(project.id).map((version) => version.snapshot),
      ])
      .filter(Boolean);
    const removed = [];
    const retained = [];
    const failed = [];
    for (const url of body.images) {
      if (history.some((snapshot) => mentions(snapshot, url))) {
        retained.push(url);
        continue;
      }
      try {
        const file = security.containedPath(PROJECTS_DIR, body.projectId, 'content', path.basename(url));
        if (fs.existsSync(file)) fs.unlinkSync(file);
        removed.push(url);
      } catch {
        failed.push(url);
      }
    }
    return { status: 200, body: { removed, retained, failed } };
  };
}
module.exports = { createScenarioTrashOperation };
