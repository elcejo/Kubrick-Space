const { randomUUID } = require('node:crypto');

/** Copy only a known raster owned by an active character; no remote URLs or arbitrary filesystem paths. */
function createCharacterAgentMedia({
  security,
  assertProject,
  readCurrentProject,
  fs,
  path,
  PROJECTS_DIR,
  ensureDir,
}) {
  return (sourceProjectId, image, targetProjectId) => {
    for (const id of [sourceProjectId, targetProjectId]) {
      assertProject(id);
      const project = readCurrentProject(id);
      if (project.type !== 'character' || project.deletedAt)
        throw security.fail('Selecciona un personaje activo.', 404);
    }
    if (
      typeof image !== 'string' ||
      !image.startsWith(`/projects/${sourceProjectId}/content/`) ||
      !security.IMAGE_NAME.test(image.split('/').pop()) ||
      image.includes('..')
    )
      throw security.fail('Referencia visual inválida.');
    const input = security.containedPath(PROJECTS_DIR, sourceProjectId, 'content', path.basename(image));
    const stat = fs.lstatSync(input);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > security.MAX_IMAGE_BYTES)
      throw security.fail('Imagen inválida.');
    const buffer = fs.readFileSync(input),
      type = security.imageType(buffer);
    if (sourceProjectId === targetProjectId) return image;
    const name = `asset-${randomUUID()}.${type}`;
    const output = security.containedPath(PROJECTS_DIR, targetProjectId, 'content', name);
    ensureDir(path.dirname(output));
    fs.writeFileSync(output, buffer, { flag: 'wx' });
    return `/projects/${targetProjectId}/content/${name}`;
  };
}
module.exports = { createCharacterAgentMedia };
