import {
  characterElement as el,
  characterAction as action,
  characterTabs,
  characterAddButton,
  setCharacterNodeWorking,
  autoSizeCharacterText,
} from './character-ui.js';
import { CHARACTER_NARRATIVE, characterNarrativeVisible, characterFieldVisible } from './character-model.js';
import {
  CHARACTER_NARRATIVE_CHOICES,
  characterNarrativeChoice,
  characterNarrativeRow,
} from './character-narrative-fields.js';
import { showCharacterFieldPicker } from './character-field-picker.js';
import { renderIcon } from '../../icons.js';
import { safeHTML } from '../../safe-html.js';

/** Independent narrative node. Owns its controls and their cleanup, never generates an image. */
export class CharacterNarrativeNode {
  constructor(host) {
    this.host = host;
    this.cleanups = [];
    this.customFields = new Set();
    this.element = el('section', 'character-node character-narrative');
    this.element.setAttribute('aria-label', 'Ficha narrativa');
    this.render();
  }
  render() {
    const host = this.host;
    this.cleanups.splice(0).forEach((dispose) => dispose());
    this.element.replaceChildren();
    const header = el('header', 'character-workspace__header');
    header.append(el('h2', 'character-eyebrow', 'NARRATIVA'));
    const body = el('div', 'character-node__body');
    const essentials = el('div', 'character-narrative__fields');
    const journey = el('div', 'character-narrative__fields');
    const notes = el('div', 'character-narrative__fields');
    const standardRoles = ['', 'protagonist', 'antagonist', 'secondary', 'supporting'];
    const role = host.document.narrative.role;
    const custom = host.input(
      'Función personalizada',
      standardRoles.includes(role) || role === 'other' ? '' : role,
      (doc, value) => {
        doc.narrative.role = value || 'other';
      },
      { collection: this.cleanups },
    );
    custom.hidden = standardRoles.includes(role);
    custom.querySelector('textarea').maxLength = 100;
    if (characterNarrativeVisible(host.document, 'role')) {
      const roleControls = el('div', 'character-narrative-choice');
      roleControls.append(
        host.select(
          'Función narrativa',
          [
            ['', 'Sin definir'],
            ['protagonist', 'Protagonista'],
            ['antagonist', 'Antagonista'],
            ['secondary', 'Secundario'],
            ['supporting', 'Reparto'],
            ['other', 'Otra'],
          ],
          standardRoles.includes(role) ? role : 'other',
          (value) => {
            host.change((doc) => {
              doc.narrative.role = value;
              if (!doc.enabledNarrative.includes('role')) doc.enabledNarrative.push('role');
            });
            custom.hidden = value !== 'other';
            custom.querySelector('textarea').value = '';
            if (value === 'other') custom.querySelector('textarea').focus();
          },
          this.cleanups,
        ),
        custom,
      );
      essentials.append(characterNarrativeRow(this, 'Función narrativa', roleControls, { key: 'role' }));
    }
    for (const [key, label] of Object.entries(CHARACTER_NARRATIVE))
      if (key !== 'role' && characterNarrativeVisible(host.document, key))
        (['arc', 'relationships', 'backstory'].includes(key)
          ? journey
          : ['personality', 'notes'].includes(key)
            ? notes
            : essentials
        ).append(
          characterNarrativeRow(
            this,
            label,
            Object.hasOwn(CHARACTER_NARRATIVE_CHOICES, key)
              ? characterNarrativeChoice(this, key, label)
              : host.input(
                  label,
                  host.document.narrative[key],
                  (doc, value) => {
                    doc.narrative[key] = value;
                    if (!doc.enabledNarrative.includes(key)) doc.enabledNarrative.push(key);
                  },
                  { multiline: true, collection: this.cleanups },
                ),
            { key, wide: key !== 'profile' },
          ),
        );
    for (const field of host.document.fields.filter(
      (field) => field.section !== 'appearance' && characterFieldVisible(field),
    ))
      (field.section === 'continuity' ? notes : essentials).append(
        characterNarrativeRow(this, field.label, host.fieldControl(field, this.cleanups), { field }),
      );
    const groups = [
      { key: 'essentials', label: 'Esencial', content: essentials },
      { key: 'journey', label: 'Trayectoria', content: journey },
      { key: 'notes', label: 'Notas', content: notes },
    ].filter((group) => group.content.children.length);
    if (groups.length)
      body.append(
        characterTabs(groups, {
          label: 'Ficha narrativa',
          selected: host.narrativeSection,
          onSelect: (section) => {
            host.narrativeSection = section;
          },
        }),
      );
    else body.append(el('p', 'character-empty', 'La descripción del personaje definirá su narrativa.'));
    this.loreContainer = el('div', 'character-narrative__lore');
    body.append(this.loreContainer);
    this.element.append(
      header,
      body,
      characterAddButton('Añadir campo narrativo', () => showCharacterFieldPicker(host, true)),
    );
  }
  destroy() {
    this.cleanups.forEach((dispose) => dispose());
    this.element.remove();
  }
}

/** Composer node. Owns input state, send controls and access to the persisted request history. */
export class CharacterComposerNode {
  constructor({
    request,
    onInput,
    onSend,
    onRetry = () => {},
    onGeneratePhoto = () => {},
    onUploadPhoto,
    getHistory,
    creation = { mode: 'description', referenceImage: '' },
    onMode = () => {},
    onReference = () => {},
    requestImage = '',
    onAttachment = () => {},
    onRemoveAttachment = () => {},
    modeLocked = false,
    initialPhoto = true,
  }) {
    this.getHistory = () => structuredClone(getHistory());
    this.element = el('section', 'character-node character-composer');
    this.element.setAttribute('aria-label', 'Asistente de personaje');
    this.mode = creation.mode === 'image' && !initialPhoto ? 'description' : creation.mode;
    const methods = [
      ['description', 'Descripción', 'agent', 'Cuenta cómo es tu personaje.'],
      ['image', 'Fotografía', 'image', 'Sube una fotografía o pega su URL.'],
      ['options', 'Opciones', 'grid', 'Diseña con un catálogo visual.'],
      ['ingredients', 'Ingredientes', 'ingredients', 'Combina las referencias del proyecto.'],
    ];
    const heading = el(
      'h2',
      creation.mode ? 'character-eyebrow' : null,
      creation.mode ? 'ASISTENTE DE PERSONAJE' : '¿Cómo quieres crear tu personaje?',
    );
    const routes = el(
      'div',
      creation.mode ? 'character-methods character-methods--compact' : 'character-methods',
    );
    routes.setAttribute('role', 'group');
    routes.setAttribute('aria-label', 'Método de creación');
    this.routes = routes;
    routes.hidden = modeLocked;
    for (const [mode, label, icon, description] of methods) {
      const button = el('button', 'character-method');
      button.type = 'button';
      button.dataset.creationMode = mode;
      const comingSoon = ['options', 'ingredients'].includes(mode);
      if (comingSoon) {
        button.dataset.comingSoon = 'true';
        button.disabled = true;
        button.title = 'Disponible en la próxima versión';
      }
      button.setAttribute('aria-pressed', String(mode === creation.mode));
      const illustration = el('span', 'character-method__icon');
      illustration.innerHTML = safeHTML(renderIcon(icon, 32));
      button.append(illustration, el('strong', null, label));
      if (!creation.mode) button.append(el('span', null, description));
      if (comingSoon) button.append(el('span', 'character-method__soon', 'Próximamente'));
      button.addEventListener('click', () => onMode(mode));
      routes.append(button);
    }
    this.methodButtons = [...routes.querySelectorAll('button')];
    if (creation.mode) {
      const header = el('header', 'character-composer__header');
      header.append(heading, routes);
      this.element.append(header);
    } else this.element.append(heading, routes);
    if (creation.mode === 'image' && initialPhoto) {
      const reference = el('div', 'character-reference');
      if (creation.referenceImage) {
        const image = el('img');
        image.src = creation.referenceImage;
        image.alt = 'Referencia para interpretar el personaje';
        reference.append(image);
      }
      this.referenceUpload = action(
        creation.referenceImage ? 'Cambiar referencia' : 'Subir referencia',
        'upload',
        onReference,
        'btn btn-secondary',
      );
      reference.append(
        this.referenceUpload,
        el(
          'p',
          'character-composer__hint',
          'La fotografía es la referencia de identidad para crear el personaje de frente, de cuerpo completo y sobre fondo blanco.',
        ),
      );
      this.element.append(reference);
    }
    const send = (source) => {
      onSend(source);
    };
    this.prompt = el('textarea', 'input character-composer__input');
    this.cleanups = [];
    this.fitPrompt = autoSizeCharacterText(this.prompt, this.cleanups, { rows: 2 });
    this.prompt.maxLength = 12000;
    this.prompt.placeholder = 'Describe tu personaje o pide un cambio…';
    this.prompt.value = request;
    this.prompt.setAttribute('aria-label', 'Describe tu personaje');
    this.prompt.addEventListener('input', () => onInput(this.prompt.value));
    this.prompt.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        send(
          this.mode === 'options' && this.prompt.value.trim() ? 'description' : this.mode || 'description',
        );
      }
    });
    this.hint = el('p', 'character-composer__hint');
    this.status = el('p', 'character-composer__status');
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.activity = el('div', 'character-composer__activity');
    this.activity.hidden = true;
    this.activity.setAttribute('role', 'status');
    this.activity.setAttribute('aria-live', 'polite');
    const activityIcon = el('span', 'character-composer__activity-icon');
    activityIcon.innerHTML = safeHTML(renderIcon('interpreting', 48));
    this.activity.append(activityIcon, el('strong', null, 'Interpretando'));
    this.fromIngredients = action('Desde ingredientes', 'ingredients', () => onSend('ingredients'));
    this.interpret = action(
      'Interpretar',
      'agent',
      () =>
        send(
          this.mode === 'options' && this.prompt.value.trim() ? 'description' : this.mode || 'description',
        ),
      'btn btn-primary',
    );
    const footer = el('div', 'character-composer__actions');
    this.retry = action('Reintentar solicitud', 'refresh', onRetry, 'btn btn-secondary');
    this.retry.hidden = true;
    this.photo = action('Generar foto', 'brush', onGeneratePhoto, 'btn btn-secondary');
    const attachmentFile = el('input');
    attachmentFile.type = 'file';
    attachmentFile.accept = 'image/png,image/jpeg,image/webp,image/gif,image/bmp';
    attachmentFile.hidden = true;
    attachmentFile.setAttribute('aria-label', 'Anexar fotografía al cambio');
    attachmentFile.addEventListener('change', () => {
      onAttachment(attachmentFile.files?.[0]);
      attachmentFile.value = '';
    });
    this.attach = action('Anexar fotografía', 'image', () => attachmentFile.click(), 'btn btn-secondary');
    this.attachmentPreview = el('div', 'character-attachment');
    this.onRemoveAttachment = onRemoveAttachment;
    this.renderAttachment(requestImage);
    this.photo.hidden = true;
    const inputArea = el('div', 'character-composer__input-area');
    this.attach.className = 'btn btn-secondary character-composer__attach';
    this.attach.title = 'Anexar fotografía';
    this.attach.lastChild.remove();
    inputArea.append(this.prompt, this.attach);
    footer.append(this.activity, this.fromIngredients, this.retry, this.photo);
    footer.append(this.interpret);
    this.element.append(inputArea, this.attachmentPreview, attachmentFile, this.hint, footer, this.status);
    this.prompt.hidden = this.hint.hidden = footer.hidden = !creation.mode;
    if (onUploadPhoto) {
      const upload = action('Subir foto a la galería', 'upload', onUploadPhoto, 'btn btn-secondary');
      this.element.append(upload);
      this.directUpload = upload;
    }
    inputArea.hidden = !creation.mode;
    this.fromIngredients.hidden = true;
    if (this.mode === 'image')
      this.prompt.placeholder = 'Añade indicaciones para interpretar la imagen (opcional)…';
    if (creation.mode === 'options')
      this.prompt.placeholder = 'Añade contexto narrativo o pide un ajuste (opcional)…';
    if (creation.mode === 'ingredients')
      this.prompt.placeholder = 'Indica cómo combinar los ingredientes (opcional)…';
  }
  clear() {
    this.prompt.value = '';
    this.fitPrompt?.();
    this.renderAttachment('');
  }
  renderAttachment(url) {
    this.attachmentImage = url;
    this.attachmentPreview.replaceChildren();
    this.attachmentPreview.hidden = !url;
    if (!url) return;
    const image = el('img');
    image.src = url;
    image.alt = 'Fotografía adjunta como contexto de este cambio';
    this.removeAttachment = action('Quitar fotografía adjunta', 'close', this.onRemoveAttachment);
    this.attachmentPreview.append(
      image,
      el('span', null, 'Referencia para este cambio'),
      this.removeAttachment,
    );
  }
  update({
    ready,
    busy,
    hasIngredients,
    mode = this.mode,
    hasReference = false,
    retry = null,
    canGeneratePhoto = false,
    hasPreviousPhoto = false,
    modeLocked = false,
    photoRetry = false,
    activityMessage = 'Interpretando personaje…',
  }) {
    this.lastUpdate = {
      ready,
      busy,
      hasIngredients,
      mode,
      hasReference,
      retry,
      canGeneratePhoto,
      hasPreviousPhoto,
      modeLocked,
      photoRetry,
      activityMessage,
    };
    this.status.hidden = !busy;
    const needsIdentity = mode === 'options';
    this.activity.hidden = true;
    setCharacterNodeWorking(this.element, busy, activityMessage);
    this.prompt.disabled = !mode || (needsIdentity && !ready) || busy;
    this.hint.textContent =
      needsIdentity && !ready
        ? 'Selecciona la base y su naturaleza para comenzar.'
        : mode === 'ingredients' && !hasIngredients
          ? 'Añade ingredientes desde el panel lateral.'
          : '';
    if (this.directUpload) this.directUpload.disabled = busy;
    this.interpret.disabled =
      busy ||
      !mode ||
      (needsIdentity && !ready) ||
      (mode === 'description' && !this.prompt.value.trim()) ||
      (mode === 'image' && !hasReference) ||
      (mode === 'ingredients' && !hasIngredients);
    if (
      mode === 'description' &&
      !busy &&
      !this.prompt.value.trim() &&
      !this.attachmentImage &&
      (retry || photoRetry)
    )
      this.interpret.disabled = false;
    this.interpret.lastChild.textContent =
      mode === 'image'
        ? 'Interpretar'
        : mode === 'options'
          ? this.prompt.value.trim()
            ? 'Interpretar cambios'
            : 'Redactar ficha'
          : mode === 'ingredients'
            ? 'Crear desde ingredientes'
            : 'Interpretar';
    this.interpret.setAttribute('aria-label', this.interpret.lastChild.textContent);
    this.fromIngredients.disabled = busy || !hasIngredients;
    this.methodButtons.forEach((button) => {
      button.disabled = busy || modeLocked || button.dataset.comingSoon === 'true';
    });
    this.routes.hidden = modeLocked;
    if (this.referenceUpload) this.referenceUpload.disabled = busy;
    this.attach.disabled = busy;
    if (this.removeAttachment) this.removeAttachment.disabled = busy;
    this.retry.hidden = !retry || Boolean(this.prompt.value.trim()) || Boolean(this.attachmentImage);
    this.retry.disabled = busy;
    if (['description', 'image'].includes(mode)) this.retry.hidden = true;
    if (retry && !busy) this.status.textContent = retry.message;
    if (mode === 'description' && photoRetry && !busy)
      this.status.textContent =
        'La ficha se conserva. Pulsa Interpretar para reintentar solo la fotografía pendiente.';
    this.photo.hidden = ['description', 'image'].includes(mode) || !canGeneratePhoto;
    this.photo.disabled =
      busy || (!photoRetry && (Boolean(this.prompt.value.trim()) || Boolean(this.attachmentImage)));
    this.photo.lastChild.textContent = hasPreviousPhoto ? 'Generar nueva foto' : 'Generar foto';
    this.photo.setAttribute('aria-label', this.photo.lastChild.textContent);
    this.photo.title =
      this.prompt.value.trim() || this.attachmentImage
        ? 'Primero interpreta y aplica los cambios escritos.'
        : hasPreviousPhoto
          ? 'Usa la última imagen como referencia visual.'
          : 'Genera la primera foto del personaje.';
  }
  destroy() {
    this.cleanups.forEach((dispose) => dispose());
    this.element.remove();
  }
}
