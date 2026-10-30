/**
 * @file api-service.js — API Communication Layer for Kubrick Space
 * @description Centralised HTTP client wrapping every backend endpoint.
 * @module api-service
 */

/** @type {string} Base URL for all API calls */
import { localFetch } from './local-session.js';
import { createAIContextClient } from './modules/ai/ai-context-client.js';
import { readChatStream } from './modules/ai/event-stream.mjs';
const BASE_URL = '/api';
let inferenceModeProvider = () => 'api';
let localModelProvider = () => null;
let projectProvider = () => null;
let aiContext;
function getAIContext() {
  return (aiContext ||= createAIContextClient((route, payload, transport = {}) =>
    _fetch(`${BASE_URL}${route}`, { method: 'POST', body: JSON.stringify(payload), ...transport }),
  ));
}
const revisions = new Map();
const snapshots = new Map();
const writes = new Map();
function remember(project) {
  revisions.set(project.id, project.revision || 0);
  snapshots.set(project.id, JSON.parse(JSON.stringify(project)));
  return project;
}

/* ──────────────────────────────────────────────
 *  Internal fetch wrapper
 * ──────────────────────────────────────────── */

/**
 * Low-level fetch helper with default headers and error handling.
 *
 * @param {string}       url     — Fully-qualified URL
 * @param {RequestInit}  [options={}] — Standard fetch options
 * @returns {Promise<*>} Parsed JSON body
 * @throws {Error} On non-ok HTTP responses (includes status + body message)
 * @private
 */
async function _fetch(url, options = {}) {
  const { onDelta, quiet = false, ...fetchOptions } = options;
  const isFormData = options.body instanceof FormData;

  const headers = {
    'X-Kubrick-Inference-Mode': inferenceModeProvider(),
    ...(localModelProvider() ? { 'X-Kubrick-Local-Model': localModelProvider() } : {}),
    ...(projectProvider() ? { 'X-Kubrick-Project-ID': projectProvider() } : {}),
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...options.headers,
  };

  // Log payload sent to all API endpoints
  if (!quiet) {
    console.group(
      `%c[API Request] ${options.method || 'GET'} -> ${url.replace('http://localhost:3001', '')}`,
      'color: #3b82f6; font-weight: bold;',
    );
    if (isFormData) {
      console.log('FormData:', options.body);
    } else if (options.body) {
      try {
        const payloadObj = JSON.parse(options.body);
        if (/\/ai\/character-(design|image-prompt|visual-library)$/.test(url) || url.includes('/jobs')) {
          console.log('Petición de ficha de personaje: contenido omitido.');
        } else if (url.includes('/files/upload-base64/') || url.includes('/files/import-character-photo')) {
          console.log('Subida de imagen: contenido omitido.');
        } else if (url.includes('/chats')) {
          console.log('Payload de conversación omitido:', {
            messageCount: Array.isArray(payloadObj.messages) ? payloadObj.messages.length : undefined,
          });
        } else {
          console.log(
            'Payload enviado:',
            url.endsWith('/keys')
              ? Object.fromEntries(Object.keys(payloadObj).map((key) => [key, '[REDACTED]']))
              : payloadObj,
          );
        }
      } catch (e) {
        console.log('Body enviado:', options.body);
      }
    } else {
      console.log('No body payload');
    }
    console.groupEnd();
  }

  const startedAt = performance.now();
  const response = await localFetch(url, { ...fetchOptions, headers });
  if (!quiet)
    console.debug('[API Debug]', {
      requestId: response.headers.get('X-Request-ID'),
      status: response.status,
      elapsedMs: Math.round(performance.now() - startedAt),
      url,
    });

  if (!response.ok) {
    let message = response.statusText;
    let code = null;
    try {
      const body = await response.json();
      code = typeof body.code === 'string' ? body.code : null;
      const errVal = body.error || body.message;
      if (errVal) {
        message = typeof errVal === 'object' ? errVal.message || JSON.stringify(errVal) : errVal;
      } else if (body.message) {
        message = body.message;
      }
    } catch {
      /* body wasn't JSON — keep statusText */
    }
    throw Object.assign(new Error(`API ${response.status}: ${message}`), { status: response.status, code });
  }

  // Some endpoints may return 204 No Content
  if (response.status === 204) return null;

  const resData = response.headers.get('content-type')?.includes('text/event-stream')
    ? await readChatStream(response.body, onDelta)
    : await response.json();

  // Log debug prompts returned by AI endpoints
  if (
    !quiet &&
    url.includes('/ai/') &&
    !/\/ai\/character-(design|image-prompt|visual-library)$/.test(url) &&
    resData
  ) {
    console.group(
      `%c[AI Debug Response] Prompts y metadatos devueltos por: ${url.substring(url.indexOf('/api/'))}`,
      'color: #10b981; font-weight: bold;',
    );
    console.log('Respuesta cruda recibida:', resData);
    if (resData.debug) {
      console.log('Metadatos Debug:', resData.debug);
      if (resData.debug.messages) {
        console.group('Mensajes Compilados (System + User Prompts)');
        resData.debug.messages.forEach((m) => {
          console.log(`%c--- ${m.role.toUpperCase()} ---`, 'font-weight: bold; color: #a78bfa;');
          console.log(m.content);
        });
        console.groupEnd();
      }
    }
    console.groupEnd();
  }

  return resData;
}

/* ──────────────────────────────────────────────
 *  Public API object
 * ──────────────────────────────────────────── */

/**
 * Centralised API service — every method returns a Promise.
 *
 * @namespace API
 */
export const API = Object.freeze({
  setProjectProvider(provider) {
    projectProvider = provider;
  },
  async saveProjectInference(id, patch) {
    const result = await _fetch(`${BASE_URL}/projects/${encodeURIComponent(id)}/inference`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    const snapshot = snapshots.get(id);
    if (snapshot) snapshot.inferenceSettings = result.inferenceSettings;
    return result.inferenceSettings;
  },
  setLocalModelProvider(provider) {
    localModelProvider = provider;
  },
  localRuntime() {
    return _fetch(`${BASE_URL}/ai/local-runtime`, { quiet: true });
  },
  controlLocalModel(action, model) {
    return _fetch(`${BASE_URL}/ai/local-runtime`, {
      method: 'POST',
      body: JSON.stringify({ action, model }),
    });
  },
  setInferenceModeProvider(provider) {
    if (typeof provider !== 'function')
      throw new TypeError('Se requiere un proveedor de modo de inferencia.');
    inferenceModeProvider = provider;
  },
  approveCharacterLore(body) {
    return _fetch(`${BASE_URL}/characters/lore/approve`, { method: 'POST', body: JSON.stringify(body) });
  },
  enqueueCharacterJob(body) {
    return _fetch(`${BASE_URL}/jobs/character`, { method: 'POST', body: JSON.stringify(body) });
  },
  enqueueFilmJob(body) {
    return _fetch(`${BASE_URL}/jobs/film`, { method: 'POST', body: JSON.stringify(body) });
  },
  enqueueFilmRenderJob(body) {
    return _fetch(`${BASE_URL}/jobs/film/render`, { method: 'POST', body: JSON.stringify(body) });
  },
  filmSceneAction(body) {
    return _fetch(`${BASE_URL}/jobs/film/scene`, { method: 'POST', body: JSON.stringify(body) });
  },
  enqueueScenarioJob(body) {
    return _fetch(`${BASE_URL}/jobs/scenario`, { method: 'POST', body: JSON.stringify(body) });
  },
  enqueueBookJob(body) {
    return _fetch(`${BASE_URL}/jobs/book`, { method: 'POST', body: JSON.stringify(body) });
  },
  enqueueCoverJob(body) {
    return _fetch(`${BASE_URL}/jobs/cover`, { method: 'POST', body: JSON.stringify(body) });
  },
  messageBookJob(id, message) {
    return _fetch(`${BASE_URL}/jobs/${encodeURIComponent(id)}/message`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
  },
  characterJobs(projectId, transport = {}) {
    return _fetch(`${BASE_URL}/jobs?projectId=${encodeURIComponent(projectId)}`, {
      quiet: true,
      ...transport,
    });
  },
  backgroundJobs(transport = {}) {
    return _fetch(`${BASE_URL}/jobs`, transport);
  },
  sidebarJobs(transport = {}) {
    return _fetch(`${BASE_URL}/jobs?view=sidebar`, { quiet: true, ...transport });
  },
  jobHistory({ offset = 0, limit = 25 } = {}, transport = {}) {
    return _fetch(`${BASE_URL}/jobs?view=history&offset=${offset}&limit=${limit}`, transport);
  },
  jobRecord(id, projectId, transport = {}) {
    return _fetch(
      `${BASE_URL}/jobs/${encodeURIComponent(id)}/record?recordProjectId=${encodeURIComponent(projectId)}`,
      transport,
    );
  },
  dismissJob(id, projectId) {
    return _fetch(
      `${BASE_URL}/jobs/${encodeURIComponent(id)}/dismiss?recordProjectId=${encodeURIComponent(projectId)}`,
      { method: 'POST', body: '{}' },
    );
  },
  deleteJobRecord(id, projectId) {
    return _fetch(
      `${BASE_URL}/jobs/${encodeURIComponent(id)}?recordProjectId=${encodeURIComponent(projectId)}`,
      { method: 'DELETE', body: '{}' },
    );
  },
  characterCatalogue() {
    return _fetch(`${BASE_URL}/characters/catalogue`);
  },
  copyCharacterReference(body) {
    return _fetch(`${BASE_URL}/characters/reference`, { method: 'POST', body: JSON.stringify(body) });
  },
  cancelBackgroundJob(id) {
    return _fetch(`${BASE_URL}/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: '{}' });
  },
  characterJob(id, transport = {}, projectId = '') {
    return _fetch(
      `${BASE_URL}/jobs/${encodeURIComponent(id)}${projectId ? '?projectId=' + encodeURIComponent(projectId) : ''}`,
      { quiet: true, ...transport },
    );
  },
  retryCharacterJob(id, projectId = '') {
    return _fetch(
      `${BASE_URL}/jobs/${encodeURIComponent(id)}/retry${projectId ? '?projectId=' + encodeURIComponent(projectId) : ''}`,
      { method: 'POST', body: '{}' },
    );
  },
  chooseCharacterJob(id, choice) {
    return _fetch(`${BASE_URL}/jobs/${encodeURIComponent(id)}/choice`, {
      method: 'POST',
      body: JSON.stringify({ choice }),
    });
  },
  importCharacterPhoto(projectId, url, transport = {}) {
    return _fetch(`${BASE_URL}/files/import-character-photo`, {
      method: 'POST',
      body: JSON.stringify({ projectId, url }),
      ...transport,
    });
  },
  listCharacterAssets({ projectId, category, kind, offset = 0 }, transport = {}) {
    return _fetch(
      `${BASE_URL}/files/character-assets?${new URLSearchParams({ projectId, category, kind, offset: String(offset) })}`,
      transport,
    );
  },
  importCharacterAsset(payload, transport = {}) {
    return _fetch(`${BASE_URL}/files/character-assets/import`, {
      method: 'POST',
      body: JSON.stringify(payload),
      ...transport,
    });
  },
  universalProps(filters = {}, transport = {}) {
    return _fetch(`${BASE_URL}/files/prop-library?${new URLSearchParams(filters)}`, transport);
  },
  renamePropCode(payload, transport = {}) {
    return _fetch(`${BASE_URL}/files/prop-library/code`, {
      method: 'POST',
      body: JSON.stringify(payload),
      ...transport,
    });
  },
  changeUniversalProps(action, ids, confirm = false, transport = {}) {
    return _fetch(`${BASE_URL}/files/prop-library`, {
      method: 'POST',
      body: JSON.stringify({ action, ids, confirm }),
      ...transport,
    });
  },
  purgeCharacterTrash(projectId, images) {
    return _fetch(`${BASE_URL}/files/purge-character-trash`, {
      method: 'POST',
      body: JSON.stringify({ projectId, images }),
    });
  },
  purgeScenarioTrash(projectId, images) {
    return _fetch(`${BASE_URL}/files/purge-scenario-trash`, {
      method: 'POST',
      body: JSON.stringify({ projectId, images }),
    });
  },
  prepareCharacterVisualLibrary(payload, transport = {}) {
    return _fetch(`${BASE_URL}/ai/character-visual-library`, {
      method: 'POST',
      body: JSON.stringify(payload),
      ...transport,
    });
  },
  prepareCharacterImagePrompt(payload, transport = {}) {
    return _fetch(`${BASE_URL}/ai/character-image-prompt`, {
      method: 'POST',
      body: JSON.stringify(payload),
      ...transport,
    });
  },
  characterDesign(payload, transport = {}) {
    return _fetch(`${BASE_URL}/ai/character-design`, {
      method: 'POST',
      body: JSON.stringify(payload),
      ...transport,
    });
  },
  /* ── Projects ────────────────────────────── */

  /**
   * Fetch the full list of projects.
   * @returns {Promise<Array<Object>>}
   */
  getProjects() {
    return _fetch(`${BASE_URL}/projects`);
  },

  /**
   * Create a new project.
   * @param {{ name: string, type: string, category: string }} data
   * @returns {Promise<Object>} The created project
   */
  createProject(data) {
    return _fetch(`${BASE_URL}/projects`, {
      method: 'POST',
      body: JSON.stringify(data),
    }).then(remember);
  },

  /**
   * Get a single project by ID.
   * @param {string} id
   * @returns {Promise<Object>}
   */
  getProject(id) {
    return _fetch(`${BASE_URL}/projects/${encodeURIComponent(id)}`).then((project) => {
      if (!revisions.has(id)) remember(project);
      return project;
    });
  },

  /**
   * Update an existing project.
   * @param {string} id
   * @param {Object} data — fields to update
   * @returns {Promise<Object>}
   */
  updateProject(id, data) {
    // Serialize this tab's writes; never fetch a newer revision to bypass a conflict.
    const snapshotBody = typeof data === 'function' ? null : JSON.stringify(data);
    const task = (writes.get(id) || Promise.resolve())
      .catch(() => {})
      .then(async () => {
        if (!revisions.has(id)) throw new Error('Abre el proyecto antes de guardarlo.');
        const body = snapshotBody ?? JSON.stringify(data(JSON.parse(JSON.stringify(snapshots.get(id)))));
        return remember(
          await _fetch(`${BASE_URL}/projects/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'X-Project-Revision': String(revisions.get(id)) },
            body,
          }),
        );
      });
    writes.set(id, task);
    task
      .finally(() => {
        if (writes.get(id) === task) writes.delete(id);
      })
      .catch(() => {});
    return task;
  },

  async openProject(id) {
    await (writes.get(id) || Promise.resolve()).catch(() => {});
    return remember(await _fetch(`${BASE_URL}/projects/${encodeURIComponent(id)}`));
  },

  getRevision(id) {
    return revisions.get(id);
  },

  /** Read the temporary editor draft; returns null when no draft exists. */
  getProjectDraft(id) {
    return _fetch(`${BASE_URL}/projects/${encodeURIComponent(id)}/draft`).then((result) => result.draft);
  },

  /** Persist an editable snapshot without changing the permanent project. */
  saveProjectDraft(id, payload, draftRevision = 0) {
    if (!revisions.has(id)) throw new Error('Abre el proyecto antes de guardar el borrador.');
    return _fetch(`${BASE_URL}/projects/${encodeURIComponent(id)}/draft`, {
      method: 'PUT',
      headers: {
        'X-Project-Revision': String(revisions.get(id)),
        'X-Document-Draft-Revision': String(draftRevision),
      },
      body: JSON.stringify(payload),
    }).then((result) => result.draft);
  },

  /** Promote the supplied draft snapshot into a new permanent document version. */
  saveDocumentVersion(id, payload, draftRevision = 0) {
    const body = JSON.stringify(payload);
    const task = (writes.get(id) || Promise.resolve())
      .catch(() => {})
      .then(async () => {
        if (!revisions.has(id)) throw new Error('Abre el proyecto antes de guardar una versión.');
        const result = await _fetch(`${BASE_URL}/projects/${encodeURIComponent(id)}/versions`, {
          method: 'POST',
          headers: {
            'X-Project-Revision': String(revisions.get(id)),
            'X-Document-Draft-Revision': String(draftRevision),
          },
          body,
        });
        remember(result.project);
        return result;
      });
    writes.set(id, task);
    task
      .finally(() => {
        if (writes.get(id) === task) writes.delete(id);
      })
      .catch(() => {});
    return task;
  },

  getDocumentVersions(id) {
    return _fetch(`${BASE_URL}/projects/${encodeURIComponent(id)}/versions`).then(
      (result) => result.versions || [],
    );
  },

  getDocumentVersion(id, versionId) {
    return _fetch(
      `${BASE_URL}/projects/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}`,
    ).then((result) => result.version);
  },

  listChats(projectId) {
    return _fetch(`${BASE_URL}/projects/${encodeURIComponent(projectId)}/chats`).then(
      (result) => result.chats || [],
    );
  },

  getChat(projectId, chatId) {
    return _fetch(
      `${BASE_URL}/projects/${encodeURIComponent(projectId)}/chats/${encodeURIComponent(chatId)}`,
    );
  },

  saveChat(projectId, payload) {
    return _fetch(`${BASE_URL}/projects/${encodeURIComponent(projectId)}/chats`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateChat(projectId, chatId, payload) {
    return _fetch(
      `${BASE_URL}/projects/${encodeURIComponent(projectId)}/chats/${encodeURIComponent(chatId)}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      },
    );
  },

  deleteChat(projectId, chatId) {
    return _fetch(
      `${BASE_URL}/projects/${encodeURIComponent(projectId)}/chats/${encodeURIComponent(chatId)}`,
      {
        method: 'DELETE',
      },
    );
  },

  /**
   * Move a project to recoverable trash.
   * @param {string} id
   * @returns {Promise<*>}
   */
  getTrash() {
    return _fetch(`${BASE_URL}/trash`);
  },
  restoreProject(id) {
    return _fetch(`${BASE_URL}/trash/${encodeURIComponent(id)}/restore`, { method: 'POST', body: '{}' }).then(
      remember,
    );
  },

  deleteProject(id) {
    return _fetch(`${BASE_URL}/projects/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      body: '{}',
    });
  },

  /**
   * Permanently delete a project and all its files.
   * @param {string} id
   * @param {string} confirmPhrase — must be 'eliminar proyecto completo'
   * @returns {Promise<*>}
   */
  deleteProjectFull(id, confirmPhrase, keepProps = true) {
    return _fetch(`${BASE_URL}/projects/${encodeURIComponent(id)}/full`, {
      method: 'DELETE',
      body: JSON.stringify({ confirmPhrase, keepProps }),
    });
  },

  /* ── API Keys ────────────────────────────── */

  /**
   * Retrieve stored API keys.
   * @returns {Promise<Object>}
   */
  getApiKeys() {
    return _fetch(`${BASE_URL}/keys`);
  },

  /**
   * Persist API keys.
   * @param {Object} keys
   * @returns {Promise<Object>}
   */
  saveApiKeys(keys) {
    return _fetch(`${BASE_URL}/keys`, {
      method: 'PUT',
      body: JSON.stringify(keys),
    });
  },

  getLLMConfig() {
    return _fetch(`${BASE_URL}/llm-config`);
  },

  getLLMModels({ force = false, mode } = {}) {
    return _fetch(`${BASE_URL}/llm-models${force ? '?force=1' : ''}`, {
      ...(mode ? { headers: { 'X-Kubrick-Inference-Mode': mode } } : {}),
    });
  },

  saveLLMConfig(config) {
    return _fetch(`${BASE_URL}/llm-config`, {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  },

  /* ── AI Endpoints ────────────────────────── */

  /**
   * Generate text via AI.
   * @param {Object} payload
   * @returns {Promise<Object>}
   */
  aiText(payload) {
    return getAIContext().send(payload);
  },

  aiTextStream(payload, { onDelta, signal } = {}) {
    return getAIContext().send({ ...payload, stream: true }, { onDelta, signal });
  },

  setAIContextProvider(callback) {
    return getAIContext().setProvider(callback);
  },

  /**
   * Generate video via AI.
   * @param {Object} payload
   * @returns {Promise<Object>}
   */
  aiVideo(payload) {
    return _fetch(`${BASE_URL}/ai/video`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * Send a multimodal AI request.
   * @param {Object} payload
   * @returns {Promise<Object>}
   */
  aiMultimodal(payload) {
    return _fetch(`${BASE_URL}/ai/multimodal`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * Returns the API image engines that can be selected for the next generation.
   * Availability is calculated at click time so a newly saved key becomes
   * usable without reloading the workspace.
   */
  async getImageGenerationAvailability() {
    return _fetch(`${BASE_URL}/image-models`);
  },

  async aiImage(payload, transport = {}) {
    if (payload?.backend && !['api', 'local'].includes(payload.backend))
      throw new Error('Motor de imagen inválido.');
    return _fetch(`${BASE_URL}/ai/image`, {
      method: 'POST',
      body: JSON.stringify({ ...payload, backend: payload.backend || 'api' }),
      signal: transport.signal,
    });
  },

  /**
   * Generate an image via AI (Flux model).
   * @param {Object} payload
   * @returns {Promise<Object>}
   */
  aiImageFlux(payload) {
    return _fetch(`${BASE_URL}/ai/image-flux`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * Generate audio via AI.
   * @param {Object} payload
   * @returns {Promise<Object>}
   */
  aiAudio(payload) {
    return _fetch(`${BASE_URL}/ai/audio`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /* ── Files ───────────────────────────────── */

  /**
   * Upload a file to a project.
   * @param {string}   projectId
   * @param {FormData} formData — must include the file field
   * @returns {Promise<Object>}
   */
  uploadFile(projectId, formData) {
    return _fetch(`${BASE_URL}/files/upload/${encodeURIComponent(projectId)}`, {
      method: 'POST',
      body: formData, // _fetch will skip Content-Type for FormData
    });
  },

  /** Upload an image file; project document metadata is registered separately in its draft. */
  uploadBase64(projectId, fileData, filename = null, { replaceFace = false, signal } = {}) {
    return _fetch(`${BASE_URL}/files/upload-base64/${encodeURIComponent(projectId)}`, {
      method: 'POST',
      body: JSON.stringify({ fileData, filename, ...(replaceFace ? { replaceFace: true } : {}) }),
      signal,
    });
  },

  /**
   * Safely delete a file from project content.
   * @param {string} projectId
   * @param {string} filePath
   * @returns {Promise<Object>}
   */
  deleteFile(projectId, filePath) {
    return _fetch(`${BASE_URL}/files/delete`, {
      method: 'POST',
      body: JSON.stringify({ projectId, filePath }),
    });
  },

  /**
   * List all files belonging to a project.
   * @param {string} projectId
   * @returns {Promise<Array<Object>>}
   */
  getFiles(projectId) {
    return _fetch(`${BASE_URL}/files/${encodeURIComponent(projectId)}`);
  },
});
