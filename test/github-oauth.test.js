import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryOAuthStateStore, buildGitHubAuthorizeUrl, exchangeCodeForToken } from '../packages/github-oauth/src/oauth.js';

test('InMemoryOAuthStateStore issues and consumes state', () => {
  const s = new InMemoryOAuthStateStore();
  const state = s.issue({ tenantId: 't-1' });
  assert.ok(state.length > 10);
  assert.equal(s.consume({ tenantId: 't-1', state }), true);
  assert.equal(s.consume({ tenantId: 't-1', state }), false);
});

test('buildGitHubAuthorizeUrl includes client_id/state/scope', () => {
  const u = buildGitHubAuthorizeUrl({ clientId: 'cid', state: 'st', redirectUri: 'http://localhost/cb', scope: 'repo' });
  assert.ok(u.includes('client_id=cid'));
  assert.ok(u.includes('state=st'));
  assert.ok(u.includes('scope=repo'));
});

test('exchangeCodeForToken returns access token from JSON response', async () => {
  const fetchImpl = async () => ({ status: 200, async text() { return JSON.stringify({ access_token: 'tok' }); } });
  const out = await exchangeCodeForToken({ clientId: 'c', clientSecret: 's', code: 'code', redirectUri: null, fetchImpl });
  assert.deepEqual(out, { token: 'tok' });
});

