import { renderIcon } from '../../icons.js';
import { safeHTML } from '../../safe-html.js';

export function characterElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The overlay stays focusable by assistive technology; only the covered contents become inert. */
export function setCharacterNodeWorking(node, busy, message = 'Trabajando…') {
  let overlay = node.querySelector(':scope > .character-working-overlay');
  if (!overlay) {
    overlay = characterElement('div', 'character-working-overlay');
    overlay.hidden = true;
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    const icon = characterElement('span', 'character-working-overlay__icon');
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = safeHTML(renderIcon('interpreting', 56));
    overlay.append(
      icon,
      characterElement('strong'),
      characterElement('span', null, 'Puedes continuar desde Tareas activas.'),
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

/** Native content sizing where available; width-aware fallback for older engines. */
export function autoSizeCharacterText(control, cleanups, { rows = 1 } = {}) {
  control.classList.add('character-text-input');
  control.rows = rows;
  if (control.ownerDocument.defaultView.CSS?.supports?.('field-sizing', 'content')) return;
  const view = control.ownerDocument.defaultView;
  let frame = null,
    width = -1,
    value = null;
  const fit = () => {
    const nextWidth = control.clientWidth;
    if (!nextWidth || (nextWidth === width && value === control.value)) return;
    width = nextWidth;
    value = control.value;
    control.style.height = 'auto';
    const style = view.getComputedStyle(control);
    const border = parseFloat(style.borderTopWidth || 0) + parseFloat(style.borderBottomWidth || 0);
    control.style.height = `${control.scrollHeight + border}px`;
  };
  const observer = view.ResizeObserver ? new view.ResizeObserver(fit) : null;
  observer?.observe(control);
  control.addEventListener('input', fit);
  frame = view.requestAnimationFrame?.(fit);
  cleanups.push(() => {
    observer?.disconnect();
    control.removeEventListener('input', fit);
    if (frame != null) view.cancelAnimationFrame?.(frame);
  });
  return fit;
}
export function characterAction(label, icon, fn, className = 'btn btn-ghost') {
  const button = characterElement('button', className);
  button.type = 'button';
  button.setAttribute('aria-label', label);
  if (icon) {
    const span = characterElement('span', 'character-action-icon');
    span.innerHTML = safeHTML(renderIcon(icon));
    button.append(span);
  }
  button.append(document.createTextNode(label));
  button.addEventListener('click', fn);
  return button;
}
export function characterAddButton(label, fn) {
  const footer = characterElement('footer', 'character-node__footer');
  const button = characterAction('', 'plus', fn, 'btn btn-ghost character-add-field');
  button.setAttribute('aria-label', label);
  button.title = label;
  footer.append(button);
  return footer;
}

let tabSequence = 0;
/** Local sections keep every field editable without showing the whole form at once. */
export function characterTabs(groups, { label, selected, onSelect = () => {} }) {
  const element = characterElement('div', 'character-tabs');
  const list = characterElement('div', 'character-tabs__list');
  list.setAttribute('role', 'tablist');
  list.setAttribute('aria-label', label);
  const panels = characterElement('div', 'character-tabs__panels');
  const prefix = `character-tabs-${++tabSequence}`;
  const buttons = [];
  const sections = [];
  const activate = (index, focus = false) => {
    buttons.forEach((button, position) => {
      const active = position === index;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      sections[position].hidden = !active;
    });
    onSelect(groups[index].key);
    if (focus) buttons[index].focus();
  };
  groups.forEach(({ key, label: title, content }, index) => {
    const button = characterElement('button', 'character-tabs__tab', title);
    button.type = 'button';
    button.id = `${prefix}-tab-${key}`;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', `${prefix}-panel-${key}`);
    button.addEventListener('click', () => activate(index));
    button.addEventListener('keydown', (event) => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % groups.length;
      else if (event.key === 'ArrowLeft') next = (index - 1 + groups.length) % groups.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = groups.length - 1;
      else return;
      event.preventDefault();
      activate(next, true);
    });
    const panel = characterElement('section', 'character-tabs__panel');
    panel.id = `${prefix}-panel-${key}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', button.id);
    panel.append(content);
    buttons.push(button);
    sections.push(panel);
    list.append(button);
    panels.append(panel);
  });
  activate(
    Math.max(
      0,
      groups.findIndex((group) => group.key === selected),
    ),
  );
  element.append(list, panels);
  return element;
}
