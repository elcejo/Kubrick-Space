import { API } from '../../api-service.js';

const PREFIX = 'kai-draft:';
const LEGACY_DISMISSED_PREFIX = 'kai-draft-dismissed:';

function validPayload(payload) {
  return Boolean(payload && typeof payload === 'object' && !Array.isArray(payload));
}

function stableJSON(value) {
  if (Array.isArray(value)) return `[${value.map(stableJSON).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJSON(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function parseLocalDrafts(projectId) {
  const drafts = [];
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith(PREFIX) || key.startsWith(LEGACY_DISMISSED_PREFIX)) continue;
    const raw = localStorage.getItem(key);
    try {
      const draft = JSON.parse(raw);
      if (draft?.projectId === projectId && validPayload(draft.payload)) drafts.push({ key, raw, draft });
    } catch {
      /* Ignore malformed emergency snapshots. */
    }
  }
  drafts.sort(
    (left, right) => (Date.parse(right.draft.savedAt) || 0) - (Date.parse(left.draft.savedAt) || 0),
  );
  return drafts;
}

function clearLocalDrafts(drafts) {
  for (const { key, raw } of drafts) {
    // Do not remove a snapshot that another tab updated after this scan.
    if (localStorage.getItem(key) === raw) localStorage.removeItem(key);
  }
}

export function storeDraft(key, project, payload, draftRevision = 0) {
  localStorage.setItem(
    PREFIX + key,
    JSON.stringify({
      projectId: project.id,
      name: project.name,
      type: project.type,
      category: project.category,
      draftRevision,
      savedAt: new Date().toISOString(),
      payload,
    }),
  );
}

export function removeDraft(key, savedPayload) {
  const storageKey = PREFIX + key;
  if (savedPayload !== undefined) {
    try {
      const current = JSON.parse(localStorage.getItem(storageKey));
      if (stableJSON(current?.payload) !== stableJSON(savedPayload)) return false;
    } catch {
      return false;
    }
  }
  localStorage.removeItem(storageKey);
  return true;
}

// The server owns one temporary draft per project. Local snapshots are only
// crash-recovery copies: on open, promote the newest one into that draft and
// clean up legacy per-tab copies without ever creating another project.
export async function recoverDrafts(projectId) {
  try {
    localStorage.removeItem(LEGACY_DISMISSED_PREFIX + projectId);
  } catch {
    /* Storage may be unavailable. */
  }
  const localDrafts = parseLocalDrafts(projectId);
  const newestLocal = localDrafts[0]?.draft || null;
  let serverDraft = null;
  let readError = null;

  try {
    serverDraft = (await API.getProjectDraft(projectId)) || null;
  } catch (error) {
    readError = error;
  }

  if (readError) {
    if (newestLocal) {
      return {
        revision: Number.isSafeInteger(newestLocal.draftRevision) ? newestLocal.draftRevision : 0,
        savedAt: newestLocal.savedAt,
        payload: newestLocal.payload,
        localOnly: true,
      };
    }
    throw readError;
  }

  if (
    newestLocal &&
    serverDraft?.payload &&
    stableJSON(newestLocal.payload) === stableJSON(serverDraft.payload)
  ) {
    clearLocalDrafts(localDrafts);
    return serverDraft;
  }

  const localTime = newestLocal ? Date.parse(newestLocal.savedAt) || 0 : 0;
  const serverTime = serverDraft ? Date.parse(serverDraft.savedAt) || 0 : 0;
  if (newestLocal && (!serverDraft || localTime > serverTime)) {
    let expectedRevision = Number.isSafeInteger(serverDraft?.revision) ? serverDraft.revision : 0;
    let knownServerRevision = expectedRevision;
    try {
      serverDraft = await API.saveProjectDraft(projectId, newestLocal.payload, expectedRevision);
    } catch (firstError) {
      // A different tab may have saved while this workspace was opening.
      // Re-read once and let the later snapshot win; keep the local copy if
      // the server still cannot accept it so the user can continue editing.
      try {
        const latest = (await API.getProjectDraft(projectId)) || null;
        const latestTime = latest ? Date.parse(latest.savedAt) || 0 : 0;
        if (latest && latestTime >= localTime) serverDraft = latest;
        else {
          expectedRevision = Number.isSafeInteger(latest?.revision) ? latest.revision : 0;
          knownServerRevision = expectedRevision;
          serverDraft = await API.saveProjectDraft(projectId, newestLocal.payload, expectedRevision);
        }
      } catch (retryError) {
        console.warn(
          '[Draft recovery] Keeping the browser copy until the project draft can be saved:',
          retryError || firstError,
        );
        return {
          revision: knownServerRevision,
          savedAt: newestLocal.savedAt,
          payload: newestLocal.payload,
          localOnly: true,
        };
      }
    }
  }

  if (serverDraft) clearLocalDrafts(localDrafts);
  else if (newestLocal) {
    // The remote draft is empty. The local backup is the only working draft.
    try {
      serverDraft = await API.saveProjectDraft(projectId, newestLocal.payload, 0);
      clearLocalDrafts(localDrafts);
    } catch (error) {
      console.warn('[Draft recovery] Keeping the browser copy until the project draft can be saved:', error);
      return {
        revision: Number.isSafeInteger(newestLocal.draftRevision) ? newestLocal.draftRevision : 0,
        savedAt: newestLocal.savedAt,
        payload: newestLocal.payload,
        localOnly: true,
      };
    }
  }

  return serverDraft;
}
