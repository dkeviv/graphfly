# Graphfly — Agents & Services

This document defines the “agents” (long-running workers and automated actors) in Graphfly and how they collaborate to deliver living, evidence-backed documentation.

## Specification References (Source of Truth)

Implementation must follow these documents to avoid drift:
- `docs/02_REQUIREMENTS.md` (functional + non-functional requirements; FR-* IDs)
- `docs/03_TECHNICAL_SPEC.md` (DB schema, APIs, agent loop, indexing protocol, security constraints)
- `docs/04_UX_SPEC.md` (user flows, UX constraints like “no code bodies by default”)
- `docs/05_SECURITY.md` (threat model, support-safe mode, secret handling, permission model)
- `docs/06_OPERATIONS.md` (SLOs, runbooks, scaling/backup expectations)

**Drift prevention rule:** every feature PR must include (1) a “Spec anchor” link to the relevant sections above, (2) an acceptance checklist mapped to FR-* IDs, and (3) test evidence (unit/integration/e2e) proving the behavior matches the spec.

**Spec drift escalation rule (required):** changes that diverge from the PRD/Requirements or Technical Spec must be explicitly called out in the PR body and tracked in `spec-map.md`.

## Code Hygiene Standards (Non-Negotiable)

To keep Graphfly enterprise-grade and maintainable as it scales:
- **Modular architecture:** avoid monoliths. Use small packages/modules with explicit, stable interfaces. Prefer composition over “god” services.
- **Boundaries:** keep API, workers, and shared libraries separated (`apps/`, `workers/`, `packages/`). Shared logic must live in `packages/`.
- **Testing discipline:** every module exports testable units; avoid hidden side effects and implicit global state.
- **Frontend styling:** avoid inline styling. Use CSS (or a CSS system like CSS Modules/Tailwind if adopted) and keep styling concerns out of logic components.
- **Security-by-default:** no code bodies/snippets in doc blocks and no default code fetching in UI/support tools (see spec anchors above).

## OpenClaw Leverage (Graph Builder + Agent Runtime)

Graphfly explicitly leverages the strongest, battle-tested operational patterns from the OpenClaw project to make the **graph builder** and **agent runtimes** enterprise-grade:
- **Deterministic lanes / serialization:** indexing and doc-generation run in controlled “lanes” to avoid concurrent mutation and to keep artifacts reproducible.
- **Session / artifact write locks:** anything persisted (transcripts, artifacts, runs) uses a write-lock model with timeouts + stale-lock recovery.
- **Tool schema enforcement:** every tool boundary validates inputs; outputs are normalized into stable result shapes for persistence and audits.
- **Tool-result persistence guard:** redact secrets/tokens and prevent source code bodies/snippets from being persisted by default.
- **Hooks for policy injection:** support pre/post hooks for indexing ingest and agent runs so enterprise deployments can inject governance without forking.
- **Retry + backoff policy:** classify failures and apply bounded retries/backoff (auth/config vs timeout vs tool_error).
- **Context window guard + compaction:** long-lived support sessions compact deterministically (no secrets, no code bodies by default).

Implementation must preserve these properties as the Code Intelligence Graph builder expands to more languages and deeper resolution.

## Project Plan Tracking (Auto-Maintained)

Graphfly must maintain a single canonical tracking table in `project_plan.md`.

**Update rule (required):** after each feature implementation + tests:
- Update `project_plan.md` row(s) for that feature.
- Mark `Status=DONE` only when the feature is implemented end-to-end **and** the listed test gate(s) pass.
- Keep rows aligned to spec anchors + FR-* requirement IDs (no “extra” scope without a spec update).
- Keep `spec-map.md` in sync by regenerating it: `npm run spec:map`.

## Admin Guide Maintenance (Required)

Graphfly must keep `docs/07_ADMIN_GUIDE.md` accurate and up-to-date.

**Update rule (required):** after each feature that impacts admin operations (deploy/config/auth/billing/webhooks/indexing/docs workers/queues/observability):
- Update `docs/07_ADMIN_GUIDE.md` in the same commit as the feature change (or explicitly note why no update is needed).
- Ensure any new env vars, migration steps, runbooks, and operational checks are documented.

## Git Workflow (Auto-Applied)

After each spec-anchored feature slice is implemented and the test gate passes:
- Create/keep work on a branch prefixed `codex/` (no direct commits to main).
- Commit changes with a message that includes the feature name and/or FR-* IDs.
- Push the branch to the remote and open a PR with:
  - the spec anchor(s) referenced
  - acceptance checklist mapped to FR-* IDs
  - test evidence (commands + results)

**Spec guardrail (required):**
- Run `npm run check:spec` before pushing. It enforces “code changes must update specs/admin guide/UX spec” to prevent drift.
- Use `PR_CHECKLIST.md` for pre-merge checks (includes “Spec alignment check completed”).

---

## 1. API Gateway (Node.js)

**Role**
- Receives GitHub webhooks, authenticates users, serves REST APIs, and streams real-time events via WebSocket.

**Key responsibilities**
- Webhook verification + deduplication (GitHub delivery ID).
- Tenant injection for all DB access (RLS safety).
- Rate limiting + entitlements enforcement.
- Enqueue background jobs (indexing, doc generation).
- WebSocket event fan-out (index progress, agent activity, run completion).

**Spec anchors**
- Requirements: `docs/02_REQUIREMENTS.md`
- API + RLS: `docs/03_TECHNICAL_SPEC.md`
- Rate limiting + entitlements: `docs/02_REQUIREMENTS.md` + `docs/05_SECURITY.md`

---

## 2. Indexer Worker (BullMQ Consumer)

**Role**
- Runs indexing jobs and persists the Code Intelligence Graph into PostgreSQL.

**Input**
- `index.jobs`: `{ tenantId, repoId, readerInstallId, fullName, sha, changedFiles[], removedFiles[] }`

**Process**
1. Clone `fullName@sha` using the **GitHub Reader App** installation token (read-only).
2. Spawn `yantra-indexer` (Rust CLI) with repo path + optional file list.
3. Stream NDJSON records from stdout (nodes/edges/progress).
4. Batch upsert `graph_nodes` + `graph_edges` with deduplication constraints.
5. Persist `graph_edge_occurrences` (reference sites) and dependency intelligence (manifests + observed deps + mismatch records) without storing code bodies.
6. Emit progress events to WebSocket.

**Output**
- Postgres updated graph state.
- WebSocket: `index:progress`, `index:complete`, `index:error`.

**Failure modes**
- Clone/auth failure (Reader App install scope, transient GitHub errors).
- Parser failures on specific files (tree-sitter grammar edge cases).
- DB upsert failures (schema drift, constraint mismatch).

**Spec anchors**
- NDJSON protocol + edge occurrences: `docs/01_ARCHITECTURE.md`
- Graph schema (CIG/PCG, HNSW, deps/mismatches): `docs/03_TECHNICAL_SPEC.md`
- Incremental correctness contract: `docs/02_REQUIREMENTS.md`

**Test responsibilities**
- Unit: NDJSON parsing, upsert batching, dedupe constraints.
- Integration: index a fixture repo; assert node identity stability (`symbol_uid`) and edge occurrence counts.
- E2E: push webhook → index job → graph query returns expected nodes/edges/occurrences/deps.

---

## 3. Documentation Agent Worker (BullMQ Consumer)

**Role**
- Maintains “doc blocks” (atomic Markdown sections) and opens PRs in the docs repo with surgical updates.

**Input**
- `doc.jobs`: `{ tenantId, repoId, prRunId, triggerSha, changedFiles[] }` (or single-block jobs)

**Core algorithm**
1. Identify affected nodes (dependents + downstream context).
2. Find doc blocks whose evidence references affected nodes.
3. For each stale block:
   - Fetch current block + evidence.
   - Fetch Public Contract Graph data for evidence nodes (signatures, schemas, constraints, allowable values), plus flow graphs and edge-occurrence evidence (file+line ranges).
   - Update the block content while preserving structure and keeping it concise.
4. Detect new undocumented nodes (policy-driven scope).
5. Open a PR in the **docs repo** only.

**PR write credentials**
- Uses the **GitHub Docs App** installation token (write access scoped to the docs repo only).

**Output**
- Updated `doc_blocks` + `doc_evidence`.
- A docs PR in the configured docs repo.
- WebSocket: `agent:start`, `agent:tool_call`, `agent:tool_result`, `agent:complete`, `agent:error`.

**Safety rules**
- Never write to source code repos.
- Every doc block must have evidence references (file + line ranges + commit SHA).
- Doc blocks must be contract-first and must not embed or display source code bodies/snippets.
- Support-safe mode must never fetch or expose source code bodies/snippets.
- Do not change doc blocks for purely cosmetic code changes.

**Spec anchors**
- Doc blocks + evidence model: `docs/02_REQUIREMENTS.md` + `docs/03_TECHNICAL_SPEC.md`
- “No code bodies by default” UX + Evidence panel: `docs/04_UX_SPEC.md`
- Support-safe mode + data egress rules: `docs/05_SECURITY.md`

**Test responsibilities**
- Unit: impacted-node selection logic; doc block diffing; evidence link generation.
- Integration: doc generation against a fixture graph (contracts/constraints/flows) with deterministic output.
- E2E: push webhook → index → doc job → PR opened in docs repo only; assert doc blocks contain no code bodies and evidence links resolve.

---

## 4. GitHub Service (Reader + Docs Apps)

**Role**
- A wrapper that encapsulates GitHub App authentication and operations.

**Apps**
- **Reader App**: read-only permissions for cloning/indexing; emits push webhooks.
- **Docs App**: write permissions on the docs repo only; used to create branches/commits/PRs.

**Primary operations**
- Resolve installation access + repo listing (Reader).
- Clone repo at a specific SHA without leaking tokens (Reader).
- Create/update branches and open PRs in docs repo (Docs).

**Spec anchors**
- Permission model + “never write to source repos”: `docs/02_REQUIREMENTS.md` + `docs/05_SECURITY.md`

---

## 5. Billing Agent (Stripe Webhook Processor)

**Role**
- Keeps organization billing state and entitlements in sync with Stripe.

**Input**
- `POST /webhooks/stripe`: Stripe events (verified + deduplicated by event ID).

**Output**
- Updates billing snapshot (`org_billing`) and organization plan state.
- Updates usage windows/counters as needed for enforcement and UX.

**Spec anchors**
- Billing requirements + idempotent webhooks: `docs/02_REQUIREMENTS.md` + `docs/03_TECHNICAL_SPEC.md`

---

## 6. How They Work Together (High Level)

1. Push to default branch → GitHub **Reader App** webhook → API verifies + enqueues `index.jobs`.
2. Indexer Worker builds/updates graph → emits progress → persists nodes/edges.
3. On completion → enqueue `doc.jobs`.
4. Doc Agent updates/creates doc blocks → opens PR via **Docs App** in docs repo only.
5. Stripe webhooks update plan/entitlements → API enforces limits on future runs.
