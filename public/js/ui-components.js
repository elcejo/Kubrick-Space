import { renderIcon } from './icons.js';
import { safeHTML, escapeHTML } from './safe-html.js';
let modalSequence = 0;
/**
 * @file ui-components.js — Shared UI Components for Kubrick Space
 * @description Modal, Alert (including special delete flow), Toast, and Loader.
 * @module ui-components
 */

/* ═══════════════════════════════════════════════
 *  Modal
 * ═══════════════════════════════════════════ */

/**
 * Glass-style modal overlay.
 * @namespace Modal
 */
export const Modal = {
  /** @type {HTMLElement|null} */
  _el: null,
  _previousFocus: null,
  _onDismiss: null,
  _stack: [],

  /**
   * Display a modal.
   *
   * @param {Object}            opts
   * @param {string}            opts.title   — Heading text
   * @param {string|HTMLElement} opts.content — HTML string or DOM node
   * @param {Array<{label:string, class?:string, onClick:Function}>} [opts.actions=[]]
   */
  show({
    title,
    content,
    actions = [],
    role = 'dialog',
    onDismiss = null,
    initialFocus = null,
    describedBy = null,
    closeOnBackdrop = true,
    preserveCurrent = false,
  }) {
    if (Modal._el && preserveCurrent) {
      Modal._stack.push({
        overlay: Modal._el,
        previousFocus: Modal._previousFocus,
        onDismiss: Modal._onDismiss,
        activeElement: document.activeElement,
      });
      Modal._el.inert = true;
      Modal._el.setAttribute('aria-hidden', 'true');
      Modal._el = null;
      Modal._previousFocus = null;
      Modal._onDismiss = null;
    } else {
      Modal.closeAll({ notify: true });
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('data-modal-overlay', 'true');

    const dialog = document.createElement('div');
    dialog.className = 'modal-content glass-heavy';
    dialog.setAttribute('role', role);
    dialog.setAttribute('aria-modal', 'true');
    dialog.tabIndex = -1;
    if (describedBy) dialog.setAttribute('aria-describedby', describedBy);

    // Header
    const header = document.createElement('header');
    header.className = 'modal-header';
    const heading = document.createElement('h2');
    heading.className = 'modal-title';
    heading.id = `modal-title-${++modalSequence}`;
    heading.textContent = title || 'Diálogo';
    dialog.setAttribute('aria-labelledby', heading.id);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'modal-close';
    close.setAttribute('aria-label', 'Cerrar');
    close.innerHTML = safeHTML(renderIcon('close'));
    header.append(heading, close);
    dialog.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.className = 'modal-body';
    if (typeof content === 'string') {
      body.innerHTML = safeHTML(content);
    } else if (content instanceof Node) {
      body.appendChild(content);
    }
    dialog.appendChild(body);

    // Footer / actions
    if (actions.length) {
      const footer = document.createElement('footer');
      footer.className = 'modal-footer';
      actions.forEach(({ label, class: cls = '', onClick }) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `btn ${cls}`.trim();
        btn.textContent = label;
        btn.addEventListener('click', onClick);
        footer.appendChild(btn);
      });
      dialog.appendChild(footer);
    }

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const focusableSelector =
      'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
    const focusables = () =>
      [...dialog.querySelectorAll(focusableSelector)].filter((item) => !item.closest('[hidden], [inert]'));
    const dismiss = () => Modal.hide({ notify: true });
    close.addEventListener('click', dismiss);
    overlay.addEventListener('click', (e) => {
      if (closeOnBackdrop && e.target === overlay) dismiss();
    });
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismiss();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0],
        last = items.at(-1);
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    });

    // Animate in
    requestAnimationFrame(() => overlay.classList.add('visible'));

    Modal._el = overlay;
    Modal._previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    Modal._onDismiss = onDismiss;
    requestAnimationFrame(() => {
      if (Modal._el !== overlay) return;
      const target =
        initialFocus instanceof HTMLElement
          ? initialFocus
          : typeof initialFocus === 'string'
            ? dialog.querySelector(initialFocus)
            : null;
      (
        target ||
        dialog.querySelector(
          '.modal-body input:not(:disabled), .modal-body textarea:not(:disabled), .modal-body select:not(:disabled)',
        ) ||
        dialog.querySelector('.modal-footer button:not(:disabled)') ||
        focusables()[0] ||
        dialog
      ).focus();
    });
    return dialog;
  },

  /**
   * Hide and remove the current modal.
   */
  hide({ notify = false } = {}) {
    if (Modal._el) {
      const el = Modal._el;
      const callback = Modal._onDismiss;
      const previousFocus = Modal._previousFocus;
      Modal._el = null;
      Modal._onDismiss = null;
      Modal._previousFocus = null;
      el.setAttribute('aria-hidden', 'true');
      el.inert = true;
      el.classList.add('closing');
      el.querySelector('.modal-content')?.classList.add('closing');
      el.classList.remove('visible');
      const remove = () => {
        el.removeEventListener('animationend', handleAnimationEnd);
        el.remove();
      };
      const handleAnimationEnd = (event) => {
        if (event.target === el) remove();
      };
      el.addEventListener('animationend', handleAnimationEnd);
      // Fallback if no transition fires
      setTimeout(remove, 350);
      const previousLayer = Modal._stack.pop();
      if (previousLayer) {
        previousLayer.overlay.inert = false;
        previousLayer.overlay.removeAttribute('aria-hidden');
        Modal._el = previousLayer.overlay;
        Modal._previousFocus = previousLayer.previousFocus;
        Modal._onDismiss = previousLayer.onDismiss;
      }
      const focusTarget = previousLayer?.activeElement || previousFocus;
      if (focusTarget?.isConnected) focusTarget.focus();
      if (notify) callback?.();
    }
  },

  /** Remove every open modal without invoking cancellation callbacks. */
  closeAll({ notify = false } = {}) {
    const overlays = [...Modal._stack.map((layer) => layer.overlay), ...(Modal._el ? [Modal._el] : [])];
    const restoreFocus = Modal._stack[0]?.previousFocus || Modal._previousFocus;
    const dismissCallbacks = [
      Modal._onDismiss,
      ...[...Modal._stack].reverse().map((layer) => layer.onDismiss),
    ];
    Modal._stack = [];
    Modal._el = null;
    Modal._previousFocus = null;
    Modal._onDismiss = null;
    for (const overlay of overlays) {
      overlay.setAttribute('aria-hidden', 'true');
      overlay.inert = true;
      overlay.classList.add('closing');
      overlay.querySelector('.modal-content')?.classList.add('closing');
      overlay.classList.remove('visible');
      const remove = () => {
        overlay.removeEventListener('animationend', handleAnimationEnd);
        overlay.remove();
      };
      const handleAnimationEnd = (event) => {
        if (event.target === overlay) remove();
      };
      overlay.addEventListener('animationend', handleAnimationEnd);
      setTimeout(remove, 350);
    }
    if (restoreFocus?.isConnected) restoreFocus.focus();
    if (notify) dismissCallbacks.forEach((callback) => callback?.());
  },

  /** Promise-based confirmation for async flows. Resolves false on every dismiss path. */
  confirm({
    title = 'Confirmar acción',
    message,
    confirmLabel = 'Confirmar',
    cancelLabel = 'Cancelar',
    type = 'warning',
    preserveCurrent = false,
    signal,
  }) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (!settled) {
          settled = true;
          signal?.removeEventListener('abort', abort);
          resolve(value);
        }
      };
      const text = document.createElement('p');
      const abort = () => {
        if (Modal._el?.contains(text)) Modal.hide({ notify: true });
        finish(false);
      };
      if (signal?.aborted) {
        finish(false);
        return;
      }
      signal?.addEventListener('abort', abort, { once: true });
      text.className = 'modal-message';
      text.textContent = message || '';
      text.id = `modal-description-${++modalSequence}`;
      Modal.show({
        title,
        content: text,
        role: 'alertdialog',
        onDismiss: () => finish(false),
        preserveCurrent,
        describedBy: text.id,
        initialFocus: '.modal-footer .btn-secondary',
        actions: [
          {
            label: cancelLabel,
            class: 'btn-secondary',
            onClick: () => {
              Modal.hide();
              finish(false);
            },
          },
          {
            label: confirmLabel,
            class: type === 'danger' ? 'btn-danger' : 'btn-primary',
            onClick: () => {
              Modal.hide();
              finish(true);
            },
          },
        ],
      });
    });
  },

  /** Promise-based text prompt that stays inside the application. */
  prompt({
    title = 'Escribe un nombre',
    message = '',
    label = 'Nombre',
    defaultValue = '',
    placeholder = '',
    maxLength = 120,
    confirmLabel = 'Guardar',
    cancelLabel = 'Cancelar',
  }) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };
      const content = document.createElement('div');
      if (message) {
        const description = document.createElement('p');
        description.className = 'modal-message';
        description.id = `modal-description-${++modalSequence}`;
        description.textContent = message;
        content.appendChild(description);
      }
      const fieldLabel = document.createElement('label');
      fieldLabel.className = 'input-label modal-prompt-label';
      fieldLabel.textContent = label;
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'input';
      input.value = defaultValue;
      input.placeholder = placeholder;
      input.maxLength = maxLength;
      input.autocomplete = 'off';
      fieldLabel.appendChild(input);
      content.appendChild(fieldLabel);
      const submit = () => {
        const value = input.value;
        Modal.hide();
        finish(value);
      };
      Modal.show({
        title,
        content,
        onDismiss: () => finish(null),
        initialFocus: input,
        describedBy: content.querySelector('.modal-message')?.id,
        actions: [
          {
            label: cancelLabel,
            class: 'btn-secondary',
            onClick: () => {
              Modal.hide();
              finish(null);
            },
          },
          { label: confirmLabel, class: 'btn-primary', onClick: submit },
        ],
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          submit();
        }
      });
    });
  },

  /** Informational dialog with no native browser alert. */
  alert({ title = 'Aviso', message, confirmLabel = 'Entendido' }) {
    return new Promise((resolve) => {
      const text = document.createElement('p');
      text.className = 'modal-message';
      text.id = `modal-description-${++modalSequence}`;
      text.textContent = message || '';
      Modal.show({
        title,
        content: text,
        role: 'alertdialog',
        onDismiss: () => resolve(),
        describedBy: text.id,
        initialFocus: '.modal-footer .btn-primary',
        actions: [
          {
            label: confirmLabel,
            class: 'btn-primary',
            onClick: () => {
              Modal.hide();
              resolve();
            },
          },
        ],
      });
    });
  },
};

/* ═══════════════════════════════════════════════
 *  Alert
 * ═══════════════════════════════════════════ */

/**
 * Styled alert / confirmation dialogs.
 * @namespace Alert
 */
export const Alert = {
  /**
   * Generic confirmation dialog.
   *
   * @param {Object} opts
   * @param {string} opts.title
   * @param {string} opts.message
   * @param {string} [opts.confirmLabel='Aceptar']
   * @param {string} [opts.cancelLabel='Cancelar']
   * @param {Function} opts.onConfirm
   * @param {Function} [opts.onCancel]
   * @param {'info'|'warning'|'danger'} [opts.type='info']
   */
  confirm({
    title,
    message,
    confirmLabel = 'Aceptar',
    cancelLabel = 'Cancelar',
    onConfirm,
    onCancel,
    type = 'info',
  }) {
    const wrapper = document.createElement('p');
    wrapper.className = 'modal-message';
    wrapper.textContent = message;
    let settled = false;
    const cancel = () => {
      if (!settled) {
        settled = true;
        onCancel?.();
      }
    };
    const confirm = () => {
      if (!settled) {
        settled = true;
        onConfirm?.();
      }
    };

    Modal.show({
      title,
      content: wrapper,
      role: 'alertdialog',
      onDismiss: cancel,
      actions: [
        {
          label: cancelLabel,
          class: 'btn-secondary',
          onClick: () => {
            Modal.hide();
            cancel();
          },
        },
        {
          label: confirmLabel,
          class: `btn-${type === 'danger' ? 'danger' : 'primary'}`,
          onClick: () => {
            Modal.hide();
            confirm();
          },
        },
      ],
    });
  },

  /**
   * Specialised delete-project dialog with two tiers:
   *   1. Recoverable trash
   *   2. Full delete with typed confirmation + checkbox
   *
   * @param {string}   projectName
   * @param {Function} onDeleteSession — called when user chooses recoverable trash
   * @param {Function} onDeleteFull    — called with the typed phrase when fully confirmed
   */
  deleteProject(projectName, onDeleteSession, onDeleteFull, { character = false, trashed = false } = {}) {
    const CONFIRM_PHRASE = 'eliminar proyecto completo';

    const content = document.createElement('div');
    content.className = 'alert-delete-project';
    content.innerHTML = safeHTML(`
      <p>¿Qué deseas hacer con <strong>${escapeHTML(projectName)}</strong>?</p>
      <div class="alert-delete-project__option">
        <button type="button" class="btn btn-warning btn-block" id="alert-del-session" aria-describedby="alert-del-trash-help">
          Mover a la papelera
        </button>
        <p id="alert-del-trash-help">Conserva sus archivos. Podrás restaurarlo desde la papelera de Inicio.</p>
      </div>
      <button type="button" class="btn btn-danger btn-block" id="alert-del-full-toggle" aria-expanded="false" aria-controls="alert-full-section">
        Eliminar el proyecto completo
      </button>

      <div class="alert-full-confirm" id="alert-full-section" hidden>
        ${character ? '<label class="checkbox-label"><input type="checkbox" id="alert-keep-props" checked /><span>Conservar rasgos, ropa y props en la biblioteca universal.</span></label>' : ''}
        <label class="input-label">
          <span>Escribe <code>${CONFIRM_PHRASE}</code> para confirmar:</span>
          <input type="text" id="alert-del-input" class="input alert-full-confirm__input" autocomplete="off" spellcheck="false" />
        </label>
        <label class="checkbox-label">
          <input type="checkbox" id="alert-del-checkbox" />
          <span>Entiendo que los archivos se eliminarán para siempre y no se podrán recuperar.</span>
        </label>
      </div>
    `);

    const inputEl = content.querySelector('#alert-del-input');
    const checkboxEl = content.querySelector('#alert-del-checkbox');
    const isConfirmed = () => inputEl.value.trim().toLowerCase() === CONFIRM_PHRASE && checkboxEl.checked;
    const dialog = Modal.show({
      title: 'Eliminar proyecto',
      content,
      initialFocus: '#alert-del-session',
      actions: [
        {
          label: 'Confirmar eliminación permanente',
          class: 'btn-danger btn-block',
          onClick: () => {
            if (!isConfirmed()) return;
            Modal.hide();
            onDeleteFull(inputEl.value.trim(), content.querySelector('#alert-keep-props')?.checked ?? true);
          },
        },
      ],
    });
    dialog.classList.add('modal-content--delete-project');
    if (trashed) content.querySelector('.alert-delete-project__option').hidden = true;
    const footer = dialog.querySelector('.modal-footer');
    const confirmBtn = footer.querySelector('button');
    confirmBtn.id = 'alert-del-confirm';
    confirmBtn.disabled = true;
    footer.hidden = true;

    // -- Session delete
    content.querySelector('#alert-del-session').addEventListener('click', () => {
      Modal.hide();
      onDeleteSession();
    });

    // -- Full delete: expand section
    const fullSection = content.querySelector('#alert-full-section');
    const fullToggle = content.querySelector('#alert-del-full-toggle');
    fullToggle.addEventListener('click', () => {
      fullSection.hidden = !fullSection.hidden;
      footer.hidden = fullSection.hidden;
      fullToggle.setAttribute('aria-expanded', String(!fullSection.hidden));
      if (!fullSection.hidden) inputEl.focus();
    });

    // -- Validate input + checkbox
    const validate = () => {
      confirmBtn.disabled = !isConfirmed();
    };

    inputEl.addEventListener('input', validate);
    checkboxEl.addEventListener('change', validate);
  },
};

/* ═══════════════════════════════════════════════
 *  Toast
 * ═══════════════════════════════════════════ */

/**
 * Non-blocking toast notifications.
 * @namespace Toast
 */
export const Toast = {
  /**
   * Display a toast message.
   *
   * @param {string} message
   * @param {'success'|'error'|'info'|'warning'} [type='info']
   * @param {number} [duration=3000] — milliseconds before auto-dismiss
   */
  show(message, type = 'info', duration = 3000) {
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    // Trigger entrance animation
    requestAnimationFrame(() => toast.classList.add('visible'));

    // Auto-dismiss
    setTimeout(() => {
      toast.classList.remove('visible');
      toast.addEventListener('transitionend', () => toast.remove(), { once: true });
      // Fallback removal
      setTimeout(() => toast.remove(), 400);
    }, duration);
  },
};

/* ═══════════════════════════════════════════════
 *  Loader
 * ═══════════════════════════════════════════ */

/**
 * Full-screen loading overlay with the rotating Kubrick Space isotype.
 * @namespace Loader
 */
export const Loader = {
  /** @type {HTMLElement|null} */
  _el: null,

  /**
   * Show the full-screen loader.
   */
  show() {
    if (Loader._el) return; // already visible

    const overlay = document.createElement('div');
    overlay.className = 'loader-overlay';
    overlay.innerHTML = safeHTML(
      `<div class="kubrick-loader" role="status" aria-label="Cargando Kubrick Space">${renderIcon('interpreting', 56)}</div>`,
    );
    document.body.appendChild(overlay);

    requestAnimationFrame(() => overlay.classList.add('visible'));
    Loader._el = overlay;
  },

  /**
   * Hide and remove the loader.
   */
  hide() {
    if (Loader._el) {
      const el = Loader._el;
      Loader._el = null;
      el.classList.remove('visible');
      el.addEventListener('transitionend', () => el.remove(), { once: true });
      // Fallback if no transition fires
      setTimeout(() => el.remove(), 350);
    }
  },
};
