/**
 * Linking a project brings its own ingredients into view: a book that already has its characters and places linked
 * should not leave a screenplay built on it without them. Pure helpers; the dialog and the linking live elsewhere.
 */

const TYPE_LABELS = Object.freeze({
  character: 'Personaje',
  stage: 'Escenario',
  book: 'Libro',
  song: 'Música',
  video: 'Metraje',
});
export const ingredientTypeLabel = (type) => TYPE_LABELS[type] || 'Ingrediente';

/**
 * Ingredients of the project being linked that the project receiving it does not have yet: active, pointing to a
 * project, not the receiving project itself and not already linked there. Each project appears once.
 */
export function relatedIngredients(source, ingredients, projectId) {
  const have = new Set((ingredients || []).map((item) => item.importedProjectId).filter(Boolean));
  const seen = new Set();
  const found = [];
  for (const item of source?.project?.ingredients || []) {
    const id = item?.importedProjectId;
    if (!item || item.active === false || !id || id === projectId || have.has(id) || seen.has(id)) continue;
    seen.add(id);
    found.push({
      id,
      name: String(item.importedProjectName || item.label || 'Sin nombre'),
      type: item.type,
      role: String(item.label || ''),
    });
  }
  return found;
}
