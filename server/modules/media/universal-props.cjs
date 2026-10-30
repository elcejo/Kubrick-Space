const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, randomInt, createHash } = require('node:crypto');
const { characterAssetRules } = require('../characters/index.cjs');
const { normalizeCharacterAssetCode: normalizeCode, characterAssetCodeKey: codeKey } = characterAssetRules;

/** Independent files and durable tombstones. Portraits and their historic selection IDs are never removed. */
function createUniversalPropStore({ ROOT_DIR, PROJECTS_DIR, repository, readProject, security }) {
  const root = security.containedPath(ROOT_DIR, 'prop-library');
  fs.mkdirSync(root, { recursive: true });
  const index = security.containedPath(root, 'index.json');
  const read = () => {
    if (!fs.existsSync(index)) return { version: 1, items: [] };
    const value = JSON.parse(fs.readFileSync(index, 'utf8'));
    if (value.version !== 1 || !Array.isArray(value.items)) throw Error('Biblioteca universal inválida.');
    const used = new Set();
    let changed = false;
    for (const entry of value.items)
      if (entry.code !== undefined) {
        if (
          normalizeCode(entry.code) !== entry.code ||
          (entry.status !== 'purged' && used.has(codeKey(entry.code)))
        )
          throw Error('Códigos de biblioteca inválidos.');
        if (entry.status !== 'purged') used.add(codeKey(entry.code));
      }
    for (const entry of value.items)
      if (!entry.code && entry.status !== 'purged') {
        entry.code = allocateCode(used);
        used.add(codeKey(entry.code));
        changed = true;
      }
    if (changed) save(value);
    return value;
  };
  const allocateCode = (used) => {
    const capacity = 36 ** 4;
    const start = randomInt(capacity);
    for (let offset = 0; offset < capacity; offset++) {
      const code = ((start + offset) % capacity).toString(36).toUpperCase().padStart(4, '0');
      if (!used.has(codeKey(code))) return code;
    }
    throw security.fail('Se agotaron los códigos automáticos de cuatro caracteres.', 409);
  };
  const save = (data) => {
    const temporary = security.containedPath(root, randomUUID() + '.tmp');
    try {
      fs.writeFileSync(temporary, JSON.stringify(data), { flag: 'wx', mode: 0o600 });
      fs.renameSync(temporary, index);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  };
  const file = (entry) => {
    if (!security.UUID.test(entry.id) || !/^(png|jpg|webp|gif|bmp)$/.test(entry.type))
      throw security.fail('Pieza inválida.');
    return security.containedPath(root, `${entry.id}.${entry.type}`);
  };
  function capture(data, project) {
    const state = characterAssetRules.readStoredState(project);
    if (!state || state.library.format !== 'square-v2') return false;
    let changed = false;
    for (const item of [...state.library.items, ...(state.library.trash || [])]) {
      if (!item.image) continue;
      const existing = data.items.find((e) =>
        e.origins.some((o) => o.projectId === project.id && o.image === item.image),
      );
      if (existing) {
        for (const origin of existing.origins)
          if (origin.projectId === project.id && origin.name !== project.name) {
            origin.name = project.name;
            changed = true;
          }
        continue;
      }
      const input = security.containedPath(PROJECTS_DIR, project.id, 'content', path.basename(item.image));
      if (!fs.existsSync(input)) continue;
      const stat = fs.statSync(input);
      if (!stat.isFile() || stat.size > security.MAX_IMAGE_BYTES) continue;
      const bytes = fs.readFileSync(input),
        type = security.imageType(bytes);
      const category = characterAssetRules.characterAssetCategory(item),
        kind = characterAssetRules.characterAssetKind(item);
      const hash = createHash('sha256').update(bytes).digest('hex');
      let entry = data.items.find(
        (e) => e.status === 'active' && e.hash === hash && e.category === category && e.kind === kind,
      );
      if (!entry) {
        entry = {
          id: randomUUID(),
          code: allocateCode(
            new Set(data.items.filter((e) => e.status !== 'purged').map((e) => codeKey(e.code))),
          ),
          type,
          hash,
          category,
          kind,
          item: { ...item, fieldKeys: [] },
          status: 'active',
          origins: [],
          createdAt: new Date().toISOString(),
        };
        delete entry.item.unavailable;
        delete entry.item.code;
        delete entry.item.detached;
        fs.writeFileSync(file(entry), bytes, { flag: 'wx', mode: 0o600 });
        data.items.push(entry);
      }
      entry.origins.push({ projectId: project.id, name: project.name, assetId: item.id, image: item.image });
      changed = true;
    }
    return changed;
  }
  function sync() {
    const data = read();
    let changed = false;
    for (const p of repository.read().projects) {
      if (p.type !== 'character' || p.deletedAt) continue;
      // Invalid projects fail independently; catalog storage errors are never replaced with an empty index.
      let project;
      try {
        project = readProject(p.id);
        characterAssetRules.readStoredState(project);
      } catch {
        continue;
      }
      changed = capture(data, project) || changed;
    }
    if (changed) save(data);
    return data;
  }
  function decorate(project) {
    if (!project?.characterVisualLibrary) return project;
    const data = read(),
      library = structuredClone(project.characterVisualLibrary);
    if (capture(data, project)) save(data);
    for (const item of [...(library.items || []), ...(library.trash || [])]) {
      const entry = data.items.find((e) =>
        e.origins.some((o) => o.projectId === project.id && o.image === item.image),
      );
      if (entry && entry.status !== 'active') item.unavailable = true;
      else delete item.unavailable;
      if (entry && entry.status !== 'purged') item.code = entry.code;
      else delete item.code;
    }
    return { ...project, characterVisualLibrary: library };
  }
  function beforeDelete(project, keep) {
    const data = sync(),
      previous = structuredClone(data),
      removed = [];
    if (keep) capture(data, project);
    for (const entry of data.items) {
      if (!entry.origins.some((o) => o.projectId === project.id)) continue;
      if (keep) entry.retained = true;
      else {
        entry.origins = entry.origins.filter((o) => o.projectId !== project.id);
        if (!entry.origins.length && !entry.retained) {
          entry.status = 'purged';
          removed.push(entry);
        }
      }
    }
    save(data);
    return {
      rollback: () => save(previous),
      commit: () => {
        for (const entry of removed) {
          try {
            if (fs.existsSync(file(entry))) fs.unlinkSync(file(entry));
          } catch {
            /* Tombstone remains authoritative; no source project is retained. */
          }
        }
      },
    };
  }
  function alias(id, project, item) {
    const data = read(),
      entry = data.items.find((e) => e.id === id && e.status === 'active');
    if (!entry) throw security.fail('La pieza ya no está disponible.', 409);
    entry.origins.push({ projectId: project.id, name: project.name, assetId: item.id, image: item.image });
    save(data);
  }
  function change({ body = {} } = {}) {
    if (
      Object.keys(body).some((k) => !['ids', 'action', 'confirm'].includes(k)) ||
      !['trash', 'restore', 'purge'].includes(body.action) ||
      !Array.isArray(body.ids) ||
      !body.ids.length ||
      body.ids.length > 200 ||
      new Set(body.ids).size !== body.ids.length ||
      body.ids.some((id) => !security.UUID.test(id))
    )
      throw security.fail('Selección de biblioteca inválida.');
    if (body.action === 'purge' && body.confirm !== true)
      throw security.fail('Confirma la eliminación definitiva.');
    const data = sync(),
      entries = body.ids.map((id) => data.items.find((e) => e.id === id));
    if (entries.some((e) => !e || (body.action === 'trash' ? e.status !== 'active' : e.status !== 'trash')))
      throw security.fail('La selección cambió. Actualiza la biblioteca.', 409);
    for (const entry of entries)
      entry.status = body.action === 'trash' ? 'trash' : body.action === 'restore' ? 'active' : 'purged';
    save(data); // Publish tombstones first, so a failed unlink cannot resurrect a deleted entry.
    if (body.action === 'purge')
      for (const entry of entries) if (fs.existsSync(file(entry))) fs.unlinkSync(file(entry));
    return { status: 200, body: { success: true } };
  }
  function list({ query = {} } = {}) {
    if (
      Object.keys(query).some((k) => !['category', 'kind', 'character', 'state', 'offset'].includes(k)) ||
      (query.category && !['traits', 'clothing', 'props'].includes(query.category)) ||
      (query.kind && !/^[a-z][a-z0-9-]{0,47}$/.test(query.kind)) ||
      (query.character && !security.UUID.test(query.character)) ||
      (query.state && !['active', 'trash'].includes(query.state)) ||
      (query.offset && !/^\d{1,7}$/.test(query.offset))
    )
      throw security.fail('Filtro de biblioteca inválido.');
    const data = sync(),
      all = data.items.filter((e) => e.status === (query.state || 'active'));
    const characters = [
      ...new Map(
        all.flatMap((e) => e.origins.map((o) => [o.projectId, { id: o.projectId, name: o.name }])),
      ).values(),
    ];
    const groups = [
      ...new Map(
        all
          .filter((e) => !query.category || e.category === query.category)
          .map((e) => [e.category + '.' + e.kind, { category: e.category, kind: e.kind }]),
      ).values(),
    ];
    const filtered = all.filter(
      (e) =>
        (!query.category || e.category === query.category) &&
        (!query.kind || e.kind === query.kind) &&
        (!query.character || e.origins.some((o) => o.projectId === query.character)),
    );
    const offset = Number(query.offset || 0),
      limit = 100;
    return {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
      body: {
        items: filtered.slice(offset, offset + limit).map((e) => ({
          id: e.id,
          code: e.code,
          sourceProjectId: e.origins[0]?.projectId,
          category: e.category,
          kind: e.kind,
          label: e.item.label,
          sourceName: [...new Set(e.origins.map((o) => o.name))].join(', '),
          image: `/api/files/prop-library/${e.id}/image`,
        })),
        total: filtered.length,
        nextOffset: offset + limit < filtered.length ? offset + limit : null,
        characters,
        groups,
      },
    };
  }
  function image({ params = {} } = {}) {
    if (!security.UUID.test(params.libraryId)) throw security.fail('Pieza inválida.');
    const entry = read().items.find((e) => e.id === params.libraryId && e.status !== 'purged');
    if (!entry) throw security.fail('La pieza ya no está disponible.', 404);
    return { path: file(entry), type: entry.type };
  }
  const get = (id) => {
    if (!security.UUID.test(id)) throw security.fail('Pieza inválida.');
    return sync().items.find((e) => e.id === id && e.status === 'active');
  };
  const resolveCode = (code) => {
    if (!normalizeCode(code)) throw security.fail('Código de pieza inválido.');
    const entry = sync().items.find((e) => codeKey(e.code) === codeKey(code) && e.status !== 'purged');
    if (!entry) throw security.fail('No se encontró esa pieza en la biblioteca.', 404);
    return {
      id: entry.id,
      code: entry.code,
      status: entry.status,
      category: entry.category,
      kind: entry.kind,
      label: entry.item.label,
      sourceName: [...new Set(entry.origins.map((o) => o.name))].join(', '),
    };
  };
  const search = (query, category = '') => {
    const normal = (value) =>
      value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
    const term = normal(query).trim();
    return sync()
      .items.filter(
        (e) =>
          e.status === 'active' &&
          (!query.trim().startsWith('#') || codeKey(e.code) === codeKey(query)) &&
          (!category || e.category === category) &&
          normal(
            `#${e.code} ${e.item.label} ${e.item.description} ${e.origins.map((o) => o.name).join(' ')}`,
          ).includes(term),
      )
      .slice(0, 100)
      .map((e) => ({
        libraryId: e.id,
        code: e.code,
        category: e.category,
        kind: e.kind,
        label: e.item.label,
        description: e.item.description,
      }));
  };
  function rename({ body = {} } = {}) {
    if (
      Object.keys(body).some(
        (k) => !['libraryId', 'projectId', 'assetId', 'image', 'code', 'expectedCode'].includes(k),
      ) ||
      !normalizeCode(body.code) ||
      !normalizeCode(body.expectedCode)
    )
      throw security.fail('Tag inválido. Usa de 1 a 64 letras, números, guiones o guion bajo.');
    const data = sync();
    let entry;
    if (body.libraryId) {
      if (!security.UUID.test(body.libraryId)) throw security.fail('Pieza inválida.');
      entry = data.items.find((e) => e.id === body.libraryId);
    } else {
      if (!security.UUID.test(body.projectId) || !/^asset_[A-Za-z0-9_-]{1,100}$/.test(body.assetId || ''))
        throw security.fail('Pieza inválida.');
      const project = readProject(body.projectId);
      if (project?.type !== 'character') throw security.fail('Personaje no disponible.', 404);
      entry = data.items.find((e) =>
        e.origins.some((o) => o.projectId === body.projectId && o.image === body.image),
      );
      if (
        ![
          ...(project.characterVisualLibrary?.items || []),
          ...(project.characterVisualLibrary?.trash || []),
        ].some((i) => i.id === body.assetId && i.image === body.image)
      )
        entry = null;
    }
    if (!entry || entry.status === 'purged') throw security.fail('La pieza ya no está disponible.', 409);
    if (entry.code !== normalizeCode(body.expectedCode))
      throw security.fail('El tag cambió en otra vista. Actualiza la biblioteca.', 409);
    const code = normalizeCode(body.code);
    if (
      data.items.some((e) => e.id !== entry.id && e.status !== 'purged' && codeKey(e.code) === codeKey(code))
    )
      throw security.fail('Ese tag ya está en uso. Se conserva el anterior.', 409);
    entry.code = code;
    save(data);
    return { status: 200, body: { id: entry.id, code } };
  }
  return { list, change, image, get, file, alias, decorate, beforeDelete, resolveCode, search, rename };
}
module.exports = { createUniversalPropStore };
