function toWsUrl(apiUrl) {
  const u = new URL(apiUrl);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return u;
}

export function createRealtimeClient({ apiUrl, tenantId, repoId, authToken } = {}) {
  let ws = null;
  const listeners = new Set();

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function notify(evt) {
    for (const fn of listeners) {
      try {
        fn(evt);
      } catch {
        // ignore
      }
    }
  }

  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    const base = toWsUrl(apiUrl);
    base.pathname = '/ws';
    base.searchParams.set('tenantId', tenantId ?? '');
    base.searchParams.set('repoId', repoId ?? '');
    if (authToken) base.searchParams.set('token', authToken);
    ws = new WebSocket(base.toString());
    ws.onmessage = (msg) => {
      try {
        notify(JSON.parse(String(msg.data ?? 'null')));
      } catch {
        // ignore
      }
    };
    ws.onclose = () => {
      // auto-reconnect with a small delay
      setTimeout(() => connect(), 800);
    };
  }

  function update({ nextApiUrl, nextTenantId, nextRepoId, nextAuthToken }) {
    const changed =
      (nextApiUrl && nextApiUrl !== apiUrl) ||
      (nextTenantId && nextTenantId !== tenantId) ||
      (nextRepoId && nextRepoId !== repoId) ||
      (nextAuthToken && nextAuthToken !== authToken);
    apiUrl = nextApiUrl ?? apiUrl;
    tenantId = nextTenantId ?? tenantId;
    repoId = nextRepoId ?? repoId;
    authToken = nextAuthToken ?? authToken;
    if (changed) {
      try {
        ws?.close();
      } catch {}
      ws = null;
      connect();
    }
  }

  function close() {
    try {
      ws?.close();
    } catch {}
    ws = null;
  }

  return { connect, subscribe, update, close };
}

