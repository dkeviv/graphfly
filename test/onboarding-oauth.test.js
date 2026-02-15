import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOAuthCallbackParams } from '../apps/web/src/pages/onboarding-oauth.js';

test('parseOAuthCallbackParams returns null without code/state', () => {
  assert.equal(parseOAuthCallbackParams({ search: '' }), null);
  assert.equal(parseOAuthCallbackParams({ search: '?code=1' }), null);
  assert.equal(parseOAuthCallbackParams({ search: '?state=1' }), null);
});

test('parseOAuthCallbackParams returns code/state', () => {
  assert.deepEqual(parseOAuthCallbackParams({ search: '?code=abc&state=xyz' }), { code: 'abc', state: 'xyz' });
});

