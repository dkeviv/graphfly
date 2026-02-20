/**
 * Unified GitHub authentication resolution.
 * Prefers GitHub App installation tokens (least-privilege, enterprise path),
 * falls back to OAuth token (simple path).
 * 
 * Spec anchor: docs/02_REQUIREMENTS.md FR-GH-01 (OAuth OR GitHub Apps)
 */

import { createInstallationToken } from '../../github-app-auth/src/app-auth.js';

/**
 * Resolve GitHub token for read operations (cloning, listing repos, reading files).
 * 
 * Precedence:
 * 1. GitHub Reader App installation token (if configured + installation ID available)
 * 2. OAuth user token (if stored)
 * 3. Error (no auth configured)
 * 
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {object} opts.org - org record (may have githubReaderInstallId)
 * @param {object} opts.secrets - secrets store
 * @returns {Promise<string>} GitHub token
 */
export async function resolveGitHubReadToken({ tenantId, org, secrets }) {
  // Mode 2: GitHub Apps (enterprise)
  const appId = process.env.GITHUB_APP_ID ?? '';
  const privateKeyPem = process.env.GITHUB_APP_PRIVATE_KEY ?? '';
  const installId = org?.githubReaderInstallId ?? null;

  if (appId && privateKeyPem && installId) {
    try {
      const out = await createInstallationToken({ appId, privateKeyPem, installationId: installId });
      if (out?.token) return out.token;
    } catch (e) {
      // Fall through to OAuth token
      console.warn('github_app_token_failed', { tenantId, error: String(e?.message ?? e) });
    }
  }

  // Mode 1: OAuth (simple path)
  const oauthToken = await secrets.getSecret({ tenantId, key: 'github.user_token' });
  if (oauthToken) return oauthToken;

  throw new Error('github_auth_not_configured: no OAuth token or GitHub App installation found');
}

/**
 * Resolve GitHub token for write operations (creating PRs, pushing commits).
 * 
 * Precedence:
 * 1. GitHub Docs App installation token (if configured + installation ID available)
 * 2. OAuth user token (if stored)
 * 3. Error (no write auth configured)
 * 
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {object} opts.org - org record (may have githubDocsInstallId)
 * @param {object} opts.secrets - secrets store
 * @returns {Promise<string>} GitHub token
 */
export async function resolveGitHubWriteToken({ tenantId, org, secrets }) {
  // Mode 2: GitHub Apps (enterprise) - prefer Docs App for writes
  const docsAppId = process.env.GITHUB_DOCS_APP_ID ?? process.env.GITHUB_APP_ID ?? '';
  const docsPrivateKeyPem = process.env.GITHUB_DOCS_APP_PRIVATE_KEY ?? process.env.GITHUB_APP_PRIVATE_KEY ?? '';
  const docsInstallId = org?.githubDocsInstallId ?? null;

  if (docsAppId && docsPrivateKeyPem && docsInstallId) {
    try {
      const out = await createInstallationToken({ appId: docsAppId, privateKeyPem: docsPrivateKeyPem, installationId: docsInstallId });
      if (out?.token) return out.token;
    } catch (e) {
      // Fall through to OAuth token
      console.warn('github_docs_app_token_failed', { tenantId, error: String(e?.message ?? e) });
    }
  }

  // Mode 1: OAuth (simple path) - same token for read + write
  const oauthToken = await secrets.getSecret({ tenantId, key: 'github.user_token' });
  if (oauthToken) return oauthToken;

  throw new Error('github_write_auth_not_configured: no OAuth token or Docs App installation found');
}

/**
 * Check if GitHub Apps mode is enabled (enterprise path).
 * @returns {boolean}
 */
export function isGitHubAppsMode() {
  return Boolean(process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY);
}

/**
 * Check if OAuth mode is active (simple path).
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {object} opts.secrets - secrets store
 * @returns {Promise<boolean>}
 */
export async function isOAuthMode({ tenantId, secrets }) {
  const oauthToken = await secrets.getSecret({ tenantId, key: 'github.user_token' });
  return Boolean(oauthToken);
}
