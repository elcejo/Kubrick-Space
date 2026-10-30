import { safeHTML } from './safe-html.js';
/**
 * @file app.js — SPA Core for Kubrick Space
 * @description Bootstraps the application and coordinates top-level view mounting.
 * @module app
 */

import { Router } from './router.js';
import { API } from './api-service.js';
import { initBrand } from './brand.js';
import { Loader, Toast } from './ui-components.js';
import { EventBus } from './event-bus.js';
import { AppState, replaceProjects, setCurrentView } from './app-state.js';
import { getAllModules, getModuleByType } from './modules/workspaces/project-module-registry.js';
import { initLiquidGlass } from './liquid-glass.js';

// Keep the legacy export surface while feature modules use focused dependencies.
export { EventBus, AppState, getAllModules, getModuleByType };

/* ──────────────────────────────────────────────
 *  App — main application controller
 * ──────────────────────────────────────────── */
/** @type {Object|null} Currently mounted view instance (must expose `unmount()`) */
let _currentViewInstance = null;

/**
 * @class App
 * @description Singleton application controller.
 */
export class App {
  static _navigation = Promise.resolve();
  static _navigationId = 0;
  static _mountedHash = window.location.hash;
  static mountView(viewName, params = {}) {
    const requestedHash = window.location.hash;
    const navigationId = ++App._navigationId;
    const isCurrent = () => navigationId === App._navigationId && window.location.hash === requestedHash;
    App._navigation = App._navigation
      .catch(() => {})
      .then(async () => {
        if (!isCurrent()) return;
        if (_currentViewInstance?.beforeLeave && !(await _currentViewInstance.beforeLeave())) {
          if (isCurrent()) history.replaceState(null, '', App._mountedHash || '#/');
          return;
        }
        if (!isCurrent()) return;
        await App._performMount(viewName, params, isCurrent);
        if (isCurrent()) App._mountedHash = requestedHash;
      });
    return App._navigation;
  }

  /**
   * Boot the SPA: initialise the router, load persisted data, render initial view.
   * Should be called once from the HTML entry-point.
   * @returns {Promise<void>}
   */
  static async init() {
    API.setInferenceModeProvider(() => AppState.inferenceMode || 'hybrid');
    API.setLocalModelProvider(() => AppState.localModel);
    API.setProjectProvider(() => AppState.currentProject?.id);
    initLiquidGlass();
    try {
      Loader.show();
      document.documentElement.setAttribute('data-theme', AppState.theme);
      initBrand();

      // Pre-load project list
      const response = await API.getProjects().catch(() => ({ projects: [] }));
      replaceProjects(Array.isArray(response) ? response : response.projects || []);

      // Start hash router (will trigger initial route)
      Router.init((viewName, params) => App.mountView(viewName, params));
    } catch (err) {
      console.error('[App] Initialisation failed:', err);
      Toast.show('Error al iniciar la aplicación', 'error');
    } finally {
      Loader.hide();
    }
  }

  /**
   * Mount a view into the `#app` container.
   * Automatically unmounts the previous view first.
   *
   * @param {ViewName} viewName
   * @param {Object}   [params={}] — route params, e.g. `{ id }`
   * @returns {Promise<void>}
   */
  static async _performMount(viewName, params = {}, isCurrent = () => true) {
    const container = document.getElementById('app');
    if (!container) {
      console.error('[App] #app container not found');
      return;
    }

    container.inert = true;
    // 1. Unmount current view
    if (_currentViewInstance && typeof _currentViewInstance.unmount === 'function') {
      _currentViewInstance.unmount();
    }
    _currentViewInstance = null;
    container.innerHTML = safeHTML('');

    // 2. Update state
    setCurrentView(viewName);

    // 3. Fetch layout HTML and lazy-load the requested view
    try {
      Loader.show();

      // Fetch and inject HTML template
      const allowedViews = ['home', 'wizard', 'workspace'];
      if (allowedViews.includes(viewName)) {
        const html = await App._fetchView(viewName);
        if (!isCurrent()) return;
        container.innerHTML = safeHTML(html);
      }

      switch (viewName) {
        case 'home': {
          _currentViewInstance = await App._mountHome(container, isCurrent);
          break;
        }
        case 'wizard': {
          const { Wizard } = await import('./wizard.js');
          if (!isCurrent()) return;
          const wizard = new Wizard();
          await wizard.mount(container, isCurrent);
          _currentViewInstance = wizard;
          break;
        }
        case 'workspace': {
          const { Workspace } = await import('./modules/workspaces/workspace.js');
          if (!isCurrent()) return;
          const workspace = new Workspace();
          await workspace.mount(container, params.id, isCurrent);
          if (isCurrent() && AppState.currentProject?.id === params.id) {
            try {
              localStorage.setItem('kai-last-project', params.id);
            } catch {
              /* Optional resume preference. */
            }
          }
          _currentViewInstance = workspace;
          break;
        }
        default:
          container.innerHTML = safeHTML('<p class="route-message">Vista no encontrada.</p>');
          _currentViewInstance = { unmount() {} };
      }
    } catch (err) {
      if (!isCurrent()) return;
      console.error(`[App] Failed to mount view "${viewName}":`, err);
      container.innerHTML = safeHTML(
        '<p class="route-message route-message--error">Error cargando la vista.</p>',
      );
    } finally {
      if (!isCurrent()) {
        _currentViewInstance?.unmount?.();
        _currentViewInstance = null;
        container.replaceChildren();
      } else container.inert = false;
      Loader.hide();
    }

    if (!isCurrent()) return;
    EventBus.emit('view:mounted', { view: viewName, params });
  }

  /* ── Private helpers ────────────────────── */

  /**
   * Fetch a view HTML file and return its content.
   * @param {string} viewName
   * @returns {Promise<string>}
   * @private
   */
  static async _fetchView(viewName) {
    const response = await fetch(`views/${viewName}.html`);
    if (!response.ok) {
      throw new Error(`Failed to load view HTML: ${viewName}.html (Status ${response.status})`);
    }
    return response.text();
  }

  /**
   * Render the home / project-list view.
   * @param {HTMLElement} container
   * @returns {Promise<{unmount: Function}>}
   * @private
   */
  static async _mountHome(container, isCurrent) {
    const { Home } = await import('./home.js');
    if (!isCurrent()) return null;
    return new Home().mount(container, isCurrent);
  }
}
