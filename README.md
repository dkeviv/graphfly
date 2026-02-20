# Graphfly

Graphfly is specified in `docs/` and implemented as a Node.js monorepo in `apps/`, `packages/`, and `workers/`.

## Specs (source of truth)

- `docs/02_REQUIREMENTS.md` — Functional & non-functional requirements
- `docs/03_TECHNICAL_SPEC.md` — Database schema, APIs, agent loops
- `docs/04_UX_SPEC.md` — User flows, wireframes, UX constraints
- `docs/05_SECURITY.md` — Threat model, auth modes, security controls
- `docs/06_OPERATIONS.md` — SLOs, runbooks, scaling/backup

## Quick Start (OAuth-Only Mode)

**Primary SaaS Path** — Get Graphfly running with minimal configuration. No GitHub Apps required.

### Prerequisites

- **Node.js** 18+ and npm
- **GitHub OAuth App** ([create here](https://github.com/settings/developers))
  - Set **Authorization callback URL** to `http://localhost:3000/auth/github/callback` (or your deployed URL)
  - Note your **Client ID** and **Client Secret**

### Environment Variables (Minimal)

```bash
# Required: GitHub OAuth
GITHUB_OAUTH_CLIENT_ID=your_oauth_client_id
GITHUB_OAUTH_CLIENT_SECRET=your_oauth_client_secret
GITHUB_OAUTH_REDIRECT_URI=http://localhost:3000/auth/github/callback

# Required: Session + encryption
GRAPHFLY_SECRET_KEY=your_base64_secret_key_here  # Generate: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
SESSION_SECRET=your_session_secret_here

# Optional: LLM for doc generation (OpenRouter)
OPENROUTER_API_KEY=your_openrouter_api_key  # Get from https://openrouter.ai
```

### Run Locally

```bash
npm install
npm test                    # Validate setup
npm start                   # Start API server (http://localhost:3000)
```

Then open your browser to `http://localhost:3000`, sign in with GitHub, and create your first project.

**What happens:**
1. **Sign in with GitHub** → OAuth token stored encrypted
2. **Create project** → Auto-indexes your repo (using OAuth token)
3. **Docs generated** → Opens PR in your docs repo (using OAuth token)

No GitHub App installations required. Works out of the box.

---

## Advanced: GitHub Apps Mode (Enterprise)

**Enterprise Path** — Use GitHub Apps for fine-grained permissions and webhook-driven indexing.

### Why GitHub Apps?

- **Fine-grained permissions:** Reader App (read-only), Docs App (docs repo writes only)
- **Webhook-driven indexing:** Auto-index on push events (no manual triggers)
- **Audit + compliance:** Installation-level permissions and access logs
- **Multi-org support:** Install once per org; all members benefit

### Additional Environment Variables

```bash
# GitHub Reader App (read-only; triggers push webhooks)
GITHUB_APP_ID=your_reader_app_id
GITHUB_APP_PRIVATE_KEY=your_reader_app_private_key_base64  # Base64-encoded
GITHUB_WEBHOOK_SECRET=your_webhook_secret

# GitHub Docs App (write access to docs repo only)
GITHUB_DOCS_APP_ID=your_docs_app_id
GITHUB_DOCS_APP_PRIVATE_KEY=your_docs_app_private_key_base64  # Base64-encoded
```

### How It Works (Dual-Mode Auth)

Graphfly's **unified authentication** (`packages/github-service/src/unified-auth.js`) resolves tokens with this precedence:

1. **GitHub Apps installation tokens** (if Apps installed) → Fine-grained, auto-expiring
2. **OAuth token** (fallback) → Stored encrypted in `secrets` table
3. **Error** → No valid authentication

This means:
- **OAuth-only users:** Simple path, no Apps needed
- **Enterprise users:** Install Apps for enhanced security + webhooks, OAuth as fallback
- **Hybrid users:** Both modes coexist; Apps take precedence when available

### GitHub App Setup

1. **Create Reader App** ([guide](https://docs.github.com/en/apps/creating-github-apps))
   - **Repository permissions:** Contents (read-only), Metadata (read-only)
   - **Subscribe to events:** Push
   - **Webhook URL:** `https://your-domain.com/webhooks/github`
   - Note **App ID** and generate a **private key**

2. **Create Docs App**
   - **Repository permissions:** Contents (read & write) — **scoped to docs repo only**
   - No webhook events needed
   - Note **App ID** and generate a **private key**

3. **Base64-encode private keys:**
   ```bash
   cat reader-app-private-key.pem | base64 > GITHUB_APP_PRIVATE_KEY.txt
   cat docs-app-private-key.pem | base64 > GITHUB_DOCS_APP_PRIVATE_KEY.txt
   ```

4. **Set environment variables** (see above)

5. **Install Apps:**
   - Install Reader App on your code repos (where you want indexing)
   - Install Docs App on your docs repos (where PRs will be created)

---

## Local smoke run (mock indexer)

This repo includes a mock indexer to validate the **Code Intelligence Graph** ingestion pipeline without external dependencies.

1. Generate NDJSON from a fixture repo:
   - `npm run index:mock > /tmp/graph.ndjson`
2. Ingest NDJSON in-process (tests cover this end-to-end):
   - `npm test`

Note: the sandbox environment used by this assistant may block binding a local TCP port, so API server smoke runs may need to be executed on your machine outside the sandbox.

## LLM agent runtime (OpenRouter)

Graphfly uses an OpenAI-compatible **chat-completions tool loop** with OpenRouter as the default remote LLM provider. In dev/tests, it can fall back to deterministic local loops for stability and reproducibility.

- Tool loop implementation: `packages/llm-openrouter/src/tool-loop.js`
- Minimal runner (contract doc block):
  - Online (requires OpenRouter key): `OPENROUTER_API_KEY=... node workers/doc-agent/src/run-contract-doc-agent.js <symbolUid>`
  - Offline deterministic render: `OFFLINE_RENDER=1 GRAPHFLY_API_URL=... node workers/doc-agent/src/run-contract-doc-agent.js <symbolUid>`

## Tests

- `npm test`
