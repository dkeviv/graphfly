import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createGitHubAppJwt, createInstallationToken } from '../packages/github-app-auth/src/app-auth.js';

function decodePart(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

test('createGitHubAppJwt produces a signed JWT with iss/iat/exp', () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs1', format: 'pem' });
  const jwt = createGitHubAppJwt({ appId: 123, privateKeyPem: pem, nowSec: 1000, ttlSec: 540 });
  const parts = jwt.split('.');
  assert.equal(parts.length, 3);
  const header = decodePart(parts[0]);
  const payload = decodePart(parts[1]);
  assert.equal(header.alg, 'RS256');
  assert.equal(payload.iss, '123');
  assert.equal(payload.iat, 1000);
  assert.equal(payload.exp, 1540);
});

test('createInstallationToken calls GitHub API with Bearer JWT', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs1', format: 'pem' });

  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), headers: init?.headers ?? {}, method: init?.method ?? 'GET' });
    return {
      status: 201,
      async text() {
        return JSON.stringify({ token: 'inst_token', expires_at: '2026-02-15T00:00:00Z' });
      }
    };
  };

  const out = await createInstallationToken({
    appId: 123,
    privateKeyPem: pem,
    installationId: 999,
    fetchImpl,
    apiBaseUrl: 'https://api.github.com'
  });
  assert.deepEqual(out, { token: 'inst_token', expiresAt: '2026-02-15T00:00:00Z' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.ok(calls[0].url.endsWith('/app/installations/999/access_tokens'));
  assert.ok(String(calls[0].headers.authorization ?? '').startsWith('Bearer '));
});

