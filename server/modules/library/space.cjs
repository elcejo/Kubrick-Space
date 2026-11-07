const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
/** Logical project folders reference existing assets; no content or media is moved. */
function createLibrarySpace({ ROOT_DIR, repository, security }) {
  const file = path.join(ROOT_DIR, 'library-space.json');
  const defaults = () => ({
    schema: 'kubrick.library-space',
    version: 1,
    revision: 0,
    profile: { displayName: 'Mi espacio', handle: 'creador', bio: '' },
    folders: [],
  });
  function read() {
    try {
      if (fs.lstatSync(file).isSymbolicLink()) throw security.fail('La biblioteca no admite enlaces.', 409);
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (
        value.schema !== 'kubrick.library-space' ||
        value.version !== 1 ||
        !Number.isSafeInteger(value.revision) ||
        !Array.isArray(value.folders)
      )
        throw security.fail('Formato de biblioteca inválido.', 409);
      return value;
    } catch (error) {
      if (error.code === 'ENOENT') return defaults();
      throw error;
    }
  }
  function save(value) {
    value.revision++;
    const temporary = file + '.' + randomUUID() + '.tmp';
    let fd;
    try {
      fd = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(fd, JSON.stringify(value, null, 2), 'utf8');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(temporary, file);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    return snapshot();
  }
  function snapshot() {
    const value = read(),
      ids = new Set(
        repository
          .read()
          .projects.filter((p) => !p.deletedAt)
          .map((p) => p.id),
      );
    return {
      ...value,
      folders: value.folders.map((folder) => ({
        ...folder,
        assetIds: folder.assetIds.filter((id) => ids.has(id)),
      })),
    };
  }
  function input(body, keys) {
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => !['revision', ...keys].includes(key)) ||
      !Number.isSafeInteger(body.revision)
    )
      throw security.fail('Datos de biblioteca inválidos.');
    const value = read();
    if (body.revision !== value.revision)
      throw security.fail('La biblioteca cambió. Actualiza y vuelve a intentar.', 409);
    return value;
  }
  const text = (value, max, empty = false) => {
    if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()))
      throw security.fail('Texto de biblioteca inválido.');
    return value.trim();
  };
  function assets(value) {
    const ids = new Set(
      repository
        .read()
        .projects.filter((p) => !p.deletedAt)
        .map((p) => p.id),
    );
    if (
      !Array.isArray(value) ||
      value.length > 5000 ||
      new Set(value).size !== value.length ||
      value.some((id) => typeof id !== 'string' || !security.UUID.test(id) || !ids.has(id))
    )
      throw security.fail('La carpeta contiene un asset no disponible.');
    return [...value];
  }
  function folder(value, id) {
    const found = value.folders.find((f) => f.id === id);
    if (!security.UUID.test(id || '') || !found) throw security.fail('Carpeta no encontrada.', 404);
    return found;
  }
  return {
    get: () => ({ status: 200, body: snapshot() }),
    create({ body }) {
      const value = input(body, ['name', 'assetIds']);
      if (value.folders.length >= 500) throw security.fail('La biblioteca admite 500 carpetas.', 409);
      const now = new Date().toISOString();
      value.folders.push({
        id: randomUUID(),
        name: text(body.name, 100),
        color: '#7819ff',
        assetIds: assets(body.assetIds || []),
        createdAt: now,
        updatedAt: now,
      });
      return { status: 201, body: save(value) };
    },
    update({ params, body }) {
      const value = input(body, ['name', 'color', 'assetIds']),
        target = folder(value, params.id);
      if (body.name !== undefined) target.name = text(body.name, 100);
      if (body.color !== undefined) {
        if (typeof body.color !== 'string' || !/^#[a-f0-9]{6}$/i.test(body.color))
          throw security.fail('Color inválido.');
        target.color = body.color;
      }
      if (body.assetIds !== undefined) target.assetIds = assets(body.assetIds);
      target.updatedAt = new Date().toISOString();
      return { status: 200, body: save(value) };
    },
    remove({ params, body }) {
      const value = input(body, []);
      folder(value, params.id);
      value.folders = value.folders.filter((f) => f.id !== params.id);
      return { status: 200, body: save(value) };
    },
    assign({ params, body }) {
      const value = input(body, ['folderIds']);
      assets([params.id]);
      if (
        !Array.isArray(body.folderIds) ||
        new Set(body.folderIds).size !== body.folderIds.length ||
        body.folderIds.length > 500
      )
        throw security.fail('Carpetas inválidas.');
      body.folderIds.forEach((id) => folder(value, id));
      const selected = new Set(body.folderIds);
      for (const item of value.folders) {
        item.assetIds = item.assetIds.filter((id) => id !== params.id);
        if (selected.has(item.id)) item.assetIds.push(params.id);
      }
      return { status: 200, body: save(value) };
    },
    profile({ body }) {
      const value = input(body, ['displayName', 'handle', 'bio']);
      if (body.displayName !== undefined) value.profile.displayName = text(body.displayName, 80);
      if (body.handle !== undefined) {
        const handle = text(body.handle, 40).replace(/^@/, '');
        if (!/^[\p{L}\p{N}_.-]+$/u.test(handle)) throw security.fail('Nombre de usuario inválido.');
        value.profile.handle = handle;
      }
      if (body.bio !== undefined) value.profile.bio = text(body.bio, 500, true);
      return { status: 200, body: save(value) };
    },
  };
}
module.exports = { createLibrarySpace };
