// Shared keyboard and accessibility behavior for custom modal overlays.
let dialogSequence = 0;
// Legacy editor dialogs share the same fixed frame and scrollable body as Modal.show.
// Move existing nodes rather than rebuilding markup, preserving listeners and form state.
export function frameModalContent(dialog) {
  if (!dialog?.classList.contains('modal-content')) return;
  if (dialog.querySelector(':scope > .modal-body')) return;
  const children = [...dialog.children];
  const heading = children.find((el) =>
    el.matches('.modal-header, .editor-modal__title, .image-model-picker-heading, h1, h2, h3'),
  );
  const actions = children.find((el) => el.matches('.modal-footer, .editor-modal__actions'));
  const header = document.createElement('div');
  header.className = 'modal-header';
  if (heading) {
    if (heading.matches('h1, h2, h3')) heading.classList.add('modal-title');
    if (heading.matches('.modal-header, .image-model-picker-heading')) {
      heading.classList.add('modal-header');
    } else {
      header.append(heading);
    }
  }
  const body = document.createElement('div');
  body.className = 'modal-body';
  const footer = actions || document.createElement('div');
  footer.classList.add('modal-footer');
  for (const child of children) {
    if (
      child === heading ||
      child === actions ||
      child.matches('.liquid-glass-layer, .liquid-glass-definitions')
    )
      continue;
    if (child.matches('button')) footer.append(child);
    else body.append(child);
  }
  footer.hidden = !footer.children.length;
  dialog.append(heading?.classList.contains('modal-header') ? heading : header, body, footer);
}

export function trapCoverFocus(overlay, close, { closeOnBackdrop = false, closeOnEscape = true } = {}) {
  const previous = document.activeElement;
  const dialog = overlay.querySelector('.modal-content, [role="dialog"], [role="alertdialog"]');
  frameModalContent(dialog);
  if (dialog) {
    overlay.setAttribute('role', 'presentation');
    overlay.removeAttribute('aria-modal');
    dialog.setAttribute('role', dialog.getAttribute('role') || 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.tabIndex = -1;
    const heading = dialog.querySelector('.modal-title, h1, h2, h3, .editor-modal__title');
    if (heading) {
      if (!heading.id) heading.id = `custom-dialog-title-${++dialogSequence}`;
      if (heading.classList.contains('editor-modal__title') && !/^H[1-6]$/.test(heading.tagName)) {
        heading.setAttribute('role', 'heading');
        heading.setAttribute('aria-level', '2');
      }
      dialog.setAttribute('aria-labelledby', heading.id);
      dialog.removeAttribute('aria-label');
    } else if (!dialog.hasAttribute('aria-label')) {
      dialog.setAttribute('aria-label', 'Diálogo');
    }
  }
  const focusRoot = dialog || overlay;
  const handler = (event) => {
    if (closeOnEscape && event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = [
      ...focusRoot.querySelectorAll(
        'a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex]:not([tabindex="-1"])',
      ),
    ].filter(
      (el) => !el.closest('[hidden]') && (!el.closest('details:not([open])') || el.tagName === 'SUMMARY'),
    );
    const first = items[0],
      last = items.at(-1);
    if (!items.length) {
      event.preventDefault();
      focusRoot.focus();
      return;
    }
    if (event.shiftKey && (document.activeElement === first || !focusRoot.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      (document.activeElement === last || !focusRoot.contains(document.activeElement))
    ) {
      event.preventDefault();
      first.focus();
    }
  };
  overlay.addEventListener('keydown', handler);
  const backdropHandler = (event) => {
    if (closeOnBackdrop && event.target === overlay) close();
  };
  overlay.addEventListener('click', backdropHandler);
  (
    focusRoot.querySelector(
      'input:not(:disabled),textarea:not(:disabled),button:not(:disabled),select:not(:disabled)',
    ) || focusRoot
  ).focus();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    overlay.removeEventListener('keydown', handler);
    overlay.removeEventListener('click', backdropHandler);
    if (previous?.isConnected) previous.focus();
  };
}

export function chooseCoverReferences(
  candidates = [],
  scene = '',
  { maxReferences = 8, returnMetadata = false, defaultIncludeText = true, signal = null } = {},
) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(null);
      return;
    }
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay cover-reference-overlay';
    const dialog = document.createElement('div');
    dialog.className = 'modal-content glass-heavy cover-reference-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'Referencias de portada');
    const title = document.createElement('h2');
    title.textContent = 'Referencias de la portada';
    const help = document.createElement('p');
    help.textContent = `Elige hasta ${maxReferences} referencias visuales. La IA desarrollará una composición nueva a partir del contexto y estas referencias.`;
    dialog.append(title, help);

    const textOption = document.createElement('label');
    textOption.className = 'cover-reference-text-option';
    const textCheckbox = document.createElement('input');
    textCheckbox.type = 'checkbox';
    textCheckbox.checked = defaultIncludeText;
    const textLabel = document.createElement('span');
    textLabel.textContent = 'Generar texto en la imagen (título, lema y autor)';
    textOption.append(textCheckbox, textLabel);
    dialog.append(textOption);

    if (!candidates.length) {
      const empty = document.createElement('p');
      empty.className = 'cover-reference-empty';
      empty.textContent = 'No hay referencias visuales disponibles para este proyecto.';
      dialog.append(empty);
    }
    let suggested = 0;
    const inputs = candidates.map((candidate) => {
      const label = document.createElement('label');
      label.className = 'cover-reference-option';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked =
        String(scene).toLocaleLowerCase().includes(candidate.name.toLocaleLowerCase()) && suggested++ < 2;
      const img = document.createElement('img');
      img.src = candidate.url;
      img.alt = '';
      img.className = 'cover-reference-thumbnail';
      const name = document.createElement('span');
      name.textContent = candidate.name;
      label.append(checkbox, img, name);
      dialog.append(label);
      return checkbox;
    });
    const count = document.createElement('p');
    count.setAttribute('aria-live', 'polite');
    const cancel = document.createElement('button');
    cancel.className = 'btn btn-ghost';
    cancel.textContent = 'Cancelar';
    const generate = document.createElement('button');
    generate.className = 'btn btn-primary';
    generate.textContent = 'Generar con estas referencias';
    const update = () => {
      const n = inputs.filter((input) => input.checked).length;
      count.textContent = `${n} de ${maxReferences} referencias seleccionadas`;
      generate.disabled = n > maxReferences;
      inputs.forEach((input) => {
        input.disabled = !input.checked && n >= maxReferences;
      });
    };
    inputs.forEach((input) => input.addEventListener('change', update));
    update();
    dialog.append(count, cancel, generate);
    overlay.append(dialog);
    document.body.append(overlay);
    let settled = false;
    const abort = () => finish(null);
    const finish = (value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      overlay.remove();
      release();
      resolve(value);
    };
    const release = trapCoverFocus(overlay, () => finish(null));
    signal?.addEventListener('abort', abort, { once: true });
    cancel.onclick = () => finish(null);
    generate.onclick = () => {
      const selected = candidates.filter((_, index) => inputs[index].checked);
      finish(returnMetadata ? { selected, includeText: textCheckbox.checked } : selected);
    };
  });
}
