const {
  parseCharacterDocument,
  legacyCharacterDocument,
} = require('../../../public/js/contracts/character-model.js');
function characterDocumentForProject(project, security) {
  const document = parseCharacterDocument(project.content || '');
  if (document) return document;
  const text = security
    .cleanHTML(project.content || '')
    .replace(/<\/(?:p|div|h[1-6]|li)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(
      /&(?:amp|lt|gt|quot|apos|nbsp);/g,
      (entity) =>
        ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' })[entity],
    )
    .trim();
  return legacyCharacterDocument(project, { legacyText: text });
}
module.exports = { characterDocumentForProject };
