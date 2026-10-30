const { randomUUID } = require('node:crypto');
const { characterAssetRules } = require('../characters/index.cjs');
const { characterAssetCategory, characterAssetKind, characterAssetSlot, characterAppearanceKey } =
  characterAssetRules;

/** Persistent universal catalogue when injected; imports always create an independent local file. */
function createCharacterAssetLibraryOperations({
  repository,
  readCurrentProject,
  assertProject,
  security,
  fs,
  path,
  PROJECTS_DIR,
  ensureDir,
  universalProps,
}) {
  const active = (id) => {
    assertProject(id);
    const project = readCurrentProject(id);
    if (project.type !== 'character' || project.deletedAt)
      throw security.fail('Selecciona un personaje activo.', 404);
    return project;
  };
  const readLibrary = characterAssetRules.readState;
  function list({ query = {} } = {}) {
    if (
      Object.keys(query).some((key) => !['projectId', 'category', 'kind', 'offset'].includes(key)) ||
      !['traits', 'clothing', 'props'].includes(query.category) ||
      !/^[a-z][a-z0-9-]{0,47}$/.test(query.kind || '') ||
      (query.offset !== undefined && !/^\d{1,7}$/.test(String(query.offset)))
    )
      throw security.fail('Filtro de biblioteca inválido.');
    active(query.projectId);
    if (universalProps) {
      const result = universalProps.list({
        query: { category: query.category, kind: query.kind, offset: query.offset || 0 },
      });
      result.body.items = result.body.items.map((entry) => ({
        ...entry,
        libraryId: entry.id,
        assetId: 'asset_library',
        sourceProjectId: entry.sourceProjectId,
      }));
      return result;
    }
    const entries = [];
    for (const source of repository.read().projects) {
      if (source.id === query.projectId || source.type !== 'character' || source.deletedAt) continue;
      try {
        const current = active(source.id),
          data = readLibrary(current);
        if (!data || data.library.format !== 'square-v2') continue;
        for (const item of data.library.items) {
          if (
            !item.image ||
            characterAssetCategory(item) !== query.category ||
            characterAssetKind(item) !== query.kind
          )
            continue;
          const file = security.containedPath(PROJECTS_DIR, source.id, 'content', path.basename(item.image));
          if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
          entries.push({
            sourceProjectId: source.id,
            sourceName: current.name,
            assetId: item.id,
            image: item.image,
            label: item.label,
          });
        }
      } catch {
        /* An unavailable source does not hide the remaining catalogue. */
      }
    }
    entries.sort(
      (a, b) => a.sourceName.localeCompare(b.sourceName, 'es') || a.assetId.localeCompare(b.assetId),
    );
    const offset = Number(query.offset || 0),
      limit = 100;
    return {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
      body: {
        items: entries.slice(offset, offset + limit),
        total: entries.length,
        nextOffset: offset + limit < entries.length ? offset + limit : null,
      },
    };
  }
  function importAsset({ body } = {}) {
    if (
      !body ||
      Array.isArray(body) ||
      Object.keys(body).some(
        (key) =>
          ![
            'projectId',
            'sourceProjectId',
            'assetId',
            'sourceImage',
            'targetImage',
            'targetKey',
            'libraryId',
          ].includes(key),
      ) ||
      !/^asset_[A-Za-z0-9_-]{1,100}$/.test(body.assetId || '') ||
      (!body.libraryId && body.projectId === body.sourceProjectId)
    )
      throw security.fail('Importación de pieza inválida.');
    const target = active(body.projectId),
      shared = body.libraryId && universalProps?.get(body.libraryId),
      source = body.libraryId ? null : active(body.sourceProjectId),
      targetData = readLibrary(target),
      sourceData = shared
        ? { library: { format: 'square-v2', items: [shared.item] } }
        : source && readLibrary(source);
    if (body.libraryId && !shared) throw security.fail('La pieza ya no está disponible.', 409);
    if (!targetData || !sourceData || sourceData.library.format !== 'square-v2')
      throw security.fail('Actualiza el desglose de ambos personajes antes de importar.', 409);
    if (
      targetData.library.sourceImage !== body.targetImage ||
      characterAppearanceKey(targetData.document) !== body.targetKey
    )
      throw security.fail('El personaje cambió. Abre de nuevo la biblioteca.', 409);
    if (targetData.library.items.length >= 48)
      throw security.fail('La galería admite 48 piezas activas.', 409);
    const item =
      shared?.item ||
      sourceData.library.items.find((item) => item.id === body.assetId && item.image === body.sourceImage);
    if (!item || item.unavailable)
      throw security.fail('La pieza ya no está disponible. Actualiza la biblioteca.', 409);
    const input = shared
      ? universalProps.file(shared)
      : security.containedPath(PROJECTS_DIR, source.id, 'content', path.basename(item.image));
    const stat = fs.statSync(input);
    if (!stat.isFile() || stat.size > security.MAX_IMAGE_BYTES)
      throw security.fail('Imagen de pieza inválida.', 413);
    const buffer = fs.readFileSync(input),
      type = security.imageType(buffer);
    const filename = `asset-${randomUUID()}.${type}`,
      output = security.containedPath(PROJECTS_DIR, target.id, 'content', filename);
    ensureDir(path.dirname(output));
    fs.writeFileSync(output, buffer, { flag: 'wx' });
    const matching = targetData.library.items.find(
      (candidate) => characterAssetSlot(candidate) === characterAssetSlot(item),
    );
    const fieldKeys = (matching?.fieldKeys || []).filter((key) =>
      targetData.document.fields.some((field) => field.key === key && field.section === 'appearance'),
    );
    const imported = {
      ...item,
      id: `asset_${randomUUID()}`,
      category: characterAssetCategory(item),
      kind: characterAssetKind(item),
      fieldKeys,
      image: `/projects/${target.id}/content/${filename}`,
      error: '',
    };
    if (shared) imported.code = shared.code;
    delete imported.unavailable;
    delete imported.detached;
    if (shared) universalProps.alias(shared.id, target, imported);
    return {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
      body: {
        item: imported,
      },
    };
  }
  return { list, importAsset };
}
module.exports = { createCharacterAssetLibraryOperations };
