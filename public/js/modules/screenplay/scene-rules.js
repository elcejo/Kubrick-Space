export const MAX_SCENES = 200;
export const MAX_SCENE_TITLE = 300;
export function normalizeSceneIds(scenes) {
  const used = new Set();
  return scenes.map((scene) => {
    let id = scene.id;
    if (typeof id !== 'string' || !id.trim() || id.length > 80 || used.has(id))
      id = globalThis.crypto.randomUUID();
    used.add(id);
    return id === scene.id ? scene : { ...scene, id };
  });
}
export function validateSceneTitles(scenes) {
  for (const scene of scenes) {
    if (typeof scene.title !== 'string' || scene.title.length > MAX_SCENE_TITLE)
      throw new Error(
        `Cada título de escena admite hasta ${MAX_SCENE_TITLE} caracteres. Acorta el título antes de importar.`,
      );
  }
}
