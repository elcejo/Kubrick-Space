import { parseScreenplayContent } from './screenplay-document.js';
import { safeContent } from '../../safe-html.js';

export function productionScriptText(scene) {
  return scene.blocks
    .map((block) => block.text)
    .filter(Boolean)
    .join('\n')
    .slice(0, 50000);
}

export function screenplayProductionScenes(content, source) {
  const doc = parseScreenplayContent(content);
  const legacy = typeof content !== 'object' && !String(content).trim().startsWith('{');
  const headings = legacy
    ? [...new DOMParser().parseFromString(safeContent(content), 'text/html').querySelectorAll('h2')]
    : [];
  const occurrences = new Map();
  const legacyId = (scene, index) => {
    const explicit = headings[index]?.dataset.kaiId;
    if (explicit && /^[A-Za-z0-9_-]{1,140}$/.test(explicit)) return scene.id;
    const heading = scene.heading.text.trim().toLocaleLowerCase();
    const occurrence = (occurrences.get(heading) || 0) + 1;
    occurrences.set(heading, occurrence);
    let hash = 2166136261;
    for (const character of heading) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    return `legacy-scene-${(hash >>> 0).toString(16)}-${occurrence}`;
  };
  return doc.scenes.map((scene, index) => ({
    id: globalThis.crypto.randomUUID(),
    title: scene.heading.text || `Escena ${index + 1}`,
    duration: null,
    status: 'pendiente',
    prompt: '',
    script: productionScriptText(scene),
    source: { ...source, sceneId: legacy ? legacyId(scene, index) : scene.id },
    sourceScene: scene,
    shots: [],
  }));
}

/** Refresh narrative references while preserving author edits, shots, prompts and status. */
export function reconcileProductionScenes(existing, incoming) {
  const used = new Set();
  const sourceKey = (scene) => (scene.source ? scene.source.projectId + ':' + scene.source.sceneId : '');
  const keys = new Map(incoming.map((scene) => [sourceKey(scene), scene]));
  const projects = new Set(incoming.map((scene) => scene.source?.projectId));
  const result = existing.map((scene) => {
    const legacyMatches = scene.source?.sceneId?.startsWith('legacy-scene-')
      ? incoming.filter(
          (item) =>
            item.source?.projectId === scene.source.projectId &&
            item.sourceScene?.heading.text === scene.sourceScene?.heading.text,
        )
      : [];
    const update =
      keys.get(sourceKey(scene)) ||
      (legacyMatches.length === 1 && !used.has(sourceKey(legacyMatches[0])) ? legacyMatches[0] : null);
    if (!update) return projects.has(scene.source?.projectId) ? { ...scene, sourceRemoved: true } : scene;
    used.add(sourceKey(update));
    const next = { ...scene, source: update.source, sourceScene: update.sourceScene, sourceRemoved: false };
    if (scene.title === scene.sourceScene?.heading.text) next.title = update.title;
    if (scene.sourceScene && scene.script === productionScriptText(scene.sourceScene))
      next.script = update.script;
    return next;
  });
  for (const scene of incoming) if (!used.has(sourceKey(scene))) result.push(scene);
  return result;
}
