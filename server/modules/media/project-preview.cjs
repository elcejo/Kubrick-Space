const fs = require('node:fs');

/** Read-only library artwork projection. Persisted covers and revisions remain untouched. */
function createProjectPreview({
  PROJECTS_DIR,
  security,
  readDraft = () => null,
  decorateArtwork = (p) => p,
}) {
  const available = (url) => {
    if (typeof url !== 'string') return false;
    if (/^https:\/\//i.test(url)) return true;
    const match = /^\/projects\/([^/]+)\/content\/([^/]+)$/.exec(url);
    if (!match || !security.UUID.test(match[1]) || !security.IMAGE_NAME.test(match[2])) return false;
    try {
      return fs.statSync(security.containedPath(PROJECTS_DIR, match[1], 'content', match[2])).isFile();
    } catch {
      return false;
    }
  };
  return (project) => {
    const draft = readDraft(project.id)?.payload;
    const current = decorateArtwork(draft ? { ...project, ...draft } : project);
    const covers = Array.isArray(current.covers) ? current.covers : [];
    const previewImage = [covers[current.currentCoverIndex], ...covers].find(available) || '';
    let previewFaceImage = '';
    if (project.type === 'character' && previewImage.startsWith('/projects/')) {
      const png = previewImage.replace(/\.[a-z0-9]+$/i, '-face.png');
      const legacy = previewImage.replace(/(\.[a-z0-9]+)$/i, '-face$1');
      previewFaceImage = [png, legacy].find(available) || '';
    }
    return {
      ...project,
      ...(project.category === 'screenplay'
        ? { name: current.name, covers: current.covers, currentCoverIndex: 0 }
        : {}),
      previewImage,
      previewFaceImage,
    };
  };
}
module.exports = { createProjectPreview };
