import { renderIcon } from '../../icons.js';
import { safeHTML } from '../../safe-html.js';

/** Shots belong to production, never to the narrative screenplay model. */
export function mountProductionShots(card, scene, persist) {
  const details = document.createElement('details');
  details.className = 'production-shots';
  const summary = document.createElement('summary');
  const list = document.createElement('div');
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'btn btn-secondary';
  add.setAttribute('aria-label', 'Añadir plano o clip');
  add.innerHTML = safeHTML(renderIcon('plus') + ' Añadir plano');
  const render = () => {
    summary.textContent = `Planos y clips · ${scene.shots?.length || 0}`;
    add.disabled = (scene.shots?.length || 0) >= 100;
    list.replaceChildren();
    for (const shot of scene.shots || []) {
      const row = document.createElement('section');
      row.className = 'production-shot';
      const title = document.createElement('input');
      title.value = shot.title;
      title.maxLength = 300;
      title.setAttribute('aria-label', 'Nombre del plano');
      title.addEventListener('input', () => {
        shot.title = title.value;
        persist();
      });
      const prompt = document.createElement('textarea');
      prompt.value = shot.prompt;
      prompt.maxLength = 10000;
      prompt.placeholder = 'Prompt de producción';
      prompt.setAttribute('aria-label', 'Prompt del plano');
      prompt.addEventListener('input', () => {
        shot.prompt = prompt.value;
        persist();
      });
      const duration = document.createElement('input');
      duration.type = 'number';
      duration.min = '1';
      duration.max = '600';
      duration.value = shot.duration ?? '';
      duration.placeholder = 'Sin duración';
      duration.setAttribute('aria-label', 'Duración del clip en segundos');
      duration.addEventListener('change', () => {
        shot.duration = duration.value
          ? Math.max(1, Math.min(600, Number.parseInt(duration.value, 10) || 1))
          : null;
        persist();
      });
      const status = document.createElement('button');
      status.type = 'button';
      status.textContent = shot.status === 'lista' ? 'Lista' : 'Pendiente';
      status.addEventListener('click', () => {
        shot.status = shot.status === 'lista' ? 'pendiente' : 'lista';
        persist();
        render();
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.setAttribute('aria-label', 'Eliminar plano');
      remove.innerHTML = safeHTML(renderIcon('close'));
      remove.addEventListener('click', () => {
        scene.shots = scene.shots.filter((item) => item !== shot);
        persist();
        render();
      });
      const controls = document.createElement('div');
      controls.className = 'production-shot__controls';
      controls.append(duration, status, remove);
      row.append(title, prompt, controls);
      for (const url of shot.images || []) {
        const image = document.createElement('img');
        image.src = url;
        image.alt = shot.title;
        image.loading = 'lazy';
        row.append(image);
      }
      list.append(row);
    }
  };
  add.addEventListener('click', () => {
    scene.shots ||= [];
    if (scene.shots.length >= 100) return;
    scene.shots.push({
      id: globalThis.crypto.randomUUID(),
      title: `Plano ${scene.shots.length + 1}`,
      prompt: '',
      duration: null,
      status: 'pendiente',
      images: [],
    });
    details.open = true;
    persist();
    render();
    list.lastElementChild?.querySelector('input')?.focus();
  });
  details.append(summary, list, add);
  card.append(details);
  render();
}
