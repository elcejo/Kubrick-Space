function createImageStorage({
  security,
  PROJECTS_DIR,
  assertProject,
  fs,
  path,
  ensureDir,
  uuidv4,
  fetchImpl = (...args) => fetch(...args),
  backgroundSignal,
  appRoot,
  referenceAssets = [],
}) {
  function referenceImage(projectId, filename) {
    assertProject(projectId);
    if (!security.IMAGE_NAME.test(filename)) throw security.fail('Invalid reference filename');
    const localPath = security.containedPath(PROJECTS_DIR, projectId, 'content', filename);
    if (fs.statSync(localPath).size > security.MAX_IMAGE_BYTES)
      throw security.fail('Reference image too large', 413);
    const buffer = fs.readFileSync(localPath);
    const type = security.imageType(buffer);
    return `data:image/${type === 'jpg' ? 'jpeg' : type};base64,${buffer.toString('base64')}`;
  }
  function saveGeneratedImage(projectId, buffer, prefix = 'cover') {
    backgroundSignal?.throwIfAborted();
    assertProject(projectId);
    if (!['cover', 'muse'].includes(prefix)) throw security.fail('Invalid generated media prefix');
    const contentDir = security.containedPath(PROJECTS_DIR, projectId, 'content');
    ensureDir(contentDir);
    const filename = `${prefix}-${uuidv4()}.${security.imageType(buffer)}`;
    fs.writeFileSync(path.join(contentDir, filename), buffer, { flag: 'wx' });
    return `/projects/${projectId}/content/${filename}`;
  }
  async function saveImageLocally(projectId, remoteUrl) {
    try {
      assertProject(projectId);
      const contentDir = security.containedPath(PROJECTS_DIR, projectId, 'content');
      ensureDir(contentDir);
      const remote = new URL(remoteUrl);
      if (
        remote.protocol !== 'https:' ||
        remote.username ||
        remote.password ||
        (remote.port && remote.port !== '443') ||
        !(
          remote.hostname === 'replicate.delivery' ||
          remote.hostname.endsWith('.replicate.delivery') ||
          remote.hostname === 'images.unsplash.com'
        )
      )
        throw security.fail('Unsupported image download host');
      const response = await fetchImpl(remoteUrl, { redirect: 'error', signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      if (Number(response.headers.get('content-length')) > security.MAX_IMAGE_BYTES)
        throw security.fail('Image too large', 413);
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > security.MAX_IMAGE_BYTES) throw security.fail('Image too large', 413);
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);
      backgroundSignal?.throwIfAborted();
      const filename = `cover-${uuidv4()}.${security.imageType(buffer)}`;
      const filepath = path.join(contentDir, filename);
      fs.writeFileSync(filepath, buffer);

      return `/projects/${projectId}/content/${filename}`;
    } catch (err) {
      console.error('Error saving image locally:', err);
      throw err;
    }
  }

  function referenceAsset(asset) {
    if (!referenceAssets.includes(asset)) throw security.fail('Referencia de soporte inválida.');
    const file = security.containedPath(
      path.join(appRoot, 'public', 'assets', 'references'),
      path.basename(asset),
    );
    const buffer = fs.readFileSync(file);
    if (buffer.length > security.MAX_IMAGE_BYTES)
      throw security.fail('Referencia de soporte demasiado grande.', 413);
    return `data:image/png;base64,${buffer.toString('base64')}`;
  }
  return { saveImageLocally, referenceImage, referenceAsset, saveGeneratedImage };
}
module.exports = { createImageStorage };
