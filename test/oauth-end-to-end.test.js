/**
 * OAuth-first end-to-end flow (no GitHub Apps required).
 *
 * This validates the primary SaaS path (Mode 1 from FR-GH-01):
 * - User completes OAuth callback
 * - OAuth token stored encrypted in secrets (handled by secrets store)
 * - Token used for repo listing / cloning / PR creation (via unified-auth resolution)
 *
 * Spec anchors:
 * - docs/02_REQUIREMENTS.md: FR-GH-01 (Mode 1: OAuth Primary SaaS Path)
 * - packages/github-service/src/unified-auth.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemorySecretsStore } from '../packages/secrets/src/store.js';
import { resolveGitHubReadToken, resolveGitHubWriteToken, isOAuthMode, isGitHubAppsMode } from '../packages/github-service/src/unified-auth.js';

function withEnv(patch, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(patch)) {
    prev[k] = process.env[k];
    if (v === null) delete process.env[k];
    else process.env[k] = String(v);
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });
}

test('OAuth-only mode resolves token for read + write (no Apps configured)', async () => {
  await withEnv(
    {
      GITHUB_APP_ID: null,
      GITHUB_APP_PRIVATE_KEY: null,
      GITHUB_DOCS_APP_ID: null,
      GITHUB_DOCS_APP_PRIVATE_KEY: null
    },
    async () => {
      const secrets = new InMemorySecretsStore();
      const tenantId = 'org-oauth-test';
      const oauthToken = 'gho_test_oauth_token_abc123';

      await secrets.setSecret({ tenantId, key: 'github.user_token', value: oauthToken });

      assert.equal(await isOAuthMode({ tenantId, secrets }), true);
      assert.equal(isGitHubAppsMode(), false);

      assert.equal(await resolveGitHubReadToken({ tenantId, org: {}, secrets }), oauthToken);
      assert.equal(await resolveGitHubWriteToken({ tenantId, org: {}, secrets }), oauthToken);
    }
  );
});

test('No auth configured throws for read + write', async () => {
  await withEnv(
    {
      GITHUB_APP_ID: null,
      GITHUB_APP_PRIVATE_KEY: null,
      GITHUB_DOCS_APP_ID: null,
      GITHUB_DOCS_APP_PRIVATE_KEY: null
    },
    async () => {
      const secrets = new InMemorySecretsStore();
      const tenantId = 'org-no-auth';

      assert.equal(await isOAuthMode({ tenantId, secrets }), false);
      assert.equal(isGitHubAppsMode(), false);

      await assert.rejects(
        () => resolveGitHubReadToken({ tenantId, org: {}, secrets }),
        /github_auth_not_configured/
      );

      await assert.rejects(
        () => resolveGitHubWriteToken({ tenantId, org: {}, secrets }),
        /github_write_auth_not_configured/
      );
    }
  );
});
