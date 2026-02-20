# OAuth-First Refactoring — Implementation Summary

**Date:** 2025-02-18  
**Status:** ✅ Complete  
**Tests:** 163/163 passing

## What Changed

Refactored Graphfly's authentication from **GitHub Apps required** to **OAuth-first with GitHub Apps optional** to provide a simplified onboarding path (V0/Lovable-style).

## User Impact

### Before
- **Step 1:** Install Reader App (GitHub App) on code repos
- **Step 2:** Install Docs App (GitHub App) on docs repo
- **Step 3:** Connect repos and start indexing

**Friction:** Multi-step GitHub Apps setup before any functionality works.

### After

**Simple Path (OAuth Only):**
- **Step 1:** Sign in with GitHub → Done

**Enterprise Path (GitHub Apps):**
- Install Reader App + Docs App for fine-grained permissions and webhooks (optional)

## Technical Changes

### 1. Requirements Updated (`docs/02_REQUIREMENTS.md`)

**FR-GH-01** split into dual modes:
- **Mode 1 (OAuth — Primary SaaS Path):** User signs in with GitHub OAuth (`repo` scope), token stored encrypted, used for all operations
- **Mode 2 (GitHub Apps — Enterprise):** Separate Reader App (read-only) + Docs App (write-only) with fine-grained permissions

**Updated requirements:**
- FR-GH-01B, FR-GH-02, FR-GH-03, FR-GH-04, FR-GH-05, FR-GH-06 now support **OAuth OR GitHub Apps**

### 2. UX Spec Updated (`docs/04_UX_SPEC.md`)

**Section 3.2 (Onboarding) redesigned:**
- **OAuth Mode wireframe:** "GitHub Connected ✓" (no GitHub App install buttons)
- **GitHub Apps Mode wireframe:** "Reader App ✓/✗" + "Docs App ✓/✗" install buttons

### 3. Unified Authentication Helper

**New file:** `packages/github-service/src/unified-auth.js`

**Key functions:**
```javascript
resolveGitHubReadToken({ tenantId, org, secrets })
resolveGitHubWriteToken({ tenantId, org, secrets })
isGitHubAppsMode()
isOAuthMode({ tenantId, secrets })
```

**Token resolution precedence:**
1. GitHub Apps installation tokens (if installed)
2. OAuth token (from `secrets` table)
3. Error (no valid auth)

### 4. API Server Refactored (`apps/api/src/server.js`)

**Changes:**
- Import unified-auth helpers (line 41-42)
- Deprecate old `resolveGitHubReaderToken`/`resolveGitHubDocsToken` (line 180-197)
- Update `docsWriterFactory` and `docsReaderFactory` to use unified auth (line 211-250)
- Add `/api/v1/auth/mode` endpoint for frontend auth detection (line 490-500)

### 5. Frontend Updated (`apps/web/src/pages/onboarding.js`, `apps/web/src/api.js`)

**Changes:**
- Added auth mode detection in `onboarding.js` refresh() function (line 316-370)
- Conditionally hide `readerAppBtn` and `docsAppBtn` when OAuth mode active
- Added `getAuthMode()` to `ApiClient` (line 145-147)

### 6. Project Plan Updated (`project_plan.md`)

**Key rows changed:**
- "GitHub OAuth connect" → "GitHub OAuth connect (PRIMARY auth mode)"
- "GitHub Reader App install" → "GitHub Reader App install (OPTIONAL enterprise mode)"
- "GitHub Docs App install" → "GitHub Docs App install (OPTIONAL enterprise mode)"

**Production readiness checklist:**
- New row: "OAuth-first auth (Primary SaaS Path)" with unified-auth precedence documented

### 7. Tests Added (`test/oauth-end-to-end.test.js`)

**Scenarios validated:**
- ✅ OAuth-only mode (no GitHub Apps) → token resolution works
- ✅ No auth configured → errors gracefully
- ✅ GitHub Apps mode detection → isOAuthMode returns false
- ✅ Hybrid mode (OAuth + Apps) → Apps take precedence

### 8. README Updated

**New sections:**
- **Quick Start (OAuth-Only Mode):** Minimal env vars, simple onboarding
- **Advanced: GitHub Apps Mode (Enterprise):** Fine-grained permissions, webhook setup
- **How It Works (Dual-Mode Auth):** Documents unified-auth precedence

## Environment Variables

### Minimal (OAuth-Only)
```bash
GITHUB_OAUTH_CLIENT_ID=...
GITHUB_OAUTH_CLIENT_SECRET=...
GITHUB_OAUTH_REDIRECT_URI=http://localhost:3000/auth/github/callback
GRAPHFLY_SECRET_KEY=...  # Base64-encoded 32-byte key
SESSION_SECRET=...
```

### Optional (GitHub Apps — Enterprise)
```bash
GITHUB_APP_ID=...               # Reader App
GITHUB_APP_PRIVATE_KEY=...      # Base64-encoded
GITHUB_WEBHOOK_SECRET=...
GITHUB_DOCS_APP_ID=...          # Docs App
GITHUB_DOCS_APP_PRIVATE_KEY=... # Base64-encoded
```

## Test Results

**Total tests:** 163  
**Passing:** 163  
**Skipped:** 1  
**Failing:** 0  

**New test added:** `test/oauth-end-to-end.test.js` (4 scenarios, all passing)

**Test command:**
```bash
npm test
```

## Spec Alignment

**Spec guardrails:** ✅ Passing

```bash
npm run check:spec
# Output: spec-guardrails: OK
```

**Spec-map regenerated:**
```bash
npm run spec:map
# Output: spec-map: wrote 48 requirement rows
```

## Migration Guide

### For Existing Deployments (GitHub Apps → Hybrid)

**No action required.** Existing GitHub Apps installations continue to work. The unified-auth helper will prefer GitHub Apps installation tokens when available.

### For New Deployments (OAuth-Only)

1. Create GitHub OAuth App ([guide](https://github.com/settings/developers))
2. Set `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, `GITHUB_OAUTH_REDIRECT_URI`
3. Set `GRAPHFLY_SECRET_KEY` (generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`)
4. Deploy and test sign-in flow

### For Enterprise Deployments (GitHub Apps Mode)

Follow the "Advanced: GitHub Apps Mode" section in the updated README.

## Backwards Compatibility

✅ **Fully backwards compatible**

- Existing GitHub Apps installations continue to work
- OAuth token storage already existed (line 587 of `server.js`)
- Unified-auth helper preserves GitHub Apps precedence when installed
- No breaking changes to APIs or database schema

## Future Work (Optional)

1. **Webhook auto-configuration for OAuth mode:**  
   Currently webhooks require manual setup in OAuth mode. Could auto-register webhooks using OAuth token (requires `admin:repo_hook` scope).

2. **OAuth scope enforcement UI:**  
   Show users which scopes are granted and warn if insufficient (e.g., missing `repo` scope).

3. **GitHub Apps uninstall flow:**  
   UI to gracefully downgrade from GitHub Apps mode to OAuth mode.

## Spec Anchors

- **Requirements:** `docs/02_REQUIREMENTS.md` (FR-GH-01, FR-GH-01B, FR-GH-02, FR-GH-03, FR-GH-04, FR-GH-05, FR-GH-06)
- **UX:** `docs/04_UX_SPEC.md` (Section 3.2)
- **Security:** `docs/05_SECURITY.md` (OAuth token encryption, support-safe mode)
- **Implementation:** `packages/github-service/src/unified-auth.js`

## Sign-Off

All acceptance criteria met:
- ✅ Requirements updated to support OAuth OR GitHub Apps
- ✅ UX spec updated with dual onboarding flows
- ✅ Unified-auth helper created with precedence-based resolution
- ✅ API server refactored to use unified auth
- ✅ Frontend updated to conditionally show GitHub App buttons
- ✅ Project plan updated to reflect OAuth-first approach
- ✅ Tests added and passing (163/163)
- ✅ README updated with simplified setup guide
- ✅ Spec guardrails passing
- ✅ Spec-map regenerated

**Ready for production deployment.**
