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
- Postgres-backed queue (`jobs` table) with leasing.
- Queues: `index`, `graph`, `doc` (index → optional graph enrichment → docs PR).
- Admin endpoints (JWT + admin role required):
  - `GET /api/v1/jobs` (list jobs by status)
  - `POST /api/v1/jobs/:queue/:jobId/retry`
  - `POST /api/v1/jobs/:queue/:jobId/cancel`

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
Graphfly supports two GitHub authentication modes (FR-GH-01):

**Mode 1 — OAuth (Primary SaaS Path)**
- **GitHub OAuth App** (used for “Connect GitHub” sign-in/onboarding)
- The user OAuth token (encrypted at rest) is used for repo listing, cloning, and docs PR creation.
- Webhooks require **manual user configuration** (or polling-based change detection in a future phase).

**Mode 2 — GitHub Apps (Optional / Enterprise / Least-Privilege)**
- **Reader App** (installed on source repos): `contents:read`, `metadata:read`, webhooks for `push`
- **Docs App** (installed on docs repo only): `contents:write`, `pull_requests:write`, `metadata:read`
- When configured, installation tokens are preferred over the OAuth token.

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
- `GITHUB_OAUTH_CLIENT_ID`
- `GITHUB_OAUTH_CLIENT_SECRET`
- `GITHUB_OAUTH_REDIRECT_URI`
- `GITHUB_WEBHOOK_SECRET` (required for automatic incremental indexing via GitHub push webhooks)

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
Optional (enterprise / least-privilege):
- `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY` (PEM or base64 PEM)
- `GITHUB_API_BASE_URL` (optional; for GitHub Enterprise) — default `https://api.github.com`

### 2.4 Webhooks
- `GITHUB_WEBHOOK_SECRET` (HMAC verification)
- `STRIPE_WEBHOOK_SECRET`

### 2.5 Docs output
- `DOCS_REPO_FULL_NAME` (fallback when org has not set `docsRepoFullName`)
- `DOCS_REPO_PATH` (local mode only; dev/test)

Docs repo creation (optional onboarding):
- `POST /api/v1/orgs/docs-repo/create` creates a new GitHub repo (auto-initialized) using the connected user OAuth token.
- In OAuth mode, docs PRs are opened using the OAuth token (repo scope).
- In GitHub Apps mode, docs PRs are opened using the Docs App installation token when available (preferred).

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
- `GRAPHFLY_AST_ENGINE=composite` (**prod default**) — TypeScript compiler for JS/TS/TSX + Tree-sitter for other languages
- `GRAPHFLY_AST_ENGINE=typescript` (**dev default**) — vendored TypeScript compiler engine for JS/TS/TSX
- `GRAPHFLY_AST_ENGINE=none` (explicit opt-out; reduces fidelity)
- `GRAPHFLY_AST_ENGINE=treesitter` — Tree-sitter only (all supported languages via grammars)

Operational constraint:
- In `GRAPHFLY_MODE=prod`, if an AST engine is requested but unavailable, the index job **fails fast** (prevents silently indexing at lower fidelity).

### 2.6C Graph enrichment agent (recommended)

Graphfly can run a post-index **graph enrichment agent** to create non-canonical annotations (e.g., `flow_summary`) that improve docs/support usability without changing the canonical graph.

Enable by running the worker:
- `npm run worker:graph`

Key env vars (guardrails):
- `GRAPHFLY_GRAPH_AGENT_MAX_TURNS` (default `20`) — **Enterprise: 20**
- `GRAPHFLY_GRAPH_AGENT_MAX_TOOL_CALLS` (default `300`)
- `GRAPHFLY_GRAPH_AGENT_MAX_ENTRYPOINTS` (default `50`) — **Enterprise: 50**
- `GRAPHFLY_GRAPH_AGENT_MAX_DEPTH` (default `5`) — **Enterprise: 5**
- `GRAPHFLY_GRAPH_AGENT_MAX_TRACE_NODES` (default `1500`) — **Enterprise: 1500**
- `GRAPHFLY_GRAPH_AGENT_MAX_TRACE_EDGES` (default `3000`) — **Enterprise: 3000**
- `GRAPHFLY_GRAPH_AGENT_LOCK_TTL_MS` (default 600000)
- `GRAPHFLY_GRAPH_AGENT_MAX_ATTEMPTS` (default 3)
- `GRAPHFLY_GRAPH_AGENT_RETRY_BASE_MS` (default 500)
- `GRAPHFLY_GRAPH_AGENT_HTTP_MAX_ATTEMPTS` (default 4)
- `GRAPHFLY_GRAPH_AGENT_HTTP_RETRY_BASE_MS` (default 300)
- `GRAPHFLY_GRAPH_AGENT_HTTP_RETRY_MAX_MS` (default 10000)

Optional (LLM-backed) mode:
- `OPENROUTER_API_KEY` (plus optional `OPENROUTER_BASE_URL` and `GRAPHFLY_LLM_MODEL`)
- If not configured, Graphfly uses a deterministic local policy so enrichment remains reproducible and testable.
- In dev, Graphfly records an `index_diagnostic` and falls back to deterministic adapters.

### 2.6C Tree-sitter AST (multi-language, enterprise fidelity)

Graphfly supports a Tree-sitter AST engine for **consistent multi-language symbol extraction** (defs/imports/calls) and richer cross-file resolution.

Enable:
- `GRAPHFLY_AST_ENGINE=treesitter`

SaaS default (prod):
- When `GRAPHFLY_MODE=prod` and `GRAPHFLY_AST_ENGINE` is unset, Graphfly defaults to `composite` (TypeScript compiler + Tree-sitter).

Recommended enforcement (prod):
- `GRAPHFLY_AST_REQUIRED=1` (fails fast if Tree-sitter is unavailable; prevents silent downgrade)

Operational verification:
- `node apps/cli/src/graphfly.js treesitter-check`
  - Prints which languages are available in the current install.

Notes:
- Tree-sitter requires native Node modules (`tree-sitter` plus language packages). Install dependencies in your deployment image so the engine is available.
- In `GRAPHFLY_MODE=prod` (or when `GRAPHFLY_AST_REQUIRED=1`), Graphfly eagerly verifies that all configured grammar modules are installed and fails fast if any are missing.
- If Tree-sitter is unavailable and `GRAPHFLY_AST_REQUIRED` is not set, Graphfly falls back to deterministic parsers and emits an `index_diagnostic`.

### 2.6C.1 Removed files (prune graph state)

GitHub push webhooks include a `removed` file list. Graphfly treats removed files as hard deletions and prunes any file-scoped graph state:
- deletes `graph_nodes` where `file_path` matches a removed file (edges/occurrences cascade)
- deletes `flow_entrypoints` and `dependency_manifests` with matching `file_path`
- deletes `unresolved_imports` for the removed files

This prevents stale symbols from surviving after deletions/renames.

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

### 2.6D Documentation agent worker (recommended)

Graphfly runs a documentation worker that updates **doc blocks** and opens PRs in the configured **docs repo only**.

Docs output layout (Phase‑1):
- `flows/` — flow entrypoints (HTTP routes, queue jobs, CLIs)
- `contracts/` — public contracts (exported functions/classes, modules, schemas)

Enable by running the worker:
- `npm run worker:doc`

Agent runtime modes:
- **LLM-backed (remote)**: set `OPENROUTER_API_KEY` (plus optional `OPENROUTER_BASE_URL` and `GRAPHFLY_LLM_MODEL`).
- **Deterministic local loop (offline/tests)**: leave `OPENROUTER_API_KEY` unset.

Production requirement:
- In `GRAPHFLY_MODE=prod`, LLM is required by default (fail-fast if missing) via `GRAPHFLY_LLM_REQUIRED=1`.
- Emergency override: `GRAPHFLY_LLM_REQUIRED=0` to allow deterministic/local mode in prod (not recommended).

Key env vars:
- `OPENROUTER_API_KEY` — OpenRouter API key (enables LLM-agentic mode)
- `OPENROUTER_BASE_URL` — optional override for OpenRouter-compatible API base URL
- `OPENROUTER_HTTP_REFERER` — optional HTTP referer header value (some providers use this for policy/analytics)
- `GRAPHFLY_LLM_MODEL` — default OpenRouter model id (can also be set per org via UI)
- `GRAPHFLY_LLM_REQUIRED=0|false` — disable the prod-default “LLM required” behavior (not recommended)

Doc agent guardrails (recommended):
- `GRAPHFLY_DOC_AGENT_LOCK_TTL_MS` (default `1800000`) — per-repo doc generation lock TTL (serializes runs)
- `GRAPHFLY_DOC_AGENT_MAX_TURNS` (default `40`, range `5-80`) — hard cap on agent loop turns. **Enterprise: 40. Large monolith: 60.**
- `GRAPHFLY_DOC_AGENT_MAX_TOOL_CALLS` (default `8000`) — hard cap on total tool calls per run (DoS guard)
- `GRAPHFLY_DOC_AGENT_HTTP_MAX_ATTEMPTS` (default `4`) — provider HTTP retry attempts (429/5xx)
- `GRAPHFLY_DOC_AGENT_RETRY_BASE_MS` (default `250`)
- `GRAPHFLY_DOC_AGENT_RETRY_MAX_MS` (default `5000`)
- `GRAPHFLY_DOC_AGENT_TRACE_DEPTH` (default `5`, range `1-10`) — call-graph hops walked per entrypoint during doc generation. Depth 5 covers controller→service→repo→client→external. **Do not exceed 7 without also raising `MAX_TRACE_NODES`/`MAX_TRACE_EDGES`; beyond depth 6 you trace into framework/ORM internals. Enterprise: 5. Large monolith: 6.**
- `GRAPHFLY_DOC_AGENT_MAX_TRACE_NODES` (default `1500`, max `20000`) — node budget for `flows_trace`; trace returns `truncated: true` when hit. **Enterprise: 1500. Large monolith: 5000.** Raise together with `TRACE_DEPTH`.
- `GRAPHFLY_DOC_AGENT_MAX_TRACE_EDGES` (default `3000`, max `100000`) — edge budget for `flows_trace`. **Enterprise: 3000. Large monolith: 10000.**
- `GRAPHFLY_DOC_AGENT_MAX_EVIDENCE_NODES` — cap on evidence links derived from a trace (local deterministic mode)
- `GRAPHFLY_DOC_AGENT_MAX_EVIDENCE_LINKS` — cap on evidence links persisted per doc block
- `GRAPHFLY_DOC_AGENT_MAX_BLOCK_CHARS` — reject oversized doc blocks
- `GRAPHFLY_DOC_AGENT_MAX_EXISTING_BLOCK_CHARS` — truncate existing block content returned to the agent

**Enterprise quick-start tuning set:**
```
GRAPHFLY_DOC_AGENT_TRACE_DEPTH=5
GRAPHFLY_DOC_AGENT_MAX_TRACE_NODES=1500
GRAPHFLY_DOC_AGENT_MAX_TRACE_EDGES=3000
GRAPHFLY_DOC_AGENT_MAX_TURNS=40
```

Manual block regeneration (FR-DOC-07):
- `POST /docs/regenerate` (admin-only) with `{ tenantId, repoId, blockId }` enqueues a single-target doc job and opens a new PR.
- The web UI exposes this as **Regenerate (Admin)** on the Doc Block detail view.

### 2.6E Product Documentation Assistant (API)

Graphfly exposes an in-product **Product Documentation Assistant** that:
- answers questions using the Public Contract Graph + Flow Graphs + docs repo Markdown (no source code bodies by default)
- proposes documentation edits as **drafts** with a preview diff
- applies edits only after explicit confirmation (opens a PR in the docs repo only)

Key endpoints:
- `POST /assistant/query` (or `/api/v1/assistant/query`) — explain + navigate (member+)
- `POST /assistant/docs/draft` (or `/api/v1/assistant/docs/draft`) — draft docs edits (admin+)
- `POST /assistant/docs/confirm` (or `/api/v1/assistant/docs/confirm`) — apply a draft (admin+)
- `GET /assistant/drafts` / `GET /assistant/draft` — inspect drafts (admin+)
- `POST /assistant/threads` / `GET /assistant/threads` — create/list threads (member+)
- `GET /assistant/thread?threadId=<uuid>` — fetch a thread + recent messages (member+)

Threaded chat behavior:
- Pass `threadId` to `POST /assistant/query` to persist the user+assistant messages to that thread.

Draft persistence:
- Drafts are stored in Postgres table `assistant_drafts` (tenant-scoped via RLS) when `DATABASE_URL` is configured.
- Threads/messages are stored in `assistant_threads` and `assistant_messages` (tenant-scoped via RLS).

Assistant guardrails (recommended):
- `GRAPHFLY_ASSISTANT_MAX_TURNS` (default `12` or `14` for draft) — hard cap on loop turns
- `GRAPHFLY_ASSISTANT_MAX_TOOL_CALLS` (default `1500`/`2500`) — hard cap on tool invocations
- `GRAPHFLY_ASSISTANT_MAX_TRACE_NODES` / `GRAPHFLY_ASSISTANT_MAX_TRACE_EDGES` — truncation caps for flow traces in answers
- `GRAPHFLY_ASSISTANT_MAX_SEARCH_RESULTS` — cap on search results per tool call
- `GRAPHFLY_ASSISTANT_MAX_ATTEMPTS` / `GRAPHFLY_ASSISTANT_RETRY_BASE_MS` — bounded retry/backoff for gateway/network failures
- `GRAPHFLY_ASSISTANT_DRAFT_TTL_HOURS` (default `24`) — expiry window for confirmable drafts
- `GRAPHFLY_ASSISTANT_DOCS_LOCK_TTL_MS` — docs-write lock TTL (serializes assistant confirm with doc agent runs)

Cloud sync fence:
- Assistant confirm uses the same docs writer pathway as the doc agent. In production, enable `GRAPHFLY_CLOUD_SYNC_REQUIRED=1` to fail fast if Docs App credentials are missing (stubbed PR).

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

Worker tenancy modes:
- **Single-tenant (strict RLS lane):** set `TENANT_ID=<uuid>` to process jobs for one org only.
- **Multi-tenant SaaS:** omit `TENANT_ID` and run workers with a DB role that can **lease** jobs across tenants (requires `BYPASSRLS` or equivalent for the `jobs` table). Each job is then processed under its own tenant context (RLS via `SET app.tenant_id`).

---

## 4B) Local Manual Testing (Developer Bring-up)

Goal: run the full pipeline locally (API + Web + durable queues + local docs git writes) so onboarding can be QA’d without GitHub Apps.

### 4B.1 Start Postgres (pgvector)
- `docker compose -f docker-compose.local.yml up -d`

### 4B.2 Configure env
1. Copy `.env.local.example` to `.env.local` and fill:
   - `DATABASE_URL`
   - `DOCS_REPO_PATH` (must be a local git repo; separate from the source repo)
2. Export it for your shell (example):
   - `set -a && source .env.local && set +a`

### 4B.3 Apply migrations
- `npm run pg:migrate`

### 4B.4 Run API + Web + workers
- `npm run dev:all:pg`

### 4B.5 Onboard (local source repo path)
In the web UI:
1. Set a docs repo full name (any placeholder like `acme/docs`) and click **Save**.
2. In **Projects**, paste a local git repo path in “Local repo path” and click **Create Local Project**.

Notes:
- The local onboarding path is guarded by `GRAPHFLY_ALLOW_LOCAL_REPO_ROOT=1` and is blocked in production (`repoRoot_not_allowed_in_prod`).
- Docs output writes into `DOCS_REPO_PATH` and must not be inside the source repo (enforced by `docs_repo_path_collision`).

---

## 5) Onboarding Checklist (One-Click UX)

For a new org:
1. User clicks **Connect GitHub** (OAuth) and completes authorization.
2. Admin selects a **docs repo** (must be separate) and clicks **Verify**.
3. User selects a source repo + tracked branch (locked) and clicks **Create Project**.
4. System enqueues index job → graph builds → docs PR opened in docs repo.

Optional (recommended for Enterprise / least-privilege):
- Install **Reader App** (source repos) and **Docs App** (docs repo) to use installation tokens and automatic webhook subscriptions.
- Otherwise, configure push webhooks manually for OAuth mode.

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
- ignored deliveries (repo not configured / non-tracked branch)

Operational notes:
- Graphfly **ignores** GitHub push webhooks for repos that are not configured as a Project.
- When `GRAPHFLY_WEBHOOK_DEDUPE=pg` and `GRAPHFLY_QUEUE_MODE=pg`, Graphfly inserts the webhook delivery record and enqueues the `index.run` job **transactionally** (prevents “deduped but not enqueued” drops).

### 6.4 Realtime progress streaming

Graphfly uses a plain WebSocket endpoint on the API:
- `GET /ws?tenantId=<uuid>&repoId=<uuid>&token=<jwt>`

For multi-process deployments (separate worker processes), configure workers to publish events into the API hub:
- `GRAPHFLY_RT_ENDPOINT` — API base URL (e.g. `http://127.0.0.1:8787`)
- `GRAPHFLY_RT_TOKEN` — shared secret used as `Authorization: Bearer <token>` for `POST /internal/rt`

For horizontally scaled API deployments (multiple API instances), enable Postgres-backed realtime fanout:
- `GRAPHFLY_RT_BACKEND=pg`
- `GRAPHFLY_RT_PG_CHANNEL` (default `graphfly_rt`)

If not configured, realtime still works in single-process mode (API publishes in-process events).
- job enqueue rate vs worker throughput

### 6.4 Indexing health
Monitor:
- index job latency (p50/p95)
- failure rate and retry counts
- graph size growth (nodes/edges/occurrences)

Lane serialization (recommended):
- `GRAPHFLY_INDEX_LOCK_TTL_MS` — index run lock TTL (renewed by heartbeat while indexing)
- `GRAPHFLY_INDEX_LOCK_MAX_WAIT_MS` — max time an index job waits for the per-repo lane lock

### 6.5 Docs PR health
Monitor:
- PR creation failures
- doc block validation failures (must reject code fences, indented code blocks, and code-like multi-line content)

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
- `POST /api/v1/feedback` records a `feedback.submit` event into `audit_log` (best-effort; secrets redacted).

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
- Repo is not configured as a Project (Graphfly ignores unknown repos)
- Push is not on the Project’s tracked branch (Graphfly ignores non-tracked branches)

### 8.3 “Jobs stuck queued”
Likely causes:
- Workers not running
- Wrong `TENANT_ID` for Phase‑1 worker loop
- DB connectivity or RLS misconfiguration

### 8.4 “Jobs stuck active”
Likely causes:
- Worker crashed mid-job (process kill, OOM, deploy restart)
- Worker cannot renew job leases (DB connectivity issues)

Notes / recovery:
- Jobs are leased with a TTL (`lock_expires_at`). When the TTL expires, another worker can re-lease the job.
- Confirm workers are running and can reach the database.
- Inspect `jobs` rows for `status='active'` with `lock_expires_at <= now()` to find stale locks.
