const { randomUUID, randomInt } = require('node:crypto');
const { endpoint } = require('../transport/index.cjs');
const {
  FILM_MAX_REFERENCES,
  FILM_MAX_SCENES,
  FILM_FRAME_OPTIONS,
  FILM_MAX_SECONDS,
  filmContinuityMode,
  filmHash,
  filmLookKey,
  filmNoteKey,
  filmPrevious,
  filmReferenceTag,
  filmSceneNeedsPrompt,
  filmSeconds,
  parseFilmDocument,
  reconcileFilmScenes,
  snapFilmFrames,
  validateFilmDocument,
} = require('../../../public/js/contracts/film.js');
const {
  FILM_PROMPT_INSTRUCTION,
  filmComposePrompt,
  filmRecomposePrompt,
  filmSceneRequest,
  parseFilmPrompt,
  parseFilmShotNote,
} = require('../../../public/js/contracts/film-prompt.js');
const { filmDialogueCapacity, filmDialogueWords } = require('../../../public/js/contracts/film-split.js');
const {
  parseCharacterDocument,
  characterContextText,
} = require('../../../public/js/contracts/character-model.js');
const { parseScenarioDocument, scenarioContextText } = require('../../../public/js/contracts/scenario.js');
const { screenplayShots } = require('../../../public/js/contracts/screenplay.js');
const { createFilmContinuity } = require('./continuity.cjs');

const REQUEST_KEYS = ['projectId', 'token', 'expectedContent', 'scope', 'sceneId', 'scriptProjectId'];
const fold = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
const mentions = (haystack, name) => {
  const needle = fold(name);
  if (needle.length < 3) return -1;
  const found = new RegExp(
    `(^|[^\\p{L}\\p{N}])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`,
    'u',
  ).exec(fold(haystack));
  return found ? found.index + found[1].length : -1;
};

/**
 * Feature film: scenes of the linked screenplay become independent video nodes, and the LLM writes one H3
 * prompt per scene from its shot, dialogue, voice-overs, characters and place. This job never generates video.
 *
 * @param deps shared server capabilities
 * @param ports `infer` (structured JSON text) injected by the queue owner
 */
function createFilmJobs(deps, { infer, readImage, videoFrames, makeOperations }) {
  const { security, assertProject, readCurrentProject, writeProject, documentStore, inference, aiContexts } =
    deps;
  const fail = (message, status = 422) => security.fail(message, status);
  const continuity = createFilmContinuity(deps, { infer, readImage, videoFrames, makeOperations });

  /** Active linked projects of the film, resolved to the version the author selected. */
  function linked(project) {
    return (project.ingredients || [])
      .filter((ingredient) => ingredient.active !== false && ingredient.importedProjectId)
      .map((ingredient) => {
        try {
          const resolved = aiContexts.resolveIngredient(ingredient);
          return resolved ? { ingredient, project: resolved } : null;
        } catch {
          // A deleted project or version is simply not a candidate.
          return null;
        }
      })
      .filter(Boolean);
  }
  /** Ingredients of the film first, then those linked to the screenplay itself; one entry per project. */
  function referenceCandidates(film, script) {
    const own = script.project.ingredients;
    const fromScript = linked({
      ingredients: Array.isArray(own)
        ? own
        : readCurrentProject(script.ingredient.importedProjectId)?.ingredients,
    });
    const seen = new Set();
    return [...linked(film), ...fromScript].filter(({ ingredient }) => {
      if (seen.has(ingredient.importedProjectId)) return false;
      seen.add(ingredient.importedProjectId);
      return true;
    });
  }
  const liveProject = (id) => {
    try {
      return readCurrentProject(id);
    } catch {
      return null;
    }
  };
  const screenplayOf = (content) => {
    const clean = security.validateScreenplayContent(content);
    return clean ? JSON.parse(clean) : null;
  };
  /**
   * The screenplays linked to the film. A screenplay linked as a draft is read as it is now: updating the film from
   * the screenplay means taking its latest shots, durations and text. One linked as a saved version stays as that version.
   */
  const screenplayCandidates = (project) =>
    linked(project)
      .map((entry) => {
        if (!['draft', 'legacy'].includes(entry.ingredient.importedSource)) return entry;
        const current = liveProject(entry.ingredient.importedProjectId);
        return screenplayOf(current?.content)
          ? { ...entry, project: { ...entry.project, content: current.content } }
          : entry;
      })
      .filter(({ project: item }) => screenplayOf(item.content));
  function parseScreenplay(content) {
    const screenplay = screenplayOf(content);
    if (!screenplay)
      throw fail('El guión vinculado aún no está en el formato actual. Ábrelo y guárdalo primero.', 409);
    return screenplay;
  }

  function register(app, queue) {
    const snapshot = (id, projectId) => ({
      job: queue.publicJob(queue.get(id)),
      draft: documentStore.getDraft(projectId),
    });
    app.post(
      '/api/jobs/film',
      endpoint(({ body }) => {
        if (
          !body ||
          typeof body !== 'object' ||
          Array.isArray(body) ||
          Object.keys(body).some((key) => !REQUEST_KEYS.includes(key)) ||
          !security.UUID.test(body.projectId || '') ||
          !security.UUID.test(body.token || '') ||
          typeof body.expectedContent !== 'string' ||
          (body.scope !== undefined &&
            !['all', 'scene', 'failed', 'continuity', 'keyframe'].includes(body.scope)) ||
          (body.scriptProjectId !== undefined && !security.UUID.test(body.scriptProjectId))
        )
          throw security.fail('Trabajo de película inválido.');
        assertProject(body.projectId);
        const project = readCurrentProject(body.projectId);
        if (project.type !== 'video' || project.category !== 'feature')
          throw security.fail('Este trabajo necesita un largometraje.');
        const duplicate = queue.list(project.id).find((job) => queue.get(job.id).token === body.token);
        if (duplicate) return { status: 202, body: snapshot(duplicate.id, project.id) };
        if (queue.list(project.id).some((job) => ['queued', 'running'].includes(job.status)))
          throw security.fail('Esta película ya tiene un trabajo en curso.', 409);
        if (body.expectedContent !== project.content)
          throw security.fail('Guarda la película antes de encolar; su contenido cambió.', 409);
        const film = parseFilmDocument(project.content);
        if (!film) throw security.fail('La película aún no está en el formato actual.', 409);
        const scope = body.scope || 'all';
        deps.saveSafetyVersion?.(project.id, 'Antes de generar la película con IA');
        const scripts = screenplayCandidates(project);
        const script = body.scriptProjectId
          ? scripts.find(({ ingredient }) => ingredient.importedProjectId === body.scriptProjectId)
          : scripts.length === 1
            ? scripts[0]
            : null;
        if (!scripts.length)
          throw security.fail('Añade un guión como ingrediente de la película y mantenlo activo.', 428);
        if (!script)
          throw security.fail(
            'Elige qué guión usar: hay varios activos o el indicado no está vinculado.',
            428,
          );
        if (['scene', 'continuity', 'keyframe'].includes(scope)) {
          if (!film.scenes.some((scene) => scene.id === body.sceneId && !scene.sourceRemoved))
            throw security.fail('La escena indicada no existe.');
        } else if (body.sceneId !== undefined) throw security.fail('La escena solo aplica a regenerar una.');
        else if (
          scope === 'failed' &&
          !film.scenes.some((scene) => scene.status === 'failed' && !scene.sourceRemoved)
        )
          throw security.fail('No hay planos fallidos que reintentar.', 409);
        return {
          status: 202,
          body: snapshot(
            queue.enqueue({
              projectId: project.id,
              kind: 'film',
              token: body.token,
              payload: {
                scope,
                sceneId: body.sceneId,
                scriptProjectId: script.ingredient.importedProjectId,
                expectedContent: project.content,
                textConfig: deps.getLLMConfig(),
                inferenceMode: inference?.currentMode() || 'api',
                inferenceSettings: inference?.currentSettings() || {},
                localModel: inference?.currentLocalModel(),
              },
            }).id,
            project.id,
          ),
        };
      }),
    );
  }

  async function run(job, ctx) {
    const p = job.payload;
    const projectId = job.projectId;
    const local = p.inferenceMode === 'local';
    // All writes are serialized and compare-and-set against the last content this job wrote.
    let tail = Promise.resolve();
    const commit = (mutate) => {
      const operation = tail.then(() => {
        ctx.throwIfAborted();
        const current = readCurrentProject(projectId);
        const expected = ctx.state.content ?? p.expectedContent;
        if (current.content !== expected)
          throw fail('La película cambió fuera del trabajo. No se sobrescribieron esos cambios.', 409);
        const draft = mutate(structuredClone(parseFilmDocument(current.content)));
        draft.identity.name = current.name || draft.identity.name;
        const document = validateFilmDocument(draft);
        const content = JSON.stringify(document);
        writeProject(projectId, { content }, expected);
        ctx.state.content = content;
        ctx.checkpoint();
        return document;
      });
      tail = operation.catch(() => {});
      return operation;
    };
    const project = () => readCurrentProject(projectId);
    const scripts = screenplayCandidates(project());
    const script = scripts.find(({ ingredient }) => ingredient.importedProjectId === p.scriptProjectId);
    if (!script) throw fail('El guión ya no está vinculado a la película.', 409);

    // 1. One clip per shot. Parent scenes retain place/time and never collapse the shot list.
    if (p.scope === 'all') {
      ctx.progress('Creando un clip por plano…');
      await ctx.step('film-scenes', async () => {
        const screenplay = parseScreenplay(script.project.content);
        const incoming = screenplay.scenes.flatMap((scene, sceneIndex) =>
          screenplayShots(scene).map((shot, shotIndex) => {
            // One clip per shot, whatever its dialogue: the shot is one take and lasts what the shot says.
            const lines = [
              scene.heading.text,
              ...(shot.explicit ? [shot.title] : []),
              ...shot.blocks.map((block) => `${block.type}: ${block.text}`),
            ];
            const text = lines.filter(Boolean).join('\n');
            if (text.length > 12000)
              throw fail(
                `El plano ${shotIndex + 1} de la escena ${sceneIndex + 1} es demasiado extenso; divídelo en varios planos.`,
              );
            const base = shot.explicit
              ? `Escena ${sceneIndex + 1} · Plano ${shotIndex + 1} — ${scene.heading.location || scene.heading.text}`
              : scene.heading.text || 'Escena';
            const { seconds } = parseFilmShotNote(shot.explicit ? shot.title : '');
            return {
              id: randomUUID(),
              sourceSceneId: scene.id,
              sourceShotId: shot.id,
              sourcePart: 1,
              sourceParts: 1,
              title: base.slice(0, 300),
              script: text,
              scriptHash: filmHash(text),
              status: 'pending',
              prompt: '',
              promptSource: '',
              promptHash: '',
              // The duration of the shot, when the screenplay states one; otherwise the model proposes it.
              frames: seconds ? snapFilmFrames(Math.min(seconds, FILM_MAX_SECONDS)) : null,
              shot: (shot.explicit ? shot.title : scene.heading.shot || '').slice(0, 400),
              seed: randomInt(0, 2 ** 31),
              references: [],
              referenceNotes: [],
              sourceRemoved: false,
              error: '',
              video: null,
            };
          }),
        );
        if (incoming.length > FILM_MAX_SCENES) throw fail(`El guión supera ${FILM_MAX_SCENES} planos.`);
        await commit((film) => {
          film.source = {
            projectId: script.ingredient.importedProjectId,
            name: script.ingredient.importedProjectName || script.project.name || '',
            origin: script.ingredient.importedSource || 'legacy',
            versionId: script.ingredient.importedVersionId || '',
            versionNumber: script.ingredient.importedVersionNumber || 0,
          };
          film.scenes = reconcileFilmScenes(film.scenes, incoming, randomUUID);
          return film;
        });
        return { scenes: incoming.length };
      });
    }

    // 2. One LLM call per shot that needs a prompt. A failure keeps the rest of the film.
    const screenplay = parseScreenplay(script.project.content);
    const sceneById = new Map(screenplay.scenes.map((scene) => [scene.id, scene]));
    const everything = referenceCandidates(project(), script);
    const noPhoto = new Set();
    // A character linked from a draft arrives as the wrapper the ingredient keeps ({name, role, traits, content}),
    // not as its sheet: the sheet is inside.
    const sheetOf = (item) => {
      const direct = parseCharacterDocument(item.content || '');
      if (direct) return direct;
      try {
        const wrapped = JSON.parse(item.content || '');
        return typeof wrapped?.content === 'string' ? parseCharacterDocument(wrapped.content) : null;
      } catch {
        return null;
      }
    };
    const characters = everything.filter(({ project: item }) => sheetOf(item));
    const places = everything.filter(({ project: item }) => parseScenarioDocument(item.content || ''));
    const document = parseFilmDocument(readCurrentProject(projectId).content);
    const targets = document.scenes.filter((scene) =>
      ['scene', 'continuity', 'keyframe'].includes(p.scope)
        ? scene.id === p.sceneId
        : p.scope === 'failed'
          ? scene.status === 'failed' && !scene.sourceRemoved
          : filmSceneNeedsPrompt(scene),
    );

    /** The references of a shot, and what the author should know about them (who has no photograph, who is not linked). */
    function referencesFor(source, shot) {
      const speakerIds = new Set(shot.blocks.map((block) => block.speakerId).filter(Boolean));
      const blocks = [...shot.blocks, ...source.blocks.filter((block) => speakerIds.has(block.id))];
      const text = [source.heading.text, shot.title, ...blocks.map((block) => block.text)].join('\n');
      const found = [];
      for (const entry of characters) {
        const byBlock = blocks.find(
          (block) => block.type === 'character' && block.characterId === entry.ingredient.importedProjectId,
        );
        const at = byBlock ? 0 : mentions(text, entry.project.name);
        if (at >= 0) found.push({ entry, at: byBlock ? source.blocks.indexOf(byBlock) : at + 1000 });
      }
      found.sort((a, b) => a.at - b.at);
      const place =
        places.find(({ ingredient }) => ingredient.importedProjectId === source.locationId) ||
        places.find(
          ({ project: item }) => mentions(source.heading.location || source.heading.text, item.name) >= 0,
        );
      // Only references with a photo can go to H3; the others are left out and reported.
      const described = found.map(({ entry }) => describe('character', entry));
      const placeReference = place ? describe('stage', place) : null;
      const notes = [];
      for (const reference of [...described, ...(placeReference ? [placeReference] : [])])
        if (!reference.image) {
          noPhoto.add(reference.name || 'sin nombre');
          notes.push(`${reference.name || 'Sin nombre'}: sin foto principal, no se usa como referencia.`);
        }
      // A speaker of the shot that is not one of the linked characters cannot be a reference at all.
      const named = new Set(found.map(({ entry }) => entry.ingredient.importedProjectId));
      for (const block of shot.blocks.filter((item) => item.type === 'character' && item.text.trim())) {
        const speaker = block.text.replace(/\([^)]*\)/g, '').trim();
        const linked = characters.some(
          ({ ingredient, project: item }) =>
            named.has(ingredient.importedProjectId) && mentions(speaker, item.name) >= 0,
        );
        const known = characters.some(({ project: item }) => mentions(speaker, item.name) >= 0);
        if (speaker && !linked && !known && !notes.some((note) => note.startsWith(speaker + ':')))
          notes.push(`${speaker}: no es un personaje vinculado a la película, no se usa como referencia.`);
      }
      const stage = placeReference?.image ? placeReference : null;
      const result = described
        .filter((reference) => reference.image)
        .slice(0, stage ? FILM_MAX_REFERENCES - 1 : FILM_MAX_REFERENCES);
      if (stage) result.push(stage);
      // Tags identify a reference in the prompt, so they are unique inside the scene.
      const used = new Set();
      return {
        references: result.map((reference, index) => {
          let tag = reference.tag || (reference.kind === 'stage' ? 'Place' : 'Character');
          for (let n = 2; used.has(tag); n++) tag = `${reference.tag} ${n}`;
          used.add(tag);
          return { ...reference, tag, picture: index + 1 };
        }),
        notes,
      };
    }
    function describe(kind, { ingredient, project: item }) {
      let description = '';
      let image = '';
      if (kind === 'character') {
        const sheet = sheetOf(item);
        description = sheet
          ? [sheet.description, characterContextText(sheet, { visualOnly: true })].filter(Boolean).join('\n')
          : '';
        const live = liveProject(ingredient.importedProjectId);
        image =
          item.covers?.[item.currentCoverIndex] ||
          item.covers?.[0] ||
          ingredient.covers?.[ingredient.currentCoverIndex] ||
          ingredient.covers?.[0] ||
          live?.covers?.[live.currentCoverIndex] ||
          live?.covers?.[0] ||
          '';
      } else {
        const sheet = parseScenarioDocument(item.content || '');
        // Only what the place IS: its time of day, light, atmosphere and period belong to the photograph, and the
        // screenplay decides them for the scene.
        description = sheet
          ? scenarioContextText({
              ...sheet,
              fields: { ...sheet.fields, period: '', timeOfDay: '', atmosphere: '', lighting: '' },
            })
          : '';
        const establishing = sheet?.views.find((view) => view.id === 'establishing')?.url;
        image = establishing || sheet?.views[0]?.url || sheet?.panorama?.url || item.covers?.[0] || '';
      }
      return {
        id: `ref_${ingredient.importedProjectId.slice(0, 8)}`,
        kind,
        projectId: ingredient.importedProjectId,
        name: item.name || ingredient.importedProjectName || '',
        tag: filmReferenceTag(item.name || ingredient.importedProjectName || ''),
        image: /^\/projects\/[a-f0-9-]{36}\/content\//.test(image) ? image : '',
        description,
      };
    }
    function blocksOf(source, blocks) {
      // The speakers of a divided speech are copies of the original: look them up among the blocks of the part too.
      const speakers = new Map(
        [...source.blocks, ...blocks]
          .filter((block) => block.type === 'character')
          .map((block) => [block.id, block]),
      );
      // A silent presence has no line: only its character and its acotación reach the prompt.
      return blocks
        .filter((block) => block.type !== 'dialogue' || block.text.trim())
        .map((block) => ({
          type: block.type,
          speaker: block.speakerId ? speakers.get(block.speakerId)?.text : undefined,
          voice: block.type === 'character' ? block.voice : undefined,
          text: block.text,
        }));
    }

    /** The characters of a scene, with their descriptions, for what the model writes about its look and continuity. */
    const peopleOf = (references) =>
      references
        .filter((reference) => reference.kind === 'character')
        .map((reference) => ({ name: reference.name, description: reference.description || '' }));
    /** The look of a script scene, written once for all its clips and written again when the scene's shots change. */
    const lookJobs = new Map();
    const ensureLook = (source, references) => {
      if (!lookJobs.has(source.id))
        lookJobs.set(
          source.id,
          (async () => {
            const film = parseFilmDocument(project().content);
            const key = filmLookKey(film, source.id);
            const known = film.looks[source.id];
            if (known && known.key === key) return known.text;
            const heading = source.heading.text;
            const shots = film.scenes
              .filter((item) => item.sourceSceneId === source.id && !item.sourceRemoved)
              .map((item) => item.script);
            const written = await ctx.step(`film-look-${source.id}-${key}`, () =>
              continuity.look({
                ctx,
                p,
                film: film.identity.name,
                heading,
                shots,
                characters: peopleOf(references),
              }),
            );
            await commit((draft) => {
              draft.looks[source.id] = { text: written.text, key };
              return draft;
            });
            return written.text;
          })(),
        );
      return lookJobs.get(source.id);
    };
    /** The continuity note of a clip, from the end of the previous one (its last frame too when the model sees images). */
    const writeNote = async (film, scene, source, references) => {
      const previous = filmPrevious(film, scene);
      if (!previous) return '';
      const key = filmNoteKey(film, scene);
      return ctx.step(`film-note-${scene.id}-${key}`, async () => {
        let frame = null;
        if (previous.preview && continuity.seesImages(p.textConfig.functions.chat.model)) {
          const tail = await continuity.lastFrame(projectId, previous);
          frame = continuity.dataUrl(tail.url);
        }
        return continuity.note({
          ctx,
          p,
          film: film.identity.name,
          heading: source.heading.text,
          previous,
          next: scene,
          characters: peopleOf(references),
          frame,
        });
      });
    };

    const writeScene = async (scene) => {
      const source = sceneById.get(scene.sourceSceneId);
      if (!source) throw fail('La escena ya no existe en el guión.', 409);
      const shots = screenplayShots(source);
      const shot = shots.find((item) => item.id === (scene.sourceShotId || scene.sourceSceneId));
      if (!shot) throw fail('El plano ya no existe en el guión. Actualiza desde el guión.', 409);
      // One shot, one clip: nothing is divided and no dialogue is moved or cut, however long it is.
      const blocks = shot.blocks;
      if (blocks.length > 120 || blocks.some((block) => block.text.length > 1200))
        throw fail(
          'Este plano supera el contenido admitido por clip; divídelo en varios planos sin eliminar texto.',
          422,
        );
      // What the shot states about itself: its framing and its duration. They are data, not the model's choice.
      const stated = parseFilmShotNote(shot.explicit ? shot.title : source.heading.shot);
      const statedSeconds = parseFilmShotNote(shot.explicit ? shot.title : '').seconds;

      await commit((film) => {
        const node = film.scenes.find((item) => item.id === scene.id);
        node.status = 'prompting';
        node.error = '';
        return film;
      });
      const { references, notes } = referencesFor(source, shot);
      const index = screenplay.scenes.indexOf(source);
      const shotIndex = shots.indexOf(shot);
      const previous =
        shotIndex > 0
          ? shots[shotIndex - 1].title
          : index > 0
            ? screenplay.scenes[index - 1].heading.text
            : '';
      const result = await ctx.step(`film-prompt-${scene.id}`, async () => {
        const model = p.textConfig.functions.chat.model;
        const request = filmSceneRequest({
          film: project().name,
          scene: {
            id: source.id,
            shotId: shot.id,
            heading: source.heading.text,
            shot: shot.explicit ? shot.title : source.heading.shot,
            location: source.heading.location,
            time: source.heading.time,
            blocks: blocksOf(source, blocks),
          },
          references,
          previous,
          duration: statedSeconds,
        });
        const tags = references.map((reference) => reference.tag);
        const ask = (extra = '') =>
          infer(
            {
              model,
              stage: 'del prompt del plano',
              maxTokens: Math.min(p.textConfig.functions.chat.maxCompletionTokens || 3000, 3000),
              messages: [
                { role: 'system', content: FILM_PROMPT_INSTRUCTION },
                { role: 'user', content: request + extra },
              ],
            },
            ctx,
          );
        let parsed;
        try {
          parsed = parseFilmPrompt(await ask(), { tags });
        } catch (error) {
          // One correction with the same model, telling it exactly which tags exist; no model change.
          const allowed = tags.length
            ? `The only tags allowed are: ${tags.map((tag) => `<${tag}>`).join(', ')}.`
            : 'This clip has no references: write every character and place by name in plain text, never in angle brackets.';
          const corrected = await ask(
            `\n\nYour previous answer was rejected: ${error.message} ${allowed} Return only the corrected JSON.`,
          );
          try {
            parsed = parseFilmPrompt(corrected, { tags });
          } catch (again) {
            // A name still in angle brackets is a presentation slip, not a lost reference: the name stays, the tag goes.
            if (!/esa referencia no existe/.test(again.message)) throw again;
            parsed = parseFilmPrompt(corrected, { tags, plainUnknownTags: true });
          }
        }
        // How this clip follows the one before it: the look of its scene, and a note on how that one ends.
        const now = parseFilmDocument(project().content);
        const mode = filmContinuityMode(now, scene);
        // The look and the note make the clips cut together; a clip is still written when they cannot be.
        const lost = [];
        const attempt = async (what, task) => {
          try {
            return await task();
          } catch (error) {
            ctx.throwIfAborted();
            lost.push(`${what}: ${String(error.message || 'no se pudo escribir').split('\n')[0]}`);
            return null;
          }
        };
        const look = (await attempt('Aspecto de la escena', () => ensureLook(source, references))) || '';
        let note = '';
        let noteMeta = null;
        if (['cut', 'keyframe', 'take'].includes(mode)) {
          const key = filmNoteKey(now, scene);
          note = scene.continuity.note;
          noteMeta = { noteSource: scene.continuity.noteSource, noteKey: scene.continuity.noteKey };
          if (scene.continuity.noteSource !== 'manual' && (!note || scene.continuity.noteKey !== key)) {
            const written = await attempt('Nota de continuidad', () =>
              writeNote(now, scene, source, references),
            );
            if (written !== null) {
              note = written;
              noteMeta = { noteSource: 'llm', noteKey: key };
            }
          }
        }
        // The prompt has three parts. The reference list and the technical line (shot size, lens, aperture, depth of
        // field, duration) come from data; the model only wrote the creative description between them and the sound.
        // The duration is the one the shot states; only when it states none does the model's proposal stand.
        const frames = statedSeconds ? scene.frames : (parsed.frames ?? scene.frames);
        const seconds = filmSeconds(frames);
        const advice = [...notes];
        const longest = filmSeconds(FILM_FRAME_OPTIONS.at(-1));
        if (statedSeconds > longest)
          advice.push(
            `El plano dura ${statedSeconds} s y un clip admite como máximo ${longest} s; se genera con ese máximo.`,
          );
        const words = filmDialogueWords(blocks);
        const capacity = filmDialogueCapacity(seconds);
        if (words > capacity)
          advice.push(
            `El diálogo tiene ${words} palabras y en ${seconds} s caben unas ${capacity}: sube la duración del plano o acórtalo.`,
          );
        advice.push(...lost);
        for (const name of parsed.repaired)
          advice.push(`${name}: el modelo la citó sin tener referencia; se dejó su nombre en texto.`);
        parsed = {
          ...parsed,
          frames,
          creative: parsed.prompt,
          prompt: filmComposePrompt({
            references,
            framing: stated.framing,
            seconds,
            look,
            continuity: note,
            creative: parsed.prompt,
          }),
        };
        const noted = advice.map((text) => text.slice(0, 200)).slice(0, 8);
        return { ...parsed, references, notes: noted, note, noteMeta };
      });
      await commit((film) => {
        const node = film.scenes.find((item) => item.id === scene.id);
        node.prompt = result.prompt;
        node.creative = result.creative;
        node.continuity.note = result.note;
        if (result.noteMeta) Object.assign(node.continuity, result.noteMeta);
        node.promptSource = 'llm';
        node.promptHash = node.scriptHash;
        node.frames = result.frames;
        node.references = result.references.map(({ description, ...reference }) => reference);
        node.referenceNotes = result.notes;
        node.status = 'ready';
        node.error = '';
        // The clip shown so far came from the previous prompt.
        node.approved = false;
        return film;
      });
    };

    const failures = [];
    const work = async (scene) => {
      ctx.progress(`Escribiendo el prompt: ${scene.title.slice(0, 60)}`);
      try {
        await writeScene(scene);
      } catch (error) {
        ctx.throwIfAborted();
        failures.push({ scene, error });
        await commit((film) => {
          const node = film.scenes.find((item) => item.id === scene.id);
          if (node) {
            node.status = 'failed';
            node.error = String(error.message || 'No se pudo escribir el prompt.').slice(0, 1400);
          }
          return film;
        }).catch(() => {});
      }
    };
    /** Writes the continuity note of a clip again (always) and puts the prompt together with it. */
    const runContinuity = async (scene) => {
      const source = sceneById.get(scene.sourceSceneId);
      const shot =
        source &&
        screenplayShots(source).find((item) => item.id === (scene.sourceShotId || scene.sourceSceneId));
      if (!shot) throw fail('El plano ya no existe en el guión. Actualiza desde el guión.', 409);
      const film = parseFilmDocument(project().content);
      const mode = filmContinuityMode(film, scene);
      if (!['cut', 'keyframe', 'take'].includes(mode))
        throw fail('Este clip no sigue a otro de su escena: no necesita nota de continuidad.', 409);
      const { references } = referencesFor(source, shot);
      ctx.progress(`Escribiendo la nota de continuidad: ${scene.title.slice(0, 60)}`);
      await ensureLook(source, references);
      const key = filmNoteKey(film, scene);
      const text = await writeNote(film, scene, source, references);
      await commit((draft) => {
        const node = draft.scenes.find((item) => item.id === scene.id);
        Object.assign(node.continuity, { note: text, noteSource: 'llm', noteKey: key });
        node.prompt = filmRecomposePrompt(draft, node);
        return draft;
      });
    };
    /** The start frame of a shot, made by the image model from its references and the end of the previous clip. */
    const runKeyframe = async (scene) => {
      const film = parseFilmDocument(project().content);
      const previous = filmPrevious(film, scene);
      ctx.progress(`Generando el fotograma inicial: ${scene.title.slice(0, 60)}`);
      const made = await ctx.step(`film-keyframe-${scene.id}-${Date.now()}`, async () => {
        const tail = previous?.preview ? await continuity.lastFrame(projectId, previous) : null;
        return continuity.keyframe({ ctx, p, projectId, film, clip: scene, previousFrame: tail });
      });
      await commit((draft) => {
        const node = draft.scenes.find((item) => item.id === scene.id);
        node.continuity.start = { url: made.url, key: filmHash(made.url) };
        node.approved = false;
        return draft;
      });
    };
    if (p.scope === 'continuity' || p.scope === 'keyframe') {
      const [scene] = targets;
      if (!scene) throw fail('El plano indicado no existe.', 409);
      await (p.scope === 'continuity' ? runContinuity : runKeyframe)(scene);
      return {
        message: p.scope === 'continuity' ? 'Nota de continuidad lista.' : 'Fotograma inicial listo.',
        scenes: 1,
      };
    }
    if (local) for (const scene of targets) await work(scene);
    else {
      // API providers take a few scenes at once; writes stay serialized.
      const queue = [...targets];
      await Promise.all(
        Array.from({ length: Math.min(3, queue.length) }, async () => {
          while (queue.length) await work(queue.shift());
        }),
      );
    }
    ctx.throwIfAborted();
    if (failures.length) {
      const message = `No se pudo escribir el prompt de ${failures.length} ${failures.length === 1 ? 'plano' : 'planos'}: ${failures[0].error.message} Las demás se guardaron; reintenta el trabajo.`;
      throw Object.assign(fail(message, 502), { publicMessage: message });
    }
    return {
      message: noPhoto.size
        ? `Película preparada. Sin foto principal, no se usaron como referencia: ${[...noPhoto].join(', ')}.`
        : 'Película preparada.',
      scenes: targets.length,
    };
  }

  return { register, run };
}
module.exports = { createFilmJobs };
