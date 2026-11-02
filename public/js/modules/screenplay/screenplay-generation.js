import { Modal } from '../../ui-components.js';
import { safeContent } from '../../safe-html.js';

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
