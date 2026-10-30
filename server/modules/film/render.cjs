const { randomInt, randomUUID } = require('node:crypto');
const { endpoint } = require('../transport/index.cjs');
const {
  filmConditioningKey,
  filmConditioningName,
  filmDimensions,
  filmNeedsConditioning,
  parseFilmDocument,
  validateFilmDocument,
} = require('../../../public/js/contracts/film.js');

const RENDER_KIND = 'film-render';
const ACTIONS = ['approve', 'unapprove', 'redo'];
const ACTIVE = ['queued', 'running'];
const IMAGE_URL = /^\/projects\/([a-f0-9-]{36})\/content\/([^/]+)$/;

/**
 * Second and third stage of the film: saved conditioning for every scene (one text encoder load), then one preview
 * video at a time from that conditioning. Re-doing a scene queues it ahead of the rest of the film.
 *
 * @param deps shared server capabilities
 * @param ports `readImage(projectId, filename)` returning a data URL of a project image
 */
function createFilmRender(deps, { readImage }) {
  const { security, assertProject, readCurrentProject, writeProject, documentStore, inference } = deps;
  const { PROJECTS_DIR, ensureDir, fs, path } = deps;
  const fail = (message, status = 422) => security.fail(message, status);

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
    const snapshot = (id, projectId) => ({
      job: id ? queue.publicJob(queue.get(id)) : null,
      draft: documentStore.getDraft(projectId),
    });
    const activeJob = (projectId) =>
      queue
        .list(projectId)
        .find((job) => queue.get(job.id).kind === RENDER_KIND && ACTIVE.includes(job.status));
    const enqueue = (project, token) =>
      queue.enqueue({
        projectId: project.id,
        kind: RENDER_KIND,
        token,
        payload: {
          // Step timeouts for the local engine are longer than for an API; nothing here uses a text model.
          inferenceMode: 'local',
          inferenceSettings: {},
          expectedContent: project.content,
        },
      });
    const available = () => {
      if (!inference?.localVideoAvailable?.())
        throw fail('Faltan los pesos locales de MiniMax H3 en models/video/h3.', 428);
    };

    app.post(
      '/api/jobs/film/render',
      endpoint(({ body }) => {
        if (
          !body ||
          typeof body !== 'object' ||
          Array.isArray(body) ||
          Object.keys(body).some((key) => !['projectId', 'token', 'expectedContent'].includes(key)) ||
          !security.UUID.test(body.projectId || '') ||
          !security.UUID.test(body.token || '') ||
          typeof body.expectedContent !== 'string'
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
        if (!document?.scenes.some((scene) => !scene.sourceRemoved && scene.prompt))
          throw fail('Primero genera los prompts de las escenas.', 428);
        available();
        return { status: 202, body: snapshot(enqueue(project, body.token).id, project.id) };
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
        if (!scene) throw fail('La escena indicada no existe.');
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
        const job = running || enqueue(readCurrentProject(project.id), randomUUID());
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

    // Whatever happens, a scene never stays marked as working after this job stops.
    try {
      // 1. Conditioning: the text encoder loads once and every scene is encoded and saved in turn.
      const first = read();
      const pending = first.scenes.filter((item) => filmNeedsConditioning(item));
      let encoded = 0;
      for (const item of pending) {
        ctx.progress(`Conditioning ${++encoded}/${pending.length}: ${item.title.slice(0, 60)}`);
        const film = read();
        const target = scene(film, item.id);
        if (!target || !filmNeedsConditioning(target)) continue;
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
            return inference.runLocalVideo(
              (video, signal) =>
                video.conditioning(
                  {
                    name,
                    prompt: target.prompt,
                    tags: target.references.map((reference) => reference.tag),
                    images,
                  },
                  signal,
                ),
              ctx.signal,
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
      // The text encoder is no longer needed; free it before the diffusion model loads.
      if (pending.length) await inference.runLocalVideo((video, signal) => video.release(signal), ctx.signal);

      // 2. Previews: one video at a time. A redo outranks the main order but never interrupts the video in progress.
      let made = 0;
      for (;;) {
        ctx.throwIfAborted();
        const film = read();
        const ready = film.scenes.filter(
          (item) =>
            !item.sourceRemoved && item.conditioning && !filmNeedsConditioning(item) && !skipped.has(item.id),
        );
        const target =
          ready.filter((item) => item.redo > 0).sort((a, b) => a.redo - b.redo)[0] ||
          ready.find((item) => !item.preview || item.preview.key !== item.conditioning.key);
        if (!target) break;
        ctx.progress(
          `Previsualización ${target.redo > 0 ? '(repetición) ' : ''}${film.scenes.indexOf(target) + 1}/${film.scenes.length}: ${target.title.slice(0, 50)}`,
        );
        const redo = target.redo > 0;
        const seed = redo || !Number.isSafeInteger(target.seed) ? randomInt(0, 2 ** 31) : target.seed;
        const { width, height } = filmDimensions(film.params);
        const version = (target.preview?.version || 0) + 1;
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
              const result = await inference.runLocalVideo(
                (video, signal) =>
                  video.preview(
                    { name: target.conditioning.name, width, height, frames: target.frames, seed },
                    signal,
                  ),
                ctx.signal,
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
              frames: target.frames,
              version,
              key: target.conditioning.key,
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
        const message = `No se completaron ${failures.length} ${failures.length === 1 ? 'escena' : 'escenas'}: ${failures[0].message} Lo demás se guardó; reintenta el trabajo.`;
        throw Object.assign(fail(message, 502), { publicMessage: message });
      }
      return { message: 'Previsualizaciones listas.', previews: made };
    } finally {
      try {
        update(projectId, (draft) => {
          let changed = false;
          for (const node of draft.scenes)
            if (['conditioning', 'generating'].includes(node.render)) {
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
