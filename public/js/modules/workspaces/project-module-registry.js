/** Content-type module registry, independent of the SPA bootstrap. */
const modules = new Map();

const modulePaths = Object.freeze({
  character: './m-characters.js',
  book: './m-books.js',
  stage: './m-stages.js',
  video: './m-video.js',
  song: './m-songs.js',
});

export async function getModuleByType(type) {
  if (modules.has(type)) return modules.get(type);
  const path = modulePaths[type];
  if (!path) throw new Error(`Unknown module type: "${type}"`);

  const loaded = await import(path);
  modules.set(type, loaded.default);
  return loaded.default;
}

export function getAllModules() {
  return Promise.all(Object.keys(modulePaths).map(getModuleByType));
}
