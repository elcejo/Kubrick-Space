import { renderIcon } from '../../icons.js';
import { safeHTML } from '../../safe-html.js';

const scenesIn = (surface) => [...surface.querySelectorAll(':scope > .screenplay-scene')];
const shotsIn = (scene) => [...scene.querySelectorAll(':scope > .screenplay-scene__body > .screenplay-shot')];

/** Presentation actions; deletion moves through the editor's normal draft/history pipeline. */
export function syncScreenplayRemoval(surface, { changed, releaseSelects }) {
  const doc = surface.ownerDocument;
  const sync = (owner, kind, allowed) => {
    let button = [...owner.children].find((node) => node.matches('.screenplay-remove'));
    if (!allowed) {
      button?.remove();
      return;
    }
    if (button) return;
    button = doc.createElement('button');
    button.type = 'button';
    button.className = 'screenplay-remove';
    button.dataset.screenplayControls = '';
    button.dataset.screenplayRemove = kind;
    button.contentEditable = 'false';
    const name = { scene: 'escena', shot: 'plano', dialogue: 'diálogo' }[kind];
    button.setAttribute('aria-label', 'Eliminar ' + name);
    button.title = 'Eliminar ' + name;
    button.innerHTML = safeHTML(renderIcon('close'));
    button.addEventListener('pointerdown', (event) => event.stopPropagation());
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!surface.contains(owner)) return;
      // Check live counts again: a queued/repeated click cannot delete the last required container.
      if (kind === 'scene' && scenesIn(surface).length <= 1) return;
      if (kind === 'shot' && shotsIn(owner.closest('.screenplay-scene')).length <= 1) return;
      const parent = owner.parentElement;
      releaseSelects(owner);
      owner.remove();
      syncScreenplayRemoval(surface, { changed, releaseSelects });
      changed();
      parent.querySelector('button:not([hidden]), input:not([hidden])')?.focus({ preventScroll: true });
    });
    owner.prepend(button);
  };
  const scenes = scenesIn(surface);
  for (const scene of scenes) {
    sync(scene, 'scene', scenes.length > 1);
    const shots = shotsIn(scene);
    for (const shot of shots) {
      sync(shot, 'shot', shots.length > 1);
      for (const speech of shot.querySelectorAll(':scope > .screenplay-dialogue'))
        sync(speech, 'dialogue', true);
    }
  }
}
