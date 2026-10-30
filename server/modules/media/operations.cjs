// Application operations with explicit storage/provider dependencies.
function createFileOperations(dependencies) {
  const { assertProject, fs, path, security, PROJECTS_DIR, uuidv4, ensureDir, readJSON } = dependencies;

  function prepareUpload({ params = {}, body, headers = {}, query = {} } = {}) {
    const responseHeaders = {};
    const reply = (body, status = 200) => ({ body, status, headers: responseHeaders });
    assertProject(body?.projectId || params.projectId);

    try {
      const contentDir = path.join(PROJECTS_DIR, params.projectId, 'content');
      ensureDir(contentDir);

      return reply({ success: true, message: 'Upload endpoint ready' }, 200);
    } catch (err) {
      console.error('POST /api/files/upload error:', err);
      return reply({ error: err.status ? err.message : 'Upload failed' }, err.status || 500);
    }
  }

  function uploadImage({ params = {}, body, headers = {}, query = {} } = {}) {
    const responseHeaders = {};
    const reply = (body, status = 200) => ({ body, status, headers: responseHeaders });
    assertProject(body?.projectId || params.projectId);

    try {
      const { projectId } = params;
      const { fileData, filename, replaceFace } = body;

      if (!fileData) {
        return reply({ error: 'No file data provided' }, 400);
      }

      const { buffer: imageBuffer, type } = security.decodeImage(fileData);
      const contentDir = security.containedPath(PROJECTS_DIR, projectId, 'content');
      ensureDir(contentDir);

      let finalFilename = `upload-${uuidv4()}.${type}`;
      if (filename) {
        if (typeof filename !== 'string' || !security.IMAGE_NAME.test(filename) || filename.includes('..'))
          return reply({ error: 'Invalid filename' }, 400);
        const ext = path.extname(filename).slice(1).toLowerCase().replace('jpeg', 'jpg');
        if (ext !== type) return reply({ error: 'Filename does not match image type' }, 400);
        finalFilename = filename;
      }

      const filepath = security.containedPath(PROJECTS_DIR, projectId, 'content', finalFilename);

      if (replaceFace !== undefined && replaceFace !== true)
        throw security.fail('Reemplazo de rostro inválido');
      if (replaceFace) {
        const project = readJSON(security.containedPath(PROJECTS_DIR, projectId, 'meta.json'), {});
        const faceNames = (project.covers || [])
          .filter((url) => url.startsWith(`/projects/${projectId}/content/`))
          .map(
            (url) =>
              path
                .basename(url)
                .replace(/\.[^.]+$/, '')
                .replace(/-face$/, '') + '-face.png',
          );
        if (project.type !== 'character' || type !== 'png' || !faceNames.includes(finalFilename)) {
          throw security.fail('Solo se puede reemplazar el recorte de un retrato del personaje.');
        }
        const temporary = security.containedPath(PROJECTS_DIR, projectId, 'content', `face-${uuidv4()}.tmp`);
        try {
          fs.writeFileSync(temporary, imageBuffer, { flag: 'wx' });
          fs.renameSync(temporary, filepath);
        } finally {
          if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
        }
      } else
        try {
          fs.writeFileSync(filepath, imageBuffer, { flag: 'wx' });
        } catch (error) {
          if (error.code === 'EEXIST')
            throw security.fail('Ya existe una imagen con ese nombre; el archivo original se conservó.', 409);
          throw error;
        }
      const imageUrl = `/projects/${projectId}/content/${finalFilename}`;

      console.log(`Saved uploaded base64 image to ${filepath}`);
      return reply({ success: true, imageUrl }, 200);
    } catch (err) {
      console.error('POST /api/files/upload-base64 error:', err);
      return reply({ error: err.status ? err.message : 'Upload failed' }, err.status || 500);
    }
  }

  function deleteFile({ params = {}, body, headers = {}, query = {} } = {}) {
    const responseHeaders = {};
    const reply = (body, status = 200) => ({ body, status, headers: responseHeaders });
    assertProject(body?.projectId || params.projectId);

    try {
      const { projectId, filePath } = body;
      if (!projectId || !filePath) {
        return reply({ error: 'Missing projectId or filePath' }, 400);
      }

      // Safety validation: ensure it's a valid UUID
      if (!security.UUID.test(projectId)) {
        return reply({ error: 'Invalid projectId' }, 400);
      }

      // Safety validation: filePath must start with /projects/:projectId/content/
      const prefix = `/projects/${projectId}/content/`;
      if (!filePath.startsWith(prefix)) {
        return reply({ error: 'Invalid file path prefix' }, 400);
      }

      const fileName = filePath.substring(prefix.length);
      // Prevent directory traversal attacks
      if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
        return reply({ error: 'Invalid file name' }, 400);
      }

      if (!security.IMAGE_NAME.test(fileName)) return reply({ error: 'Invalid image filename' }, 400);
      const localPath = security.containedPath(PROJECTS_DIR, projectId, 'content', fileName);
      if (fs.existsSync(localPath)) {
        fs.unlinkSync(localPath);
        console.log(`Deleted file physically: ${localPath}`);
      }

      // Also delete the corresponding face file if it exists
      const ext = path.extname(fileName);
      const base = path.basename(fileName, ext);
      const faceFilename = `${base}-face${ext}`;
      const faceLocalPath = security.containedPath(PROJECTS_DIR, projectId, 'content', faceFilename);
      if (fs.existsSync(faceLocalPath)) {
        fs.unlinkSync(faceLocalPath);
        console.log(`Deleted face file physically: ${faceLocalPath}`);
      }

      return reply({ success: true }, 200);
    } catch (err) {
      console.error('POST /api/files/delete error:', err);
      return reply({ error: 'Delete failed' }, 500);
    }
  }

  function listFiles({ params = {}, body, headers = {}, query = {} } = {}) {
    const responseHeaders = {};
    const reply = (body, status = 200) => ({ body, status, headers: responseHeaders });
    assertProject(body?.projectId || params.projectId);

    try {
      const contentDir = path.join(PROJECTS_DIR, params.projectId, 'content');

      if (!fs.existsSync(contentDir)) {
        return reply({ files: [] }, 200);
      }

      const files = fs.readdirSync(contentDir);
      return reply({ files }, 200);
    } catch (err) {
      console.error('GET /api/files/:projectId error:', err);
      return reply({ error: 'Failed to list files' }, 500);
    }
  }
  return { prepareUpload, uploadImage, deleteFile, listFiles };
}
module.exports = { createFileOperations };
