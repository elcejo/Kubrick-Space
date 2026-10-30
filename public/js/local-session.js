let pending;
export function ensureLocalSession() {
  if (!pending)
    pending = fetch('/api/session', { credentials: 'same-origin', cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error('No se pudo iniciar la sesión local');
      })
      .catch((error) => {
        pending = null;
        throw error;
      });
  return pending;
}

export async function localFetch(url, options = {}) {
  await ensureLocalSession();
  const send = () =>
    fetch(url, {
      ...options,
      credentials: 'same-origin',
      headers: { ...options.headers, 'X-Kubrick-Space': 'local' },
    });
  let response = await send();
  if (response.status === 401) {
    pending = null;
    await ensureLocalSession();
    response = await send();
  }
  return response;
}
