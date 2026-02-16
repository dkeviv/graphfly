# Graphfly — Admin Guide (Production Operations)

**Version**: 1.0  
**Last Updated**: February 2026  
**Status**: Draft

This guide is the canonical checklist for deploying, operating, and maintaining Graphfly in production.

> **Non‑negotiable safety constraints**
> - Graphfly **must not** write to customer source repos (Reader App is read-only; Docs App writes to docs repo only).
> - Docs output **must** go to a **separate** Git repo (docs repo) with doc blocks (no code bodies/snippets).
> - Secrets **must** be encrypted at rest and never logged.

---

## 0) Architecture (Operational View)

**Services**
- `apps/api` — API gateway + webhook ingress + auth + job enqueue
- `workers/indexer` — builds/updates the Code Intelligence Graph (CIG)
- `workers/doc-agent` — generates doc blocks and opens docs-repo PRs

**Core stores (prod)**
- PostgreSQL (RLS enforced): orgs, repos, graph, docs, jobs, audit log, webhook dedupe, billing

**Queues (prod)**
- Postgres-backed queue (`jobs` table) with leasing (Phase‑1: one job at a time per tenant).

---

## 1) Prerequisites

### 1.1 Postgres
Required extensions:
- `uuid-ossp`
- `pgcrypto`
- `vector` (pgvector)

Required database settings:
- Allow the app role to set `SET app.tenant_id = <uuid>` (RLS isolation contract).

### 1.2 GitHub Integrations
You need **both**:
- **Reader App** (installed on source repos): `contents:read`, `metadata:read`, webhooks for `push`
- **Docs App** (installed on docs repo only): `contents:write`, `pull_requests:write`, `metadata:read`

Optional (for user sign-in and repo listing):
- GitHub OAuth App (used for “Connect GitHub” in onboarding)

### 1.3 Stripe (optional for billing)
- Stripe secret key
- Price IDs for plans
- Webhook signing secret

---

## 2) Environment Configuration

### 2.1 Required in production
Graphfly enforces hard requirements when `GRAPHFLY_MODE=prod`:
- `DATABASE_URL`
- `GRAPHFLY_SECRET_KEY` (or `GRAPHFLY_SECRET_KEYS`, see Secrets section)
- `GRAPHFLY_AUTH_MODE=jwt`
- `GRAPHFLY_JWT_SECRET`
- `GRAPHFLY_QUEUE_MODE=pg`

Recommended explicit store modes:
- `GRAPHFLY_GRAPH_STORE=pg`
- `GRAPHFLY_DOC_STORE=pg`
- `GRAPHFLY_REPO_STORE=pg`
- `GRAPHFLY_ORG_STORE=pg`
- `GRAPHFLY_ORG_MEMBER_STORE=pg`
- `GRAPHFLY_SECRETS_STORE=pg`
- `GRAPHFLY_ENTITLEMENTS_STORE=pg`
- `GRAPHFLY_USAGE_COUNTERS=pg`

### 2.2 GitHub OAuth (user onboarding)
- `GITHUB_OAUTH_CLIENT_ID`
- `GITHUB_OAUTH_CLIENT_SECRET`
- `GITHUB_OAUTH_REDIRECT_URI` (must point back to the web onboarding page)

### 2.3 GitHub App auth (installation tokens)
- `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY` (PEM or base64 PEM)

### 2.4 Webhooks
- `GITHUB_WEBHOOK_SECRET` (HMAC verification)
- `STRIPE_WEBHOOK_SECRET`

### 2.5 Docs output
- `DOCS_REPO_FULL_NAME` (fallback when org has not set `docsRepoFullName`)
- `DOCS_REPO_PATH` (local mode only; dev/test)

Invitation links (team onboarding) use:
- `GRAPHFLY_WEB_URL` (optional) — absolute web origin used to build invite accept URLs (e.g. `https://app.graphfly.example`)

### 2.6 Indexer (production)
Graphfly ships with a built‑in indexer (`packages/indexer-engine/`) that emits NDJSON and ingests it into PostgreSQL.

Optional (advanced): configure an external indexer process (e.g., a faster native implementation) by setting:
- `GRAPHFLY_INDEXER_CMD` — command to run
- `GRAPHFLY_INDEXER_ARGS_JSON` — JSON array of extra args (optional)

The indexer process must emit **NDJSON records** to stdout and will receive context via env vars:
- `GRAPHFLY_REPO_ROOT`
- `GRAPHFLY_SHA`
- `GRAPHFLY_CHANGED_FILES_JSON`
- `GRAPHFLY_REMOVED_FILES_JSON`

`GRAPHFLY_INDEXER_MODE` controls selection:
- `auto` (default): prefer external CLI when configured, else use built‑in
- `builtin`: force built‑in
- `cli`: force external (fails if not configured)
- `mock`: dev-only legacy parser (not recommended)

Indexer performance/safety caps:
- `GRAPHFLY_INDEXER_MAX_FILE_BYTES` (default `2000000`) — skip parsing files larger than this and emit an `index_diagnostic` (`skip_large_file`). This prevents outliers from blowing up memory.

### 2.6B AST engine (recommended)
Graphfly supports a pluggable AST engine for AST‑grade extraction. Configure:
- `GRAPHFLY_AST_ENGINE=typescript` (default; **vendored in-repo** so it is always available)
- `GRAPHFLY_AST_ENGINE=none` (explicit opt-out; reduces fidelity)
- `GRAPHFLY_AST_ENGINE=tree-sitter` (future)

Operational constraint:
- In `GRAPHFLY_MODE=prod`, if an AST engine is requested but unavailable, the index job **fails fast** (prevents silently indexing at lower fidelity).

### 2.6C Graph enrichment agent (recommended)

Graphfly can run a post-index **graph enrichment agent** to create non-canonical annotations (e.g., `flow_summary`) that improve docs/support usability without changing the canonical graph.

Enable by running the worker:
- `npm run worker:graph`

Key env vars (guardrails):
- `GRAPHFLY_GRAPH_AGENT_MAX_TURNS` (default 12)
- `GRAPHFLY_GRAPH_AGENT_MAX_TOOL_CALLS` (default 300)
- `GRAPHFLY_GRAPH_AGENT_MAX_ENTRYPOINTS` (default 25)
- `GRAPHFLY_GRAPH_AGENT_MAX_DEPTH` (default 4)
- `GRAPHFLY_GRAPH_AGENT_MAX_TRACE_NODES` (default 200)
- `GRAPHFLY_GRAPH_AGENT_MAX_TRACE_EDGES` (default 300)
- `GRAPHFLY_GRAPH_AGENT_LOCK_TTL_MS` (default 600000)
- `GRAPHFLY_GRAPH_AGENT_MAX_ATTEMPTS` (default 3)
- `GRAPHFLY_GRAPH_AGENT_RETRY_BASE_MS` (default 500)
- `GRAPHFLY_GRAPH_AGENT_HTTP_MAX_ATTEMPTS` (default 4)
- `GRAPHFLY_GRAPH_AGENT_HTTP_RETRY_BASE_MS` (default 300)
- `GRAPHFLY_GRAPH_AGENT_HTTP_RETRY_MAX_MS` (default 10000)

Optional (LLM-backed) mode:
- `OPENCLAW_GATEWAY_URL`, `OPENCLAW_TOKEN`, `OPENCLAW_MODEL`
- If not configured, Graphfly uses a deterministic local policy so enrichment remains reproducible and testable.
- In dev, Graphfly records an `index_diagnostic` and falls back to deterministic adapters.

### 2.6C Tree-sitter AST (multi-language, enterprise fidelity)

Graphfly supports a Tree-sitter AST engine for **consistent multi-language symbol extraction** (defs/imports/calls) and richer cross-file resolution.

Enable:
- `GRAPHFLY_AST_ENGINE=treesitter`

Recommended enforcement (prod):
- `GRAPHFLY_AST_REQUIRED=1` (fails fast if Tree-sitter is unavailable)

Operational verification:
- `node apps/cli/src/graphfly.js treesitter-check`
  - Prints which languages are available in the current install.

Notes:
- Tree-sitter requires native Node modules (`tree-sitter` plus language packages). Install dependencies in your deployment image so the engine is available.
- If Tree-sitter is unavailable and `GRAPHFLY_AST_REQUIRED` is not set, Graphfly falls back to deterministic parsers and emits an `index_diagnostic`.

### 2.6D Embeddings (semantic search)

Graphfly stores 384‑dim embeddings on `graph_nodes.embedding` and uses `pgvector` + HNSW for fast semantic search.

Modes:
- `GRAPHFLY_EMBEDDINGS_MODE=deterministic` (default) — deterministic local embedding (dev/test friendly; not semantically strong).
- `GRAPHFLY_EMBEDDINGS_MODE=http` — calls an embedding HTTP endpoint during ingest and for query-time semantic search.

HTTP mode env vars:
- `GRAPHFLY_EMBEDDINGS_HTTP_URL` — required; `POST` endpoint that accepts `{ input, dims: 384 }` and returns `{ embedding: number[384] }` (or `{ data: [{ embedding: ... }] }`).
- `GRAPHFLY_EMBEDDINGS_HTTP_TOKEN` — optional bearer token.
- `GRAPHFLY_EMBEDDINGS_HTTP_TIMEOUT_MS` (default `15000`)
- `GRAPHFLY_EMBEDDINGS_HTTP_MAX_ATTEMPTS` (default `4`)
- `GRAPHFLY_EMBEDDINGS_HTTP_RETRY_BASE_MS` (default `250`)
- `GRAPHFLY_EMBEDDINGS_HTTP_RETRY_MAX_MS` (default `5000`)
- `GRAPHFLY_EMBEDDINGS_CONCURRENCY` (default `4`) — embedding compute concurrency during NDJSON ingest.

Prod enforcement (optional):
- `GRAPHFLY_EMBEDDINGS_REQUIRED=1` — in `GRAPHFLY_MODE=prod`, prevents starting with deterministic embeddings (forces explicit configuration).

Backfill control:
- `node apps/cli/src/graphfly.js embeddings-backfill --tenant-id <uuid> --repo-id <uuid> --limit 500`
  - Computes missing embeddings for nodes that have `embedding_text` but no valid embedding.
  - Uses the configured embeddings provider (deterministic or HTTP).

### 2.7 Docs sync fence (recommended)
To prevent “successful” doc jobs that do not actually sync documentation to GitHub (stubbed PRs), enable:
- `GRAPHFLY_CLOUD_SYNC_REQUIRED=1`

Behavior:
- If the docs writer runs in stub mode (missing Docs App install/token), the doc job **fails fast** with `docs_cloud_sync_disabled`.
- In dev mode (without the flag), Graphfly logs a loud warning when a PR is stubbed.

---

## 3) Database Migrations

Run migrations before starting services:
- `npm run pg:migrate`

Operational notes:
- RLS is enabled and forced for tenant-scoped tables.
- `webhook_deliveries` provides durable webhook replay protection.
- `jobs` provides durable queueing.
- `audit_log` records admin actions (best-effort; does not block primary flows).

---

## 4) Start/Run (Production)

### 4.1 Start API
- `npm run dev:api` (prod deployments should run the same entrypoint under a process manager)

### 4.2 Start workers
Run both worker processes:
- `npm run worker:indexer`
- `npm run worker:doc`

Workers require `TENANT_ID` in Phase‑1 (single-tenant worker loop).

---

## 5) Onboarding Checklist (One-Click UX)

For a new org:
1. User clicks **Connect GitHub** (OAuth) and completes authorization.
2. Admin installs **Reader App** (source repos) and **Docs App** (docs repo).
3. Admin selects a **docs repo** (must be separate) and clicks **Verify**.
4. User selects a source repo and clicks **Create Project**.
5. System enqueues index job → graph builds → docs PR opened in docs repo.

---

## 5B) Team Invitations (FR-TM-03)

Graphfly supports inviting new members by email address:
- Admin creates invite in `#/admin` (Team card).
- System returns an **accept URL** (copy/paste into email).
- Invite expires after 7 days.

Operational note:
- Email sending is intentionally **out-of-band** in Phase‑1. Enterprises should integrate a mailer (SES/Sendgrid/etc.) that delivers the accept URL to the invitee.
- Invitation tokens are one-time secrets; Graphfly stores only a SHA-256 hash.

---

## 6) Operational Maintenance

### 6.1 Secrets management & rotation
Graphfly encrypts secrets (AES‑256‑GCM). For rotation:
- Configure a **keyring** using `GRAPHFLY_SECRET_KEYS` (recommended) and rotate the primary key ID.
- Old ciphertext remains decryptable as long as old key IDs remain in the keyring.

Keyring format:
- `GRAPHFLY_SECRET_KEYS="k1:<base64-or-hex>,k2:<base64-or-hex>"`
- The **first** key ID is used for new encryption.

Rewrap procedure (recommended after rotation):
1. Deploy with the new keyring (new primary first, old keys retained).
2. Call `POST /api/v1/admin/secrets/rewrap` (owner-only) to re-encrypt stored org secrets with the new primary key.
3. After confirming, remove retired key IDs from the keyring in a later deploy window.

### 6.2 Backups & restore
Minimum:
- Daily Postgres backups (WAL + snapshots) and restore drills.
- Validate pgvector indexes rebuild time and store size.

### 6.3 Webhook health
Monitor:
- webhook verification failures
  - delivery dedupe hit rate

### 6.4 Realtime progress streaming

Graphfly uses a plain WebSocket endpoint on the API:
- `GET /ws?tenantId=<uuid>&repoId=<uuid>&token=<jwt>`

For multi-process deployments (separate worker processes), configure workers to publish events into the API hub:
- `GRAPHFLY_RT_ENDPOINT` — API base URL (e.g. `http://127.0.0.1:8787`)
- `GRAPHFLY_RT_TOKEN` — shared secret used as `Authorization: Bearer <token>` for `POST /internal/rt`

If not configured, realtime still works in single-process mode (API publishes in-process events).
- job enqueue rate vs worker throughput

### 6.4 Indexing health
Monitor:
- index job latency (p50/p95)
- failure rate and retry counts
- graph size growth (nodes/edges/occurrences)

### 6.5 Docs PR health
Monitor:
- PR creation failures
- doc block validation failures (must reject code fences)

---

## 7) Observability

### 7.1 Logs
- API and workers should emit structured JSON logs with request/job IDs.
- Never log secrets/tokens.

### 7.2 Metrics
- Expose a Prometheus-style `/metrics` endpoint (protect in production).
- Track request counts/latency and job success/failure rates.

Metrics endpoint controls:
- `GRAPHFLY_METRICS_PUBLIC=1` to expose publicly (not recommended)
- Or set `GRAPHFLY_METRICS_TOKEN` and require `Authorization: Bearer <token>`

### 7.3 Audit log
- Use `/api/v1/audit` to review admin actions (requires DB).

### 7.4 Admin dashboard
- The web app includes an **Admin** page that surfaces: org config, indexing/docs job status, audit events, secrets rewrap, and a `/metrics` preview.

---

## 8) Runbooks (Common Incidents)

### 8.1 “Docs repo verify failed”
Likely causes:
- Docs App not installed on selected docs repo
- Missing `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` / docs installation id

### 8.2 “Push webhook not triggering index”
Likely causes:
- Reader App not installed
- Webhook secret mismatch
- Delivery dedupe incorrectly configured or DB unavailable

### 8.3 “Jobs stuck queued”
Likely causes:
- Workers not running
- Wrong `TENANT_ID` for Phase‑1 worker loop
- DB connectivity or RLS misconfiguration
