# Quick Start: OAuth-Only Mode

## ✅ Status: Fully Wired & Ready

OAuth is **100% functional** in Graphfly. No GitHub Apps needed!

---

## 🚀 3-Minute Setup

### 1. Create GitHub OAuth App (2 min)

Visit: **https://github.com/settings/developers** → "New OAuth App"

```
Application name:         Graphfly Local
Homepage URL:            http://localhost:3000
Authorization callback:  http://localhost:3000
```

Copy your **Client ID** and **Client Secret**.

---

### 2. Generate Secrets (1 min)

```bash
# Generate all three secrets at once:
node -e "console.log('GRAPHFLY_SECRET_KEY=' + require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log('GRAPHFLY_JWT_SECRET=' + require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log('SESSION_SECRET=' + require('crypto').randomBytes(32).toString('base64'))"
```

---

### 3. Create `.env` File

```bash
# GitHub OAuth (from step 1)
GITHUB_OAUTH_CLIENT_ID=Iv1.YOUR_CLIENT_ID
GITHUB_OAUTH_CLIENT_SECRET=YOUR_CLIENT_SECRET
GITHUB_OAUTH_REDIRECT_URI=http://localhost:3000

# Secrets (from step 2)
GRAPHFLY_SECRET_KEY=YOUR_BASE64_SECRET_KEY
GRAPHFLY_JWT_SECRET=YOUR_BASE64_JWT_SECRET
SESSION_SECRET=YOUR_SESSION_SECRET

# Auth mode
GRAPHFLY_AUTH_MODE=jwt
```

---

### 4. Start & Test

```bash
npm install
npm test      # Should show 163+ tests passing
npm start     # Starts server on http://localhost:3000
```

Open **http://localhost:3000** → Click "Connect GitHub" → Done! ✓

---

## 🔍 How to Verify It's Working

### Backend Check
```bash
# OAuth start endpoint
curl http://localhost:3000/api/v1/integrations/github/oauth/start

# Should return: {"authorizeUrl": "https://github.com/login/oauth/authorize?...", ...}
```

### Frontend Check
1. Open http://localhost:3000
2. Look for "Connect GitHub" button on onboarding page
3. Click it → redirects to GitHub
4. Approve → redirects back with auth token
5. Repos appear in list → OAuth working! ✓

---

## 📋 What's Wired

✅ **Backend (`apps/api/src/server.js`)**
- `GET /api/v1/integrations/github/oauth/start` → OAuth authorize URL
- `POST /api/v1/integrations/github/oauth/callback` → Exchange code for token
- `POST /api/v1/integrations/github/connect` → Store token (legacy)
- `GET /api/v1/integrations/github/repos` → List repos (uses OAuth token)
- `GET /api/v1/integrations/github/branches` → List branches (uses OAuth token)

✅ **Frontend (`apps/web/src/`)**
- `api.js` → `githubOAuthStart()` + `githubConnect()`
- `pages/onboarding.js` → "Connect GitHub" button + OAuth popup flow
- `pages/accept.js` → Org invite acceptance with OAuth

✅ **Unified Auth (`packages/github-service/src/unified-auth.js`)**
- `resolveGitHubReadToken()` → OAuth token (if no GitHub Apps)
- `resolveGitHubWriteToken()` → OAuth token (if no Docs App)
- `isOAuthMode()` → Detects OAuth-only setup

✅ **Tests (`test/oauth-end-to-end.test.js`)**
- OAuth-only mode works ✓
- No auth fails gracefully ✓
- GitHub Apps mode detection ✓

---

## 🎯 OAuth Scopes

**Requested scopes:**
- `repo` — Read/write access to all repos (required for clone + PR creation)
- `read:user` — Read user profile (for identity binding)

**Why `repo` and not just `public_repo`?**
Most users have private repos. Graphfly needs access to:
- Clone repos (indexing)
- Create PRs in docs repos
- List branches

---

## 🔐 Security Notes

1. **Tokens encrypted at rest** — Uses `GRAPHFLY_SECRET_KEY`
2. **CSRF protection** — State parameter validated (single-use, 10min expiry)
3. **JWT sessions** — Signed with `GRAPHFLY_JWT_SECRET` (7-day expiry)
4. **No token leakage** — Never logged or exposed in responses

---

## 🐛 Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `oauth_not_configured` | Missing env vars | Set all `GITHUB_OAUTH_*` vars |
| `invalid_state` | State mismatch/expired | Clear cookies, try again |
| `github_not_connected` | No token stored | Complete OAuth flow first |
| `server_misconfigured` | Missing JWT secret | Set `GRAPHFLY_JWT_SECRET` |

---

## 📚 Full Documentation

- **Complete setup guide:** `SETUP_GUIDE.md`
- **Requirements (FR-GH-01):** `docs/02_REQUIREMENTS.md`
- **UX spec (Section 3.2):** `docs/04_UX_SPEC.md`
- **Implementation details:** `docs/OAUTH_REFACTORING.md`
- **Unified auth code:** `packages/github-service/src/unified-auth.js`

---

## ✨ Next Steps

After OAuth is working:
1. **Create a project** → Select a repo → Indexing starts
2. **View the graph** → Code Intelligence Graph populated
3. **Check docs** → PR opened in docs repo (using OAuth token)
4. **Try the assistant** → Ask questions about your code

**Optional:** Add GitHub Apps later for webhook-driven indexing (enterprise mode).

---

**That's it!** OAuth is fully wired. Just add your credentials and go. 🚀
