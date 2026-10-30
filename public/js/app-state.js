import { EventBus } from './event-bus.js';

function readTheme() {
  try {
    return localStorage.getItem('kai-theme') || 'dark';
  } catch {
    return 'dark';
  }
}

function readCanvasEffects() {
  try {
    return localStorage.getItem('kai-canvas-effects') === 'true';
  } catch {
    return false;
  }
}

/**
 * Shared client state. Feature modules read this state; use the named actions
 * below for top-level changes so state ownership and notifications stay clear.
 */
export const AppState = new Proxy(
  {
    currentView: 'home',
    currentProject: null,
    moduleConfig: null,
    projects: [],
    unsavedChanges: false,
    theme: readTheme(),
    canvasEffects: readCanvasEffects(),
    inferenceMode: 'api',
    localModel: 'local:qwen3.5-4b-int8-convrot',
  },
  {
    set(target, key, value) {
      const previous = target[key];
      target[key] = value;
      if (key === 'theme') {
        try {
          localStorage.setItem('kai-theme', value);
        } catch {
          /* Theme persistence is optional. */
        }
        document.documentElement.setAttribute('data-theme', value);
      }
      if (key === 'canvasEffects') {
        try {
          localStorage.setItem('kai-canvas-effects', String(value));
        } catch {
          /* The visual effect remains usable without preference storage. */
        }
      }
      EventBus.emit('state:change', { key, value, previous });
      return true;
    },
  },
);

export function setCurrentView(view) {
  AppState.currentView = view;
}

export function setActiveProject(project) {
  AppState.currentProject = project || null;
  AppState.inferenceMode = project?.inferenceSettings?.mode === 'local' ? 'local' : 'api';
  AppState.localModel = project?.inferenceSettings?.localModel || 'local:qwen3.5-4b-int8-convrot';
}

/** Apply an acknowledged preference write only to its originating project. */
export function applyProjectInference(projectId, settings) {
  for (const project of AppState.projects) {
    if (project.id === projectId) project.inferenceSettings = settings;
  }
  if (AppState.currentProject?.id !== projectId) return;
  AppState.currentProject.inferenceSettings = settings;
  AppState.inferenceMode = settings.mode === 'local' ? 'local' : 'api';
  AppState.localModel = settings.localModel || 'local:qwen3.5-4b-int8-convrot';
  EventBus.emit('state:change', { key: 'inferenceSettings', value: settings });
}

export function setActiveModuleConfig(config) {
  AppState.moduleConfig = config || null;
}

export function replaceProjects(projects) {
  AppState.projects = Array.isArray(projects) ? projects : [];
}

export function setTheme(theme) {
  if (theme !== 'dark' && theme !== 'light') return;
  AppState.theme = theme;
}

export function setCanvasEffects(enabled) {
  if (typeof enabled !== 'boolean') return;
  AppState.canvasEffects = enabled;
}

/** Selection preference; inference routing is configured independently of the toolbar. */
export function setInferenceMode(mode) {
  if (!['local', 'api'].includes(mode)) return;
  AppState.inferenceMode = mode;
}
export function setLocalModel(model) {
  if (!/^local:qwen3\.5-(4b|9b)-int8-convrot$/.test(model)) return;
  AppState.localModel = model;
}

/** Apply a saved project snapshot to the active project and home collection. */
export function commitProjectSnapshot(project) {
  if (!project || typeof project !== 'object') return;
  setActiveProject(project);
  replaceProjects(AppState.projects.map((item) => (item.id === project.id ? { ...item, ...project } : item)));
}

export function removeProjectSummary(projectId) {
  replaceProjects(AppState.projects.filter((project) => project.id !== projectId));
}

export function renameProjectSummary(projectId, name) {
  if (AppState.currentProject?.id === projectId) AppState.currentProject.name = name;
  replaceProjects(
    AppState.projects.map((project) => (project.id === projectId ? { ...project, name } : project)),
  );
}
