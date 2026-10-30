/** Physically remove only explicitly discarded, unreferenced files after the draft has committed. */
function createCharacterTrashOperation({
  security,
  assertProject,
  repository,
  documentStore,
  readCurrentProject,
  fs,
  path,
  PROJECTS_DIR,
}) {
  const references = (value, url) => {
    if (typeof value === 'string') return value.includes(url);
    if (Array.isArray(value)) return value.some((entry) => references(entry, url));
    return (
      value &&
      typeof value === 'object' &&
      Object.entries(value).some(
        ([key, entry]) => key !== 'characterMediaDeletions' && references(entry, url),
      )
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
      current.type !== 'character' ||
      !Array.isArray(body.images) ||
      !body.images.length ||
      body.images.length > 500 ||
      new Set(body.images).size !== body.images.length
    )
      throw security.fail('Selección de eliminación inválida.');
    for (const url of body.images)
      if (
        typeof url !== 'string' ||
        !url.startsWith(`/projects/${body.projectId}/content/`) ||
        !security.IMAGE_NAME.test(url.split('/').pop()) ||
        url.includes('..') ||
        !current.characterMediaDeletions?.includes(url) ||
        current.covers?.includes(url) ||
        current.characterVisualLibrary?.items.some((item) => item.image === url)
      )
        throw security.fail(
          'Solo se pueden eliminar imágenes descartadas y sin uso en el proyecto actual.',
          409,
        );
    const records = repository.read().projects;
    const snapshots = records
      .flatMap((project) => [
        project,
        documentStore.getDraft(project.id)?.payload,
        ...documentStore.getVersions(project.id).map((version) => version.snapshot),
      ])
      .filter(Boolean);
    const removed = [],
      retained = [],
      failed = [];
    for (const url of body.images) {
      if (snapshots.some((snapshot) => references(snapshot, url))) {
        retained.push(url);
        continue;
      }
      const name = url.split('/').pop(),
        base = path.basename(name, path.extname(name));
      try {
        for (const filename of [name, `${base}-face.png`]) {
          if (
            filename !== name &&
            snapshots.some((snapshot) =>
              references(snapshot, `/projects/${body.projectId}/content/${filename}`),
            )
          )
            continue;
          const file = security.containedPath(PROJECTS_DIR, body.projectId, 'content', filename);
          if (fs.existsSync(file)) fs.unlinkSync(file);
        }
        removed.push(url);
      } catch {
        failed.push(url);
      }
    }
    return { status: 200, body: { removed, retained, failed } };
  };
}
module.exports = { createCharacterTrashOperation };
