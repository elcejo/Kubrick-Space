import { renderIcon } from '../../icons.js';
import { safeHTML } from '../../safe-html.js';

export function scenarioElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A labelled icon button. The label is the accessible name; the icon is decorative. */
export function scenarioAction(label, icon, onClick, className = 'btn btn-ghost') {
  const button = scenarioElement('button', className);
  button.type = 'button';
  const glyph = scenarioElement('span', 'scenario-action__icon');
  glyph.setAttribute('aria-hidden', 'true');
  glyph.innerHTML = safeHTML(renderIcon(icon, 16));
  button.append(glyph, scenarioElement('span', null, label));
  button.setAttribute('aria-label', label);
  button.addEventListener('click', onClick);
  return button;
}

/** Same overlay contract as the other workspaces: only the covered contents become inert. */
export function setScenarioNodeWorking(node, busy, message = 'Trabajando…') {
  let overlay = node.querySelector(':scope > .character-working-overlay');
  if (!overlay) {
    overlay = scenarioElement('div', 'character-working-overlay');
    overlay.hidden = true;
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    const icon = scenarioElement('span', 'character-working-overlay__icon');
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = safeHTML(renderIcon('interpreting', 56));
    overlay.append(
      icon,
      scenarioElement('strong'),
      scenarioElement('span', null, 'Puedes continuar desde Tareas activas.'),
    );
    node.append(overlay);
  }
  for (const child of node.children) {
    if (child === overlay) continue;
    if (busy && !child.hasAttribute('data-working-inert')) {
      child.dataset.workingInert = String(child.inert);
      child.inert = true;
    } else if (!busy && child.hasAttribute('data-working-inert')) {
      child.inert = child.dataset.workingInert === 'true';
      delete child.dataset.workingInert;
    }
  }
  if (
    busy &&
    node.contains(node.ownerDocument.activeElement) &&
    !overlay.contains(node.ownerDocument.activeElement)
  )
    node.ownerDocument.activeElement.blur();
  overlay.querySelector('strong').textContent = busy ? message : '';
  overlay.hidden = !busy;
  node.classList.toggle('is-working', busy);
  node.setAttribute('aria-busy', String(busy));
}

export function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    reader.readAsDataURL(file);
  });
}
export const SCENARIO_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'];
export const SCENARIO_IMAGE_BYTES = 15 * 1024 * 1024;
