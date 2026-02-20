# Graphfly — Architecture Specification

**Version**: 1.0  
**Last Updated**: February 2026  
**Status**: Draft

---

## Navigation
- [← Index](00_INDEX.md)
- [Next: Requirements →](02_REQUIREMENTS.md)

---

## 1. Architecture Goals

Graphfly is a SaaS workspace that keeps product documentation truthful by grounding every doc block in evidence from a **Code Intelligence Graph**.

**Non‑negotiable properties**
- **Multi-tenant isolation** is enforced at the database layer (PostgreSQL RLS).
- **Docs-repo-only writes**: Graphfly never writes to source repos.
- **No code bodies/snippets by default** in UI, logs, or LLM tool outputs.
- **Deterministic lanes + write locks** for indexing and docs generation to avoid concurrent mutation.
- **Auditable actions**: indexing runs, doc agent runs, assistant writes, and admin actions are recorded.

---

## 2. Phase‑1 System Map (Implemented in This Repo)

Graphfly’s Phase‑1 implementation keeps the operational footprint small:

- **Web UI**: `apps/web/` (single-page workspace)
- **API Gateway**: `apps/api/` (Node.js HTTP server + REST + WebSocket)
- **Workers**: `workers/indexer/`, `workers/graph-agent/`, `workers/doc-agent/`
- **Database**: PostgreSQL (+ pgvector) for graph data, doc blocks, queue, and audit
- **LLM provider (optional in dev/test)**: OpenRouter-compatible Chat Completions API for tool-loop agents

```
Internet
  ├─ GitHub Push Webhooks ───────────────┐
  │                                      │
  └─ Browser (Workspace SPA) ────────────┼──────────┐
                                         │          │
                                  ┌──────▼──────┐   │
                                  │ API Gateway │   │
                                  │  Node HTTP  │   │
                                  │  REST /api  │   │
                                  │  WS   /ws   │   │
                                  └──────┬──────┘   │
                                         │          │
                              ┌──────────▼──────────▼──────────┐
                              │   PostgreSQL (RLS + pgvector)   │
                              │  graph_*  doc_*  assistant_*    │
                              │  jobs  agent_locks  audit_log   │
                              └──────────┬──────────┬──────────┘
                                         │          │
                              ┌──────────▼───┐  ┌───▼───────────┐
                              │ Indexer      │  │ Doc Agent     │
                              │ Worker       │  │ Worker        │
                              │ leases jobs  │  │ leases jobs   │
                              └──────┬───────┘  └──────┬────────┘
                                     │                 │
                        ┌────────────▼────────────┐    │
                        │ Built-in indexer-engine │    │
                        │ (or external NDJSON CLI)│    │
                        └─────────────────────────┘    │
                                                       │
                         ┌─────────────────────────────────────────────────────────────▼──────────────┐
                         │ OpenRouter (LLM provider; required by default in prod)                    │
                         │ /chat/completions → tool calls                                            │
                         └────────────────────────────────────────────────────────────────────────────┘
```

**Notes**
- In local/dev, the API process can drain in-memory queues to exercise end-to-end flows without separate worker processes.
- In production, workers run as separate processes and lease from the Postgres `jobs` table.

---

## 3. Core Responsibilities

### 3.1 API Gateway (`apps/api/`)

Responsibilities:
- Accept GitHub webhooks (`POST /webhooks/github`) and Stripe webhooks (`POST /webhooks/stripe`)
- Serve REST APIs (`/api/v1/*`) for orgs/projects/docs browsing/assistant/billing
- Serve legacy “exercise APIs” endpoints (`/graph/*`, `/flows/*`, `/coverage/*`) used by Phase‑1 UI
- Stream realtime events via WebSocket (`/ws`)
- Enforce:
  - tenant isolation (RLS via `SET app.tenant_id`)
  - role-based access control
  - rate limiting (Phase‑1 in-memory token bucket)

### 3.2 Indexer Worker (`workers/indexer/`)

Responsibilities:
- Serialize indexing per `(tenant, repo)` via `agent_locks` (`lock_name=index_run`)
- Clone the source repo at a specific SHA using the **Reader App** installation token (read-only)
- Run an indexer to produce NDJSON (built-in engine by default; external CLI optional)
- Ingest NDJSON into Postgres (nodes/edges/edge_occurrences/flows/deps/mismatches/diagnostics)
- Compute incremental impact scope and mark doc blocks stale for impacted symbols
- Enqueue:
  - graph enrichment job (`graph.enrich`)
  - doc generation job (`doc.generate`)
- Publish realtime progress events: `index:start`, `index:progress`, `index:complete`

### 3.3 Graph Enrichment Agent (`workers/graph-agent/`)

Responsibilities:
- Post-index enrichment lane via `agent_locks` (`lock_name=graph_enrich`)
- Tool-loop agent that produces graph annotations (flow summaries, metadata) without code bodies
- Uses OpenRouter when `OPENROUTER_API_KEY` is configured; deterministic fallback in dev/test for stability

### 3.4 Documentation Creator Agent (`workers/doc-agent/`)

Responsibilities:
- Docs generation lane via `agent_locks` (`lock_name=docs_generate`)
- Tool-loop agent that:
  - reads public contract data + bounded flow traces
  - reads existing doc blocks + evidence
  - updates stale blocks and creates missing blocks
  - opens PRs in the **configured docs repo only** via the Docs App
- Enforces safety:
  - rejects code fences/code-like blocks
  - redacts secrets
  - budgets on turns/tool calls/output sizes

### 3.5 Documentation Assistant Agent (Chat) (`packages/assistant-agent/` + UI)

Responsibilities:
- Read-only explaining + navigation using:
  - Public Contract Graph (signatures/schemas/constraints/allowables)
  - Flow entrypoints + bounded flow traces
  - Docs repo Markdown (sanitized)
- Draft docs edits via PR:
  - produces a diff preview
  - requires explicit user confirmation
  - writes only to the configured docs repo

---

## 4. Key Data Flows

### 4.1 Project Creation (Repo + Locked Branch + Docs Repo)

1. User connects GitHub OAuth and installs Reader/Docs Apps.
2. User creates a **Project** by selecting:
   - code repo + tracked branch (locked after creation)
   - docs repo (PR target; immutable by default)
3. API creates the `repos` row and enqueues a full index job.
4. Indexer runs → graph materialized → doc job enqueued → initial docs PR opened.

### 4.2 Push Webhook → Incremental Index → Docs Update PR

1. GitHub sends `push` webhook.
2. API verifies signature, deduplicates by delivery ID, and maps `github_repo_id` → `(tenant_id, repo_id)`.
3. API ignores pushes that aren’t for the project’s tracked branch.
4. Index job enqueued with `changedFiles`/`removedFiles`.
5. Indexer ingests updates, records index diagnostics, and marks impacted doc blocks as `stale`.
6. Doc agent targets stale + undocumented items and opens a docs PR.

### 4.3 Assistant Q&A / Draft PR

1. User asks a question in a project thread.
2. API runs assistant tool-loop (OpenRouter if configured; deterministic fallback otherwise).
3. Assistant returns:
   - Markdown answer (sanitized)
   - evidence citations (symbol UIDs, flow keys, docs paths)
4. For “Draft PR”, assistant produces a draft diff and persists it until confirmed.

### 4.4 Manual Docs Edit → Open PR

1. User edits a docs file in the in-app viewer/editor.
2. UI shows preview and unified diff.
3. User clicks **Open PR** (explicit publish).
4. API validates doc policy (no fenced code inside doc-block-managed sections) and opens PR in docs repo.

---

## 5. Storage & Isolation

**PostgreSQL is the system of record**:
- Graph: `graph_nodes`, `graph_edges`, `graph_edge_occurrences`, flow entities/graphs, deps/mismatches, embeddings (pgvector)
- Docs: `doc_blocks`, `doc_evidence`, `pr_runs`
- Assistant: `assistant_threads`, `assistant_messages`, `assistant_drafts`
- Queue: `jobs` (durable leasing) + `agent_locks` (lanes/write locks)
- Audit: `audit_log`
- Webhooks: `webhook_deliveries` (durable dedupe)

**Tenant isolation**
- RLS policies apply to all tenant-scoped tables.
- API/worker DB clients set `SET app.tenant_id = <tenant>` per request/job.

---

## 6. Production Deployment Notes (What “Prod-Ready” Means)

Minimum external dependencies:
- PostgreSQL (required)
- OpenRouter API key (required by default for agentic runs in `GRAPHFLY_MODE=prod`)

Recommended topology:
- 1× API service (stateless)
- N× worker processes (index/doc/graph) leasing from Postgres `jobs`
- 1× Web UI (static assets via CDN)

Operational requirements:
- Workers use bounded retries and renew queue locks (heartbeats) to prevent stuck `active` jobs.
- Unknown/unconfigured webhook repos must never index into a default tenant in prod.
- Runbooks cover:
  - queue backlogs and dead jobs
  - GitHub App auth failures
  - LLM provider failures
  - RLS misconfiguration detection

---

## Navigation
- [← Index](00_INDEX.md)
- [Next: Requirements →](02_REQUIREMENTS.md)
