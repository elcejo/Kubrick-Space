import { reviewScreenplayProposal } from './screenplay-generation.js';
import { Mode } from '../../contracts/editor-mode.js';

import { parseScreenplayContent, screenplayToHTML, screenplayContext } from './screenplay-document.js';

import { screenplaySceneProposal } from './screenplay-ai.js';
import { safeContent } from '../../safe-html.js';

import { EventBus } from '../../event-bus.js';

import { AppState } from '../../app-state.js';
import { API } from '../../api-service.js';
import { Loader, Toast, Modal } from '../../ui-components.js';

/** Feature-owned editing operations; the host supplies only explicit integration ports. */
export class ScreenplayWorkflow {
  screenplayGenerating = false;
  screenplayLoader = null;
  screenplayDialogCleanups = new Set();
  constructor(context) {
    this.context = context;
  }
  destroy() {
    if (this.screenplayLoader && Loader._el === this.screenplayLoader) Loader.hide();
    for (const close of [...this.screenplayDialogCleanups]) close();
  }
  async updateScreenplayScene() {
    if (
      this.screenplayGenerating ||
      this.context.destroyed ||
      !this.context.isScreenplay() ||
      this.context.mode !== Mode.WYSIWYG
    )
      return;
    // A long generation must never start on a fallback model the author did not choose.
    if (AppState.inferenceMode !== 'local' && !AppState.currentProject?.inferenceSettings?.textModel) {
      Toast.show('Selecciona un modelo LLM en la barra superior antes de generar.', 'warning');
      return;
    }
    const context = this.context.getContext();
    const baseline = this.context.getContent();
    const doc = parseScreenplayContent(baseline);
    const node = screenplayContext(doc).nodes.find((item) => item.id === context.target?.nodeId);
    const scene = doc.scenes.find((item) => item.id === (node?.sceneId || node?.id));
    if (!scene) {
      Toast.show('Coloca el cursor dentro de la escena que quieres actualizar.', 'warning');
      return;
    }
    const ingredients = JSON.stringify(this.context.ingredients);
    const projectId = this.context.projectId;
    const isCurrent = () =>
      !this.context.destroyed &&
      AppState.currentProject?.id === projectId &&
      this.context.mode === Mode.WYSIWYG &&
      this.context.getContent() === baseline &&
      JSON.stringify(this.context.ingredients) === ingredients;
    const instruction = await Modal.prompt({
      title: 'Actualizar escena',
      label: 'Describe el cambio',
      placeholder: '¿Qué quieres modificar en esta escena?',
      maxLength: 12000,
      confirmLabel: 'Preparar propuesta',
    });
    if (!instruction?.trim() || !isCurrent()) return;
    this.screenplayGenerating = true;
    Loader.show();
    const loader = Loader._el;
    this.screenplayLoader = loader;
    try {
      const response = await API.aiText({
        action: 'screenplay_scene',
        target: { nodeId: scene.id },
        instruction,
        content: JSON.stringify(scene),
      });
      if (!isCurrent()) throw new Error('El guión o sus ingredientes cambiaron. Se conservó tu edición.');
      const proposedDoc = screenplaySceneProposal(response?.text, doc, scene.id);
      const sceneHTML = (document) =>
        screenplayToHTML({
          ...document,
          preamble: [],
          scenes: document.scenes.filter((item) => item.id === scene.id),
        });
      if (Loader._el === loader) Loader.hide();
      const applied = await reviewScreenplayProposal({
        current: sceneHTML(doc),
        proposed: sceneHTML(proposedDoc),
        isCurrent,
        cleanups: this.screenplayDialogCleanups,
        apply: async () => {
          if (!isCurrent()) throw new Error('El documento cambió antes de aplicar la propuesta.');
          const heading = [...this.context.surface.querySelectorAll('h2')].find(
            (item) => item.dataset.kaiId === scene.id,
          );
          if (!heading) throw new Error('La escena ya no está disponible.');
          const replacement = document.createElement('div');
          replacement.innerHTML = safeContent(sceneHTML(proposedDoc));
          replacement.querySelector('h1')?.remove();
          const shell = heading.closest('.screenplay-scene');
          let next = shell ? null : heading.nextElementSibling;
          while (next && next.tagName !== 'H2') {
            const following = next.nextElementSibling;
            next.remove();
            next = following;
          }
          (shell || heading).replaceWith(...replacement.childNodes);
          this.context.screenplayDocument = proposedDoc;
          this.context.emitChange();
          const saved = await EventBus.emitAsync('autosave:flush');
          if (!saved.length) throw new Error('El guardado del documento no está disponible.');
        },
      });
      if (applied && !this.context.destroyed)
        Toast.show('Escena actualizada y borrador guardado.', 'success');
    } catch (error) {
      if (!this.context.destroyed && AppState.currentProject?.id === projectId)
        Toast.show(error.message, 'error');
    } finally {
      this.screenplayGenerating = false;
      if (this.screenplayLoader === loader) this.screenplayLoader = null;
      if (Loader._el === loader) Loader.hide();
    }
  }
}
