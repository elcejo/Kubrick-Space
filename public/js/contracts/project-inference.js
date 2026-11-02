import { canonicalLocalModel, localModelProfile } from './local-models.js';
/** Project metadata, independent of document revisions and saved content versions. */
export function validateProjectInference(value) {
  const fail = () => {
    throw new TypeError('Preferencias de inferencia inválidas.');
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  if (
    Object.keys(value).some(
      (key) => !['mode', 'imageMode', 'localModel', 'textModel', 'imageModel', 'videoModel'].includes(key),
    )
  )
    fail();
  if (value.mode !== undefined && !['local', 'api', 'hybrid'].includes(value.mode)) fail();
  // Absent imageMode follows mode; it only exists once text and image providers differ.
  if (value.imageMode !== undefined && !['local', 'api'].includes(value.imageMode)) fail();
  if (value.localModel !== undefined && !localModelProfile(value.localModel)) fail();
  if (
    value.textModel !== undefined &&
    (typeof value.textModel !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:/+-]{0,159}$/.test(value.textModel) ||
      value.textModel.startsWith('local:'))
  )
    fail();
  if (value.imageModel !== undefined) validateImageEngine(value.imageModel);
  // null clears the selection.
  if (value.videoModel !== undefined && value.videoModel !== null) validateVideoEngine(value.videoModel);
  const result = structuredClone(value);
  if (result.localModel !== undefined) result.localModel = canonicalLocalModel(result.localModel);
  return result;
}

/** The only video model today: MiniMax H3 on the local engine. */
export const LOCAL_VIDEO_MODEL = Object.freeze({ provider: 'local', model: 'minimax-h3' });
export function validateVideoEngine(video) {
  if (
    !video ||
    typeof video !== 'object' ||
    Array.isArray(video) ||
    Object.keys(video).some((key) => !['provider', 'model'].includes(key)) ||
    video.provider !== LOCAL_VIDEO_MODEL.provider ||
    video.model !== LOCAL_VIDEO_MODEL.model
  )
    throw new TypeError('Invalid video engine');
  return { provider: video.provider, model: video.model };
}

/** Persist provider/model identity independently of the live catalogue and API-key availability.
 * Generation must separately verify capabilities and availability before contacting a provider.
 */
export function validateImageEngine(image) {
  if (
    !image ||
    typeof image !== 'object' ||
    Array.isArray(image) ||
    Object.keys(image).some((key) => !['provider', 'model'].includes(key)) ||
    !['openrouter', 'openai', 'replicate', 'gemini', 'local'].includes(image.provider) ||
    typeof image.model !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:/+-]{0,159}$/.test(image.model) ||
    image.model.startsWith('local:') ||
    (image.provider === 'local' && image.model !== 'flux3-klein')
  )
    throw new TypeError('Invalid character image engine');
  return { provider: image.provider, model: image.model };
}
