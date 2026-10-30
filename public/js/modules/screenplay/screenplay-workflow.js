import {
  screenplayUpdateInstruction,
  normalizeScreenplayProposal,
  reviewScreenplayProposal,
} from './screenplay-generation.js';

import { Mode } from '../../contracts/editor-mode.js';

import {
  parseScreenplayContent,
  screenplayToHTML,
  screenplayContext,
  prepareScreenplayAdaptation,
} from './screenplay-document.js';

import { screenplaySceneProposal } from './screenplay-ai.js';
import { chooseStoryBook, bookElements, bookOrigin } from './screenplay-sources.js';
import { safeHTML, safeContent } from '../../safe-html.js';

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
  async generateScreenplayFromContext() {
    if (this.screenplayGenerating) return;
    if (this.context.mode !== Mode.WYSIWYG || !this.context.surface) {
      Toast.show('Debes estar en modo Editor Visual.', 'warning');
      return;
    }
    const books = this.context.ingredients.filter(
      (ingredient) =>
        ingredient.type === 'book' && ingredient.active !== false && ingredient.importedProjectId,
    );
    if (!books.length) {
      Toast.show('Vincula un Story Book como ingrediente para usar el contexto.', 'warning');
      return;
    }
    let book;
    const projectId = this.context.projectId;
    const currentDocument = this.context.getContent();
    const current = this.context.isScreenplay()
      ? screenplayToHTML(parseScreenplayContent(currentDocument))
      : currentDocument;
    const ingredients = JSON.stringify(this.context.ingredients);
    const isCurrent = () =>
      !this.context.destroyed &&
      AppState.currentProject?.id === projectId &&
      this.context.projectId === projectId &&
      this.context.getContent() === currentDocument &&
      JSON.stringify(this.context.ingredients) === ingredients;
    this.screenplayGenerating = true;
    Loader.show();
    let loader = Loader._el;
    this.screenplayLoader = loader;
    try {
      if (Loader._el === loader) Loader.hide();
      book = await chooseStoryBook(this.context.ingredients, this.screenplayDialogCleanups, isCurrent);
      if (!book || !isCurrent()) return;
      Loader.show();
      loader = Loader._el;
      this.screenplayLoader = loader;
      const sourceProject = await API.getProject(book.importedProjectId);
      if (sourceProject.type !== 'book' || sourceProject.category !== 'story-book')
        throw new Error('El libro de origen debe ser un Story Book.');
      let selectedBookContent = book.value || '';
      if (book.importedSource === 'version') {
        const selected = await API.getDocumentVersion(book.importedProjectId, book.importedVersionId);
        if (!selected?.snapshot) throw new Error('No se pudo leer la versión seleccionada del libro.');
        selectedBookContent = selected.snapshot.content || '';
      }
      if (!selectedBookContent.trim()) throw new Error('La versión seleccionada del libro está vacía.');
      const sourceElements = bookElements(selectedBookContent);
      let previousBookContent = book.lastAdaptedContent || '';
      if (book.lastAdaptedVersionId) {
        const previous = await API.getDocumentVersion(book.importedProjectId, book.lastAdaptedVersionId);
        if (!previous?.snapshot) throw new Error('No se pudo leer la versión adaptada anteriormente.');
        previousBookContent = previous.snapshot.content || '';
      }
      if (!isCurrent())
        throw new Error(
          'El guión o sus ingredientes cambiaron. Se conservó tu trabajo; vuelve a generar la propuesta.',
        );
      const availableScenarios = (AppState.projects || [])
        .filter((project) => project.type === 'stage' && !project.deletedAt && !project.trashedAt)
        .map(({ id, name }) => ({ id, name }));
      const response = await API.aiText({
        instruction: screenplayUpdateInstruction(),
        action: 'screenplay_context',
        content: JSON.stringify({
          screenplay: current,
          availableScenarios,
          selectedBook: {
            projectId: book.importedProjectId,
            name: book.importedProjectName,
            version: book.importedVersionNumber || null,
            content: selectedBookContent,
            elements: sourceElements,
          },
          previouslyAdaptedBook: {
            version: book.lastAdaptedVersionNumber || null,
            content: previousBookContent,
          },
        }),
      });
      if (!isCurrent())
        throw new Error(
          'El guión o sus ingredientes cambiaron. Se conservó tu trabajo; vuelve a generar la propuesta.',
        );
      const title = document.createElement('h1');
      title.textContent = AppState.currentProject.name || 'Guión sin título';
      const titleHTML = this.context.surface.querySelector('h1')?.outerHTML || title.outerHTML;
      let proposed = normalizeScreenplayProposal(response?.text, titleHTML);
      let proposedDocument;
      if (this.context.isScreenplay()) {
        proposedDocument = prepareScreenplayAdaptation(proposed, currentDocument, availableScenarios);
        const raw = new DOMParser().parseFromString(safeHTML(response.text), 'text/html');
        const headings = [...raw.querySelectorAll('h2')];
        const validIds = new Set(sourceElements.map((item) => item.id));
        proposedDocument.scenes.forEach((scene, index) => {
          const requested = [
            ...new Set(
              (headings[index]?.dataset.sourceElements || '')
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean),
            ),
          ];
          if (requested.some((id) => !validIds.has(id)))
            throw new Error('La IA devolvió una referencia de origen inexistente. Se conservó el guión.');
          const previousIds =
            scene.origins?.find((origin) => origin.projectId === book.importedProjectId)?.elementIds || [];
          scene.origins = [
            ...(scene.origins || []).filter((origin) => origin.projectId !== book.importedProjectId),
            bookOrigin(book, requested.length ? requested : previousIds.filter((id) => validIds.has(id))),
          ];
        });
        proposedDocument = parseScreenplayContent(proposedDocument);
        proposed = screenplayToHTML(proposedDocument);
      }
      if (Loader._el === loader) Loader.hide();
      const applied = await reviewScreenplayProposal({
        current,
        proposed,
        isCurrent,
        cleanups: this.screenplayDialogCleanups,
        apply: async () => {
          if (!isCurrent() || this.context.mode !== Mode.WYSIWYG)
            throw new Error('El documento cambió antes de aplicar la propuesta.');
          this.context.surface.innerHTML = safeContent(proposed);
          if (proposedDocument) this.context.screenplayDocument = proposedDocument;
          for (const key of ['lastAdaptedVersionId', 'lastAdaptedVersionNumber', 'lastAdaptedContent'])
            delete book[key];
          if (book.importedSource === 'version') {
            book.lastAdaptedVersionId = book.importedVersionId;
            book.lastAdaptedVersionNumber = book.importedVersionNumber;
          } else book.lastAdaptedContent = book.value || '';
          this.context.emitChange();
          const saved = await EventBus.emitAsync('autosave:flush');
          if (!saved.length) throw new Error('El guardado del documento no está disponible.');
        },
      });
      if (applied && !this.context.destroyed && AppState.currentProject?.id === projectId)
        Toast.show('Guión actualizado y borrador guardado.', 'success');
    } catch (error) {
      if (!this.context.destroyed && AppState.currentProject?.id === projectId)
        Toast.show(error.message || 'No se pudo actualizar el guión.', 'error');
    } finally {
      this.screenplayGenerating = false;
      if (this.screenplayLoader === loader) this.screenplayLoader = null;
      if (Loader._el === loader) Loader.hide();
    }
  }
}
