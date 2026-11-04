const { randomUUID } = require('node:crypto');
const {
  FILM_CONTINUITY_INSTRUCTION,
  FILM_LOOK_INSTRUCTION,
  filmContinuityNoteSchema,
  filmContinuityRequest,
  filmKeyframePrompt,
  filmLookRequest,
  filmLookSchema,
  nearestRatio,
  parseFilmContinuityNote,
  parseFilmLook,
} = require('../../../public/js/contracts/film-continuity.js');
const { filmLookKey, filmNoteKey } = require('../../../public/js/contracts/film.js');

const PROJECT_FILE = /^\/projects\/([a-f0-9-]{36})\/content\/([^/]+)$/;
/** The proportions the image engines make; the keyframe takes the nearest to the film's. */
const KEYFRAME_RATIOS = Object.freeze(['16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16']);

/**
 * What a clip needs to follow the one before it: the look of its scene, a continuity note written from how the previous
 * clip ends (with its last frame when the model sees images), that last frame as a file, and a generated start frame.
 * It writes nothing of the film: the jobs that call it commit what it returns.
 */
function createFilmContinuity(deps, { infer, readImage, videoFrames, makeOperations }) {
  const { security, PROJECTS_DIR, ensureDir, path, openrouterModels, inference } = deps;
  const fail = (message, status = 422) => security.fail(message, status);

  /** Whether the chosen model accepts images: a local model does, an API model says so in its catalogue. */
  function seesImages(model) {
    if (String(model).startsWith('local:'))
      return Boolean(
        inference
          ?.models?.()
          .find((item) => item.id === model)
          ?.inputModalities?.includes('image'),
      );
    return Boolean(openrouterModels?.findModel(model)?.inputModalities?.includes('image'));
  }

  /** One answer inside a schema, corrected once with the reason it was refused. */
  async function answer({ ctx, p, system, request, image, schema, schemaName, parse, stage }) {
    const model = p.textConfig.functions.chat.model;
    const ask = (extra = '') =>
      infer(
        {
          model,
          stage,
          maxTokens: 1500,
          schema,
          schemaName,
          messages: [
            { role: 'system', content: system },
            {
              role: 'user',
              content: image
                ? [
                    { type: 'text', text: request + extra },
                    { type: 'image_url', image_url: { url: image } },
                  ]
                : request + extra,
            },
          ],
        },
        ctx,
      );
    try {
      return parse(await ask());
    } catch (error) {
      return parse(
        await ask(`\n\nYour previous answer was rejected: ${error.message} Return only the corrected JSON.`),
      );
    }
  }

  /** The look of a scene of the script, written from all its shots. */
  async function look({ ctx, p, film, heading, shots, characters }) {
    return answer({
      ctx,
      p,
      system: FILM_LOOK_INSTRUCTION,
      request: filmLookRequest({ film, heading, shots, characters }),
      schema: filmLookSchema(),
      schemaName: 'kubrick_film_look',
      parse: parseFilmLook,
      stage: 'de la ficha de aspecto de la escena',
    });
  }

  /** The state at the start of a clip, from the end of the one before. `frame` is its last frame as a data URL. */
  async function note({ ctx, p, film, heading, previous, next, characters, frame }) {
    const useFrame = Boolean(frame) && seesImages(p.textConfig.functions.chat.model);
    return answer({
      ctx,
      p,
      system: FILM_CONTINUITY_INSTRUCTION,
      request: filmContinuityRequest({ film, heading, previous, next, characters, hasFrame: useFrame }),
      image: useFrame ? frame : null,
      schema: filmContinuityNoteSchema(),
      schemaName: 'kubrick_film_continuity',
      parse: parseFilmContinuityNote,
      stage: 'de la nota de continuidad',
    });
  }

  /** The last frame of the preview of a clip, saved as an image of the film so that it can be shown and sent. */
  async function lastFrame(projectId, clip) {
    const match = PROJECT_FILE.exec(clip.preview?.url || '');
    if (!match || match[1] !== projectId) throw fail('El plano anterior aún no tiene previsualización.', 409);
    const source = security.containedPath(PROJECTS_DIR, projectId, 'content', path.basename(match[2]));
    const directory = security.containedPath(PROJECTS_DIR, projectId, 'content');
    ensureDir(directory);
    const filename = `film-tail-${randomUUID()}.png`;
    await videoFrames.last(source, path.join(directory, filename));
    return { url: `/projects/${projectId}/content/${filename}`, filename };
  }

  /**
   * A start frame for a shot, made by the image model chosen in the top bar from the references of the shot, the end of
   * the previous clip and the shot's own description. Returns the project image that was saved.
   */
  async function keyframe({ ctx, p, projectId, film, clip, previousFrame }) {
    const imageMode = p.inferenceSettings?.imageMode || p.inferenceMode;
    const engine =
      imageMode === 'local' ? { provider: 'local', model: 'flux3-klein' } : p.inferenceSettings?.imageModel;
    if (!engine)
      throw fail('Elige el modelo de imagen en la barra superior para generar el fotograma inicial.', 428);
    const operations = makeOperations(p.textConfig, ctx);
    const inputImages = [
      ...clip.references.filter((reference) => reference.image).map((reference) => reference.image),
    ];
    if (previousFrame) inputImages.push(previousFrame.url);
    const response = await operations.generateImage({
      body: {
        projectId,
        imageType: 'cover',
        aspectRatio: nearestRatio(film.params.aspectRatio, KEYFRAME_RATIOS),
        prompt: filmKeyframePrompt({
          shot: clip.shot,
          creative: clip.creative,
          look: film.looks?.[clip.sourceSceneId]?.text || '',
          note: clip.continuity.note,
          hasPrevious: Boolean(previousFrame),
        }),
        inputImages: inputImages.slice(0, 8),
        backend: imageMode === 'local' ? 'local' : 'api',
        ...engine,
      },
    });
    if (response.status >= 400 || !response.body?.imageUrl)
      throw fail(
        response.body?.error || response.body?.message || 'No se pudo generar el fotograma inicial.',
        response.status >= 400 ? response.status : 502,
      );
    return { url: response.body.imageUrl };
  }

  /** The image of the project file as a data URL, for a model that looks at it. */
  const dataUrl = (url) => {
    const match = PROJECT_FILE.exec(url || '');
    return match ? readImage(match[1], match[2]) : null;
  };

  return { look, note, lastFrame, keyframe, dataUrl, seesImages, lookKey: filmLookKey, noteKey: filmNoteKey };
}
module.exports = { createFilmContinuity };
