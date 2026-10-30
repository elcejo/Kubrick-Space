/**
 * @file router.js — Hash-based SPA Router for Kubrick Space
 * @description Listens to `hashchange`, parses route patterns, and delegates to an injected mount callback.
 * @module router
 */

/**
 * Route definition consumed by the router.
 * @typedef {Object} RouteEntry
 * @property {RegExp}  pattern — regex to test against the hash
 * @property {string}  view    — view name passed to the configured mount callback
 * @property {string[]} paramNames — ordered capture-group names
 */

/** @type {RouteEntry[]} */
const ROUTES = [
  { pattern: /^#\/wizard\/?$/, view: 'wizard', paramNames: [] },
  { pattern: /^#\/workspace\/([^/]+)\/?$/, view: 'workspace', paramNames: ['id'] },
  { pattern: /^#?\/?$/, view: 'home', paramNames: [] }, // catch-all: empty, #, #/
];

/**
 * @class Router
 * @description Minimal hash-based router. Call `Router.init(mountView)` once at startup.
 */
export class Router {
  /** @type {boolean} */
  static _initialised = false;
  /** @type {((viewName: string, params: Object) => unknown)|null} */
  static _mountView = null;

  /**
   * Initialise the router with the application-owned view mount callback.
   * Bind the hashchange listener and resolve the current hash.
   */
  static init(mountView = Router._mountView) {
    if (Router._initialised) return;
    if (typeof mountView === 'function') Router._mountView = mountView;
    if (!Router._mountView)
      throw new Error('[Router] A view-mount handler is required before initialization.');
    Router._initialised = true;

    window.addEventListener('hashchange', Router._onHashChange);
    // Resolve the URL the user landed on
    Router._resolve(window.location.hash);
  }

  /**
   * Programmatically navigate to a new hash route.
   * @param {string} hash — e.g. `#/wizard` or `#/workspace/abc123`
   */
  static navigate(hash) {
    window.location.hash = hash;
    // hashchange listener will fire automatically
  }

  /**
   * Tear down the router (useful for tests).
   */
  static destroy() {
    window.removeEventListener('hashchange', Router._onHashChange);
    Router._initialised = false;
    Router._mountView = null;
  }

  /* ── Internal ─────────────────────────────── */

  /**
   * Handle `hashchange` events.
   * @private
   */
  static _onHashChange() {
    Router._resolve(window.location.hash);
  }

  /**
   * Match the current hash against registered routes and mount the corresponding view.
   * @param {string} hash
   * @private
   */
  static _resolve(hash) {
    const normalized = hash || '#/';

    for (const route of ROUTES) {
      const match = normalized.match(route.pattern);
      if (match) {
        /** @type {Object<string, string>} */
        const params = {};
        route.paramNames.forEach((name, i) => {
          params[name] = decodeURIComponent(match[i + 1]);
        });
        Router._mountView?.(route.view, params);
        return;
      }
    }

    // Fallback — unknown route → home
    console.warn(`[Router] No route matched "${hash}", falling back to home.`);
    Router._mountView?.('home');
  }
}
