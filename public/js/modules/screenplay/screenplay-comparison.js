import { parseScreenplayContent, screenplayToHTML } from './screenplay-document.js';
import { safeHTML } from '../../safe-html.js';

/** IDs are preferred; heading matching keeps legacy HTML histories useful. */
export function screenplaySceneDiff(current, version) {
  current = parseScreenplayContent(current);
  version = parseScreenplayContent(version);
  const used = new Set();
  const same = (scene) =>
    JSON.stringify({
      heading: scene.heading,
      narrative: scene.narrative,
      blocks: scene.blocks.map(({ type, text, html, characterId, speakerId }) => ({
        type,
        text,
        html,
        characterId,
        speaker: scene.blocks.find((block) => block.id === speakerId)?.text,
      })),
      origins: scene.origins,
      locationId: scene.locationId,
    });
  const result = version.scenes.map((before, index) => {
    const after =
      current.scenes.find((scene) => !used.has(scene.id) && scene.id === before.id) ||
      current.scenes.find((scene) => !used.has(scene.id) && scene.heading.text === before.heading.text);
    if (after) used.add(after.id);
    return {
      id: after?.id || before.id,
      status: !after ? 'removed' : same(after) === same(before) ? 'unchanged' : 'changed',
      moved: !!after && current.scenes.indexOf(after) !== index,
      before,
      after,
    };
  });
  for (const after of current.scenes)
    if (!used.has(after.id)) result.push({ id: after.id, status: 'added', after });
  return result;
}

export function renderScreenplayComparison(current, version) {
  const currentDoc = parseScreenplayContent(current),
    versionDoc = parseScreenplayContent(version);
  const root = document.createElement('div');
  root.className = 'screenplay-comparison';
  const labels = {
    added: 'Añadida en el borrador',
    removed: 'Solo en la versión',
    changed: 'Modificada',
    unchanged: 'Sin cambios',
  };
  const title = document.createElement('p');
  title.textContent = 'Comparación por escena · versión guardada y borrador actual';
  root.append(title);
  for (const entry of screenplaySceneDiff(currentDoc, versionDoc)) {
    const details = document.createElement('details');
    details.open = entry.status !== 'unchanged' || entry.moved;
    const summary = document.createElement('summary');
    summary.textContent = `${labels[entry.status]}${entry.moved ? ' · Reordenada' : ''} · ${(entry.after || entry.before).heading.text}`;
    const columns = document.createElement('div');
    columns.className = 'screenplay-comparison__columns';
    for (const [label, scene, doc] of [
      ['Versión guardada', entry.before, versionDoc],
      ['Borrador actual', entry.after, currentDoc],
    ]) {
      const section = document.createElement('section');
      const heading = document.createElement('h4');
      heading.textContent = label;
      const body = document.createElement('article');
      body.className = 'screenplay-preview';
      if (scene) {
        const fragment = document.createElement('div');
        fragment.innerHTML = safeHTML(screenplayToHTML({ ...doc, preamble: [], scenes: [scene] }));
        fragment.querySelector('h1')?.remove();
        body.append(...fragment.childNodes);
      } else body.textContent = 'Sin escena';
      section.append(heading, body);
      columns.append(section);
    }
    details.append(summary, columns);
    root.append(details);
  }
  return root;
}
