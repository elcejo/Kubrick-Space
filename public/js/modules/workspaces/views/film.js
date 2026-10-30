import { FilmWorkspace } from '../../film/film-workspace.js';

/** A feature film is a board of scene nodes, not a text editing surface. */
export function renderFilmMode(view) {
  if (!view.context.node) return;
  view.context.surface = null;
  const workspace = new FilmWorkspace(view.context.node, {
    onChange: () => view.context.emitChange(),
    onBackgroundState: view.context.onBackgroundState,
  });
  view.filmWorkspace = workspace;
  view.previewCleanup = () => {
    workspace.destroy();
    view.filmWorkspace = null;
  };
}
