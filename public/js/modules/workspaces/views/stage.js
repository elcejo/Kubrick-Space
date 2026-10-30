import { ScenarioWorkspace } from '../../scenarios/scenario-workspace.js';

/** A scenario is a typed sheet with a 360° panorama and four angles, not a text editing surface. */
export function renderStageMode(view) {
  if (!view.context.node) return;
  view.context.surface = null;
  const workspace = new ScenarioWorkspace(view.context.node, {
    onChange: () => view.context.emitChange(),
    onCreationSelected: () => view.context.refitCanvas?.(),
    onBackgroundState: view.context.onBackgroundState,
  });
  view.scenarioWorkspace = workspace;
  view.previewCleanup = () => {
    workspace.destroy();
    view.scenarioWorkspace = null;
  };
}
