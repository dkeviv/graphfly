import crypto from 'node:crypto';

function randomState() {
  return crypto.randomBytes(16).toString('hex');
}

async function readFormOrJson(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // GitHub can return application/x-www-form-urlencoded
    const out = Object.create(null);
    for (const part of text.split('&')) {
      const [k, v] = part.split('=', 2);
      if (!k) continue;
      out[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
    }
    return out;
  }
}

export class InMemoryOAuthStateStore {
  constructor() {
    this._byTenant = new Map(); // tenantId -> state
  }

  issue({ tenantId }) {
    const s = randomState();
    this._byTenant.set(String(tenantId), s);
    return s;
  }

  consume({ tenantId, state }) {
    const t = String(tenantId);
    const expected = this._byTenant.get(t) ?? null;
    if (!expected || expected !== state) return false;
    this._byTenant.delete(t);
    return true;
  }
}

export function buildGitHubAuthorizeUrl({ clientId, state, redirectUri, scope = 'repo read:user' }) {
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('state', state);
  if (redirectUri) url.searchParams.set('redirect_uri', redirectUri);
  if (scope) url.searchParams.set('scope', scope);
  return url.toString();
}

export async function exchangeCodeForToken({
  clientId,
  clientSecret,
  code,
  redirectUri,
  fetchImpl = globalThis.fetch
}) {
  if (!clientId || !clientSecret) throw new Error('missing_oauth_client');
  if (!code) throw new Error('code is required');
  const res = await fetchImpl('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri })
  });
  if (res.status !== 200) {
    const data = await readFormOrJson(res);
    const err = new Error(`oauth_exchange_failed`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  const data = await readFormOrJson(res);
  const token = data?.access_token ?? null;
  if (!token) {
    const err = new Error('missing_access_token');
    err.data = data;
    throw err;
  }
  return { token };
}

