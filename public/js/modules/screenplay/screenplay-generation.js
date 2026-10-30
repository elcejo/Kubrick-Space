import { Modal } from '../../ui-components.js';
import { safeContent } from '../../safe-html.js';

/** Data goes in the request content; this instruction never embeds a particular story. */
export { screenplayUpdateInstruction } from '../../contracts/text-instructions.js';

export function normalizeScreenplayProposal(text, titleHTML) {
  const raw = String(text || '')
    .replace(/```(?:html)?/gi, '')
    .trim();
  const inspection = new document.defaultView.DOMParser().parseFromString(raw, 'text/html');
  if (
    inspection.querySelector(
      'form,input,select,textarea,button,details,[data-scene-properties],[data-screenplay-controls]',
    )
  )
    throw new Error(
      'La respuesta incluye formularios ajenos al formato de guión; se conservó el documento actual.',
    );
  const parsed = document.createElement('div');
  parsed.innerHTML = safeContent(raw);
  parsed.querySelectorAll('h1').forEach((title) => title.remove());
  if (!parsed.querySelector('h2') || !parsed.textContent.trim())
    throw new Error('La respuesta no contiene escenas válidas; se conservó el guión actual.');
  // Unwrap presentation-only containers, but never accept prose outside cinematic blocks.
  for (const wrapper of [...parsed.querySelectorAll('div')].reverse())
    wrapper.replaceWith(...wrapper.childNodes);
  const allowed = new Set(['H2', 'P', 'H3', 'BLOCKQUOTE', 'H4', 'H5']);
  if (
    [...parsed.childNodes].some((node) =>
      node.nodeType === 3 ? node.textContent.trim() : node.nodeType === 1 && !allowed.has(node.tagName),
    ) ||
    (parsed.firstElementChild && parsed.firstElementChild.tagName !== 'H2')
  )
    throw new Error('La respuesta no respeta los bloques cinematográficos; se conservó el guión actual.');
  return safeContent(titleHTML + parsed.innerHTML);
}

export function reviewScreenplayProposal({ current, proposed, isCurrent, apply, cleanups }) {
  return new Promise((resolve) => {
    let dialog;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanups.delete(cancel);
      if (dialog && Modal._el?.contains(dialog)) Modal.hide();
      resolve(value);
    };
    const cancel = () => finish(false);
    cleanups.add(cancel);
    const content = document.createElement('div');
    content.className = 'screenplay-review';
    for (const [title, html] of [
      ['Guión actual', current],
      ['Propuesta', proposed],
    ]) {
      const section = document.createElement('section');
      const heading = document.createElement('h3');
      heading.textContent = title;
      const article = document.createElement('article');
      article.className = 'screenplay-review__document screenplay-preview';
      article.tabIndex = 0;
      article.setAttribute('aria-label', title);
      article.innerHTML = safeContent(html);
      section.append(heading, article);
      content.append(section);
    }
    const status = document.createElement('p');
    status.className = 'screenplay-review__status';
    status.setAttribute('role', 'status');
    content.append(status);
    dialog = Modal.show({
      title: 'Revisar actualización del guión',
      content,
      preserveCurrent: true,
      initialFocus: '.modal-footer .btn-secondary',
      onDismiss: cancel,
      actions: [
        { label: 'Conservar actual', class: 'btn-secondary', onClick: cancel },
        {
          label: 'Aplicar propuesta',
          class: 'btn-primary',
          onClick: async () => {
            if (!isCurrent()) {
              status.textContent =
                'El guión o sus ingredientes cambiaron. Se conservó tu trabajo; genera una nueva propuesta.';
              return;
            }
            const buttons = dialog.querySelectorAll('.modal-footer button');
            buttons.forEach((button) => {
              button.disabled = true;
            });
            try {
              await apply();
              finish(true);
            } catch (error) {
              status.textContent =
                'La propuesta está en el editor, pero no se confirmó su guardado: ' + error.message;
              buttons[0].textContent = 'Cerrar';
              buttons[0].disabled = false;
              buttons[1].disabled = true;
            }
          },
        },
      ],
    });
    dialog.classList.add('screenplay-review-dialog');
  });
}
