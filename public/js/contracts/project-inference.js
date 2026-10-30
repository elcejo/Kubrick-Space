/** Project metadata, independent of document revisions and saved content versions. */
export function validateProjectInference(value) {
  const fail = () => {
    throw new TypeError('Preferencias de inferencia inválidas.');
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  if (Object.keys(value).some((key) => !['mode', 'localModel', 'textModel', 'imageModel'].includes(key)))
    fail();
  if (value.mode !== undefined && !['local', 'api', 'hybrid'].includes(value.mode)) fail();
  if (value.localModel !== undefined && !/^local:qwen3\.5-(4b|9b)-int8-convrot$/.test(value.localModel))
    fail();
  if (
    value.textModel !== undefined &&
    (typeof value.textModel !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:/+-]{0,159}$/.test(value.textModel) ||
      value.textModel.startsWith('local:'))
  )
    fail();
  if (value.imageModel !== undefined) validateImageEngine(value.imageModel);
  return structuredClone(value);
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
