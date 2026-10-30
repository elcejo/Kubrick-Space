/** Immutable ingredient sources. Drafts are offered only before the first permanent save. */
export async function loadIngredientVersions(api, projectId) {
  const [project, entries] = await Promise.all([
    api.getProject(projectId),
    api.getDocumentVersions(projectId),
  ]);
  const versions = entries.slice().sort((a, b) => b.number - a.number);
  return { project, versions };
}

export async function readIngredientVersion(api, catalogue, versionId = null) {
  const { project, versions } = catalogue;
  if (versions.length) {
    const entry = versions.find((version) => version.id === (versionId || versions[0].id));
    if (!entry) throw new Error('La versión elegida ya no está disponible.');
    const version = await api.getDocumentVersion(project.id, entry.id);
    if (!version?.snapshot || version.id !== entry.id)
      throw new Error('La versión no contiene una ficha válida.');
    return {
      project: { ...project, ...version.snapshot },
      source: 'version',
      versionId: version.id,
      versionNumber: version.number,
      savedAt: version.savedAt,
    };
  }
  if (versionId) throw new Error('La versión elegida ya no está disponible.');
  const draft = await api.getProjectDraft(project.id);
  if ((await api.getDocumentVersions(project.id)).length)
    throw new Error('El libro ya tiene versiones guardadas. Vuelve a seleccionarlo.');
  return { project: { ...project, ...(draft?.payload || {}) }, source: 'draft' };
}

export function ingredientContent(ingredient) {
  if (ingredient.type !== 'character') return ingredient.value || '';
  try {
    return JSON.parse(ingredient.value || '{}').content || '';
  } catch {
    return '';
  }
}

export function ingredientVersionLabel(ingredient) {
  if (ingredient.importedSource === 'version') return `Versión ${ingredient.importedVersionNumber}`;
  return ingredient.importedSource === 'draft' ? 'Borrador inicial' : 'Contenido sin versión registrada';
}

/** Cards display the selected document's words, never its storage keys. */
export function ingredientPreviewText(ingredient) {
  const content = ingredientContent(ingredient);
  let value;
  try {
    value = JSON.parse(content);
  } catch {
    return content.replace(/<[^>]*>/g, '').trim();
  }
  if (value?.schema === 'code-kai.scenario')
    return [value.identity?.name, value.description, ...Object.values(value.fields || {})]
      .filter((part) => typeof part === 'string' && part.trim())
      .join(' ');
  if (value?.schema === 'code-kai.screenplay')
    return [
      value.title?.text,
      ...value.preamble.map((block) => block.text),
      ...value.scenes.flatMap((scene) => [scene.heading.text, ...scene.blocks.map((block) => block.text)]),
    ]
      .filter(Boolean)
      .join(' ');
  if (value?.schema === 'code-kai.story-book')
    return [
      value.title?.text,
      ...value.chapters.flatMap((chapter) => [
        chapter.title?.text,
        ...chapter.themes.flatMap((theme) => [
          theme.title?.text,
          ...theme.paragraphs.map((paragraph) => paragraph.text),
        ]),
      ]),
    ]
      .filter(Boolean)
      .join(' ');
  return content.replace(/<[^>]*>/g, '').trim();
}

/** Keep local activation/colors; replace only the selected source snapshot and its provenance. */
export function applyIngredientVersion(ingredient, source, label, mappedTraits) {
  const project = source.project;
  if (ingredient.importedProjectId && ingredient.importedProjectId !== project.id) {
    for (const key of ['lastAdaptedVersionId', 'lastAdaptedVersionNumber', 'lastAdaptedContent'])
      delete ingredient[key];
  }
  ingredient.importedProjectId = project.id;
  ingredient.importedProjectName = project.name;
  ingredient.label = label;
  ingredient.importedSource = source.source;
  for (const key of ['importedVersionId', 'importedVersionNumber', 'importedVersionSavedAt'])
    delete ingredient[key];
  if (source.source === 'version') {
    ingredient.importedVersionId = source.versionId;
    ingredient.importedVersionNumber = source.versionNumber;
    ingredient.importedVersionSavedAt = source.savedAt;
  }
  ingredient.value =
    ingredient.type === 'character'
      ? JSON.stringify({
          name: project.name,
          role: label,
          traits: mappedTraits || project.traits || {},
          content: project.content || '',
          covers: project.covers || [],
          currentCoverIndex: project.currentCoverIndex,
        })
      : project.content || '';
  ingredient.covers = project.covers || [];
  ingredient.currentCoverIndex = project.currentCoverIndex ?? -1;
  return ingredient;
}

export function ingredientHasNewVersion(ingredient, catalogue) {
  const latest = catalogue?.versions[0];
  const selected = catalogue?.versions.find((entry) => entry.id === ingredient.importedVersionId);
  return Boolean(latest && latest.number > (selected?.number || 0));
}
