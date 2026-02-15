import crypto from 'node:crypto';

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export function createGitHubAppJwt({ appId, privateKeyPem, nowSec = Math.floor(Date.now() / 1000), ttlSec = 540 } = {}) {
  if (!appId) throw new Error('appId is required');
  if (!privateKeyPem) throw new Error('privateKeyPem is required');
  const iat = Number(nowSec);
  const exp = iat + Math.min(600, Math.max(60, Number(ttlSec) || 540));

  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { iat, exp, iss: String(appId) };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(input);
  sign.end();
  const sig = sign.sign(privateKeyPem);
  return `${input}.${b64url(sig)}`;
}

async function readJson(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function createInstallationToken({
  appId,
  privateKeyPem,
  installationId,
  fetchImpl = globalThis.fetch,
  apiBaseUrl = 'https://api.github.com'
} = {}) {
  if (!installationId) throw new Error('installationId is required');
  const jwt = createGitHubAppJwt({ appId, privateKeyPem });
  const url = new URL(`/app/installations/${installationId}/access_tokens`, apiBaseUrl);
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${jwt}`,
      'user-agent': 'graphfly-github-app-auth'
    }
  });
  if (res.status !== 201) {
    const data = await readJson(res);
    const msg = data?.message ?? `HTTP ${res.status}`;
    const err = new Error(`github_installation_token_error: ${msg}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  const data = await readJson(res);
  return { token: data?.token ?? null, expiresAt: data?.expires_at ?? null };
}

