import { renderIcon } from '../../icons.js';
import { safeHTML, safeContent } from '../../safe-html.js';
import { markdownToHTML } from './chat-markdown.js';
import { parseAgentResponse, createReplyAnimator, storyBookIntent } from './chat-response.js';
/**
 * @module chat
 * @description Collapsible right-side chat panel. Gathers editor context (content,
 * tags, blocks), sends it with the user message to the AI API, and displays
 * the conversation.
 */

import { EventBus } from '../../event-bus.js';
import { AppState } from '../../app-state.js';
import { API } from '../../api-service.js';
import { ingredientContent, ingredientVersionLabel } from '../ingredients/ingredient-versions.js';
import { Modal, Toast } from '../../ui-components.js';
import { prepareCharacterCreation } from '../characters/character-creation.js';

/**
 * Returns a short HH:MM timestamp string.
 * @returns {string}
 */
function timestamp() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Creates a single message bubble element.
 * @param {'user'|'ai'} role
 * @param {string} text
 * @param {string} time
 * @returns {HTMLElement}
 */
function createBubble(role, text, time) {
  const wrap = document.createElement('div');
  wrap.className = `chat-msg chat-msg--${role}`;

  const bubble = document.createElement('div');
  bubble.className = 'chat-msg-bubble';
  const content = document.createElement('div');
  content.className = 'chat-msg-content';
  if (role === 'ai') content.innerHTML = safeContent(markdownToHTML(parseAgentResponse(text, true).text));
  else content.textContent = text;
  bubble.appendChild(content);

  const ts = document.createElement('span');
  ts.className = 'chat-msg-time';
  ts.textContent = time;

  wrap.append(bubble, ts);
  return wrap;
}

/**
 * Right-side project assistant panel.
 *
 * @example
 * const chat = new Chat();
 * chat.init(chatContainer);
 */
let chatSequence = 0;

export class Chat {
  /** @type {HTMLElement|null} */ #root = null;
  /** @type {HTMLElement|null} */ #header = null;
  /** @type {HTMLElement|null} */ #messageList = null;
  /** @type {HTMLInputElement|null} */ #input = null;
  /** @type {HTMLElement|null} */ #sendBtn = null;
  /** @type {HTMLElement|null} */ #emptyState = null;
  /** @type {HTMLElement|null} */ #menu = null;
  /** @type {HTMLDialogElement|null} */ #libraryDialog = null;
  /** @type {boolean} */ #expanded = false;
  /** @type {boolean} */ #loading = false;
  /** @type {Array<{role:string,text:string,time:string,visible:boolean}>} */ #history = [];
  /** @type {string} */ #autoTitle = '';
  /** @type {string|null} */ #activeConversationId = null;

  /** @type {HTMLButtonElement|null} */ #toggleButton = null;
  #inputRow = null;
  #focusTimer = null;

  /** Bound handler refs */
  #bound = {};
  #requestController = null;
  #applyDocumentChange = null;
  #prepareProjectContent = null;
  #conversationProjectId = null;
  #contextProjectId = null;
  #executeCharacterAction = null;
  #attachCharacterPhoto = null;
  #photoButton = null;
  #photoPreview = null;
  #uploadingPhoto = false;
  #externalPhoto = '';
  #bookJobId = null;
  #acceptBookJob = null;
  #bookActive = false;
  #bookStopRequested = false;
  #bookQueuedMessages = [];

  /**
   * Build and mount the chat bar.
   * @param {HTMLElement} container
   */
  init(
    container,
    {
      executeCharacterAction = null,
      attachCharacterPhoto = null,
      applyDocumentChange = null,
      prepareProjectContent = null,
      acceptBookJob = null,
    } = {},
  ) {
    this.#applyDocumentChange = applyDocumentChange;
    this.#acceptBookJob = acceptBookJob;
    this.#prepareProjectContent = prepareProjectContent;
    this.#executeCharacterAction = executeCharacterAction;
    this.#attachCharacterPhoto = attachCharacterPhoto;
    this.#root = document.createElement('div');
    this.#root.className = 'chat-panel is-collapsed';
    container.classList.add('is-collapsed');

    // ── Header / collapsed bar ──────────────────────────────────────────
    this.#header = document.createElement('div');
    this.#header.className = 'chat-header';
    const id = `chat-${++chatSequence}`;
    this.#header.innerHTML = safeHTML(`
      <button class="chat-toggle-button" type="button" aria-label="Abrir agente" aria-expanded="false" aria-controls="${id}-messages ${id}-input">
        <span class="chat-header__mark" aria-hidden="true">${renderIcon('kubrick', 24)}</span>
        <span class="chat-header__copy"><b>Kubrick Space</b></span>
        <span class="chat-header__toggle" aria-hidden="true">${renderIcon('chevron-left')}</span>
      </button>
      <button class="chat-menu-button" type="button" title="Opciones de conversación" aria-label="Opciones de conversación" aria-haspopup="menu" aria-expanded="false" aria-controls="${id}-menu">${renderIcon('more')}</button>
    `);
    this.#toggleButton = this.#header.querySelector('.chat-toggle-button');

    this.#menu = document.createElement('div');
    this.#menu.className = 'chat-menu';
    this.#menu.id = `${id}-menu`;
    this.#menu.setAttribute('aria-label', 'Opciones de conversación');
    this.#menu.setAttribute('role', 'menu');
    this.#menu.hidden = true;
    this.#menu.innerHTML = safeHTML(`
      <button type="button" role="menuitem" data-chat-action="new">Nuevo chat</button>
      <button type="button" role="menuitem" data-chat-action="save">Guardar conversación</button>
      <button type="button" role="menuitem" data-chat-action="library">Ver Guardadas</button>
      <div class="chat-menu__separator" role="separator"></div>
      <button type="button" role="menuitem" class="is-danger" data-chat-action="delete">Eliminar este chat</button>
    `);
    this.#header.appendChild(this.#menu);

    // ── Message list ────────────────────────────────────────────────────
    this.#messageList = document.createElement('div');
    this.#messageList.className = 'chat-messages';
    this.#messageList.id = `${id}-messages`;
    this.#messageList.inert = true;

    // ── Input row ───────────────────────────────────────────────────────
    const inputRow = document.createElement('div');
    inputRow.className = 'chat-input-row';
    inputRow.id = `${id}-input`;
    inputRow.inert = true;
    this.#inputRow = inputRow;

    this.#input = document.createElement('textarea');
    this.#input.rows = 1;
    this.#input.placeholder = 'Pide una idea, una revisión o el siguiente paso…';
    this.#input.setAttribute('aria-label', 'Mensaje para Kubrick Space');
    this.#input.className = 'chat-input';

    this.#sendBtn = document.createElement('button');
    this.#sendBtn.className = 'chat-send btn-ghost';
    this.#sendBtn.textContent = 'Enviar';

    inputRow.append(this.#input, this.#sendBtn);
    if (attachCharacterPhoto) {
      const file = document.createElement('input');
      file.type = 'file';
      file.accept = 'image/png,image/jpeg,image/webp,image/gif,image/bmp';
      file.hidden = true;
      file.setAttribute('aria-label', 'Adjuntar fotografía en Kubrick Space');
      this.#photoButton = document.createElement('button');
      this.#photoButton.type = 'button';
      this.#photoButton.className = 'chat-photo-button btn-ghost';
      this.#photoButton.setAttribute('aria-label', 'Adjuntar fotografía al personaje');
      this.#photoButton.title = 'Adjuntar fotografía al personaje';
      this.#photoButton.innerHTML = safeHTML(renderIcon('image'));
      this.#photoButton.addEventListener('click', () => file.click());
      file.addEventListener('change', async () => {
        if (!file.files?.[0] || this.#loading || this.#uploadingPhoto) return;
        this.#uploadingPhoto = true;
        this.#photoButton.disabled = true;
        try {
          const url = await this.#attachCharacterPhoto(file.files[0]);
          if (AppState.currentProject?.type !== 'character') this.#externalPhoto = url;
          this.#syncPhotoPreview();
        } catch (error) {
          this.#notify(error.message, 'error');
        } finally {
          file.value = '';
          this.#uploadingPhoto = false;
          this.#photoButton.disabled = false;
        }
      });
      inputRow.insertBefore(this.#photoButton, this.#sendBtn);
      inputRow.append(file);
    }

    this.#root.append(this.#header, this.#messageList, inputRow);
    container.appendChild(this.#root);
    if (this.#photoButton) {
      this.#photoPreview = document.createElement('div');
      this.#photoPreview.className = 'chat-photo-preview';
      this.#root.insertBefore(this.#photoPreview, inputRow);
      this.#syncPhotoPreview();
    }
    this.#restoreActiveConversation();
    this.#refreshContext();

    // ── Events ──────────────────────────────────────────────────────────
    this.#bound.keydown = this.#onInputKeydown.bind(this);
    this.#bound.send = () => {
      if (!this.#loading) return this.#send();
      if (this.#bookActive) {
        this.#bookStopRequested = true;
        if (this.#bookJobId)
          void API.cancelBackgroundJob(this.#bookJobId).catch((error) =>
            this.#notify(error.message, 'error'),
          );
      } else this.#requestController?.abort();
    };
    this.#bound.toggle = () => this.#toggle();
    this.#bound.menuButton = (event) => {
      event.stopPropagation();
      this.#toggleMenu();
    };
    this.#bound.menuAction = (event) => {
      const action = event.target.closest('[data-chat-action]')?.dataset.chatAction;
      if (!action) return;
      event.stopPropagation();
      this.#closeMenu();
      if (action === 'new') this.#clearConversation();
      else if (action === 'save') this.#saveConversation();
      else if (action === 'library') this.#showLibrary();
      else if (action === 'delete') this.#deleteCurrentConversation();
    };
    this.#bound.outsideMenu = (event) => {
      if (!this.#header?.contains(event.target)) this.#closeMenu();
    };
    this.#bound.escapeMenu = (event) => {
      if (event.key === 'Escape' && !this.#menu?.hidden) {
        event.preventDefault();
        this.#closeMenu(true);
      }
    };
    this.#bound.menuKeydown = (event) => {
      const items = [...this.#menu.querySelectorAll('[role=menuitem]')];
      const index = items.indexOf(document.activeElement);
      let next;
      if (event.key === 'ArrowDown') next = (index + 1) % items.length;
      else if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = items.length - 1;
      else return;
      event.preventDefault();
      items[next]?.focus();
    };
    this.#bound.libraryClick = (event) => this.#onLibraryClick(event);
    this.#bound.libraryClose = (event) => {
      if (event.target === this.#libraryDialog) this.#libraryDialog.close();
    };
    this.#bound.contextReady = () => this.#refreshContext();
    this.#bound.suggestion = (event) => {
      const button = event.target.closest('[data-chat-prompt]');
      if (!button || !(button instanceof HTMLButtonElement)) return;
      this.#input.value = button.dataset.chatPrompt || '';
      this.#input.focus();
    };
    this.#input.addEventListener('keydown', this.#bound.keydown);
    this.#sendBtn.addEventListener('click', this.#bound.send);
    this.#toggleButton.addEventListener('click', this.#bound.toggle);
    this.#header.querySelector('.chat-menu-button')?.addEventListener('click', this.#bound.menuButton);
    this.#menu.addEventListener('click', this.#bound.menuAction);
    this.#menu.addEventListener('keydown', this.#bound.menuKeydown);
    document.addEventListener('pointerdown', this.#bound.outsideMenu);
    document.addEventListener('keydown', this.#bound.escapeMenu);
    this.#messageList.addEventListener('click', this.#bound.suggestion);
    EventBus.on('workspace:context:ready', this.#bound.contextReady);
    if (this.#acceptBookJob && API.enqueueBookJob && AppState.currentProject?.category === 'story-book') {
      const id = AppState.currentProject.id;
      void API.characterJobs(id)
        .then(({ jobs }) => {
          const job = jobs.find((j) => j.kind === 'book' && ['queued', 'running'].includes(j.status));
          if (job && this.#root && AppState.currentProject?.id === id && !this.#loading)
            return this.#runBookJob('', job.id);
        })
        .catch(() => {});
    }
  }

  /** Clean up listeners and DOM. */
  destroy() {
    if (!this.#root) return;
    this.#rememberConversation();
    this.#requestController?.abort();
    this.#input?.removeEventListener('keydown', this.#bound.keydown);
    this.#sendBtn?.removeEventListener('click', this.#bound.send);
    clearTimeout(this.#focusTimer);
    this.#toggleButton?.removeEventListener('click', this.#bound.toggle);
    this.#header?.querySelector('.chat-menu-button')?.removeEventListener('click', this.#bound.menuButton);
    this.#menu?.removeEventListener('click', this.#bound.menuAction);
    this.#menu?.removeEventListener('keydown', this.#bound.menuKeydown);
    document.removeEventListener('pointerdown', this.#bound.outsideMenu);
    document.removeEventListener('keydown', this.#bound.escapeMenu);
    this.#messageList?.removeEventListener('click', this.#bound.suggestion);
    this.#libraryDialog?.removeEventListener('click', this.#bound.libraryClick);
    this.#libraryDialog?.removeEventListener('click', this.#bound.libraryClose);
    this.#libraryDialog?.close();
    this.#libraryDialog?.remove();
    this.#libraryDialog = null;
    EventBus.off('workspace:context:ready', this.#bound.contextReady);
    this.#root?.remove();
    this.#root = null;
    this.#bound = {};
  }

  // ─── Private ──────────────────────────────────────────────────────────

  /** Toggle expanded / collapsed. */
  #toggle() {
    this.#expanded = !this.#expanded;
    this.#root?.classList.toggle('is-open', this.#expanded);
    this.#root?.classList.toggle('is-collapsed', !this.#expanded);
    this.#root?.parentElement?.classList.toggle('is-open', this.#expanded);
    this.#root?.parentElement?.classList.toggle('is-collapsed', !this.#expanded);
    clearTimeout(this.#focusTimer);
    this.#closeMenu();
    this.#toggleButton?.setAttribute('aria-expanded', String(this.#expanded));
    this.#toggleButton?.setAttribute('aria-label', this.#expanded ? 'Cerrar agente' : 'Abrir agente');
    this.#messageList.inert = !this.#expanded;
    this.#inputRow.inert = !this.#expanded;
    EventBus.emit('workspace:chat:toggle', { open: this.#expanded });
    if (this.#expanded) {
      this.#refreshContext();
      this.#scrollToBottom();
      // Auto-focus input when expanding
      this.#focusTimer = setTimeout(() => {
        if (this.#expanded && this.#root?.isConnected && document.activeElement === this.#toggleButton) {
          this.#input?.focus();
        }
      }, 260);
    } else {
      this.#toggleButton?.focus();
    }
  }

  /**
   * Handle keyboard in the input field.
   * Enter → send. Shift+Enter → a line break.
   * @param {KeyboardEvent} e
   */
  #onInputKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.#send();
    }
  }

  /**
   * Helper to add an invisible message to history without showing it in UI
   */
  #addInvisibleMessage(role, text) {
    const time = timestamp();
    this.#history.push({ role, text, time, visible: false });
    this.#rememberConversation();
  }

  #titleFromFirstMessage(text) {
    const normalized = String(text || '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[#>*\s-]+/, '');
    if (normalized.length <= 64) return normalized || 'Nueva conversación';
    return `${normalized.slice(0, 61).trimEnd()}…`;
  }

  #projectId() {
    return AppState.currentProject?.id || null;
  }

  #toggleMenu() {
    if (!this.#menu || !this.#expanded) return;
    clearTimeout(this.#focusTimer);
    const open = this.#menu.hidden;
    this.#menu.hidden = !open;
    this.#header?.querySelector('.chat-menu-button')?.setAttribute('aria-expanded', String(open));
    if (open) this.#menu.querySelector('[role=menuitem]')?.focus();
  }

  #closeMenu(restoreFocus = false) {
    if (!this.#menu || this.#menu.hidden) return;
    this.#menu.hidden = true;
    this.#header?.querySelector('.chat-menu-button')?.setAttribute('aria-expanded', 'false');
    if (restoreFocus) this.#header?.querySelector('.chat-menu-button')?.focus();
  }

  #notify(message, type = 'info') {
    Toast.show(message, type);
  }

  #getEditorContext() {
    let ctx = null;
    const ctxHandler = (data) => {
      ctx = data;
    };
    EventBus.on('editor:context', ctxHandler);
    EventBus.emit('editor:getContext');
    EventBus.off('editor:context', ctxHandler);
    return ctx || { content: '', plainText: '', tags: [], blocks: [], ingredients: [] };
  }

  #refreshContext() {
    this.#syncPhotoPreview();
    // Keep the editor context handshake, but leave the chat header uncluttered.
    return this.#getEditorContext();
  }
  #pendingPhoto() {
    if (this.#externalPhoto) return this.#externalPhoto;
    try {
      return JSON.parse(AppState.currentProject?.content || '{}').requestImage || '';
    } catch {
      return '';
    }
  }
  #syncPhotoPreview() {
    if (!this.#photoPreview) return;
    const url = this.#pendingPhoto();
    this.#photoPreview.replaceChildren();
    this.#photoPreview.hidden = !url;
    if (!url) return;
    const image = document.createElement('img');
    image.src = url;
    image.alt = 'Referencia visual adjunta al personaje';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn-ghost';
    remove.textContent = 'Quitar fotografía';
    remove.disabled = this.#loading || this.#uploadingPhoto;
    remove.addEventListener('click', async () => {
      try {
        await this.#attachCharacterPhoto(null);
        this.#externalPhoto = '';
        this.#syncPhotoPreview();
      } catch (error) {
        this.#notify(error.message, 'error');
      }
    });
    this.#photoPreview.append(image, remove);
  }

  #renderEmptyState() {
    if (!this.#messageList) return;
    const type = AppState.currentProject?.type || 'project';
    const prompts = {
      book: [
        'Analiza este fragmento y propón tres mejoras concretas de ritmo, conflicto y continuidad.',
        'Propón el siguiente giro narrativo coherente con este proyecto.',
        'Hazme preguntas que ayuden a descubrir qué falta en esta historia.',
      ],
      character: [
        'Analiza este personaje: detecta contradicciones, vacíos y oportunidades narrativas.',
        'Propón un conflicto interno y uno externo que hagan más interesante a este personaje.',
        'Hazme preguntas para profundizar sus motivaciones y relaciones.',
      ],
      video: [
        'Convierte este guion en una propuesta de escenas con intención visual y sonora.',
        'Revisa la continuidad y sugiere mejoras cinematográficas concretas.',
        'Propón un plan de storyboard para la siguiente secuencia.',
      ],
      song: [
        'Analiza la letra y propone mejoras de intención, métrica e imágenes.',
        'Propón una estructura que fortalezca esta canción.',
        'Hazme preguntas para descubrir el tono y la emoción central de la pieza.',
      ],
      stage: [
        'Analiza este escenario y propone detalles que refuercen la historia.',
        'Identifica oportunidades visuales y dramáticas en este espacio.',
        'Hazme preguntas para definir la atmósfera y las reglas de este escenario.',
      ],
    }[type] || [
      'Analiza el estado de este proyecto y propón el siguiente paso.',
      'Hazme preguntas para aclarar la dirección creativa.',
      'Propón tres mejoras concretas para este proyecto.',
    ];

    this.#emptyState = document.createElement('section');
    this.#emptyState.className = 'chat-welcome';
    this.#emptyState.innerHTML = safeHTML(
      `<div class="chat-welcome__eyebrow">ASISTENTE DEL PROYECTO</div><h2>¿En qué parte quieres avanzar?</h2><p>Kubrick Space toma el contenido, las etiquetas y los ingredientes activos como contexto. Puedes pedir análisis, ideas, estructura o una acción concreta.</p><div class="chat-suggestions">${prompts.map((prompt) => `<button type="button" data-chat-prompt="${prompt.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">${prompt}</button>`).join('')}</div>`,
    );
    this.#messageList.appendChild(this.#emptyState);
  }

  #rememberConversation() {
    try {
      window.localStorage.setItem(
        'kubrick-active-chat',
        JSON.stringify({
          history: this.#history,
          name: this.#autoTitle,
          id: this.#activeConversationId,
          projectId: this.#conversationProjectId,
          contextProjectId: this.#contextProjectId,
          draft: this.#input?.value || '',
        }),
      );
    } catch {
      /* Navigation retains the in-memory snapshot when browser storage is unavailable. */
    }
    Chat.activeConversation = {
      history: this.#history.map((item) => ({ ...item })),
      name: this.#autoTitle,
      id: this.#activeConversationId,
      projectId: this.#conversationProjectId,
      contextProjectId: this.#contextProjectId,
      draft: this.#input?.value || '',
    };
  }
  #restoreActiveConversation() {
    let saved = Chat.activeConversation;
    try {
      saved ||= JSON.parse(window.localStorage.getItem('kubrick-active-chat'));
    } catch {
      /* Optional recovery. */
    }
    if (
      saved &&
      Array.isArray(saved.history) &&
      saved.history.length <= 2000 &&
      saved.history.every((item) => ['user', 'ai'].includes(item.role) && typeof item.text === 'string')
    ) {
      this.#history = saved.history.map((item) => ({ ...item }));
      this.#autoTitle = saved.name || '';
      this.#activeConversationId = saved.id || null;
      this.#conversationProjectId = saved.projectId || null;
      this.#contextProjectId = saved.contextProjectId || null;
      this.#input.value = saved.draft || '';
      for (const message of this.#history)
        if (
          message.visible !== false &&
          (message.role !== 'ai' || parseAgentResponse(message.text, true).text.trim())
        )
          this.#messageList.append(createBubble(message.role, message.text, message.time || ''));
    }
    if (!this.#history.length) this.#renderEmptyState();
  }

  #clearConversation() {
    if (this.#loading) return;
    this.#history = [];
    this.#autoTitle = '';
    this.#activeConversationId = null;
    this.#conversationProjectId = null;
    this.#contextProjectId = null;
    this.#input.value = '';
    this.#externalPhoto = '';
    this.#rememberConversation();
    this.#messageList?.replaceChildren();
    this.#renderEmptyState();
    this.#input?.focus();
  }

  async #saveConversation() {
    if (this.#loading) return this.#notify('Espera a que termine la respuesta antes de guardar.', 'info');
    const projectId = this.#conversationProjectId || this.#projectId();
    const firstUserMessage = this.#history.find(
      (message) => message.visible !== false && message.role === 'user' && message.text.trim(),
    );
    if (!projectId || !firstUserMessage)
      return this.#notify('Envía al menos un mensaje antes de guardar la conversación.', 'info');
    const defaultName = this.#autoTitle || this.#titleFromFirstMessage(firstUserMessage.text);
    const name = await Modal.prompt({
      title: 'Guardar conversación',
      message: 'Elige un nombre fácil de reconocer para encontrarla después.',
      label: 'Nombre de la conversación',
      defaultValue: defaultName,
      maxLength: 120,
      confirmLabel: 'Guardar',
    });
    if (name === null) return;
    const cleanedName = name.trim();
    if (!cleanedName) return this.#notify('Escribe un nombre para la conversación.', 'error');
    if (cleanedName.length > 120)
      return this.#notify('El nombre no puede superar los 120 caracteres.', 'error');
    try {
      const payload = { name: cleanedName, messages: this.#history };
      const saved = this.#activeConversationId
        ? await API.updateChat(projectId, this.#activeConversationId, payload)
        : await API.saveChat(projectId, payload);
      this.#activeConversationId = saved.id;
      this.#conversationProjectId = projectId;
      this.#autoTitle = saved.name;
      this.#rememberConversation();
      this.#notify('Conversación guardada.', 'success');
    } catch (error) {
      this.#notify(`No se pudo guardar la conversación: ${error.message}`, 'error');
    }
  }

  async #deleteCurrentConversation() {
    if (this.#loading)
      return this.#notify('Espera a que termine la respuesta antes de eliminar el chat.', 'info');
    const projectId = this.#conversationProjectId || this.#projectId();
    if (this.#activeConversationId && projectId) {
      try {
        await API.deleteChat(projectId, this.#activeConversationId);
      } catch (error) {
        this.#notify(`No se pudo eliminar la conversación guardada: ${error.message}`, 'error');
        return;
      }
    }
    this.#clearConversation();
  }

  async #showLibrary() {
    const projectId = this.#projectId();
    if (!projectId) return;
    if (!this.#libraryDialog) this.#createLibraryDialog();
    const list = this.#libraryDialog.querySelector('.chat-library__list');
    list.replaceChildren();
    const loading = document.createElement('p');
    loading.className = 'chat-library__empty';
    loading.textContent = 'Cargando conversaciones…';
    list.appendChild(loading);
    this.#libraryDialog.showModal();
    try {
      const chats = await API.listChats(projectId);
      if (!this.#root || this.#projectId() !== projectId) return;
      list.replaceChildren();
      if (!chats.length) {
        const empty = document.createElement('p');
        empty.className = 'chat-library__empty';
        empty.textContent = 'Todavía no hay conversaciones guardadas en este proyecto.';
        list.appendChild(empty);
        return;
      }
      for (const chat of chats) {
        const row = document.createElement('article');
        row.className = 'chat-library__item';
        const details = document.createElement('div');
        details.className = 'chat-library__details';
        const title = document.createElement('h3');
        title.textContent = chat.name;
        const meta = document.createElement('p');
        const date = new Date(chat.updatedAt);
        meta.textContent = `${Number.isNaN(date.getTime()) ? '' : date.toLocaleString()} · ${chat.messageCount} mensajes`;
        details.append(title, meta);
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'btn-ghost';
        open.dataset.openChat = chat.id;
        open.textContent = 'Abrir';
        row.append(details, open);
        list.appendChild(row);
      }
    } catch (error) {
      list.replaceChildren();
      const failure = document.createElement('p');
      failure.className = 'chat-library__empty is-error';
      failure.textContent = `No se pudo cargar la biblioteca: ${error.message}`;
      list.appendChild(failure);
    }
  }

  #createLibraryDialog() {
    const dialog = document.createElement('dialog');
    dialog.className = 'chat-library-dialog';
    dialog.setAttribute('aria-labelledby', 'chat-library-title');
    dialog.innerHTML = safeHTML(`
      <header class="chat-library__header"><div><span>KUBRICK SPACE</span><h2 id="chat-library-title">Conversaciones guardadas</h2></div><button type="button" class="chat-library__close" aria-label="Cerrar">${renderIcon('close')}</button></header>
      <section class="chat-library__list"></section>
    `);
    dialog.querySelector('.chat-library__close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', this.#bound.libraryClick);
    dialog.addEventListener('click', this.#bound.libraryClose);
    document.body.appendChild(dialog);
    this.#libraryDialog = dialog;
  }

  async #onLibraryClick(event) {
    const button = event.target.closest('[data-open-chat]');
    if (!button) return;
    if (this.#loading)
      return this.#notify('Espera a que termine la respuesta antes de abrir otra conversación.', 'info');
    const hasCurrent = this.#history.some((message) => message.visible !== false && message.role === 'user');
    if (
      hasCurrent &&
      !(await Modal.confirm({
        title: 'Abrir conversación guardada',
        message: 'Abrir esta conversación reemplazará el chat actual. ¿Quieres continuar?',
        confirmLabel: 'Abrir conversación',
        type: 'warning',
      }))
    )
      return;
    button.disabled = true;
    const projectId = this.#projectId();
    try {
      const chat = await API.getChat(projectId, button.dataset.openChat);
      if (!this.#root || this.#projectId() !== projectId) return;
      this.#history = chat.messages.map((message) => ({ ...message, visible: message.visible !== false }));
      this.#activeConversationId = chat.id;
      this.#conversationProjectId = projectId;
      this.#contextProjectId = projectId;
      this.#autoTitle = chat.name;
      this.#rememberConversation();
      this.#messageList.replaceChildren();
      this.#emptyState = null;
      for (const message of this.#history) {
        if (message.visible && (message.role !== 'ai' || parseAgentResponse(message.text, true).text.trim()))
          this.#messageList.appendChild(createBubble(message.role, message.text, message.time || ''));
      }
      this.#libraryDialog.close();
      this.#scrollToBottom();
    } catch (error) {
      button.disabled = false;
      this.#notify(`No se pudo abrir la conversación: ${error.message}`, 'error');
    }
  }

  /** Send the user message + editor context to the AI (with Agentic Loop support). */
  async #send() {
    if (this.#loading && this.#bookActive) {
      const message = this.#input.value.trim();
      if (!message) return;
      try {
        if (this.#bookJobId) await API.messageBookJob(this.#bookJobId, message);
        else this.#bookQueuedMessages.push(message);
        this.#addMessage('user', message);
        this.#input.value = '';
      } catch (error) {
        this.#notify(error.message, 'error');
      }
      return;
    }
    if (this.#loading || this.#uploadingPhoto) return;
    const originalText = this.#input?.value.trim();
    const originatingProjectId = AppState.currentProject?.id;
    const approvedReads = new Set([originatingProjectId]);
    if (!originalText) return;
    if (
      AppState.currentProject?.type === 'book' &&
      AppState.currentProject?.category === 'story-book' &&
      storyBookIntent(originalText) === 'edit' &&
      this.#acceptBookJob &&
      API.enqueueBookJob
    ) {
      this.#input.value = '';
      if (!this.#history.some((message) => message.visible !== false && message.role === 'user'))
        this.#autoTitle = this.#titleFromFirstMessage(originalText);
      this.#addMessage('user', originalText);
      await this.#runBookJob(originalText);
      return;
    }

    const expectedDocument = this.#getEditorContext().document;
    if (this.#contextProjectId && this.#contextProjectId !== originatingProjectId)
      this.#addInvisibleMessage(
        'user',
        '[Sistema: cambió el proyecto abierto. Los mensajes anteriores son historial; el proyecto activo y su contenido del turno actual tienen precedencia. No repitas comandos anteriores.]',
      );
    this.#contextProjectId = originatingProjectId;
    // Clear input
    if (this.#input) this.#input.value = '';

    // Show user bubble
    if (!this.#history.some((message) => message.visible !== false && message.role === 'user')) {
      this.#autoTitle = this.#titleFromFirstMessage(originalText);
    }
    this.#addMessage('user', originalText);

    this.#loading = true;
    if (this.#photoButton) this.#photoButton.disabled = true;
    const controller = new AbortController();
    this.#requestController = controller;
    this.#sendBtn.textContent = 'Detener';
    const loader = this.#showLoader();

    let currentMessageText = originalText;
    const maxTurns = 3;
    let turns = 0;
    let characterActionExecuted = false;

    while (
      turns < maxTurns &&
      !controller.signal.aborted &&
      this.#root &&
      AppState.currentProject?.id === originatingProjectId
    ) {
      turns++;

      // Gather editor context via EventBus
      this.#refreshContext();

      // Build AI payload
      // Exclude the last message from history because it will be sent as 'message'
      // `time` is presentation-only metadata for the chat bubbles. Keep the
      // transport history limited to the fields accepted by /api/ai/text;
      // sending the timestamp makes the second request fail validation.
      const historyToSend = this.#history
        .slice(0, -1)
        .slice(-20)
        .map(({ role, text }) => ({ role, text }));

      const payload = {
        message:
          currentMessageText +
          (this.#pendingPhoto()
            ? '\n[Referencia visual adjunta disponible para PERSONAJE.attachmentImage (dato local confirmado): ' +
              JSON.stringify(this.#pendingPhoto()) +
              ']'
            : ''),
        history: historyToSend,
      };

      const reply = this.#createLiveReply(controller, loader, originatingProjectId);
      try {
        const response = await API.aiTextStream(payload, {
          signal: controller.signal,
          onDelta: reply.append,
        });
        if (
          controller.signal.aborted ||
          !this.#root ||
          AppState.currentProject?.id !== originatingProjectId
        ) {
          reply.cancel();
          break;
        }
        if (response && response.debug) {
          console.group('%c[AI Debug - Chat] Datos enviados al LLM', 'color: #818cf8; font-weight: bold;');
          console.log('Payload de la Petición:', payload);
          console.log('Metadatos Debug:', response.debug);
          console.group('Mensajes Compilados (System + User Prompts - Sin Truncar)');
          if (response.debug.messages) {
            response.debug.messages.forEach((m) => {
              console.log(`%c--- ${m.role.toUpperCase()} ---`, 'font-weight: bold; color: #a78bfa;');
              console.log(m.content);
            });
          }
          console.groupEnd();
          console.groupEnd();
        }

        let aiText =
          typeof response === 'string'
            ? response
            : (response?.text ?? response?.message ?? JSON.stringify(response));

        // Check for agentic command
        const parsed = parseAgentResponse(aiText, true);
        if (
          this.#acceptBookJob &&
          AppState.currentProject?.category === 'story-book' &&
          storyBookIntent(originalText) === 'edit' &&
          (parsed.incomplete || !parsed.commands.length)
        ) {
          reply.discard();
          loader.remove();
          await this.#runBookJob(originalText);
          break;
        }
        if (parsed.incomplete) throw new Error('El agente devolvió un comando incompleto. No se ejecutó.');
        const directEdit =
          AppState.currentProject?.type === 'book' && storyBookIntent(originalText) === 'edit';
        if (
          turns === 1 &&
          directEdit &&
          !parsed.commands.length &&
          /(?:\?|¿).{0,180}(?:proced|confirm|autoriz|quieres|deseas|guard|aplic)/is.test(parsed.text)
        ) {
          reply.discard();
          const instruction =
            '[Sistema: La petición anterior ya ordena actuar en el libro abierto. No solicites confirmación ni crees otro proyecto. Emite EDITAR_DOCUMENTO con el ID del proyecto activo y el contenido actualizado. Pregunta solo si falta información imprescindible.]';
          this.#addInvisibleMessage('user', instruction);
          currentMessageText = instruction;
          continue;
        }
        await reply.finish(aiText);
        if (controller.signal.aborted || !this.#root || AppState.currentProject?.id !== originatingProjectId)
          break;
        const readMatch = parsed.commands.find((command) => command.name === 'LEER_PROYECTO');
        const editMatch = parsed.commands.find((command) => command.name === 'EDITAR_DOCUMENTO');
        const createMatch = parsed.commands.find((command) => command.name === 'CREAR_PROYECTO');
        const characterMatch = parsed.commands.find((command) => command.name === 'PERSONAJE');
        const bookMatch = parsed.commands.find((command) => command.name === 'ESCRIBIR_LIBRO');
        if (bookMatch) {
          const action = JSON.parse(bookMatch.argument);
          if (
            parsed.commands.length !== 1 ||
            action.projectId !== originatingProjectId ||
            !this.#acceptBookJob ||
            AppState.currentProject?.category !== 'story-book'
          )
            throw new Error('La escritura requiere el Story Book abierto.');
          loader.remove();
          await this.#runBookJob(originalText);
          break;
        }

        if (characterMatch) {
          if (characterActionExecuted)
            throw new Error('La acción de personaje ya se ejecutó en esta petición.');
          if (parsed.commands.length !== 1)
            throw new Error('Kubrick Space debe ejecutar una sola acción de personaje por turno.');
          if (!this.#executeCharacterAction)
            throw new Error('La edición de personajes no está disponible en esta vista.');
          const action = JSON.parse(characterMatch.argument);
          if (!/^[a-f0-9-]{36}$/.test(action.projectId || ''))
            throw new Error('Selecciona un personaje con un ID confirmado.');
          characterActionExecuted = true;
          const result = await this.#executeCharacterAction(action, { signal: controller.signal });
          if (result?.status === 'queued') {
            this.#externalPhoto = '';
            this.#syncPhotoPreview();
          }
          if (controller.signal.aborted || AppState.currentProject?.id !== originatingProjectId) break;
          const systemContext =
            '[Sistema: Resultado real de la acción del personaje (datos): ' +
            JSON.stringify(result) +
            '. Confirma solo lo completado. proposed requiere revisión del usuario; error o imageStatus error significa que la foto NO se completó. No repitas la acción en esta respuesta.]';
          this.#addInvisibleMessage('user', systemContext);
          currentMessageText = systemContext;
          continue;
        }

        if (editMatch) {
          if (parsed.commands.length !== 1 || characterActionExecuted || !this.#applyDocumentChange)
            throw new Error('La edición no está disponible o incluye varias acciones.');
          const proposal = JSON.parse(editMatch.argument);
          if (proposal.projectId !== originatingProjectId || typeof proposal.content !== 'string') {
            reply.discard();
            if (turns < maxTurns) {
              currentMessageText =
                '[Sistema: La propuesta usa un ID o formato incorrecto. Proyecto activo autoritativo: ' +
                JSON.stringify(originatingProjectId) +
                '. Usa ese ID exacto, nunca el ID del documento interno ni uno del historial. Emite una acción válida; no anuncies comandos.]';
              this.#addInvisibleMessage('user', currentMessageText);
              continue;
            }
            throw new Error('No se pudo preparar una edición válida para el documento abierto.');
          }
          controller.signal.throwIfAborted();
          if (AppState.currentProject?.id !== originatingProjectId) break;
          const result = await this.#applyDocumentChange(proposal, expectedDocument);
          characterActionExecuted = true;
          const outcome =
            '[Sistema: Resultado real de EDITAR_DOCUMENTO: ' +
            JSON.stringify(result) +
            '. Confirma solo este resultado; no repitas la acción.]';
          this.#addInvisibleMessage('user', outcome);
          currentMessageText = outcome;
          continue;
        }

        if (createMatch) {
          const jsonStr = createMatch.argument;
          let payload;
          try {
            payload = JSON.parse(jsonStr);
          } catch (err) {
            console.error('Failed to parse CREAR_PROYECTO JSON:', err);
            const systemContext = `[Sistema: Error al procesar el comando CREAR_PROYECTO. El formato JSON es inválido: ${err.message}. Por favor, vuelve a generar el comando con un JSON estrictamente válido.]`;
            this.#addInvisibleMessage('user', systemContext);
            currentMessageText = systemContext;
            continue;
          }

          if (!this.#root || AppState.currentProject?.id !== originatingProjectId) break;
          const normalizedName = (value) =>
            String(value || '')
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .toLowerCase()
              .trim();
          const knownProjects = API.getProjects ? await API.getProjects() : AppState.projects || [];
          const existing = (
            Array.isArray(knownProjects) ? knownProjects : knownProjects?.projects || []
          ).find((project) => normalizedName(project.name) === normalizedName(payload.name));
          const editRequest =
            /\b(edit(?:a|ar|alo|ala)|modific(?:a|ar|alo|ala)|actualiz(?:a|ar|alo|ala)|reescrib(?:e|ir|elo|ela)|complet(?:a|ar|alo|ala))\b/i.test(
              normalizedName(originalText),
            );
          const explicitNewProject =
            /\b(?:crea|crear|genera|generar|haz)\b[\s\S]{0,100}\b(?:proyecto|libro|personaje|guion)\b/i.test(
              normalizedName(originalText),
            ) && /\b(?:nuevo|nueva|otro|otra)\b/i.test(normalizedName(originalText));
          if (
            existing ||
            ((editRequest ||
              (directEdit && !explicitNewProject) ||
              normalizedName(payload.name) === normalizedName(AppState.currentProject?.name)) &&
              AppState.currentProject?.type === 'book' &&
              payload.type === 'book')
          ) {
            const outcome =
              '[Sistema: Creación bloqueada. El usuario está editando un proyecto existente. Usa EDITAR_DOCUMENTO para el libro abierto con su ID confirmado; no propongas duplicados. Proyecto existente: ' +
              JSON.stringify(existing?.id || originatingProjectId) +
              ']';
            this.#addInvisibleMessage('user', outcome);
            currentMessageText = outcome;
            continue;
          }
          if (payload.type === 'book' && payload.category !== 'screenplay') {
            payload.category = 'story-book';
            if (!this.#prepareProjectContent) throw new Error('No está disponible el validador de libros.');
            payload.content = this.#prepareProjectContent(payload, payload.content || '');
          }
          if (
            !explicitNewProject &&
            !(await Modal.confirm({
              title: 'Autorizar creación de proyecto',
              message: `El asistente propone crear y guardar "${payload.name || 'Nuevo proyecto'}" (${payload.type || 'character'})${payload.linkAsIngredient ? ' y vincularlo al proyecto actual' : ''}.\n\n¿Autorizar esta creación?`,
              confirmLabel: 'Crear proyecto',
              type: 'warning',
            }))
          ) {
            this.#addMessage('ai', 'Creación cancelada. No se guardó el proyecto propuesto.');
            break;
          }
          Toast.show(`Creando proyecto "${payload.name || 'Nuevo'}"...`, 'info');

          let systemContext = '';
          let createdProject = null;
          try {
            const newProj = await API.createProject({
              name: payload.name || 'Sin título',
              type: payload.type || 'character',
              category: payload.category || 'secondary',
            });
            createdProject = newProj;

            let initialContent = payload.content || '';
            if (newProj.type === 'character') {
              const creation = await prepareCharacterCreation(
                newProj,
                payload.characterCreation || {
                  source: 'auto',
                  request:
                    [payload.content, payload.traits ? JSON.stringify(payload.traits) : '']
                      .filter(Boolean)
                      .join('\n') || `Crear un personaje llamado ${newProj.name}.`,
                },
                {
                  signal: controller.signal,
                  ingredients:
                    AppState.currentProject?.id === originatingProjectId
                      ? AppState.currentProject.ingredients || []
                      : [],
                },
              );
              if (controller.signal.aborted) throw new Error('Se canceló la configuración del personaje.');
              initialContent = JSON.stringify(creation.document);
            }
            const updatedProj = await API.updateProject(newProj.id, {
              content: initialContent,
              traits: newProj.type === 'character' ? {} : payload.traits || {},
            });
            createdProject = updatedProj;

            let linkedMsg = '';
            if (payload.linkAsIngredient) {
              if (AppState.currentProject?.id !== originatingProjectId || controller.signal.aborted) {
                linkedMsg = '; no se vinculó porque el proyecto activo cambió antes de terminar';
              } else {
                let ingredientAdded = false;
                try {
                  const imported = await EventBus.emitAsync('editor:importIngredient', {
                    id: updatedProj.id,
                    name: updatedProj.name,
                    type: updatedProj.type,
                    category: updatedProj.category,
                    deferToast: true,
                  });
                  if (
                    !imported.some((result) => result === true) ||
                    !AppState.currentProject?.ingredients?.some(
                      (ingredient) => ingredient.importedProjectId === updatedProj.id,
                    )
                  ) {
                    throw new Error(
                      'El editor no confirmó que el ingrediente quedara añadido al proyecto activo.',
                    );
                  }
                  ingredientAdded = true;
                  // Persist through the temporary document draft. This deliberately
                  // does not create or overwrite a permanent document version.
                  const savedDrafts = await EventBus.emitAsync('autosave:flush');
                  if (!savedDrafts.length)
                    throw new Error('El guardado temporal del proyecto no está disponible.');
                  linkedMsg = ' y vinculado como ingrediente del proyecto actual';
                  Toast.show(
                    `Ingrediente "${updatedProj.name}" vinculado y guardado en el borrador temporal.`,
                    'success',
                  );
                } catch (linkError) {
                  linkedMsg = ingredientAdded
                    ? ` y añadido al editor, pero falló el guardado temporal: ${linkError.message}`
                    : `, pero no se pudo vincular al proyecto actual: ${linkError.message}`;
                }
              }
            }

            systemContext = `[Sistema: Proyecto "${payload.name}" creado con éxito. ID: ${updatedProj.id}${linkedMsg}. Responde al usuario confirmándole esto de forma natural.]`;
          } catch (e) {
            console.error('Error creating project in agentic loop:', e);
            systemContext = createdProject
              ? `[Sistema: Proyecto "${createdProject.name}" creado con ID ${createdProject.id}, pero no se completó su configuración o vinculación al proyecto actual. Error: ${e.message}. Sé explícito: confirma solo la creación; di que la configuración o el enlace no terminó y no afirmes que quedó como ingrediente.]`
              : `[Sistema: Error al crear el proyecto. Detalles: ${e.message}]`;
          }

          this.#addInvisibleMessage('user', systemContext);
          currentMessageText = systemContext;
          continue; // Loop again
        } else if (readMatch) {
          const projectIdToRead = readMatch.argument;
          if (!this.#root || AppState.currentProject?.id !== originatingProjectId) break;
          if (!approvedReads.has(projectIdToRead)) {
            const name = AppState.projects?.find((p) => p.id === projectIdToRead)?.name || projectIdToRead;
            if (
              !(await Modal.confirm({
                title: 'Autorizar lectura de otro proyecto',
                message: `El asistente solicita leer "${name}" y enviar su contenido al proveedor de IA para responder.\n\n¿Autorizar esta lectura?`,
                confirmLabel: 'Autorizar lectura',
                type: 'warning',
              }))
            ) {
              this.#addMessage('ai', 'Lectura cancelada. No se envió el contenido de ese proyecto.');
              break;
            }
            approvedReads.add(projectIdToRead);
          }

          Toast.show('Kubrick Space está leyendo un proyecto...', 'info');

          let systemContext = '';
          try {
            const proj = await API.getProject(projectIdToRead);
            const ingredient = this.#getEditorContext().ingredients?.find(
              (item) =>
                item.active !== false && item.importedProjectId === projectIdToRead && item.importedSource,
            );
            const version =
              ingredient?.importedSource === 'version'
                ? await API.getDocumentVersion(projectIdToRead, ingredient.importedVersionId)
                : null;
            if (ingredient?.importedSource === 'version' && !version?.snapshot)
              throw new Error('La versión seleccionada del ingrediente ya no está disponible.');
            const content = ingredient
              ? (version?.snapshot?.content ?? ingredientContent(ingredient))
              : proj.content;
            systemContext = `[Sistema: Contenido del proyecto "${version?.snapshot?.name || ingredient?.importedProjectName || proj.name}" (ID: ${proj.id})${ingredient ? ' · ' + ingredientVersionLabel(ingredient) : ''}]:\n"""\n${content || '(vacío)'}\n"""\nResponde al usuario basándote en esta información.`;
            const visual = version?.snapshot || (!ingredient ? proj : null);
            const reference = visual?.covers?.[visual.currentCoverIndex];
            if (
              typeof reference === 'string' &&
              reference.startsWith(`/projects/${proj.id}/content/`) &&
              /\.(png|jpe?g|webp|gif|bmp)$/i.test(reference)
            )
              systemContext +=
                '\nReferenciaVisual local de esta misma fuente (datos): ' +
                JSON.stringify({ projectId: proj.id, referenceImage: reference });
          } catch (e) {
            systemContext = `[Sistema: Error al leer el proyecto con ID ${projectIdToRead}. Dile al usuario que no pudiste encontrarlo.]`;
          }

          this.#addInvisibleMessage('user', systemContext);
          currentMessageText = systemContext;
          continue; // Loop again
        } else {
          // Normal response
          break; // The live bubble and complete history were finalized above.
        }
      } catch (err) {
        reply.cancel();
        if (!this.#root || AppState.currentProject?.id !== originatingProjectId) break;
        if (!controller.signal.aborted) console.error('[Chat] AI request failed:', err);
        this.#addMessage(
          'ai',
          controller.signal.aborted
            ? 'Respuesta detenida.'
            : `Error: ${err.message ?? 'No se pudo contactar la IA.'}`,
          { record: false },
        );
        break;
      }
    }

    loader?.remove();
    this.#loading = false;
    if (this.#photoButton) this.#photoButton.disabled = false;
    this.#syncPhotoPreview();
    this.#requestController = null;
    if (this.#sendBtn) this.#sendBtn.textContent = 'Enviar';
    if (this.#activeConversationId && AppState.currentProject?.id === originatingProjectId) {
      try {
        await API.updateChat(
          this.#conversationProjectId || originatingProjectId,
          this.#activeConversationId,
          {
            name: this.#autoTitle || 'Conversación',
            messages: this.#history,
          },
        );
      } catch (error) {
        this.#notify(
          `La respuesta llegó, pero no se pudo actualizar la conversación guardada: ${error.message}`,
          'error',
        );
      }
    }
  }

  async #runBookJob(request, existingId = null) {
    const projectId = AppState.currentProject.id;
    this.#loading = true;
    this.#bookActive = true;
    this.#bookStopRequested = false;
    this.#bookQueuedMessages = [];
    this.#sendBtn.textContent = 'Stop';
    if (this.#photoButton) this.#photoButton.disabled = true;
    this.#input.placeholder = 'Añade una indicación y pulsa Enter…';
    const controller = new AbortController();
    this.#requestController = controller;
    const loader = this.#showLoader();
    loader.classList.add('chat-loader--book');
    const context =
      !this.#contextProjectId || this.#contextProjectId === projectId
        ? this.#history
            .filter(
              (message) => message.role === 'user' && message.visible !== false && message.text !== request,
            )
            .slice(-6)
            .map((message) => message.text.slice(0, 1500))
        : [];
    this.#contextProjectId = projectId;
    this.#rememberConversation();
    const label = document.createElement('span');
    const progress = document.createElement('progress');
    progress.max = 100;
    progress.value = 0;
    progress.setAttribute('aria-label', 'Avance estimado del libro');
    loader.append(label, progress);
    let expected, response;
    const questions = new Set();
    try {
      if (!existingId) await EventBus.emitAsync('autosave:flush');
      expected = this.#getEditorContext().document;
      response = existingId
        ? null
        : await API.enqueueBookJob({ projectId, request, context, token: globalThis.crypto.randomUUID() });
      this.#bookJobId = existingId || response.job.id;
      if (this.#bookStopRequested) await API.cancelBackgroundJob(this.#bookJobId);
      for (const message of this.#bookQueuedMessages) await API.messageBookJob(this.#bookJobId, message);
      this.#bookQueuedMessages = [];
      while (!controller.signal.aborted && this.#root && AppState.currentProject?.id === projectId) {
        response = await API.characterJob(this.#bookJobId, { signal: controller.signal }, projectId);
        expected = await this.#acceptBookJob(response, expected);
        progress.value = response.job.progress || 0;
        label.textContent = `${response.job.message} · ${progress.value}% estimado`;
        for (const question of response.job.questions || [])
          if (!questions.has(question)) {
            questions.add(question);
            this.#addMessage('ai', question);
          }
        if (!['queued', 'running'].includes(response.job.status)) {
          this.#addMessage(
            'ai',
            response.job.status === 'completed'
              ? `Libro escrito y revisado. ${response.job.result?.words || 0} palabras guardadas en el borrador.`
              : response.job.error || 'Trabajo detenido. Lo guardado se conserva.',
          );
          break;
        }
        await new Promise((resolve) => {
          setTimeout(resolve, 1200);
        });
      }
    } catch (error) {
      if (!controller.signal.aborted)
        this.#addMessage('ai', `El trabajo del servidor se conserva. ${error.message}`);
    } finally {
      loader.remove();
      this.#bookJobId = null;
      this.#bookActive = false;
      this.#loading = false;
      if (this.#photoButton) this.#photoButton.disabled = false;
      this.#rememberConversation();
      this.#requestController = null;
      if (this.#sendBtn) this.#sendBtn.textContent = 'Enviar';
      if (this.#input) this.#input.placeholder = 'Pide una idea, una revisión o el siguiente paso…';
    }
  }

  #createLiveReply(controller, loader, projectId) {
    let bubble = null;
    const time = timestamp();
    loader.hidden = false;
    const animator = createReplyAnimator((text) => {
      if (controller.signal.aborted || !this.#root || AppState.currentProject?.id !== projectId) return;
      if (!text.trim()) return;
      const list = this.#messageList;
      const follow = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
      if (!bubble) {
        this.#emptyState?.remove();
        this.#emptyState = null;
        bubble = createBubble('ai', '', time);
        bubble.setAttribute('aria-busy', 'true');
        list.insertBefore(bubble, loader);
      }
      // Parse the current prefix every frame: headings, emphasis, lists and code
      // are displayed during generation, with the same sanitizer as final text.
      bubble.querySelector('.chat-msg-content').innerHTML = safeContent(markdownToHTML(text));
      loader.hidden = true;
      if (follow) this.#scrollToBottom();
    });
    const cancel = () => {
      animator.cancel();
      controller.signal.removeEventListener('abort', cancel);
      if (bubble) {
        bubble.setAttribute('aria-busy', 'false');
        bubble.querySelector('.chat-msg-time').textContent = `${time} · Respuesta incompleta`;
      }
    };
    controller.signal.addEventListener('abort', cancel, { once: true });
    return {
      append: (delta) => animator.append(delta),
      cancel,
      discard: () => {
        cancel();
        bubble?.remove();
      },
      finish: async (text) => {
        await animator.finish(text);
        controller.signal.removeEventListener('abort', cancel);
        controller.signal.throwIfAborted();
        if (!this.#root || AppState.currentProject?.id !== projectId) return;
        bubble?.setAttribute('aria-busy', 'false');
        this.#history.push({ role: 'ai', text, time, visible: true });
        this.#rememberConversation();
      },
    };
  }

  /**
   * Append a message to the chat UI + history.
   * @param {'user'|'ai'} role
   * @param {string} text
   */
  #addMessage(role, text, { record = true } = {}) {
    const time = timestamp();
    if (record) {
      this.#history.push({ role, text, time, visible: true });
      this.#rememberConversation();
    }

    this.#emptyState?.remove();
    this.#emptyState = null;
    const bubble = createBubble(role, text, time);
    this.#messageList?.appendChild(bubble);
    this.#scrollToBottom();
  }

  /**
   * Show a "typing…" loader in the message list.
   * @returns {HTMLElement}
   */
  #showLoader() {
    const el = document.createElement('div');
    el.className = 'chat-loader';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-label', 'Kubrick Space está pensando');
    el.innerHTML = safeHTML(renderIcon('interpreting', 28));
    this.#messageList?.appendChild(el);
    this.#scrollToBottom();
    return el;
  }

  /** Scroll message list to the bottom. */
  #scrollToBottom() {
    if (this.#messageList) {
      this.#messageList.scrollTop = this.#messageList.scrollHeight;
    }
  }
}
