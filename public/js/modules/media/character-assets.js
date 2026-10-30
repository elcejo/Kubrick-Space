import { API } from '../../api-service.js';
import { AppState } from '../../app-state.js';
import { EventBus } from '../../event-bus.js';
import { updateDocumentDraft } from '../documents/document-draft.js';
import {
  parseCharacterDocument,
  characterAppearanceKey,
  characterVisualLibraryCurrent,
  validateCharacterVisualLibrary,
  characterAssetPrompt,
  characterAssetReferences,
  characterAssetSlot,
  characterOutfitSelectionMap,
  selectCharacterAsset,
  removeCharacterSelectionIds,
  characterSelectionIds,
  characterVisualLibraryNeedsAudit,
  characterRequestedTraits,
  reconcileCharacterVisualLibrary,
  rememberCharacterPortraitOutfit,
  preserveCharacterAssetGroup,
} from '../characters/character-model.js';
import { saveGeneratedImage } from './generated-media.js';

/** Parallel inference with serialized draft commits; retry keeps finished pieces. */
export async function generateCharacterAssets(
  projectId,
  { signal, engine, refreshAssets = false, onProgress = () => {} } = {},
) {
  await EventBus.emitAsync?.('autosave:flush');
  signal?.throwIfAborted();
  const project = AppState.currentProject;
  const document = parseCharacterDocument(project.content);
  const sourceImage = project.covers?.[project.currentCoverIndex] || project.covers?.[0];
  if (project.id !== projectId || !sourceImage || !document)
    throw Error('Primero genera la imagen principal del personaje.');
  if (!engine?.provider || !engine?.model)
    throw Error('Selecciona el motor de imágenes del personaje antes de generar sus piezas.');
  const sourceKey = characterAppearanceKey(document);
  const requestedTraits = JSON.stringify(characterRequestedTraits(document));
  const assertCurrent = (current) => {
    signal?.throwIfAborted();
    if (
      AppState.currentProject?.id !== projectId ||
      (current.covers?.[current.currentCoverIndex] || current.covers?.[0]) !== sourceImage ||
      characterAppearanceKey(parseCharacterDocument(current.content)) !== sourceKey ||
      JSON.stringify(characterRequestedTraits(parseCharacterDocument(current.content))) !== requestedTraits
    )
      throw Error('La apariencia principal cambió. Actualiza las piezas con el retrato vigente.');
  };
  const publish = (updated) => {
    if (AppState.currentProject?.id === projectId) {
      AppState.currentProject.characterVisualLibrary = updated.characterVisualLibrary;
      EventBus.emit('editor:change');
    }
    return updated.characterVisualLibrary;
  };
  let library = project.characterVisualLibrary;
  let inventoryIds;
  if (
    refreshAssets ||
    !characterVisualLibraryCurrent(project, document) ||
    library?.format !== 'square-v2' ||
    characterVisualLibraryNeedsAudit(library, document)
  ) {
    onProgress('Analizando rasgos, prendas y accesorios…');
    const response = await API.prepareCharacterVisualLibrary(
      { projectId, document, sourceImage },
      { signal },
    );
    signal?.throwIfAborted();
    library = validateCharacterVisualLibrary(response.library, projectId);
    if (refreshAssets) inventoryIds = new Set(library.items.map((item) => item.id));
    library.format = 'square-v2';
    if (library.sourceImage !== sourceImage || library.sourceKey !== sourceKey)
      throw Error('El desglose no corresponde al retrato vigente.');
    library = publish(
      await updateDocumentDraft(projectId, (current) => {
        assertCurrent(current);
        library = reconcileCharacterVisualLibrary(library, current.characterVisualLibrary, projectId, {
          reuseImages: !refreshAssets,
        });
        return { characterVisualLibrary: library };
      }),
    );
  }
  const pending = library.items.filter((item) => !item.image && (!inventoryIds || inventoryIds.has(item.id)));
  const progress = { completed: 0, failed: 0, total: pending.length };
  onProgress(`Generando props · 0 de ${pending.length}`, progress);
  const results = await Promise.allSettled(
    pending.map(async (item) => {
      assertCurrent(AppState.currentProject);
      try {
        const response = await API.aiImage(
          {
            projectId,
            prompt: characterAssetPrompt(item),
            aspectRatio: '1:1',
            imageType: 'character',
            backend: 'api',
            inputImages: characterAssetReferences(item, sourceImage),
            provider: engine.provider,
            model: engine.model,
          },
          { signal },
        );
        signal?.throwIfAborted();
        if (!response?.imageUrl) throw Error('No se recibió la imagen de esta pieza.');
        const updated = await saveGeneratedImage(
          projectId,
          response.imageUrl,
          {},
          { characterAsset: { id: item.id, sourceImage, sourceKey } },
        );
        publish(updated);
        progress.completed++;
        onProgress(`Props recibidos · ${progress.completed} de ${pending.length}`, { ...progress });
      } catch (error) {
        signal?.throwIfAborted();
        // A failed part never rolls back a completed portrait or a successful part.
        publish(
          await updateDocumentDraft(projectId, (current) => {
            assertCurrent(current);
            const latest = validateCharacterVisualLibrary(current.characterVisualLibrary, projectId);
            if (latest.sourceImage !== sourceImage || latest.sourceKey !== sourceKey)
              throw Error('La biblioteca visual cambió.');
            latest.items = latest.items.map((entry) =>
              entry.id === item.id
                ? { ...entry, error: 'No se pudo generar esta pieza. Puedes reintentar.' }
                : entry,
            );
            return { characterVisualLibrary: latest };
          }),
        );
        progress.failed++;
        onProgress(
          `Props recibidos · ${progress.completed} de ${pending.length} · ${progress.failed} pendientes de reintento`,
          { ...progress },
        );
        throw error;
      }
    }),
  );
  signal?.throwIfAborted();
  const failed = results.find((result) => result.status === 'rejected');
  if (failed) throw failed.reason;
  assertCurrent(AppState.currentProject);
  return AppState.currentProject.characterVisualLibrary;
}

/** Replace one extraction, retaining the previous file in the outfit trash. */
export async function regenerateCharacterAsset(projectId, { id, referenceImage, signal, engine }) {
  await EventBus.emitAsync?.('autosave:flush');
  signal?.throwIfAborted();
  const project = AppState.currentProject;
  if (project?.id !== projectId || project.type !== 'character') throw Error('El personaje activo cambió.');
  const document = parseCharacterDocument(project.content);
  const library = validateCharacterVisualLibrary(project.characterVisualLibrary, projectId);
  const item = library?.items.find((entry) => entry.id === id);
  if (!item?.image || !characterVisualLibraryCurrent(project, document))
    throw Error('Actualiza las piezas con el retrato vigente antes de regenerar.');
  if (!engine?.provider || !engine?.model) throw Error('Selecciona el motor de imágenes del personaje.');
  if ((library.trash || []).length >= 500) throw Error('La papelera de piezas está llena.');
  const original = document.creation.mode === 'image' ? document.creation.referenceImage : '';
  if (![library.sourceImage, original].filter(Boolean).includes(referenceImage))
    throw Error('La referencia debe ser el retrato actual o la fotografía original de este personaje.');
  const response = await API.aiImage(
    {
      projectId,
      prompt: characterAssetPrompt(item),
      aspectRatio: '1:1',
      imageType: 'character',
      backend: 'api',
      inputImages: characterAssetReferences(item, referenceImage),
      provider: engine.provider,
      model: engine.model,
    },
    { signal },
  );
  signal?.throwIfAborted();
  if (!response?.imageUrl) throw Error('No se recibió la imagen de esta pieza. La anterior se conserva.');
  // saveGeneratedImage keeps a recovery receipt if navigation or concurrent edits prevent adoption.
  return saveGeneratedImage(
    projectId,
    response.imageUrl,
    {},
    {
      characterAsset: {
        id,
        sourceImage: library.sourceImage,
        sourceKey: library.sourceKey,
        replaceImage: item.image,
        discardedId: 'asset_' + crypto.randomUUID(),
      },
    },
  );
}

export async function importSharedCharacterAsset(projectId, action) {
  await EventBus.emitAsync?.('autosave:flush');
  const project = AppState.currentProject;
  if (project?.id !== projectId) throw Error('El personaje activo cambió.');
  const library = validateCharacterVisualLibrary(project.characterVisualLibrary, projectId);
  const sourceImage = library?.sourceImage,
    sourceKey = library?.sourceKey;
  if (!library) throw Error('Primero prepara las piezas del personaje.');
  const response = await API.importCharacterAsset(
    {
      projectId,
      sourceProjectId: action.sourceProjectId,
      ...(action.libraryId ? { libraryId: action.libraryId } : {}),
      assetId: action.assetId,
      sourceImage: action.image,
      targetImage: sourceImage,
      targetKey: sourceKey,
    },
    { signal: action.signal },
  );
  return updateDocumentDraft(projectId, (current) => {
    action.signal?.throwIfAborted();
    const latest = validateCharacterVisualLibrary(current.characterVisualLibrary, projectId);
    if (
      AppState.currentProject?.id !== projectId ||
      latest?.sourceImage !== sourceImage ||
      latest?.sourceKey !== sourceKey ||
      !characterVisualLibraryCurrent(current, parseCharacterDocument(current.content))
    )
      throw Error('La apariencia cambió antes de añadir la pieza.');
    if (latest.items.length >= 48) throw Error('La galería admite 48 piezas activas.');
    const slot = characterAssetSlot(response.item);
    latest.appliedSelections = characterOutfitSelectionMap(latest, true);
    if (!latest.items.some((item) => characterAssetSlot(item) === slot))
      latest.appliedSelections[slot] = null;
    latest.items.push(response.item);
    selectCharacterAsset(latest, response.item);
    return { characterVisualLibrary: validateCharacterVisualLibrary(latest, projectId) };
  });
}

export async function changeCharacterAssetLibrary(projectId, action) {
  if (action.type === 'rename-code') {
    await EventBus.emitAsync?.('autosave:flush');
    await API.renamePropCode({
      ...(action.libraryId
        ? { libraryId: action.libraryId }
        : { projectId, assetId: action.id, image: action.image }),
      code: action.code,
      expectedCode: action.expectedCode,
    });
    const [project, draft] = await Promise.all([API.getProject(projectId), API.getProjectDraft(projectId)]);
    return { ...project, ...(draft?.payload || {}) };
  }
  let removed = [];
  const updated = await updateDocumentDraft(projectId, (project) => {
    const library = rememberCharacterPortraitOutfit(
      validateCharacterVisualLibrary(project.characterVisualLibrary, projectId),
    );
    if (!library) throw Error('No hay biblioteca visual.');
    library.trash ||= [];
    library.selections ||= {};
    library.appliedSelections ||= {};
    const ids = [...new Set(action.ids || [])];
    if (!ids.length) throw Error('Selecciona al menos una pieza.');
    if (action.type === 'select') {
      const item = library.items.find((entry) => entry.id === ids[0] && entry.image);
      if (!item || ids.length !== 1) throw Error('La variante ya no está disponible.');
      selectCharacterAsset(library, item, { toggle: true });
    } else if (['trash', 'detach'].includes(action.type)) {
      library.appliedSelections = characterOutfitSelectionMap(library, true);
      const entries = library.items.filter((item) => ids.includes(item.id));
      if (
        entries.length !== ids.length ||
        entries.some((item) => !item.image) ||
        library.trash.length + entries.length > 500
      )
        throw Error('No se pudieron mover las piezas a la papelera.');
      library.items = library.items.filter((item) => !ids.includes(item.id));
      entries.forEach((item) => preserveCharacterAssetGroup(library, item));
      library.trash.push(
        ...entries.map((item) => (action.type === 'detach' ? { ...item, detached: true } : item)),
      );
      removeCharacterSelectionIds(library.selections, ids);
    } else if (['restore', 'purge'].includes(action.type)) {
      const entries = library.trash.filter((item) => ids.includes(item.id));
      if (entries.length !== ids.length) throw Error('La selección de la papelera cambió.');
      if (action.type === 'restore') {
        if (library.items.length + entries.length > 48)
          throw Error('La biblioteca admite 48 piezas activas.');
        for (const item of entries) delete item.detached;
        library.items.push(...entries);
      } else removed = entries.map((item) => item.image).filter(Boolean);
      library.trash = library.trash.filter((item) => !ids.includes(item.id));
      if (action.type === 'purge') removeCharacterSelectionIds(library.appliedSelections, ids);
      if (action.type === 'purge')
        for (const entry of library.portraitSelections || [])
          if (
            Object.values(entry.selections)
              .flatMap(characterSelectionIds)
              .some((id) => ids.includes(id))
          ) {
            removeCharacterSelectionIds(entry.selections, ids);
            delete entry.review;
          }
    } else throw Error('Acción de biblioteca inválida.');
    return {
      characterVisualLibrary: validateCharacterVisualLibrary(library, projectId),
      ...(removed.length ? { characterMediaDeletions: mediaDeletionList(project, removed) } : {}),
    };
  });
  if (removed.length) return finishCharacterMediaCleanup(projectId, removed);
  return updated;
}
function mediaDeletionList(project, images) {
  const list = [...new Set([...(project.characterMediaDeletions || []), ...images])];
  if (list.length > 5000) throw Error('El registro de eliminación está lleno.');
  return list;
}
export async function purgeCharacterPortraits(projectId, images) {
  const unique = [...new Set(images)];
  await updateDocumentDraft(projectId, (project) => {
    if (!unique.length || unique.some((image) => !project.characterImageTrash?.includes(image)))
      throw Error('La selección de la papelera cambió.');
    return {
      characterImageTrash: project.characterImageTrash.filter((image) => !unique.includes(image)),
      ...(project.characterVisualLibrary?.portraitSelections
        ? {
            characterVisualLibrary: {
              ...project.characterVisualLibrary,
              portraitSelections: project.characterVisualLibrary.portraitSelections.filter(
                (entry) => !unique.includes(entry.image),
              ),
            },
          }
        : {}),
      characterMediaDeletions: mediaDeletionList(project, unique),
    };
  });
  return finishCharacterMediaCleanup(projectId, unique);
}
async function finishCharacterMediaCleanup(projectId, images) {
  const result = await API.purgeCharacterTrash(projectId, images);
  const completed = [...(result.removed || []), ...(result.retained || [])];
  const failed = result.failed || [];
  if (
    new Set([...completed, ...failed]).size !== images.length ||
    [...completed, ...failed].some((image) => !images.includes(image))
  )
    throw Error('No se pudo confirmar la eliminación. Puedes reintentar la limpieza pendiente.');
  const updated = await updateDocumentDraft(projectId, (current) => ({
    characterMediaDeletions: (current.characterMediaDeletions || []).filter(
      (image) => !completed.includes(image),
    ),
  }));
  if (failed.length)
    throw Error('Algunos archivos no se pudieron eliminar. Reintenta la eliminación pendiente.');
  return updated;
}
export async function retryCharacterMediaCleanup(projectId) {
  let updated;
  await updateDocumentDraft(projectId, (current) => {
    updated = current;
    return {};
  });
  const images = [...(updated.characterMediaDeletions || [])];
  for (let offset = 0; offset < images.length; offset += 500)
    updated = await finishCharacterMediaCleanup(projectId, images.slice(offset, offset + 500));
  return updated;
}
