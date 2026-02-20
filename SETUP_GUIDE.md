# Graphfly OAuth Setup Guide

## ✅ OAuth Wiring Status

**Good news:** OAuth is fully wired and ready to use! The SaaS app supports **OAuth-only mode** (no GitHub Apps required).

## Quick Setup (5 minutes)

### Step 1: Create a GitHub OAuth App

1. Go to **https://github.com/settings/developers**
2. Click **"New OAuth App"**
3. Fill in:
   - **Application name:** `Graphfly Local` (or your choice)
   - **Homepage URL:** `http://localhost:3000`
   - **Authorization callback URL:** `http://localhost:3000`
4. Click **"Register application"**
5. You'll see your **Client ID** — copy it
6. Click **"Generate a new client secret"** — copy the secret immediately (you won't see it again)

### Step 2: Generate Encryption Keys

Run these commands in your terminal:

```bash
# Generate secret key for encrypting OAuth tokens
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Generate JWT secret for session tokens
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Generate session secret
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Copy each output — you'll need them for the `.env` file.

### Step 3: Create `.env` File

Create a file named `.env` in the project root with these values:

```bash
# GitHub OAuth (REQUIRED for OAuth mode)
GITHUB_OAUTH_CLIENT_ID=your_client_id_here
GITHUB_OAUTH_CLIENT_SECRET=your_client_secret_here
GITHUB_OAUTH_REDIRECT_URI=http://localhost:3000

# Secrets & Sessions (REQUIRED)
GRAPHFLY_SECRET_KEY=your_base64_secret_key_here
GRAPHFLY_JWT_SECRET=your_base64_jwt_secret_here
SESSION_SECRET=your_session_secret_here

# Auth Mode (REQUIRED for production-style auth)
GRAPHFLY_AUTH_MODE=jwt

# Mode (optional, defaults to 'dev')
GRAPHFLY_MODE=dev

# Database (optional for local dev; required for prod)
# DATABASE_URL=postgresql://user:pass@localhost:5432/graphfly

# LLM (optional for local dev; generates docs deterministically without it)
# OPENROUTER_API_KEY=sk-or-v1-...
```

### Step 4: Start the Server

```bash
npm install
npm test      # Verify everything works
npm start     # Start API server on http://localhost:3000
```

### Step 5: Test OAuth Flow

1. Open **http://localhost:3000** in your browser
2. Click **"Sign in with GitHub"** (or equivalent OAuth button)
3. You'll be redirected to GitHub to authorize
4. After authorization, you'll be redirected back with a session token
5. Create a project → select a repo → indexing starts automatically

**That's it!** No GitHub Apps needed.

---

## What OAuth Gives You

With OAuth configured, users can:

✅ **Sign in with GitHub** — One-click authentication  
✅ **List their repos** — Browse and select code repos  
✅ **Create projects** — Auto-indexes selected repo  
✅ **Clone repos** — Uses OAuth token for read access  
✅ **Create PRs** — Uses OAuth token to open docs PRs  

**All with zero GitHub Apps setup.**

---

## OAuth Flow (How It Works)

```
1. User clicks "Sign in with GitHub"
   ↓
2. Redirected to GitHub OAuth authorize page
   ↓
3. User approves (grants `repo` + `read:user` scopes)
   ↓
4. GitHub redirects to: http://localhost:3000?code=...&state=...
   ↓
5. Frontend detects code/state in URL, calls backend API to exchange for token
   ↓
6. Token stored encrypted in secrets table (key: github.user_token)
   ↓
7. Server creates JWT session token and returns to frontend
   ↓
8. User is signed in! Can now create projects, list repos, etc.
```

### Key Endpoints

**Frontend-initiated:**
- `GET /api/v1/integrations/github/oauth/start` → Returns GitHub authorize URL
- `POST /api/v1/integrations/github/oauth/callback` → Exchanges code for token, returns JWT

**Repo operations (use stored OAuth token):**
- `GET /api/v1/integrations/github/repos` → List user's repos
- `GET /api/v1/integrations/github/branches` → List branches for a repo
- `POST /api/v1/repos` → Create project (triggers indexing)

---

## Environment Variables Reference

### Required (OAuth-Only Mode)

| Variable | Description | Example |
|----------|-------------|---------|
| `GITHUB_OAUTH_CLIENT_ID` | GitHub OAuth App Client ID | `Iv1.abc123...` |
| `GITHUB_OAUTH_CLIENT_SECRET` | GitHub OAuth App Client Secret | `ghp_secret123...` |
| `GITHUB_OAUTH_REDIRECT_URI` | OAuth callback URL (frontend base URL) | `http://localhost:3000` |
| `GRAPHFLY_SECRET_KEY` | Base64 key for encrypting secrets | Generate with: `node -e "..."` |
| `GRAPHFLY_JWT_SECRET` | Base64 key for signing JWTs | Generate with: `node -e "..."` |
| `SESSION_SECRET` | Session middleware secret | Generate with: `node -e "..."` |
| `GRAPHFLY_AUTH_MODE` | Auth mode (`jwt` for prod-style) | `jwt` |

### Optional (Enhanced Features)

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | In-memory stores |
| `OPENROUTER_API_KEY` | LLM API key for doc generation | Deterministic local mode |
| `GRAPHFLY_MODE` | `dev` or `prod` | `dev` |
| `PORT` | API server port | `3000` |

### Optional (GitHub Apps — Enterprise Mode)

Only needed if you want fine-grained permissions instead of OAuth:

| Variable | Description |
|----------|-------------|
| `GITHUB_APP_ID` | Reader App ID |
| `GITHUB_APP_PRIVATE_KEY` | Reader App private key (base64) |
| `GITHUB_DOCS_APP_ID` | Docs App ID |
| `GITHUB_DOCS_APP_PRIVATE_KEY` | Docs App private key (base64) |
| `GITHUB_WEBHOOK_SECRET` | Webhook verification secret |

---

## Verification Checklist

After setup, verify everything works:

```bash
# 1. Test suite passes
npm test

# 2. Server starts without errors
npm start

# 3. OAuth endpoints respond
curl http://localhost:3000/api/v1/integrations/github/oauth/start

# 4. Health check passes
curl http://localhost:3000/health

# 5. Frontend loads
open http://localhost:3000
```

---

## Troubleshooting

### "oauth_not_configured" error

**Cause:** Missing OAuth environment variables  
**Fix:** Ensure `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, and `GITHUB_OAUTH_REDIRECT_URI` are set

### "invalid_state" error during callback

**Cause:** OAuth state mismatch (replay/CSRF protection)  
**Fix:** Clear cookies and try again. State is single-use and expires after 10 minutes

### "github_not_connected" when listing repos

**Cause:** No OAuth token stored  
**Fix:** Complete OAuth flow first (sign in with GitHub)

### OAuth token not persisting

**Cause:** Missing `GRAPHFLY_SECRET_KEY`  
**Fix:** Generate and set encryption key:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### "server_misconfigured" with GRAPHFLY_JWT_SECRET

**Cause:** JWT secret not set (required when `GRAPHFLY_AUTH_MODE=jwt`)  
**Fix:** Generate and set JWT secret

---

## Security Notes

1. **Never commit `.env`** — Add it to `.gitignore`
2. **OAuth token encryption** — Tokens are encrypted at rest using `GRAPHFLY_SECRET_KEY`
3. **HTTPS in production** — Always use HTTPS for OAuth callbacks in production
4. **Scope minimization** — OAuth requests `repo` (full repo access) and `read:user` (user info only)
5. **State validation** — CSRF protection via single-use state tokens

---

## Production Deployment

When deploying to production:

1. **Update OAuth App callback URL** to your production domain:
   ```
   https://your-domain.com
   ```
   
   **Note:** The callback URL should be your frontend base URL (not an API endpoint). The frontend JavaScript handles the OAuth callback by detecting `?code=...&state=...` in the URL.

2. **Set production env vars:**
   ```bash
   GRAPHFLY_MODE=prod
   GRAPHFLY_AUTH_MODE=jwt
   DATABASE_URL=postgresql://...  # Required in prod
   OPENROUTER_API_KEY=sk-or-v1-...  # Required in prod (unless GRAPHFLY_LLM_REQUIRED=0)
   ```

3. **Enable HTTPS** — OAuth requires secure callbacks in production

4. **Set all required keys** — Use secure random values for all secrets

---

## Next Steps

After OAuth is working:

1. **Test project creation** — Create a project and verify indexing starts
2. **Check docs generation** — Ensure PR is opened in docs repo
3. **Explore the UI** — Graph canvas, flows, contracts, chats
4. **Optional: Add GitHub Apps** — For webhook-driven indexing and fine-grained permissions

---

## Support

- **Docs:** `docs/02_REQUIREMENTS.md` (FR-GH-01 for OAuth specs)
- **Implementation:** `packages/github-service/src/unified-auth.js`
- **Tests:** `test/oauth-end-to-end.test.js`
- **Refactoring summary:** `docs/OAUTH_REFACTORING.md`

**Need help?** Check test suite output for hints: `npm test`
