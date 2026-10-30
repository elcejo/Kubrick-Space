/** Transport cache only; provider memory is not assumed. Each operation captures
 * an immutable editor snapshot before its first await, including unsaved edits. */
export function createAIContextClient(request) {
  let provider = null;
  const sessions = new Map();
  const writing = new Set(['corregir', 'expandir', 'reescribir', 'continuar']);
  // A cover concept is a new creative brief, not a continuation of a prior
  // editor operation. Always give the provider a fresh context session so a
  // previous cover prompt cannot become an implicit reference for the next one.
  const freshContextActions = new Set(['portada_prompt_unificado']);
  const snapshotOf = (ctx) => ({
    content: ctx.structuredText || ctx.plainText || ctx.content || '',
    document: ctx.document || '',
    tags: ctx.tags || [],
    blocks: ctx.blocks || [],
    ingredients: ctx.ingredients || [],
  });
  function setProvider(callback) {
    provider = callback;
    return () => {
      if (provider === callback) {
        provider = null;
        sessions.clear();
      }
    };
  }
  async function send(payload, transport = {}) {
    transport.signal?.throwIfAborted();
    const originProvider = provider;
    const source = originProvider?.();
    if (!source?.projectId) return request('/ai/text', payload, transport);
    const ctx = source.context;
    const snapshot = JSON.parse(JSON.stringify(snapshotOf(ctx)));
    const projectId = source.projectId;
    const serialized = JSON.stringify(snapshot);
    const originalTarget = JSON.stringify({ target: ctx.target || {}, selectedText: ctx.selectedText || '' });
    const compact = { ...payload, projectId };
    // Chat timestamps and other view-only fields must never cross the API
    // boundary. The server intentionally rejects unknown history properties.
    if (Array.isArray(compact.history)) {
      compact.history = compact.history.map(({ role, text, content }) => ({
        role,
        ...(text !== undefined ? { text } : { content }),
      }));
    }
    const freshContext = freshContextActions.has(payload.action);
    delete compact.tags;
    delete compact.blocks;
    delete compact.ingredients;
    delete compact.context;
    delete compact.project;
    if (writing.has(payload.action)) {
      delete compact.content;
      compact.selectedText = payload.selectedText || ctx.selectedText || '';
      compact.target = JSON.parse(JSON.stringify(ctx.target || {}));
    }
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
    const key =
      projectId + ':' + Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    async function sync() {
      if (!freshContext && sessions.has(key)) return sessions.get(key);
      const sessionRequest = request('/context-sessions', {
        projectId,
        snapshot,
        ...(freshContext ? { fresh: true } : {}),
      });
      if (freshContext) return sessionRequest;
      if (!sessions.has(key)) {
        // Deduplicate concurrent initializations without allowing one project to
        // overwrite another project's session or a newer snapshot.
        const pending = sessionRequest;
        sessions.set(key, pending);
        pending.catch(() => {
          if (sessions.get(key) === pending) sessions.delete(key);
        });
        if (sessions.size > 16) sessions.delete(sessions.keys().next().value);
      }
      return sessions.get(key);
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const session = await sync();
      transport.signal?.throwIfAborted();
      try {
        const result = await request(
          '/ai/text',
          { ...compact, contextSessionId: session.sessionId, contextVersion: session.contextVersion },
          transport,
        );
        if (
          writing.has(payload.action) ||
          ['screenplay_context', 'screenplay_scene'].includes(payload.action)
        ) {
          const current = provider === originProvider ? provider?.() : null;
          if (
            current?.projectId !== projectId ||
            JSON.stringify(snapshotOf(current.context)) !== serialized ||
            (writing.has(payload.action) &&
              JSON.stringify({
                target: current.context.target || {},
                selectedText: current.context.selectedText || '',
              }) !== originalTarget)
          ) {
            throw Object.assign(
              new Error(
                'El texto o la selección cambiaron durante la generación. No se aplicó la respuesta para proteger tus cambios; vuelve a solicitarla sobre la selección actual.',
              ),
              { code: 'AI_TARGET_CHANGED' },
            );
          }
        }
        return result;
      } catch (error) {
        if (attempt || !['AI_CONTEXT_EXPIRED', 'AI_CONTEXT_STALE'].includes(error.code)) throw error;
        sessions.delete(key);
      }
    }
  }
  return { send, setProvider };
}
