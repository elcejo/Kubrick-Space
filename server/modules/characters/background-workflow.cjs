const { validateImageEngine } = require('../../../public/js/contracts/project-inference.js');
const {
  parseCharacterDocument,
  validateCharacterDocument,
  characterVisualChangeKeys,
  characterImageAction,
  characterPhotoNeedsInterpretation,
  validateCharacterPhotoReferences,
  applyCharacterLore,
  characterLoreVisualKind,
} = require('../../../public/js/contracts/character-model.js');
const { characterDocumentForProject } = require('./legacy.cjs');
const { isDeepStrictEqual } = require('node:util');
const { runCharacterComposition, characterCompositionSignature } = require('./composition.cjs');
const { characterImageBrief } = require('../../../public/js/contracts/character-image-prompt.js');
const {
  characterAppearanceKey,
  characterAssetImage,
  characterAssetPrompt,
  characterAssetReferences,
  characterVisualLibraryCurrent,
  characterVisualLibraryNeedsAudit,
  validateCharacterVisualLibrary,
  applyCharacterAssetDescriptions,
  characterRequestedTraits,
  reconcileCharacterVisualLibrary,
  rememberCharacterPortraitOutfit,
  remapCharacterPortraitAsset,
  characterOutfitSelectionMap,
  characterAssetCreationPrompt,
  characterAssetCategory,
  characterAssetSlot,
} = require('../../../public/js/contracts/character-visual-library.js');

/** Character recipe; all persistence, image engines and scoped helpers are injected public capabilities. */
function createCharacterBackgroundWorkflow({
  readCurrentProject,
  writeProject,
  makeHelpers,
  generateImage,
  security,
  management,
}) {
  const checked = async (promise) => {
    const response = await promise;
    if (!response || response.status >= 400) {
      const error = security.fail(
        typeof response?.body?.error === 'string'
          ? response.body.error
          : 'El proveedor no pudo completar esta etapa.',
        response?.status || 502,
      );
      error.publicMessage = error.message;
      throw error;
    }
    return response.body;
  };
  const own = (image, id) => {
    if (!characterAssetImage(image, id)) throw security.fail('Referencia de imagen inválida.');
    return image;
  };
  function portraitPatch(project, image, replace) {
    own(image, project.id);
    const covers = [...(project.covers || [])],
      trash = [...(project.characterImageTrash || [])];
    const index = replace ? covers.indexOf(replace) : -1;
    if (index >= 0) {
      covers[index] = image;
      if (!trash.includes(replace)) trash.push(replace);
    } else if (!covers.includes(image)) covers.push(image);
    if (covers.length > 100 || trash.length > 500)
      throw security.fail('La galería o su papelera están llenas.', 409);
    return {
      covers,
      currentCoverIndex: project.currentCoverIndex >= 0 ? project.currentCoverIndex : 0,
      lastCharacterImage: image,
      characterImageTrash: trash.filter((url) => url !== image),
    };
  }
  async function run(job, ctx) {
    const id = job.projectId,
      input = job.payload,
      state = ctx.state;
    const helpers = makeHelpers(input.textConfig, {
      signal: ctx.signal,
      reportProgress: (message) => ctx.progress(message),
      trackRequest: ctx.trackRequest,
    });
    const { designCharacter, preparePrompt, prepareLibrary } = helpers;
    const current = () => {
      const project = readCurrentProject(id);
      if (project.type !== 'character')
        throw security.fail('El trabajo pertenece a otro tipo de proyecto.', 409);
      return project;
    };
    if (!state.content) {
      state.content = input.expectedContent;
      ctx.checkpoint();
    }
    const write = (patch) => {
      ctx.throwIfAborted?.();
      const draft = writeProject(id, patch, state.content);
      if (draft?.payload.content !== undefined) state.content = draft.payload.content;
      ctx.checkpoint();
      return current();
    };
    const archiveCandidate = (candidate) => {
      const trash = [...new Set([...(current().characterImageTrash || []), candidate])];
      if (trash.length > 500) throw security.fail('La papelera está llena.', 409);
      write({ characterImageTrash: trash });
    };
    if (job.kind === 'manage' || state.managementPlan)
      return management.execute(state.managementPlan || input.management, job, ctx, run);
    if (
      state.legacyPrepared &&
      current().content === JSON.stringify(state.legacyPrepared) &&
      state.content !== current().content
    ) {
      state.content = current().content;
      ctx.checkpoint();
    }
    if (current().content !== state.content)
      throw security.fail('La ficha cambió. No se aplicó el trabajo a una versión distinta.', 409);
    if (!parseCharacterDocument(state.content)) {
      const prepared = await ctx.step('legacy-document', () =>
        characterDocumentForProject(current(), security),
      );
      state.legacyPrepared = prepared;
      ctx.checkpoint();
      write({ content: JSON.stringify(prepared) });
    }
    let doc = parseCharacterDocument(state.content);
    // Recover a portrait saved before the initial extraction failed on an older run.
    if (doc.creation.initialState === 'pending' && current().covers?.length) {
      doc.creation.initialState = 'complete';
      write({ content: JSON.stringify(validateCharacterDocument(doc)) });
    }
    // The interpreted sheet is a checkpoint, not a completed initial character.
    if (
      job.kind === 'interpret' &&
      ['description', 'image'].includes(input.source) &&
      ['description', 'image'].includes(doc.creation.mode) &&
      doc.creation.initialState !== 'complete' &&
      (doc.creation.initialState === 'pending' || !current().covers?.length)
    ) {
      state.initialCreation = true;
      if (doc.creation.initialState !== 'pending') {
        doc.creation.initialState = 'pending';
        write({ content: JSON.stringify(validateCharacterDocument(doc)) });
      }
    }
    if (
      job.kind === 'interpret' &&
      input.source === 'image' &&
      !current().covers?.length &&
      !state.sourceArchived
    ) {
      const original = doc.creation.referenceImage || input.referenceImage;
      if (original) {
        own(original, id);
        const trash = [...new Set([...(current().characterImageTrash || []), original])];
        if (trash.length > 500) throw security.fail('La papelera de fotografías está llena.', 409);
        write({ characterImageTrash: trash });
      }
      state.sourceArchived = true;
      ctx.checkpoint();
    }
    if (state.loreEligible === undefined) {
      state.loreEligible =
        job.kind === 'interpret' &&
        ['description', 'image'].includes(input.source) &&
        !doc.lore &&
        !current().covers?.length &&
        !doc.history.some((turn) => turn.status === 'applied');
      ctx.checkpoint();
    }
    const discoverLore = async () => {
      ctx.progress('Buscando referencias y lore del personaje…');
      const lore = await ctx.step('lore-discovery', async () => {
        try {
          return (
            await checked(
              helpers.discoverLore({
                body: {
                  projectId: id,
                  document: parseCharacterDocument(state.content),
                  request: input.request || '',
                },
              }),
            )
          ).lore;
        } catch (error) {
          ctx.throwIfAborted?.();
          return {
            status: 'unavailable',
            name: '',
            work: '',
            message: 'No se pudo comprobar si existe lore previo. Puedes reintentar la búsqueda.',
            sources: [],
            facts: [],
          };
        }
      });
      doc = parseCharacterDocument(state.content);
      doc.lore = lore;
      doc.revision++;
      write({ content: JSON.stringify(validateCharacterDocument(doc)) });
      state.loreSearched = true;
      ctx.checkpoint();
    };
    if (job.kind === 'lore' && !input.loreIds) {
      await discoverLore();
      return { message: 'Búsqueda de lore terminada. Ningún dato se incorpora sin tu aprobación.' };
    }
    let engine = input.engine || current().characterImageGeneration;
    if (engine) {
      try {
        validateImageEngine(engine);
      } catch {
        throw security.fail('Motor de imágenes inválido.');
      }
    }
    const image = async (name, body) => {
      if (!engine?.provider || !engine?.model)
        throw security.fail('Selecciona el modelo de imagen antes de encolar el trabajo.', 428);
      const result = await ctx.step(name, async (stage) => {
        const response = await checked(
          generateImage(
            {
              body: {
                ...body,
                projectId: id,
                backend: 'api',
                imageType: 'character',
                provider: engine.provider,
                model: engine.model,
              },
            },
            { signal: ctx.signal, trackRequest: stage?.trackRequest || ctx.trackRequest },
          ),
        );
        return { imageUrl: own(response.imageUrl, id) };
      });
      return own(result.imageUrl, id);
    };
    if (job.kind === 'lore' && input.loreIds) {
      const sourceImage = current().covers?.[current().currentCoverIndex] || current().covers?.[0];
      if (!sourceImage)
        throw security.fail('Genera primero la imagen principal para crear referencias de lore.', 409);
      if (!state.loreApproved) {
        doc = applyCharacterLore(doc, input.loreIds);
        write({ content: JSON.stringify(doc) });
        state.loreApproved = true;
        ctx.checkpoint();
      }
      const facts = doc.lore.facts.filter(
        (fact) => input.loreIds.includes(fact.id) && characterLoreVisualKind(fact),
      );
      for (let index = 0; index < facts.length; index++) {
        doc = parseCharacterDocument(state.content);
        const fact = facts[index];
        if (doc.lore.visualAssets?.some((entry) => entry.factId === fact.id)) continue;
        let library = current().characterVisualLibrary
          ? validateCharacterVisualLibrary(current().characterVisualLibrary, id)
          : {
              version: 1,
              format: 'square-v2',
              sourceImage,
              sourceKey: characterAppearanceKey(doc),
              items: [],
              trash: [],
              selections: {},
              appliedSelections: {},
            };
        if (library.sourceImage === sourceImage) library.sourceKey = characterAppearanceKey(doc);
        const assetId = `asset_${job.id}_lore_${index}`;
        let item = library.items.find((entry) => entry.id === assetId);
        if (!item) {
          if (library.items.length >= 48)
            throw security.fail('La biblioteca admite 48 piezas; libera espacio para continuar.', 409);
          const kind = characterLoreVisualKind(fact);
          item = {
            id: assetId,
            category: characterAssetCategory({ kind }),
            kind,
            label: fact.label,
            description: String(fact.value).slice(0, 4000),
            fieldKeys: [],
            image: '',
            error: '',
            prompt: 'Create the approved component as an independent optional reference.',
          };
          library.selections = characterOutfitSelectionMap(library);
          library.appliedSelections = characterOutfitSelectionMap(library, true);
          const slot = characterAssetSlot(item);
          if (!Object.hasOwn(library.selections, slot)) library.selections[slot] = null;
          if (!Object.hasOwn(library.appliedSelections, slot)) library.appliedSelections[slot] = null;
          library.items.push(item);
          write({ characterVisualLibrary: validateCharacterVisualLibrary(library, id) });
        }
        ctx.progress(`Creando referencia opcional: ${item.label} · ${index + 1} de ${facts.length}`);
        const url = await image('lore-asset-' + index, {
          prompt: characterAssetCreationPrompt(item),
          aspectRatio: '1:1',
          inputImages: characterAssetReferences(item, sourceImage),
        });
        library = validateCharacterVisualLibrary(current().characterVisualLibrary, id);
        library.items.find((entry) => entry.id === assetId).image = url;
        doc = parseCharacterDocument(state.content);
        doc.lore.visualAssets = [...(doc.lore.visualAssets || []), { factId: fact.id, assetId }];
        doc.revision++;
        write({ content: JSON.stringify(validateCharacterDocument(doc)), characterVisualLibrary: library });
      }
      return {
        message: 'Lore incorporado. Las referencias visuales están disponibles sin aplicar al personaje.',
      };
    }
    let changed = input.visualChangeKeys || [],
      imageAction = job.kind === 'interpret' ? 'preserve' : 'generate';
    let references = input.photoReferences;
    if (job.kind === 'interpret') {
      const source =
        input.source === 'image' && !characterPhotoNeedsInterpretation(doc) ? 'description' : input.source;
      const turnId = 'turn_' + job.id;
      if (!state.turnStarted) {
        if (!doc.history.some((turn) => turn.id === turnId)) {
          doc.history.push({
            id: turnId,
            source,
            request: input.request || '',
            createdAt: job.createdAt,
            status: 'pending',
            message: '',
            ...(input.attachmentImage ? { attachmentImage: input.attachmentImage } : {}),
            ...(source === 'image' ? { referenceImage: input.referenceImage } : {}),
          });
          write({ content: JSON.stringify(validateCharacterDocument(doc)) });
        }
        state.turnStarted = true;
        ctx.checkpoint();
      }
      ctx.progress('Interpretando personaje…');
      const response = await ctx.step('interpretation', () =>
        checked(
          designCharacter(
            {
              body: {
                projectId: id,
                document: parseCharacterDocument(state.content),
                source,
                request: input.request || '',
                ingredients: current().ingredients || [],
                ...(source === 'image' ? { referenceImage: input.referenceImage } : {}),
                ...(input.attachmentImage ? { attachmentImage: input.attachmentImage } : {}),
                ...(input.gallery ? { gallery: input.gallery } : {}),
              },
            },
            { management: !input.managementDisabled && source !== 'summary' },
          ),
        ),
      );
      if (response.management) {
        state.managementPlan = response.management;
        ctx.checkpoint();
        return management.execute(response.management, job, ctx, run);
      }
      const proposed = validateCharacterDocument(response.document);
      if (!state.interpreted) {
        changed = [
          ...new Set([
            ...characterVisualChangeKeys(doc, proposed),
            ...(response.photoReferences?.details.flatMap((photo) => photo.keys) || []),
          ]),
        ];
        imageAction =
          source === 'summary'
            ? 'preserve'
            : state.initialCreation
              ? 'generate'
              : response.photoReferences
                ? 'generate'
                : characterImageAction(doc, proposed, response.imageAction);
        const turn = proposed.history.find((entry) => entry.id === turnId);
        if (!turn) throw security.fail('Falta el registro de interpretación.', 409);
        Object.assign(turn, {
          status: 'applied',
          message: response.message || '',
          visualChangeKeys: changed,
          visualScopes: response.visualScopes || [],
          imageAction,
          ...(imageAction === 'generate' ? { imageStatus: 'pending' } : {}),
          ...(response.photoReferences ? { photoReferences: response.photoReferences } : {}),
        });
        // Only the server can advance readiness after the complete image recipe.
        if (state.initialCreation) proposed.creation.initialState = 'pending';
        else if (doc.creation.initialState) proposed.creation.initialState = doc.creation.initialState;
        state.changed = changed;
        state.visualScopes = response.visualScopes || [];
        state.extractOnly =
          JSON.stringify(characterRequestedTraits(doc)) !==
          JSON.stringify(characterRequestedTraits(proposed));
        state.imageAction = imageAction;
        state.photoReferences = response.photoReferences;
        write({ content: JSON.stringify(proposed) });
        state.interpreted = true;
        ctx.checkpoint();
      }
      changed = state.changed || [];
      imageAction = state.imageAction;
      references = state.photoReferences;
      doc = parseCharacterDocument(state.content);
    }
    if (job.kind === 'regenerate') {
      const project = current(),
        library = rememberCharacterPortraitOutfit(
          validateCharacterVisualLibrary(project.characterVisualLibrary, id),
        );
      const item = library?.items.find((entry) => entry.id === input.assetId);
      if (!item?.image || !characterVisualLibraryCurrent(project, doc))
        throw security.fail('La pieza ya no corresponde al retrato actual.', 409);
      const origin = doc.creation.mode === 'image' ? doc.creation.referenceImage : '';
      if (![library.sourceImage, origin].filter(Boolean).includes(input.referenceImage))
        throw security.fail('Referencia de extracción inválida.');
      ctx.progress('Regenerando ' + item.label + '…');
      const url = await image('single-piece', {
        prompt: characterAssetPrompt(item),
        aspectRatio: '1:1',
        inputImages: characterAssetReferences(item, input.referenceImage),
      });
      if (item.image !== url) {
        library.trash ||= [];
        if (library.trash.length >= 500) throw security.fail('La papelera está llena.', 409);
        library.trash.push({ ...item, id: 'asset_' + job.id });
        remapCharacterPortraitAsset(library, item.id, 'asset_' + job.id);
        item.image = url;
        item.error = '';
        write({ characterVisualLibrary: library });
      }
      return { imageUrl: url, message: 'Pieza regenerada. La anterior está en la papelera Outfit.' };
    }
    if (!['assets', 'regenerate'].includes(job.kind) && imageAction === 'generate' && !state.portraitSaved) {
      const project = current(),
        primary = project.covers?.[project.currentCoverIndex] || project.covers?.[0];
      const ref =
        (state.initialCreation &&
          doc.creation.mode === 'image' &&
          (input.referenceImage || doc.creation.referenceImage)) ||
        input.baseImage ||
        references?.base?.image ||
        (input.variation && primary) ||
        (project.covers?.includes(project.lastCharacterImage) && project.lastCharacterImage) ||
        project.covers?.at(-1) ||
        doc.creation.referenceImage ||
        '';
      if (ref) own(ref, id);
      if (input.baseImage && !project.covers?.includes(input.baseImage))
        throw security.fail('La foto a editar ya no está en la galería.', 409);
      if (references) {
        references = validateCharacterPhotoReferences(references, id);
        if ([references.base, ...references.details].some((photo) => !project.covers?.includes(photo.image)))
          throw security.fail('Las fotos seleccionadas cambiaron.', 409);
      }
      const initial = state.initialCreation || !primary;
      let url, compositionReview;
      if (input.assetSelection) {
        if (
          !state.compositionSignatures?.outfit &&
          Object.keys(job.steps || {}).some((key) => /^outfit-\d+-image-/.test(key))
        )
          throw security.fail(
            'Este trabajo antiguo no conserva una huella verificable de las piezas. Aplica la selección actual en un trabajo nuevo; la imagen guardada se conserva.',
            409,
          );
        characterImageBrief(doc, {
          purpose: 'assets',
          referenceImage: ref,
          assetSelection: input.assetSelection,
          visualLibrary: project.characterVisualLibrary,
        });
        const composition = await runCharacterComposition({
          project,
          document: doc,
          ctx,
          helpers,
          picture: (name, prompt, references, options) =>
            image(name, { prompt, inputImages: references, ...options }),
          reject: archiveCandidate,
          retain: archiveCandidate,
        });
        url = composition.image;
        compositionReview = composition.review;
      } else {
        const protectOutfit = !initial && project.characterVisualLibrary?.items.some((item) => item.image);
        if (protectOutfit)
          await checked(helpers.reviewComposition({ body: { projectId: id, preflight: true } }));
        ctx.progress('Preparando dirección visual…');
        const renderAttempt = state.compositionAttempts?.['portrait-outfit'] || 0;
        const direction = await ctx.step(
          renderAttempt ? 'direction-retry-' + renderAttempt : 'direction',
          () =>
            checked(
              preparePrompt({
                body: {
                  projectId: id,
                  document: doc,
                  purpose: input.assetSelection
                    ? 'assets'
                    : initial
                      ? 'initial'
                      : input.variation || !changed.length
                        ? 'variation'
                        : 'edit',
                  referenceImage: ref,
                  attachmentImage: input.attachmentImage || '',
                  visualChangeKeys: changed,
                  visualScopes: state.visualScopes || [],
                  ...(references ? { photoReferences: references } : {}),
                  ...(input.assetSelection ? { assetSelection: input.assetSelection } : {}),
                },
              }),
            ),
        );
        ctx.progress('Generando fotografía del personaje…');
        url = await image(renderAttempt ? 'portrait-retry-' + renderAttempt : 'portrait', {
          prompt: direction.prompt,
          inputImages: [
            ref,
            ...(references?.details.map((photo) => photo.image) || []),
            input.assetSelection?.sheetImage,
            input.attachmentImage,
          ].filter(Boolean),
        });
        if (protectOutfit) {
          const composition = await runCharacterComposition({
            project,
            document: doc,
            ctx,
            helpers,
            prefix: 'portrait-outfit',
            baseImage: url,
            canonicalReferencePose: input.variation === true,
            changedKeys: changed,
            visualScopes: state.visualScopes || [],
            picture: (name, prompt, references, options) =>
              image(name, { prompt, inputImages: references, ...options }),
            reject: archiveCandidate,
            retain: archiveCandidate,
          });
          url = composition.image;
        }
      }
      if (input.variation && primary && !references && !state.choice) {
        const trash = [...new Set([...(project.characterImageTrash || []), url])];
        if (trash.length > 500) throw security.fail('La papelera está llena.', 409);
        write({ characterImageTrash: trash });
        return {
          awaitingChoice: true,
          candidateImage: url,
          baseImage: primary,
          sourceKey: characterAppearanceKey(doc),
          message: 'Elige qué apariencia conservar. La propuesta ya está guardada.',
        };
      }
      if (state.choice === 'current')
        return { imageUrl: primary, message: 'Se conserva la apariencia actual.' };
      let patch = portraitPatch(project, url, references ? '' : ref);
      if (input.assetSelection) {
        const library = rememberCharacterPortraitOutfit(
          validateCharacterVisualLibrary(project.characterVisualLibrary, id),
        );
        doc = applyCharacterAssetDescriptions(doc, library);
        patch = {
          ...patch,
          content: JSON.stringify(doc),
          characterVisualLibrary: rememberCharacterPortraitOutfit({
            ...library,
            sourceImage: url,
            sourceKey: characterAppearanceKey(doc),
            appliedSelections: characterOutfitSelectionMap(library),
          }),
        };
      }
      if (compositionReview)
        patch.characterVisualLibrary.portraitSelections.find((entry) => entry.image === url).review =
          compositionReview;
      if (state.initialCreation) {
        doc = parseCharacterDocument(patch.content || state.content);
        doc.creation.initialState = 'complete';
        const turn = doc.history.find((entry) => entry.id === 'turn_' + job.id);
        if (turn) turn.imageStatus = 'generated';
        if (
          doc.request.trim() === (input.request || '').trim() &&
          doc.requestImage === (input.attachmentImage || '')
        ) {
          doc.request = '';
          doc.requestImage = '';
        }
        patch.content = JSON.stringify(validateCharacterDocument(doc));
      }
      write({ ...patch, characterImageGeneration: engine });
      state.skipInventory = Boolean(
        references && (current().covers?.[current().currentCoverIndex] || current().covers?.[0]) !== url,
      );
      state.portraitSaved = true;
      state.imageUrl = url;
      ctx.checkpoint();
    }
    if (
      job.kind === 'assets' ||
      (imageAction === 'generate' && !state.skipInventory) ||
      (state.extractOnly && current().covers?.length)
    ) {
      const project = current();
      doc = parseCharacterDocument(state.content);
      const sourceImage = project.covers?.[project.currentCoverIndex] || project.covers?.[0];
      if (!sourceImage) throw security.fail('Primero genera el retrato.', 409);
      if (job.kind === 'assets' && input.referenceImage && input.referenceImage !== sourceImage)
        throw security.fail(
          'La fotografía principal cambió antes de generar los props. Vuelve a solicitarlos.',
          409,
        );
      let library = project.characterVisualLibrary;
      if (
        !input.assetSelection &&
        (input.refreshAssets
          ? !state.inventoryPrepared
          : !characterVisualLibraryCurrent(project, doc) ||
            characterVisualLibraryNeedsAudit(library, doc) ||
            library.format !== 'square-v2')
      ) {
        ctx.progress('Analizando rasgos, ropa y props…');
        const plan = await ctx.step('inventory', () =>
          checked(prepareLibrary({ body: { projectId: id, document: doc, sourceImage } })),
        );
        library = validateCharacterVisualLibrary(plan.library, id);
        library.format = 'square-v2';
        if (input.refreshAssets) state.inventoryItemIds = library.items.map((item) => item.id);
        library = reconcileCharacterVisualLibrary(library, project.characterVisualLibrary, id, {
          reuseImages: !input.refreshAssets,
        });
        write({ characterVisualLibrary: validateCharacterVisualLibrary(library, id) });
        state.inventoryPrepared = true;
        ctx.checkpoint();
      }
      library = validateCharacterVisualLibrary(current().characterVisualLibrary, id);
      const pending = library.items.filter(
        (item) => !item.image && (!input.refreshAssets || state.inventoryItemIds?.includes(item.id)),
      );
      state.assetProgress = { completed: 0, failed: 0, total: pending.length };
      ctx.progress(`Generando props · 0 de ${pending.length}`);
      let localTail = Promise.resolve();
      const results = await Promise.allSettled(
        pending.map(async (item) => {
          const previous = localTail;
          let release;
          if (input.inferenceMode === 'local')
            localTail = new Promise((resolve) => {
              release = resolve;
            });
          await previous;
          try {
            const url = await image('piece-' + item.id, {
              prompt: characterAssetPrompt(item),
              aspectRatio: '1:1',
              inputImages: characterAssetReferences(item, sourceImage),
            });
            library = validateCharacterVisualLibrary(current().characterVisualLibrary, id);
            if (library.sourceImage !== sourceImage || library.sourceKey !== characterAppearanceKey(doc))
              throw security.fail('El retrato cambió durante la extracción.', 409);
            const target = library.items.find((entry) => entry.id === item.id);
            if (!target) throw security.fail('La pieza cambió.', 409);
            target.image = url;
            target.error = '';
            write({ characterVisualLibrary: library });
            state.assetProgress.completed++;
            ctx.progress(`Props recibidos · ${state.assetProgress.completed} de ${pending.length}`);
          } catch (error) {
            ctx.throwIfAborted?.();
            state.assetProgress.failed++;
            const latest = validateCharacterVisualLibrary(current().characterVisualLibrary, id);
            const target = latest.items.find((entry) => entry.id === item.id);
            if (
              latest.sourceImage === sourceImage &&
              latest.sourceKey === characterAppearanceKey(doc) &&
              target &&
              !target.image
            ) {
              target.error = 'No se pudo generar esta pieza. Puedes reintentar.';
              write({ characterVisualLibrary: latest });
            }
            ctx.progress(
              `Props recibidos · ${state.assetProgress.completed} de ${pending.length} · ${state.assetProgress.failed} pendientes de reintento`,
            );
            throw error;
          } finally {
            release?.();
          }
        }),
      );
      ctx.throwIfAborted?.();
      const failed = results.find((result) => result.status === 'rejected');
      if (failed) throw failed.reason;
    }
    if (job.kind === 'interpret') {
      doc = parseCharacterDocument(state.content);
      const turn = doc.history.find((entry) => entry.id === 'turn_' + job.id);
      if (turn?.imageAction === 'generate') turn.imageStatus = 'generated';
      if (
        doc.request.trim() === (input.request || '').trim() &&
        doc.requestImage === (input.attachmentImage || '')
      ) {
        doc.request = '';
        doc.requestImage = '';
      }
      write({ content: JSON.stringify(doc) });
    }
    if (state.loreEligible && !state.loreSearched) await discoverLore();
    return {
      imageUrl: state.imageUrl || null,
      message: 'Personaje actualizado. Todo el trabajo está guardado.',
    };
  }
  return {
    run,
    checked,
    canResumeReview(job, payload, project) {
      if (
        job.kind !== 'portrait' ||
        !['failed', 'interrupted'].includes(job.status) ||
        !payload.assetSelection ||
        payload.variation ||
        job.state.portraitSaved ||
        !job.state.compositionReviewPending?.outfit ||
        !job.state.compositionSignatures?.outfit ||
        job.state.content !== project.content ||
        !isDeepStrictEqual(job.payload, payload)
      )
        return false;
      const prefix = job.state.compositionReviewPending.outfit;
      if (
        !Object.entries(job.steps).some(
          ([key, value]) =>
            key.startsWith(prefix + '-image-') && characterAssetImage(value?.imageUrl, project.id),
        )
      )
        return false;
      try {
        const document = parseCharacterDocument(project.content);
        return (
          characterCompositionSignature({ project, document }) === job.state.compositionSignatures.outfit
        );
      } catch {
        return false;
      }
    },
    choose(job, choice) {
      if (!['current', 'new'].includes(choice) || job.status !== 'awaiting_choice')
        throw security.fail('La elección no es válida.', 409);
      const project = readCurrentProject(job.projectId),
        doc = parseCharacterDocument(project.content);
      if (
        (project.covers?.[project.currentCoverIndex] || project.covers?.[0]) !== job.result.baseImage ||
        characterAppearanceKey(doc) !== job.result.sourceKey
      )
        throw security.fail('La apariencia cambió; la propuesta permanece en la papelera.', 409);
      job.state.choice = choice;
      job.state.content = project.content;
    },
  };
}
module.exports = { createCharacterBackgroundWorkflow };
