import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOAuthCallbackParams, parseGitHubAppCallbackParams } from '../apps/web/src/pages/onboarding-oauth.js';

test('parseOAuthCallbackParams returns null without code/state', () => {
  assert.equal(parseOAuthCallbackParams({ search: '' }), null);
  assert.equal(parseOAuthCallbackParams({ search: '?code=1' }), null);
  assert.equal(parseOAuthCallbackParams({ search: '?state=1' }), null);
});

test('parseOAuthCallbackParams returns code/state', () => {
  assert.deepEqual(parseOAuthCallbackParams({ search: '?code=abc&state=xyz' }), { code: 'abc', state: 'xyz' });
});

test('parseGitHubAppCallbackParams parses app + installation_id', () => {
  assert.deepEqual(parseGitHubAppCallbackParams({ search: '?app=reader&installation_id=123' }), { app: 'reader', installationId: '123' });
  assert.deepEqual(parseGitHubAppCallbackParams({ search: '?app=docs&installationId=999' }), { app: 'docs', installationId: '999' });
  assert.equal(parseGitHubAppCallbackParams({ search: '?app=bad&installation_id=1' }), null);
});
