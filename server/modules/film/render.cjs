const { randomInt, randomUUID } = require('node:crypto');
const { endpoint } = require('../transport/index.cjs');
const {
  filmConditioningKey,
  filmConditioningName,
  filmDimensions,
  filmFinalDimensions,
  filmFinalKey,
  filmContinuityMode,
  filmGuideKey,
  filmNeedsConditioning,
  filmNeedsFinal,
  filmPrevious,
  filmPreviewOutdated,
  filmTakeFrames,
  FILM_MAX_REFERENCES,
  FILM_TAIL_FRAMES,
  parseFilmDocument,
  validateFilmDocument,
} = require('../../../public/js/contracts/film.js');
const { filmRecomposePrompt } = require('../../../public/js/contracts/film-prompt.js');

const RENDER_KIND = 'film-render';
const ACTIONS = ['approve', 'unapprove', 'redo'];
const ACTIVE = ['queued', 'running'];
const STAGES = ['preview', 'final'];
const SOURCE_SCENE = /^[A-Za-z0-9_-]{1,140}$/;
/** The latent upscaler refines with one of three fixed schedules: the film's steps are held to that range. */
const upscalerSteps = (steps) => Math.min(5, Math.max(3, steps));
const IMAGE_URL = /^\/projects\/([a-f0-9-]{36})\/content\/([^/]+)$/;

/**
 * Second and third stage of the film, per dramatic scene (the author works on one at a time): saved conditioning for
 * its clips (one text encoder load), then one preview video at a time from that conditioning; and, for the approved
 * previews, the final videos enlarged by the H3 latent upscaler. Re-doing a clip queues it ahead of the rest.
 *
 * @param deps shared server capabilities
 * @param ports `readImage(projectId, filename)` returning a data URL of a project image
 */
function createFilmRender(deps, { readImage, videoFrames }) {
  const { security, assertProject, readCurrentProject, writeProject, documentStore, inference } = deps;
  const { PROJECTS_DIR, ensureDir, fs, path } = deps;
  const fail = (message, status = 422) => security.fail(message, status);
  /** The latest preview of the sampling of each running job, for the task panel. */
  const livePreviews = new Map();

  /** Synchronous read-modify-write: nothing can interleave, so the job and the author's clicks never overwrite each other. */
  function update(projectId, mutate) {
    const current = readCurrentProject(projectId);
    const document = parseFilmDocument(current.content);
    if (!document) throw fail('La película aún no está en el formato actual.', 409);
    const draft = mutate(structuredClone(document));
    if (!draft) return document;
    draft.identity.name = current.name || draft.identity.name;
    const next = validateFilmDocument(draft);
    writeProject(projectId, { content: JSON.stringify(next) }, current.content);
    return next;
  }
  const filmProject = (projectId) => {
    assertProject(projectId);
    const project = readCurrentProject(projectId);
    if (project.type !== 'video' || project.category !== 'feature')
      throw fail('Este trabajo necesita un largometraje.');
    return project;
  };
  const previewFile = (projectId, url) => {
    const match = IMAGE_URL.exec(url || '');
    return match && match[1] === projectId
      ? security.containedPath(PROJECTS_DIR, projectId, 'content', path.basename(match[2]))
      : null;
  };

  function register(app, queue) {
    app.get('/api/jobs/:jobId/live-preview', (request, response) => {
      const preview = security.UUID.test(request.params.jobId)
        ? livePreviews.get(request.params.jobId)
        : null;
      if (!preview)
        return response.status(404).json({ error: 'Esta tarea no tiene previsualización en vivo.' });
      response.set({ 'Content-Type': preview.mime, 'Cache-Control': 'no-store' });
      return response.send(preview.buffer);
    });
    const snapshot = (id, projectId) => ({
      job: id ? queue.publicJob(queue.get(id)) : null,
      draft: documentStore.getDraft(projectId),
    });
    const activeJob = (projectId) =>
      queue
        .list(projectId)
        .find((job) => queue.get(job.id).kind === RENDER_KIND && ACTIVE.includes(job.status));
    const enqueue = (project, token, { sourceSceneId = '', stage = 'preview' } = {}) =>
      queue.enqueue({
        projectId: project.id,
        kind: RENDER_KIND,
        token,
        payload: {
          sourceSceneId,
          stage,
          // Step timeouts for the local engine are longer than for an API; nothing here uses a text model.
          inferenceMode: 'local',
          inferenceSettings: inference.currentSettings(),
          expectedContent: project.content,
        },
      });
    /** The top bar decides: previews run only in Local mode with the video model chosen for this project. */
    const available = () => {
      if (inference.currentSettings?.()?.videoModel?.model !== 'minimax-h3')
        throw fail(
          'Elige el modelo de video local en la barra superior para generar las previsualizaciones.',
          428,
        );
      if (!inference.localVideoAvailable?.())
        throw fail('Faltan los pesos locales de MiniMax H3 en models/video/h3.', 428);
    };

    app.post(
      '/api/jobs/film/render',
      endpoint(({ body }) => {
        if (
          !body ||
          typeof body !== 'object' ||
          Array.isArray(body) ||
          Object.keys(body).some(
            (key) => !['projectId', 'token', 'expectedContent', 'sourceSceneId', 'stage'].includes(key),
          ) ||
          !security.UUID.test(body.projectId || '') ||
          !security.UUID.test(body.token || '') ||
          typeof body.expectedContent !== 'string' ||
          (body.sourceSceneId !== undefined && !SOURCE_SCENE.test(body.sourceSceneId)) ||
          (body.stage !== undefined && !STAGES.includes(body.stage))
        )
          throw fail('Trabajo de video inválido.', 400);
        const project = filmProject(body.projectId);
        const duplicate = queue.list(project.id).find((job) => queue.get(job.id).token === body.token);
        if (duplicate) return { status: 202, body: snapshot(duplicate.id, project.id) };
        if (queue.list(project.id).some((job) => ACTIVE.includes(job.status)))
          throw fail('Esta película ya tiene un trabajo en curso.', 409);
        if (body.expectedContent !== project.content)
          throw fail('Guarda la película antes de encolar; su contenido cambió.', 409);
        const document = parseFilmDocument(project.content);
        const scope = body.sourceSceneId || '';
        const stage = body.stage || 'preview';
        const inScope = (scene) => !scope || scene.sourceSceneId === scope;
        if (scope && !document?.scenes.some((scene) => !scene.sourceRemoved && inScope(scene)))
          throw fail('La escena indicada no existe en la película.', 404);
        if (!document?.scenes.some((scene) => !scene.sourceRemoved && scene.prompt && inScope(scene)))
          throw fail('Primero genera los prompts de esta escena.', 428);
        available();
        if (stage === 'final') {
          const wanted = document.scenes.filter(
            (scene) =>
              inScope(scene) && filmNeedsFinal(scene, document.params, filmGuideKey(document, scene)),
          );
          if (!wanted.length)
            throw fail(
              'No hay clips aprobados pendientes de video final en esta escena. Aprueba las previsualizaciones primero.',
              409,
            );
          if (inference.localUpscalerAvailable && !inference.localUpscalerAvailable())
            throw fail('Falta el modelo de escalado H3 LUp en models/video/h3/lup.', 428);
        }
        return {
          status: 202,
          body: snapshot(enqueue(project, body.token, { sourceSceneId: scope, stage }).id, project.id),
        };
      }),
    );

    app.post(
      '/api/jobs/film/scene',
      endpoint(({ body }) => {
        if (
          !body ||
          typeof body !== 'object' ||
          Array.isArray(body) ||
          Object.keys(body).some((key) => !['projectId', 'sceneId', 'action'].includes(key)) ||
          !security.UUID.test(body.projectId || '') ||
          !security.UUID.test(body.sceneId || '') ||
          !ACTIONS.includes(body.action)
        )
          throw fail('Acción de escena inválida.', 400);
        const project = filmProject(body.projectId);
        const document = parseFilmDocument(project.content);
        const scene = document?.scenes.find((item) => item.id === body.sceneId && !item.sourceRemoved);
        if (!scene) throw fail('El plano indicado no existe.');
        if (body.action !== 'redo') {
          if (body.action === 'approve' && !scene.preview)
            throw fail('Esta escena aún no tiene previsualización que aprobar.', 409);
          update(project.id, (film) => {
            film.scenes.find((item) => item.id === scene.id).approved = body.action === 'approve';
            return film;
          });
          return { status: 200, body: snapshot(activeJob(project.id)?.id, project.id) };
        }
        if (filmNeedsConditioning(scene)) throw fail('Primero genera el conditioning de esta escena.', 409);
        available();
        update(project.id, (film) => {
          const order = Math.max(0, ...film.scenes.map((item) => item.redo)) + 1;
          const node = film.scenes.find((item) => item.id === scene.id);
          node.redo = order;
          node.approved = false;
          return film;
        });
        // A running job picks the request up after the video it is making; otherwise one starts now.
        const running = activeJob(project.id);
        const job =
          running ||
          enqueue(readCurrentProject(project.id), randomUUID(), { sourceSceneId: scene.sourceSceneId });
        return { status: running ? 200 : 202, body: snapshot(job.id, project.id) };
      }),
    );
  }

  async function run(job, ctx) {
    const projectId = job.projectId;
    const read = () => parseFilmDocument(readCurrentProject(projectId).content);
    const edit = (mutate) => {
      ctx.throwIfAborted();
      const document = update(projectId, mutate);
      ctx.checkpoint();
      return document;
    };
    const failures = [];
    // Scenes that failed in this run are not retried until the author starts another one.
    const skipped = new Set();
    const scene = (film, id) => film.scenes.find((item) => item.id === id);
    // The job works on one dramatic scene of the script; a redo of a clip elsewhere is still honoured.
    const scope = job.payload?.sourceSceneId || '';
    const stage = job.payload?.stage || 'preview';
    const inScope = (item) => !scope || item.sourceSceneId === scope;

    /**
     * Measures one task of the engine for the task panel: the stage it is in over time, the step and its time, and the
     * latest preview of the sampling. The finished clip keeps its stage times in `state.done`.
     */
    async function measured(kind, label, work) {
      const startedAt = Date.now();
      let last = null;
      let published = { at: 0, stage: '' };
      const publish = (snapshot) => {
        last = snapshot;
        const at = Date.now();
        if (!snapshot.finished && snapshot.stage === published.stage && at - published.at < 1500) return;
        published = { at, stage: snapshot.stage };
        ctx.state.live = {
          kind,
          label: label.slice(0, 120),
          startedAt: new Date(startedAt).toISOString(),
          stage: snapshot.stage,
          step: snapshot.step,
          total: snapshot.total,
          stepMs: snapshot.stepMs,
          avgStepMs: snapshot.avgStepMs,
          elapsedMs: snapshot.elapsedMs,
          at: Date.now(),
          finished: snapshot.finished === true,
          segments: snapshot.segments,
          previewVersion: livePreviews.get(job.id)?.version || 0,
        };
        try {
          ctx.checkpoint();
        } catch {
          // The job is stopping.
        }
      };
      const hooks = {
        onTelemetry: publish,
        onPreview: (frame) => {
          const version = (livePreviews.get(job.id)?.version || 0) + 1;
          livePreviews.set(job.id, { ...frame, version });
          if (ctx.state.live) ctx.state.live.previewVersion = version;
        },
      };
      let outcome = 'completed';
      try {
        return await work(hooks);
      } catch (error) {
        outcome = ctx.signal.aborted ? 'cancelled' : 'failed';
        throw error;
      } finally {
        const done = Array.isArray(ctx.state.done) ? ctx.state.done : [];
        done.push({
          kind,
          label: label.slice(0, 120),
          outcome,
          totalMs: Date.now() - startedAt,
          avgStepMs: last?.avgStepMs ?? null,
          steps: last?.total || 0,
          segments: (last?.segments || []).slice(0, 400),
        });
        ctx.state.done = done.slice(-40);
        delete ctx.state.live;
        try {
          ctx.checkpoint();
        } catch {
          // The job is stopping.
        }
      }
    }

    /** What guides the start of a clip in the graph: the end of the previous clip (a take) or its start frame. */
    const guideOf = (film, target) => {
      const mode = filmContinuityMode(film, target);
      if (mode === 'take') {
        const file = previewFile(projectId, filmPrevious(film, target)?.preview?.url);
        return file ? { kind: 'tail', file } : null;
      }
      if (mode === 'keyframe') {
        const file = previewFile(projectId, target.continuity.start?.url);
        return file ? { kind: 'start', file } : null;
      }
      return null;
    };
    /**
     * A cut that asks for it carries the last frame of the previous clip as one more reference image, named after the
     * previous shot. It is made when that clip has its preview and again whenever the preview changes; the prompt that
     * mentions it is put together again, and the conditioning follows because its references changed.
     */
    async function syncContinuityFrames() {
      const film = read();
      for (const item of film.scenes) {
        if (!inScope(item) || item.sourceRemoved) continue;
        const wanted =
          filmContinuityMode(film, item) === 'cut' && item.continuity.frame ? filmPrevious(film, item) : null;
        const current = item.references.find((reference) => reference.kind === 'continuity');
        const id = wanted?.preview ? `prev-${wanted.preview.version}-${wanted.id.slice(0, 8)}` : '';
        if (current?.id === id || (!current && !id)) continue;
        const url = id
          ? await ctx.step(`film-tail-${item.id}-${id}`, async () => {
              const match = IMAGE_URL.exec(wanted.preview.url);
              const source = security.containedPath(
                PROJECTS_DIR,
                projectId,
                'content',
                path.basename(match[2]),
              );
              const directory = security.containedPath(PROJECTS_DIR, projectId, 'content');
              ensureDir(directory);
              const filename = `film-tail-${randomUUID()}.png`;
              await videoFrames.last(source, path.join(directory, filename));
              return `/projects/${projectId}/content/${filename}`;
            })
          : '';
        edit((draft) => {
          const node = scene(draft, item.id);
          const rest = node.references.filter((reference) => reference.kind !== 'continuity');
          if (url && rest.length < FILM_MAX_REFERENCES)
            rest.push({
              id,
              kind: 'continuity',
              projectId,
              name: 'Plano anterior',
              tag: 'Previous shot',
              image: url,
              picture: 0,
            });
          node.references = rest.map((reference, index) => ({ ...reference, picture: index + 1 }));
          node.prompt = filmRecomposePrompt(draft, node);
          return draft;
        });
      }
    }

    /** The saved conditioning of one clip (prompt and named references), kept for the preview that follows. */
    async function conditionClip(id) {
      const film = read();
      const target = scene(film, id);
      if (!target || !filmNeedsConditioning(target)) return;
      const key = filmConditioningKey(target);
      const name = filmConditioningName(film, target);
      edit((draft) => {
        const node = scene(draft, target.id);
        node.render = 'conditioning';
        node.renderError = '';
        return draft;
      });
      try {
        await ctx.step(`film-conditioning-${target.id}-${key}`, async () => {
          const images = target.references
            .filter((reference) => reference.image)
            .map((reference) => {
              const match = IMAGE_URL.exec(reference.image);
              return readImage(match[1], match[2]);
            });
          if (images.length !== target.references.length)
            throw fail(`Falta la foto principal de ${target.references.find((r) => !r.image).name}.`);
          return measured('conditioning', target.title, (hooks) =>
            inference.runLocalVideo(
              (video, signal) =>
                video.conditioning(
                  {
                    name,
                    prompt: target.prompt,
                    tags: target.references.map((reference) => reference.tag),
                    images,
                  },
                  signal,
                  hooks,
                ),
              ctx.signal,
            ),
          );
        });
        edit((draft) => {
          const node = scene(draft, target.id);
          node.conditioning = { name, key };
          node.render = 'idle';
          return draft;
        });
      } catch (error) {
        ctx.throwIfAborted();
        failures.push(error);
        skipped.add(target.id);
        edit((draft) => {
          const node = scene(draft, target.id);
          node.render = 'failed';
          node.renderError = String(error.message || 'No se pudo preparar la escena.').slice(0, 1400);
          return draft;
        });
      }
    }

    /** Final videos: each approved preview of the scene, enlarged by the latent upscaler, one at a time. */
    async function runFinals() {
      let made = 0;
      for (;;) {
        ctx.throwIfAborted();
        const film = read();
        const target = film.scenes.find(
          (item) =>
            inScope(item) &&
            !skipped.has(item.id) &&
            filmNeedsFinal(item, film.params, filmGuideKey(film, item)),
        );
        if (!target) break;
        const live = film.scenes.filter((item) => inScope(item) && !item.sourceRemoved);
        ctx.progress(`Video final ${live.indexOf(target) + 1}/${live.length}: ${target.title.slice(0, 50)}`);
        const key = filmFinalKey(target, film.params);
        const version = (target.final?.version || 0) + 1;
        const size = filmFinalDimensions(target.preview, film.params.finalMegapixels);
        edit((draft) => {
          const node = scene(draft, target.id);
          node.render = 'finalizing';
          node.renderError = '';
          return draft;
        });
        try {
          const saved = await ctx.step(`film-final-${target.id}-${key}-${version}`, async () => {
            const result = await measured('final', target.title, (hooks) =>
              inference.runLocalVideo(
                (video, signal) =>
                  video.final(
                    {
                      name: target.conditioning.name,
                      width: target.preview.width,
                      height: target.preview.height,
                      frames: target.preview.frames,
                      seed: target.preview.seed,
                      megapixels: film.params.finalMegapixels,
                      steps: upscalerSteps(film.params.steps),
                      guide: guideOf(film, target),
                    },
                    signal,
                    hooks,
                  ),
                ctx.signal,
              ),
            );
            ctx.throwIfAborted();
            const directory = security.containedPath(PROJECTS_DIR, projectId, 'content');
            ensureDir(directory);
            const filename = `film-${randomUUID()}.mp4`;
            fs.writeFileSync(path.join(directory, filename), result.buffer, { flag: 'wx' });
            return { filename };
          });
          let replaced;
          edit((draft) => {
            const node = scene(draft, target.id);
            replaced = node.final?.url;
            node.final = {
              url: `/projects/${projectId}/content/${saved.filename}`,
              seed: target.preview.seed,
              width: size.width,
              height: size.height,
              frames: target.preview.frames,
              version,
              key,
              overlap: target.preview.overlap,
              guide: target.preview.guide,
            };
            node.render = 'idle';
            return draft;
          });
          const old = previewFile(projectId, replaced);
          if (old) fs.rmSync(old, { force: true });
          made++;
        } catch (error) {
          ctx.throwIfAborted();
          failures.push(error);
          skipped.add(target.id);
          edit((draft) => {
            const node = scene(draft, target.id);
            node.render = 'failed';
            node.renderError = String(error.message || 'No se pudo generar el video final.').slice(0, 1400);
            return draft;
          });
        }
      }
      if (failures.length) {
        const message = `No se completaron ${failures.length} ${failures.length === 1 ? 'video final' : 'videos finales'}: ${failures[0].message} Lo demás se guardó; reintenta el trabajo.`;
        throw Object.assign(fail(message, 502), { publicMessage: message });
      }
      return { message: 'Videos finales listos.', finals: made };
    }

    // Whatever happens, a scene never stays marked as working after this job stops.
    try {
      if (stage === 'final') return await runFinals();
      // 1. Conditioning: the text encoder loads once and every scene is encoded and saved in turn.
      await syncContinuityFrames();
      const first = read();
      const pending = first.scenes.filter((item) => inScope(item) && filmNeedsConditioning(item));
      let encoded = 0;
      for (const item of pending) {
        ctx.progress(`Conditioning ${++encoded}/${pending.length}: ${item.title.slice(0, 60)}`);
        await conditionClip(item.id);
      }
      // The text encoder is no longer needed; free it before the diffusion model loads.
      if (pending.length) await inference.runLocalVideo((video, signal) => video.release(signal), ctx.signal);

      // 2. Previews: one video at a time. A redo outranks the main order but never interrupts the video in progress.
      let made = 0;
      for (;;) {
        ctx.throwIfAborted();
        // A clip that follows another is made after it: its reference frame and its conditioning wait for that preview.
        await syncContinuityFrames();
        const changed = read().scenes.filter(
          (item) =>
            inScope(item) && !item.sourceRemoved && !skipped.has(item.id) && filmNeedsConditioning(item),
        );
        for (const item of changed) await conditionClip(item.id);
        const film = read();
        const ready = film.scenes.filter(
          (item) =>
            !item.sourceRemoved && item.conditioning && !filmNeedsConditioning(item) && !skipped.has(item.id),
        );
        const target =
          ready.filter((item) => item.redo > 0).sort((a, b) => a.redo - b.redo)[0] ||
          ready.find(
            (item) =>
              inScope(item) &&
              (!item.preview ||
                item.preview.key !== item.conditioning.key ||
                filmPreviewOutdated(item, film.params, filmGuideKey(film, item))),
          );
        if (!target) break;
        // A take or a start frame needs what it starts from: refuse the clip, with the reason, and go on.
        const mode = filmContinuityMode(film, target);
        const before = filmPrevious(film, target);
        const missing =
          mode === 'take' &&
          (!before?.preview || skipped.has(before.id) || filmPreviewOutdated(before, film.params))
            ? 'La continuación necesita la previsualización vigente del plano anterior.'
            : mode === 'keyframe' && !target.continuity.start
              ? 'Genera primero el fotograma inicial de este plano.'
              : '';
        if (missing) {
          skipped.add(target.id);
          failures.push(fail(missing, 409));
          edit((draft) => {
            const node = scene(draft, target.id);
            node.render = 'failed';
            node.renderError = missing;
            node.redo = 0;
            return draft;
          });
          continue;
        }
        ctx.progress(
          `Previsualización ${target.redo > 0 ? '(repetición) ' : ''}${film.scenes.indexOf(target) + 1}/${film.scenes.length}: ${target.title.slice(0, 50)}`,
        );
        const redo = target.redo > 0;
        const seed = redo || !Number.isSafeInteger(target.seed) ? randomInt(0, 2 ** 31) : target.seed;
        const { width, height } = filmDimensions(film.params);
        const version = (target.preview?.version || 0) + 1;
        // A take also makes the frames that repeat the end of the previous clip, to guide its start.
        const frames = mode === 'take' ? filmTakeFrames(target.frames) : target.frames;
        edit((draft) => {
          const node = scene(draft, target.id);
          node.render = 'generating';
          node.renderError = '';
          return draft;
        });
        try {
          const saved = await ctx.step(
            `film-preview-${target.id}-${target.conditioning.key}-${seed}-${version}`,
            async () => {
              const result = await measured('preview', target.title, (hooks) =>
                inference.runLocalVideo(
                  (video, signal) =>
                    video.preview(
                      {
                        name: target.conditioning.name,
                        width,
                        height,
                        frames,
                        seed,
                        guide: guideOf(film, target),
                      },
                      signal,
                      hooks,
                    ),
                  ctx.signal,
                ),
              );
              ctx.throwIfAborted();
              const directory = security.containedPath(PROJECTS_DIR, projectId, 'content');
              ensureDir(directory);
              const filename = `film-${randomUUID()}.mp4`;
              fs.writeFileSync(path.join(directory, filename), result.buffer, { flag: 'wx' });
              return { filename };
            },
          );
          const url = `/projects/${projectId}/content/${saved.filename}`;
          let replaced;
          edit((draft) => {
            const node = scene(draft, target.id);
            replaced = node.preview?.url;
            node.preview = {
              url,
              seed,
              width,
              height,
              frames,
              version,
              key: target.conditioning.key,
              overlap: mode === 'take' ? FILM_TAIL_FRAMES : 0,
              guide: filmGuideKey(film, target),
            };
            node.approved = false;
            node.redo = 0;
            node.render = 'idle';
            return draft;
          });
          const old = previewFile(projectId, replaced);
          if (old) fs.rmSync(old, { force: true });
          made++;
        } catch (error) {
          ctx.throwIfAborted();
          failures.push(error);
          skipped.add(target.id);
          edit((draft) => {
            const node = scene(draft, target.id);
            node.render = 'failed';
            node.renderError = String(error.message || 'No se pudo generar la previsualización.').slice(
              0,
              1400,
            );
            // A failed redo is dropped: the clip already on screen stays.
            node.redo = 0;
            return draft;
          });
        }
      }
      if (failures.length) {
        const message = `No se completaron ${failures.length} ${failures.length === 1 ? 'plano' : 'planos'}: ${failures[0].message} Lo demás se guardó; reintenta el trabajo.`;
        throw Object.assign(fail(message, 502), { publicMessage: message });
      }
      return { message: 'Previsualizaciones listas.', previews: made };
    } finally {
      livePreviews.delete(job.id);
      try {
        update(projectId, (draft) => {
          let changed = false;
          for (const node of draft.scenes)
            if (['conditioning', 'generating', 'finalizing'].includes(node.render)) {
              node.render = 'idle';
              changed = true;
            }
          return changed ? draft : null;
        });
      } catch {
        // The project can be gone or changed; the next run starts from the stored state anyway.
      }
    }
  }

  return { register, run };
}

module.exports = { createFilmRender, RENDER_KIND };
