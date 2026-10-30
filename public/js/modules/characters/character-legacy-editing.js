import { parseCharacterDocument, characterDescription } from './character-model.js';

import { Mode } from '../../contracts/editor-mode.js';

import {
  CHARACTER_FIELDS,
  characterFieldText,
  readCharacterTraits,
  patchCharacterDocument,
  parseCharacterProposal,
} from './character-document.js';

import { safeContent } from '../../safe-html.js';

import { EventBus } from '../../event-bus.js';

import { AppState } from '../../app-state.js';
import { API } from '../../api-service.js';
import { Loader, Toast, Modal } from '../../ui-components.js';
import { Convert } from '../ui/convert.js';
import { getSkinLabel, getBodyLabel, getVoiceLabel, generateRandomTraitsForCharacter } from './generators.js';
/** Feature-owned editing operations; the host supplies only explicit integration ports. */
export class CharacterLegacyEditing {
  characterGenerating = false;
  constructor(context) {
    this.context = context;
  }

  updateCharacterTrait(key, value) {
    if (parseCharacterDocument(AppState.currentProject?.content)) return;
    if (this.context.projectType !== 'character' || !CHARACTER_FIELDS[key]) return;
    this.context.syncContentBeforeSwitch();
    this.context.htmlContent = safeContent(
      patchCharacterDocument(this.context.htmlContent, { [key]: value }),
    );
    this.context.renderMode(this.context.mode);
    this.parseTraitsFromHtml();
  }
  parseTraitsFromHtml() {
    if (
      !this.context.surface ||
      this.context.destroyed ||
      this.context.projectType !== 'character' ||
      AppState.currentProject?.id !== this.context.projectId
    )
      return;
    const root =
      this.context.mode === Mode.MARKDOWN
        ? new DOMParser().parseFromString(
            this.context.surface.querySelector('textarea')?.value || '',
            'text/html',
          ).body
        : this.context.surface;
    const previous = AppState.currentProject.traits || {};
    const traits = readCharacterTraits(root, previous);
    if (JSON.stringify(previous) !== JSON.stringify(traits)) {
      AppState.currentProject.traits = traits;
      EventBus.emit('editor:characterTraitsUpdated');
    }
  }
  getCharacterMappedTraits(project) {
    const document = parseCharacterDocument(project.content || '');
    if (document)
      return {
        lore: characterDescription(document),
        pseudonyms: document.fields
          .filter((field) => /alias|pseudonym|pseudonim/.test(field.key))
          .map((field) => field.value || '')
          .filter(Boolean)
          .join(', '),
      };
    const root = new DOMParser().parseFromString(safeContent(project.content || ''), 'text/html').body;
    const traits = readCharacterTraits(root, project.traits || {});
    return {
      age: traits.age ?? '?',
      skin: getSkinLabel(traits.skin),
      body: getBodyLabel(traits.body),
      voice: traits.voice
        ? getVoiceLabel(traits.voice) + (traits.pitch === undefined ? '' : ` (${traits.pitch} Hz)`)
        : 'Sin definir',
      pseudonyms: traits.pseudonyms || '',
      clothing: traits.clothing || '',
      lore: traits.lore || '',
      psychology: traits.psychology || '',
    };
  }
  showCharacterProposal(traits, baseline) {
    if (this.context.destroyed || AppState.currentProject?.id !== this.context.projectId) return;
    const content = document.createElement('div');
    content.className = 'character-proposal';
    const explanation = document.createElement('p');
    explanation.textContent =
      'Revisa la propuesta antes de aplicarla. Se actualizarán estos rasgos; los objetivos y las secciones adicionales se conservarán.';
    content.appendChild(explanation);
    const table = document.createElement('table');
    const header = table.createTHead().insertRow();
    for (const label of ['Rasgo', 'Actual', 'Propuesta']) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = label;
      header.appendChild(th);
    }
    const rows = table.createTBody();
    const current = AppState.currentProject.traits || {};
    for (const [key, value] of Object.entries(traits)) {
      const tr = document.createElement('tr');
      for (const text of [
        CHARACTER_FIELDS[key][1],
        characterFieldText(key, current[key]),
        characterFieldText(key, value),
      ]) {
        const td = document.createElement('td');
        td.textContent = text;
        tr.appendChild(td);
      }
      rows.appendChild(tr);
    }
    content.appendChild(table);
    Modal.show({
      title: 'Propuesta de personaje',
      content,
      actions: [
        { label: 'Descartar', class: 'btn-secondary', onClick: () => Modal.hide() },
        {
          label: 'Aplicar rasgos',
          class: 'btn-primary',
          onClick: () => {
            if (this.context.destroyed || AppState.currentProject?.id !== this.context.projectId) {
              Modal.hide();
              return;
            }
            this.context.syncContentBeforeSwitch();
            if (this.context.htmlContent !== baseline) {
              Toast.show(
                'La ficha cambió durante la generación. Revisa una nueva propuesta para conservar tus cambios.',
                'warning',
              );
              return;
            }
            this.context.htmlContent = safeContent(patchCharacterDocument(this.context.htmlContent, traits));
            AppState.currentProject.traits = { ...AppState.currentProject.traits, ...traits };
            this.context.renderMode(this.context.mode);
            this.context.emitChange();
            EventBus.emit('editor:characterTraitsUpdated');
            EventBus.emit('autosave:flush');
            Modal.hide();
            Toast.show('Propuesta aplicada a la ficha.', 'success');
          },
        },
      ],
    });
  }
  async generateCharacterTraitsRandomly() {
    if (
      this.characterGenerating ||
      this.context.destroyed ||
      AppState.currentProject?.id !== this.context.projectId
    )
      return;
    this.context.syncContentBeforeSwitch();
    this.showCharacterProposal(
      generateRandomTraitsForCharacter(AppState.currentProject.name || 'Personaje'),
      this.context.htmlContent,
    );
  }
  async generateCharacterTraitsFromContext() {
    if (
      this.characterGenerating ||
      this.context.destroyed ||
      AppState.currentProject?.id !== this.context.projectId
    )
      return;
    if (!this.context.ingredients.some((ingredient) => ingredient.active !== false && ingredient.value)) {
      Toast.show(
        'Añade un libro u otro ingrediente activo para generar una propuesta basada en tu historia.',
        'warning',
      );
      return;
    }
    this.context.syncContentBeforeSwitch();
    const baseline = this.context.htmlContent;
    const project = AppState.currentProject;
    this.characterGenerating = true;
    Loader.show();
    try {
      const response = await API.aiText({
        content: `Personaje: ${project.name}\nRol: ${project.category}\nFicha actual: ${Convert.htmlToStructuredText(baseline)}\nRasgos: ${JSON.stringify(project.traits || {})}`,
        action: 'generate_character',
      });
      if (this.context.destroyed || AppState.currentProject?.id !== this.context.projectId) return;
      if (response?.debug?.mock)
        throw new Error('Configura una clave de OpenRouter para generar desde ingredientes.');
      const traits = parseCharacterProposal(typeof response === 'string' ? response : response?.text);
      this.showCharacterProposal(traits, baseline);
    } catch (err) {
      if (!this.context.destroyed && AppState.currentProject?.id === this.context.projectId)
        Toast.show('No se pudo generar la propuesta: ' + err.message + ' Tu ficha se conserva.', 'error');
    } finally {
      this.characterGenerating = false;
      Loader.hide();
    }
  }
}
