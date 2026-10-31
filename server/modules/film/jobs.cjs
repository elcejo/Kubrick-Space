const { randomUUID, randomInt } = require('node:crypto');
const { endpoint } = require('../transport/index.cjs');
const {
  FILM_MAX_REFERENCES,
  FILM_MAX_SCENES,
  FILM_FRAME_OPTIONS,
  filmHash,
  filmReferenceTag,
  filmSceneNeedsPrompt,
  parseFilmDocument,
  reconcileFilmScenes,
  validateFilmDocument,
} = require('../../../public/js/contracts/film.js');
const {
  FILM_PROMPT_INSTRUCTION,
  filmSceneRequest,
  parseFilmPrompt,
} = require('../../../public/js/contracts/film-prompt.js');
const {
  parseCharacterDocument,
  characterContextText,
} = require('../../../public/js/contracts/character-model.js');
const { parseScenarioDocument, scenarioContextText } = require('../../../public/js/contracts/scenario.js');

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
function createFilmJobs(deps, { infer }) {
  const { security, assertProject, readCurrentProject, writeProject, documentStore, inference, aiContexts } =
    deps;
  const fail = (message, status = 422) => security.fail(message, status);

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
  const screenplayCandidates = (project) =>
    linked(project).filter(({ project: item }) => screenplayOf(item.content));
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
          (body.scope !== undefined && !['all', 'scene'].includes(body.scope)) ||
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
        if (scope === 'scene') {
          if (!film.scenes.some((scene) => scene.id === body.sceneId && !scene.sourceRemoved))
            throw security.fail('La escena indicada no existe.');
        } else if (body.sceneId !== undefined) throw security.fail('La escena solo aplica a regenerar una.');
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

    // 1. Scenes: one node per screenplay scene, keeping what the author already has.
    if (p.scope === 'all') {
      ctx.progress('Creando un nodo por escena…');
      await ctx.step('film-scenes', async () => {
        const screenplay = parseScreenplay(script.project.content);
        if (screenplay.scenes.length > FILM_MAX_SCENES)
          throw fail(`El guión supera ${FILM_MAX_SCENES} escenas.`);
        const incoming = screenplay.scenes.map((scene) => {
          const lines = [scene.heading.text, ...scene.blocks.map((block) => `${block.type}: ${block.text}`)];
          const text = lines.filter(Boolean).join('\n').slice(0, 12000);
          return {
            id: randomUUID(),
            sourceSceneId: scene.id,
            title: (scene.heading.text || 'Escena').slice(0, 300),
            script: text,
            scriptHash: filmHash(text),
            status: 'pending',
            prompt: '',
            promptSource: '',
            promptHash: '',
            frames: FILM_FRAME_OPTIONS[0],
            shot: (scene.heading.shot || '').slice(0, 400),
            seed: randomInt(0, 2 ** 31),
            references: [],
            sourceRemoved: false,
            error: '',
            video: null,
          };
        });
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

    // 2. Prompts: one LLM call per scene that needs it. A failure keeps the rest of the film.
    const screenplay = parseScreenplay(script.project.content);
    const sceneById = new Map(screenplay.scenes.map((scene) => [scene.id, scene]));
    const everything = referenceCandidates(project(), script);
    const noPhoto = new Set();
    const characters = everything.filter(({ project: item }) => parseCharacterDocument(item.content || ''));
    const places = everything.filter(({ project: item }) => parseScenarioDocument(item.content || ''));
    const document = parseFilmDocument(readCurrentProject(projectId).content);
    const targets = document.scenes.filter((scene) =>
      p.scope === 'scene' ? scene.id === p.sceneId : filmSceneNeedsPrompt(scene),
    );

    function referencesFor(source) {
      const text = [source.heading.text, ...source.blocks.map((block) => block.text)].join('\n');
      const found = [];
      for (const entry of characters) {
        const byBlock = source.blocks.find(
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
      // Only references with a photo can go to H3; the others are left out and reported once.
      const described = found.map(({ entry }) => describe('character', entry));
      const placeReference = place ? describe('stage', place) : null;
      for (const reference of [...described, ...(placeReference ? [placeReference] : [])])
        if (!reference.image) noPhoto.add(reference.name || 'sin nombre');
      const stage = placeReference?.image ? placeReference : null;
      const result = described
        .filter((reference) => reference.image)
        .slice(0, stage ? FILM_MAX_REFERENCES - 1 : FILM_MAX_REFERENCES);
      if (stage) result.push(stage);
      // Tags identify a reference in the prompt, so they are unique inside the scene.
      const used = new Set();
      return result.map((reference, index) => {
        let tag = reference.tag || (reference.kind === 'stage' ? 'Place' : 'Character');
        for (let n = 2; used.has(tag); n++) tag = `${reference.tag} ${n}`;
        used.add(tag);
        return { ...reference, tag, picture: index + 1 };
      });
    }
    function describe(kind, { ingredient, project: item }) {
      let description = '';
      let image = '';
      if (kind === 'character') {
        const sheet = parseCharacterDocument(item.content || '');
        description = sheet
          ? [sheet.description, characterContextText(sheet, { visualOnly: true })].filter(Boolean).join('\n')
          : '';
        const live = liveProject(ingredient.importedProjectId);
        image =
          item.covers?.[item.currentCoverIndex] ||
          item.covers?.[0] ||
          live?.covers?.[live.currentCoverIndex] ||
          live?.covers?.[0] ||
          '';
      } else {
        const sheet = parseScenarioDocument(item.content || '');
        description = sheet ? scenarioContextText(sheet) : '';
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
    function blocksOf(source) {
      const speakers = new Map(
        source.blocks.filter((block) => block.type === 'character').map((block) => [block.id, block]),
      );
      return source.blocks.map((block) => ({
        type: block.type,
        speaker: block.speakerId ? speakers.get(block.speakerId)?.text : undefined,
        voice: block.type === 'character' ? block.voice : undefined,
        text: block.text,
      }));
    }

    const writeScene = async (scene) => {
      const source = sceneById.get(scene.sourceSceneId);
      if (!source) throw fail('La escena ya no existe en el guión.', 409);
      await commit((film) => {
        const node = film.scenes.find((item) => item.id === scene.id);
        node.status = 'prompting';
        node.error = '';
        return film;
      });
      const references = referencesFor(source);
      const index = screenplay.scenes.indexOf(source);
      const previous = index > 0 ? screenplay.scenes[index - 1].heading.text : '';
      const result = await ctx.step(`film-prompt-${scene.id}`, async () => {
        const model = p.textConfig.functions.chat.model;
        const request = filmSceneRequest({
          film: project().name,
          scene: {
            heading: source.heading.text,
            shot: source.heading.shot,
            location: source.heading.location,
            time: source.heading.time,
            blocks: blocksOf(source),
          },
          references,
          previous,
        });
        const tags = references.map((reference) => reference.tag);
        const ask = (extra = '') =>
          infer(
            {
              model,
              stage: 'del prompt de la escena',
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
          // One correction with the same model; no other retry and no model change.
          parsed = parseFilmPrompt(
            await ask(
              `\n\nYour previous answer was rejected: ${error.message} Return only the corrected JSON.`,
            ),
            { tags },
          );
        }
        return { ...parsed, references };
      });
      await commit((film) => {
        const node = film.scenes.find((item) => item.id === scene.id);
        node.prompt = result.prompt;
        node.promptSource = 'llm';
        node.promptHash = node.scriptHash;
        node.frames = result.frames;
        node.shot = result.shot || node.shot;
        node.references = result.references.map(({ description, ...reference }) => reference);
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
      const message = `No se pudo escribir el prompt de ${failures.length} ${failures.length === 1 ? 'escena' : 'escenas'}: ${failures[0].error.message} Las demás se guardaron; reintenta el trabajo.`;
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
