import { updateDocumentDraft } from '../documents/document-draft.js';
import { Modal } from '../../ui-components.js';
import {
  parseCharacterDocument,
  characterAppearanceKey,
  validateCharacterVisualLibrary,
  characterAssetImage,
  selectedCharacterAssets,
  applyCharacterAssetDescriptions,
  rememberCharacterPortraitOutfit,
  activateCharacterPortraitOutfit,
  remapCharacterPortraitAsset,
  characterOutfitSelectionMap,
} from '../characters/character-model.js';

/** Logical removal only: files remain available to saved versions. */
export function characterImageTrashPatch(project, imageUrl) {
  if (project.type !== 'character' || !project.covers?.includes(imageUrl))
    throw new Error('La imagen ya no pertenece a la galería.');
  if (!imageUrl.startsWith(`/projects/${project.id}/content/`))
    throw new Error('Solo se pueden enviar a la papelera imágenes locales de este personaje.');
  const characterImageTrash = [...new Set([...(project.characterImageTrash || []), imageUrl])];
  if (characterImageTrash.length > 500)
    throw new Error('La papelera admite hasta 500 imágenes. Restaura imágenes antes de continuar.');
  const selected = project.covers[project.currentCoverIndex];
  const covers = project.covers.filter((url) => url !== imageUrl);
  const primary = covers.includes(selected) ? selected : covers[0];
  const linked =
    primary &&
    primary !== selected &&
    activateCharacterPortraitOutfit(
      parseCharacterDocument(project.content),
      project.characterVisualLibrary,
      primary,
    );
  return {
    ...(linked ? { content: JSON.stringify(linked.document), characterVisualLibrary: linked.library } : {}),
    covers,
    characterImageTrash,
    currentCoverIndex: covers.length ? Math.max(0, covers.indexOf(selected)) : -1,
    ...(project.lastCharacterImage === imageUrl ? { lastCharacterImage: '' } : {}),
  };
}

export async function restoreCharacterImage(projectId, imageUrl) {
  return updateDocumentDraft(projectId, (project) => {
    if (project.type !== 'character' || !project.characterImageTrash?.includes(imageUrl))
      throw new Error('La imagen ya no está en la papelera.');
    if ((project.covers || []).length >= 100)
      throw new Error('La galería admite hasta 100 imágenes. Envía otra a la papelera antes de restaurar.');
    const covers = [...new Set([...(project.covers || []), imageUrl])];
    const selected = project.covers?.[project.currentCoverIndex];
    const linked =
      !selected &&
      activateCharacterPortraitOutfit(
        parseCharacterDocument(project.content),
        project.characterVisualLibrary,
        imageUrl,
      );
    return {
      ...(linked ? { content: JSON.stringify(linked.document), characterVisualLibrary: linked.library } : {}),
      covers,
      characterImageTrash: project.characterImageTrash.filter((url) => url !== imageUrl),
      currentCoverIndex: selected ? covers.indexOf(selected) : covers.indexOf(imageUrl),
    };
  });
}

export async function saveGeneratedImage(projectId, imageUrl, fields = {}, options = {}) {
  const key = `kai-generated-image:${projectId}:${encodeURIComponent(imageUrl)}`;
  // Retain the result if a competing tab or disk error prevents association.
  try {
    localStorage.setItem(key, JSON.stringify({ imageUrl, fields, options }));
  } catch (error) {
    console.warn('[Media] Recovery unavailable', error);
  }
  const updated = await updateDocumentDraft(projectId, (project) => {
    if (options.characterAsset) {
      const target = options.characterAsset;
      const library = rememberCharacterPortraitOutfit(
        validateCharacterVisualLibrary(project.characterVisualLibrary, projectId),
      );
      if (
        project.type !== 'character' ||
        !library ||
        !characterAssetImage(imageUrl, projectId) ||
        library.sourceImage !== target.sourceImage ||
        library.sourceKey !== target.sourceKey ||
        (project.covers?.[project.currentCoverIndex] || project.covers?.[0]) !== target.sourceImage ||
        characterAppearanceKey(parseCharacterDocument(project.content)) !== target.sourceKey ||
        !library.items.some((item) => item.id === target.id)
      )
        throw Error('La pieza pertenece a otra apariencia. Se conserva para recuperación.');
      const item = library.items.find((entry) => entry.id === target.id);
      if (target.replaceImage !== undefined) {
        library.trash ||= [];
        if (item.image === imageUrl && library.trash.some((entry) => entry.id === target.discardedId))
          return { characterVisualLibrary: library };
        if (
          item.image !== target.replaceImage ||
          !item.image ||
          item.image === imageUrl ||
          !/^asset_[A-Za-z0-9_-]{1,100}$/.test(target.discardedId) ||
          [...library.items, ...library.trash].some((entry) => entry.id === target.discardedId) ||
          library.trash.length >= 500
        )
          throw Error('La pieza cambió durante la regeneración. El resultado se conserva para recuperación.');
        library.trash.push({ ...item, id: target.discardedId });
        remapCharacterPortraitAsset(library, item.id, target.discardedId);
      }
      return {
        characterVisualLibrary: {
          ...library,
          items: library.items.map((item) =>
            item.id === target.id ? { ...item, image: imageUrl, error: '' } : item,
          ),
        },
      };
    }
    if (options.characterVariationCandidate) {
      if (
        project.type !== 'character' ||
        !imageUrl.startsWith(`/projects/${project.id}/content/`) ||
        !/^\/projects\/[A-Za-z0-9_-]+\/content\/[A-Za-z0-9][A-Za-z0-9_.-]*\.(png|jpe?g|webp|gif|bmp)$/i.test(
          imageUrl,
        ) ||
        project.covers?.includes(imageUrl)
      )
        throw new Error('La propuesta debe ser una imagen nueva de este personaje.');
      const trash = [...new Set([...(project.characterImageTrash || []), imageUrl])];
      if (trash.length > 500)
        throw new Error('La papelera está llena. Restaura imágenes antes de continuar.');
      const metadata = fields.characterImageGeneration
        ? { characterImageGeneration: fields.characterImageGeneration }
        : {};
      return { ...metadata, characterImageTrash: trash };
    }
    const replacing =
      project.type === 'character' &&
      options.replaceImage &&
      options.replaceImage !== imageUrl &&
      project.covers?.includes(options.replaceImage);
    const removed = replacing ? characterImageTrashPatch(project, options.replaceImage) : {};
    const covers = [
      ...new Set(
        (project.covers || []).map((url) => (replacing && url === options.replaceImage ? imageUrl : url)),
      ),
    ];
    if (!covers.includes(imageUrl)) covers.push(imageUrl);
    const keepPrimary =
      project.type === 'character' &&
      Number.isInteger(project.currentCoverIndex) &&
      !!project.covers?.[project.currentCoverIndex];
    const selected = keepPrimary ? project.covers[project.currentCoverIndex] : null;
    const primary = replacing && selected === options.replaceImage ? imageUrl : selected;
    const trash = removed.characterImageTrash || project.characterImageTrash;
    let assetPatch = {};
    if (options.characterAssetApply) {
      const plan = options.characterAssetApply;
      const library = rememberCharacterPortraitOutfit(
        validateCharacterVisualLibrary(project.characterVisualLibrary, projectId),
      );
      const document = parseCharacterDocument(project.content);
      const selected = library && selectedCharacterAssets(library).filter((item) => item.image);
      if (
        !library ||
        library.sourceImage !== plan.sourceImage ||
        library.sourceKey !== plan.sourceKey ||
        characterAppearanceKey(document) !== plan.sourceKey ||
        JSON.stringify(selected.map((item) => item.id)) !== JSON.stringify(plan.ids) ||
        !replacing ||
        options.replaceImage !== plan.sourceImage
      )
        throw Error('Las piezas seleccionadas cambiaron. La imagen se conserva para recuperación.');
      const next = applyCharacterAssetDescriptions(document, library);
      assetPatch = {
        content: JSON.stringify(next),
        characterVisualLibrary: rememberCharacterPortraitOutfit({
          ...library,
          sourceImage: imageUrl,
          sourceKey: characterAppearanceKey(next),
          appliedSelections: characterOutfitSelectionMap(library),
        }),
      };
    }
    return {
      ...fields,
      ...assetPatch,
      covers,
      ...(trash ? { characterImageTrash: trash.filter((url) => !covers.includes(url)) } : {}),
      currentCoverIndex: keepPrimary ? covers.indexOf(primary) : covers.indexOf(imageUrl),
    };
  });
  try {
    localStorage.removeItem(key);
  } catch {}
  return updated;
}

/** Commit one explicit primary-image choice; the unselected candidate remains recoverable. */
export async function chooseCharacterVariation(
  projectId,
  baseImage,
  candidateImage,
  choice,
  expectedContent,
) {
  return updateDocumentDraft(projectId, (project) => {
    if (
      project.type !== 'character' ||
      !['current', 'new'].includes(choice) ||
      (project.covers?.[project.currentCoverIndex] || project.covers?.[0]) !== baseImage ||
      !project.characterImageTrash?.includes(candidateImage) ||
      (expectedContent !== undefined && project.content !== expectedContent)
    )
      throw new Error('El personaje o su imagen principal cambió. La propuesta se conserva en la papelera.');
    if (choice === 'current')
      return { lastCharacterImage: baseImage, currentCoverIndex: project.covers.indexOf(baseImage) };
    const covers = project.covers.map((url) => (url === baseImage ? candidateImage : url));
    const trash = [
      ...new Set([...project.characterImageTrash.filter((url) => url !== candidateImage), baseImage]),
    ];
    return {
      covers,
      currentCoverIndex: covers.indexOf(candidateImage),
      characterImageTrash: trash,
      lastCharacterImage: candidateImage,
    };
  });
}

export async function saveGeneratedCoverVersion(projectId, finalUrl, record, fields = {}) {
  const key = `kai-cover-version:${projectId}:${encodeURIComponent(finalUrl)}`;
  try {
    localStorage.setItem(key, JSON.stringify({ finalUrl, record, fields }));
  } catch (error) {
    console.warn('[Media] Cover recovery unavailable', error);
  }
  const updated = await updateDocumentDraft(projectId, (current) => {
    const covers = [...(current.covers || [])];
    if (!covers.includes(finalUrl)) covers.push(finalUrl);
    return {
      ...fields,
      covers,
      currentCoverIndex: covers.indexOf(finalUrl),
      coverVersions: (current.coverVersions || []).some(
        (item) => item.id === record.id || item.finalUrl === finalUrl,
      )
        ? current.coverVersions
        : [...(current.coverVersions || []), record],
    };
  });
  try {
    localStorage.removeItem(key);
  } catch {}
  return updated;
}

export async function recoverGeneratedImages(projectId) {
  let recovered = 0;
  const recover = async (key, save) => {
    try {
      const result = JSON.parse(localStorage.getItem(key));
      if (!result || typeof result !== 'object') throw new Error('Registro inválido');
      if (
        !(await Modal.confirm({
          title: 'Recuperar imagen pendiente',
          message: result.options?.characterVariationCandidate
            ? 'Hay una propuesta de personaje pendiente. ¿Conservarla en la papelera sin cambiar la imagen principal?'
            : result.options?.characterAsset
              ? 'Hay una pieza visual pendiente del personaje. ¿Recuperarla en su biblioteca sin cambiar la galería principal?'
              : 'Hay una imagen o composición pendiente. ¿Recuperarla en el historial?',
          confirmLabel: 'Recuperar',
          type: 'warning',
        }))
      )
        return;
      await save(result);
      recovered++;
      localStorage.removeItem(key);
    } catch (error) {
      console.warn('[Media] No se pudo recuperar el registro; se conserva para reintentar:', key, error);
    }
  };
  let keys;
  try {
    keys = Object.keys(localStorage);
  } catch (error) {
    console.warn('[Media] Storage unavailable', error);
    return;
  }
  const prefix = `kai-generated-image:${projectId}:`;
  for (const key of keys.filter((key) => key.startsWith(prefix))) {
    await recover(key, (result) =>
      saveGeneratedImage(projectId, result.imageUrl, result.fields, result.options),
    );
  }
  const coverPrefix = `kai-cover-version:${projectId}:`;
  for (const key of keys.filter((key) => key.startsWith(coverPrefix))) {
    await recover(key, (result) =>
      saveGeneratedCoverVersion(projectId, result.finalUrl, result.record, result.fields),
    );
  }
  return recovered;
}
