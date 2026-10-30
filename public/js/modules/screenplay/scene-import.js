import { MAX_SCENES, normalizeSceneIds, validateSceneTitles } from './scene-rules.js';
import { AppState } from '../../app-state.js';
import { EventBus } from '../../event-bus.js';
import { Modal, Toast } from '../../ui-components.js';
import { reconcileProductionScenes } from './screenplay-production.js';

export function publishProduction(source) {
  EventBus.emit('production:changed', { projectId: AppState.currentProject?.id, source });
  EventBus.emit('editor:change');
}

export function applySceneImport(projectId, scenes, mode, metadata = {}) {
  const project = AppState.currentProject;
  if (project?.id !== projectId) throw new Error('El proyecto activo cambió. Abre de nuevo la importación.');
  const production = project.production;
  validateSceneTitles(scenes);
  const incoming = scenes.map((scene) => ({ ...scene, id: globalThis.crypto.randomUUID() }));
  if (!['append', 'replace', 'update'].includes(mode)) throw new Error('Modo de importación inválido.');
  if (mode === 'update' && scenes.some((scene) => !scene.source?.projectId || !scene.source?.sceneId))
    throw new Error('Actualizar requiere escenas con una fuente identificada.');
  const next =
    mode === 'append'
      ? [...production.scenes, ...incoming]
      : mode === 'update'
        ? reconcileProductionScenes(production.scenes, incoming)
        : incoming;
  if (next.length > MAX_SCENES)
    throw new Error('El proyecto admite hasta 200 escenas. No se modificó ninguna.');
  // Save before mutating, so a failed backup never destroys the current scenes.
  localStorage.setItem(
    `kai-scenes-before-import:${projectId}`,
    JSON.stringify({
      scenes: production.scenes,
      scriptProjectId: production.scriptProjectId,
      scriptProjectName: production.scriptProjectName,
    }),
  );
  production.scenes = next;
  Object.assign(production, metadata);
  publishProduction('import');
}

export function showSceneImport(scenes, metadata = {}) {
  const projectId = AppState.currentProject?.id;
  const baseline = JSON.stringify(AppState.currentProject?.production);
  const content = document.createElement('div');
  const summary = document.createElement('p');
  summary.textContent = `${scenes.length} escenas encontradas. Actualizar conserva tus cambios, prompts y planos. Reemplazar guarda una copia recuperable.`;
  const preview = document.createElement('pre');
  preview.className = 'scene-import-preview';
  preview.textContent = scenes.map((scene, index) => `${index + 1}. ${scene.title}`).join('\n');
  content.append(summary, preview);
  const apply = async (mode) => {
    if (
      mode === 'replace' &&
      !(await Modal.confirm({
        title: 'Reemplazar escenas',
        message:
          'Se reemplazarán todas las escenas actuales por las de esta vista previa. Puedes recuperar la copia después. ¿Continuar?',
        confirmLabel: 'Reemplazar escenas',
        type: 'danger',
        preserveCurrent: true,
      }))
    )
      return;
    try {
      if (
        AppState.currentProject?.id !== projectId ||
        JSON.stringify(AppState.currentProject?.production) !== baseline
      )
        throw new Error('La producción cambió durante la revisión. Abre de nuevo la importación.');
      applySceneImport(projectId, scenes, mode, metadata);
      Modal.hide();
      Toast.show('Escenas importadas. Puedes deshacer la importación.', 'success');
    } catch (error) {
      Toast.show(error.message, 'error');
    }
  };
  Modal.show({
    title: 'Revisar escenas antes de importar',
    content,
    actions: [
      { label: 'Cancelar', onClick: () => Modal.hide() },
      { label: 'Añadir al final', class: 'btn-primary', onClick: () => apply('append') },
      ...(scenes.some((scene) => scene.source)
        ? [{ label: 'Actualizar vinculadas', class: 'btn-primary', onClick: () => apply('update') }]
        : []),
      { label: 'Reemplazar escenas', class: 'btn-secondary', onClick: () => apply('replace') },
    ],
  });
}

export async function undoSceneImport() {
  const project = AppState.currentProject;
  const key = `kai-scenes-before-import:${project.id}`;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      Toast.show('No hay una importación que deshacer.', 'info');
      return;
    }
    if (
      !(await Modal.confirm({
        title: 'Deshacer importación',
        message:
          'Se restaurarán las escenas anteriores a la última importación. Las escenas actuales y sus cambios posteriores serán reemplazados. ¿Continuar?',
        confirmLabel: 'Restaurar escenas',
        type: 'danger',
        preserveCurrent: true,
      }))
    )
      return;
    const previous = JSON.parse(raw);
    const current = project.production;
    validateSceneTitles(previous.scenes);
    if (previous.scenes.length > MAX_SCENES) throw new Error('La copia supera 200 escenas.');
    const restoredScenes = normalizeSceneIds(previous.scenes);
    // Validate before swapping, so an invalid backup remains available for recovery.
    localStorage.setItem(
      key,
      JSON.stringify({
        scenes: current.scenes,
        scriptProjectId: current.scriptProjectId,
        scriptProjectName: current.scriptProjectName,
      }),
    );
    current.scenes = restoredScenes;
    delete current.scriptProjectId;
    delete current.scriptProjectName;
    if (previous.scriptProjectId) {
      current.scriptProjectId = previous.scriptProjectId;
      current.scriptProjectName = previous.scriptProjectName || '';
    }
    publishProduction('import');
  } catch (error) {
    Toast.show(`No se pudo recuperar la importación: ${error.message}`, 'error');
  }
}
