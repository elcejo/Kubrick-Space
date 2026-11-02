/** Installed model identities shared by client preferences and the local provider. No I/O. */
export const LOCAL_LLM_PROFILES = Object.freeze(
  [
    ['qwen3.5-4b-int8-convrot', 'Qwen 3.5 4B', 'Qwen 3.5 4B', 'qwen'],
    ['qwen3.5-9b-int8-convrot', 'Qwen 3.5 9B', 'Qwen 3.5 9B', 'qwen'],
    ['qwen3.8-27b-int8-convrot', 'Qwen 3.8 27B', 'Qwen 3.8 27B', 'qwen'],
    ['gemma4-e4b-int8-convrot', 'Gemma 4 E4B', 'Gemma 4 E4B', 'gemma4'],
  ].map(([id, name, folder, family]) =>
    Object.freeze({
      id: 'local:' + id,
      name: name + ' · Local · INT8 ConvRot',
      family,
      path: 'models/llm/' + folder + '/model.safetensors',
      clipName: folder + '/model.safetensors',
      clipType: 'qwen_image',
    }),
  ),
);

/** The old 27B label was wrong; keep its saved references usable without duplicating the catalogue. */
export function canonicalLocalModel(value) {
  if (value === 'local:qwen3.5-27b-int8-convrot') return 'local:qwen3.8-27b-int8-convrot';
  return value;
}
export function localModelProfile(value) {
  return LOCAL_LLM_PROFILES.find((profile) => profile.id === canonicalLocalModel(value)) || null;
}
