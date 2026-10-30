const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const security = require('../security/index.cjs').security;
const { DOCUMENT_FIELDS: documentFields } = require('../../../public/js/contracts/document-draft.js');
const { parseCharacterDocument } = require('../../../public/js/contracts/character-model.js');
const {
  validateCharacterVisualLibrary,
} = require('../../../public/js/contracts/character-visual-library.js');

const DOCUMENT_FIELDS = new Set(documentFields);

function createDocumentStore(projectsDir, { preparePayload = (id, payload) => payload } = {}) {
  const fileFor = (projectId, file) => {
    if (!security.UUID.test(projectId) || !['document-draft.json', 'document-versions.json'].includes(file)) {
      throw security.fail('Ruta de documento inválida.');
    }
    return security.containedPath(projectsDir, projectId, file);
  };

  const readJSON = (projectId, file, fallback) => {
    try {
      return JSON.parse(fs.readFileSync(fileFor(projectId, file), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return fallback;
      throw error;
    }
  };

  const atomicWrite = (file, value) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
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
  };

  const validatePayload = (value, projectId) => {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).some((key) => !DOCUMENT_FIELDS.has(key))
    ) {
      throw security.fail('El borrador contiene campos no permitidos.');
    }
    if (value.content !== undefined && typeof value.content !== 'string')
      throw security.fail('El contenido del documento no es válido.');
    if (value.name !== undefined && typeof value.name !== 'string')
      throw security.fail('El nombre del documento no es válido.');
    const validated = security.validateProject(value, true);
    if (validated.characterMediaDeletions?.some((url) => !url.startsWith(`/projects/${projectId}/content/`)))
      throw security.fail('El registro de eliminación contiene imágenes de otro proyecto.');
    if (validated.characterVisualLibrary) {
      try {
        validateCharacterVisualLibrary(validated.characterVisualLibrary, projectId);
      } catch {
        throw security.fail('Los componentes visuales deben pertenecer a este personaje.');
      }
    }
    if (validated.characterImageTrash?.some((url) => !url.startsWith(`/projects/${projectId}/content/`)))
      throw security.fail('La papelera contiene una imagen de otro proyecto.');
    if (
      validated.lastCharacterImage &&
      !validated.lastCharacterImage.startsWith(`/projects/${projectId}/content/`)
    )
      throw security.fail('La referencia visual pertenece a otro proyecto.');
    const character = parseCharacterDocument(validated.content || '');
    if (character && character.id !== projectId)
      throw security.fail('La ficha de personaje pertenece a otro proyecto.');
    return preparePayload(projectId, validated);
  };

  const getDraft = (projectId) => readJSON(projectId, 'document-draft.json', null);

  const saveDraft = (projectId, payload, expectedRevision) => {
    const previous = getDraft(projectId);
    const revision = previous?.revision || 0;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== revision) {
      throw security.fail(
        'El borrador cambió en otra pestaña. Abre de nuevo el proyecto para continuar.',
        409,
      );
    }
    const draft = {
      revision: revision + 1,
      savedAt: new Date().toISOString(),
      payload: validatePayload(payload, projectId),
    };
    atomicWrite(fileFor(projectId, 'document-draft.json'), draft);
    return draft;
  };

  const getVersions = (projectId) => {
    const versions = readJSON(projectId, 'document-versions.json', []);
    if (!Array.isArray(versions)) throw new Error('El historial de versiones tiene un formato inválido.');
    return versions;
  };

  const createVersion = (projectId, payload) => {
    const versions = getVersions(projectId);
    const nextNumber = versions.reduce((latest, item) => Math.max(latest, Number(item.number) || 0), 0) + 1;
    const snapshot = validatePayload(payload, projectId);
    const version = {
      id: randomUUID(),
      number: nextNumber,
      name: snapshot.name || 'Sin título',
      savedAt: new Date().toISOString(),
      snapshot,
    };
    return { versions: [...versions, version], version };
  };

  const listVersions = (projectId) =>
    getVersions(projectId)
      .slice()
      .sort((a, b) => b.number - a.number)
      .map(({ snapshot, ...version }) => ({ ...version, contentLength: snapshot?.content?.length || 0 }));

  const getVersion = (projectId, versionId) =>
    getVersions(projectId).find((version) => version.id === versionId) || null;

  return { getDraft, saveDraft, getVersions, listVersions, getVersion, createVersion };
}

module.exports = { createDocumentStore };
