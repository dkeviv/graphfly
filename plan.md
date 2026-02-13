# Graphfly — Delivery Plan

This plan turns the February 2026 specifications into an executable implementation roadmap.

## Specs-as-Code Discipline (Prevent Drift)

The following documents are the source of truth and must be referenced in every implementation PR:
- `docs/02_REQUIREMENTS.md` (FR-* requirements)
- `docs/03_TECHNICAL_SPEC.md` (schema, APIs, agent loop, indexing protocol)
- `docs/04_UX_SPEC.md` (user flows + UX constraints; especially “no code bodies/snippets by default”)
- `docs/05_SECURITY.md` (support-safe mode, secret handling, app permissions)
- `docs/06_OPERATIONS.md` (SLOs, runbooks, reliability expectations)

**Per-feature implementation loop (required):**
1. Pick a single feature slice and link its **spec anchor** (one or more sections in the docs above).
2. Define acceptance criteria mapped to FR-* IDs.
3. Implement end-to-end (API + worker + DB + UI, as applicable).
4. Add/extend tests (unit + integration + e2e) and run them in CI.
5. Re-check the spec anchor and update code/tests until the behavior matches. If a spec change is needed, update the spec docs in the same PR.

---

## Phase 1: Foundation (Weeks 1–3)

**Goal:** Persist the Code Intelligence Graph in PostgreSQL and query it via API.

**Deliverables**
- PostgreSQL schema (RLS-enabled tenant isolation) + migrations (including HNSW for embeddings).
- Redis + BullMQ setup with `index.jobs` queue.
- API skeleton: auth (Clerk), tenant injection, basic REST conventions.
- Extract `yantra-indexer` Rust CLI (NDJSON streaming).
- Indexer Worker: clone → spawn indexer → batch upsert nodes/edges/edge-occurrences + dependency intelligence.
- WebSocket: `index:*` events.
- Minimal graph read APIs (nodes/edges/search).

**Exit criteria**
- Index a test repo end-to-end and query nodes/edges from the API.

**Spec anchors**
- Graph schema + HNSW + occurrences + deps: `docs/03_TECHNICAL_SPEC.md`
- Indexer protocol: `docs/01_ARCHITECTURE.md`

**Test gate**
- Integration test indexes a fixture repo and asserts: stable `symbol_uid` identity, edge dedupe, edge occurrence counts, dependency mismatch records, and semantic search via HNSW index.

---

## Phase 2: GitHub Integration (Weeks 4–5)

**Goal:** Fully automated indexing triggered by code changes without any ability to write to source repos.

**Deliverables**
- Two GitHub Apps:
  - **Reader App**: read-only on source repos + push webhooks.
  - **Docs App**: write access to docs repo only.
- Onboarding endpoints + callbacks:
  - Reader install detection
  - Docs repo selection/creation
  - Docs App install detection
- GitHub webhook receiver:
  - signature verification
  - replay deduplication
  - default branch filtering
  - enqueue incremental indexing jobs
- Secure cloning:
  - no tokens embedded in URLs or logged

**Exit criteria**
- Push to default branch triggers incremental index automatically and streams progress.

**Spec anchors**
- Apps + docs-repo-only writes: `docs/02_REQUIREMENTS.md` + `docs/05_SECURITY.md`
- Incremental correctness contract: `docs/02_REQUIREMENTS.md` + `docs/03_TECHNICAL_SPEC.md`

**Test gate**
- E2E test: push webhook → incremental index job → graph updated; verify no write permissions/paths exist for source repos.

---

## Phase 3: Documentation Agent (Weeks 6–8)

**Goal:** Surgical documentation updates with evidence, delivered as PRs to the docs repo.

**Deliverables**
- `TurnOutcome`-style doc agent loop with tool-driven actions.
- Tools backed by PostgreSQL:
  - graph query/blast radius/flow/semantic search
  - doc block get/update/create + evidence management
  - public contract retrieval (contracts/constraints/allowable values) + edge-occurrence evidence
  - GitHub PR creation (Docs App only)
- PR run tracking (`pr_runs`) and streaming agent activity (`agent:*` events).
- Correct impacted-node semantics (dependents + downstream context).

**Exit criteria**
- Push triggers doc PR in the docs repo within target latency for small changes.

**Spec anchors**
- Doc blocks are contract-first (no code bodies/snippets): `docs/02_REQUIREMENTS.md` + `docs/03_TECHNICAL_SPEC.md`
- UX evidence panel privacy: `docs/04_UX_SPEC.md`
- Support-safe mode + LLM egress: `docs/05_SECURITY.md`

**Test gate**
- E2E test: push webhook → index → doc run → PR to docs repo; assert generated docs contain contracts/constraints/flows and contain no code bodies/snippets.

---

## Phase 4: Frontend (Weeks 9–11)

**Goal:** World-class UX with fast onboarding and enterprise-scale graph exploration.

**Deliverables**
- Onboarding flow (Reader install → repo selection → docs repo + Docs app → indexing → first PR).
- Dashboard: stats, recent PRs, stale blocks, top undocumented entry points.
- Graph Explorer:
  - Focus mode by default
  - lazy-loaded neighborhoods/flows
  - search (text + semantic)
  - blast radius and flow tracing
- Docs Browser + Doc Block Detail:
  - evidence panel
  - regenerate (agent PR)
  - edit (manual PR)
  - update evidence
- PR Timeline + Coverage dashboard.

**Exit criteria**
- New user reaches first docs PR in <5 minutes and can explore/verify evidence quickly.

**Spec anchors**
- User flows: `docs/04_UX_SPEC.md`
- Graph explorer constraints (focus mode, lazy loading, semantic search): `docs/02_REQUIREMENTS.md` + `docs/04_UX_SPEC.md`

**Test gate**
- UI e2e: onboarding (reader + docs repo setup) → first index → first docs PR → graph focus navigation + evidence panel (no code bodies by default).

---

## Phase 5: Enterprise Hardening (Weeks 12–14)

**Goal:** Security, scale, reliability, and billing readiness for enterprise customers.

**Deliverables**
- RLS penetration tests (no cross-tenant access).
- Queue resilience: retries, DLQ, operational runbooks.
- Large repo handling: chunked indexing + backpressure controls.
- Rate limiting + entitlement enforcement.
- Stripe billing:
  - Checkout + Customer Portal
  - Stripe webhook processing (signature verification + idempotency)
  - usage tracking + transparent limits UI
- Monitoring and alerting dashboards.

**Exit criteria**
- Meets SLO targets for small/medium repos; safe degradation for large repos; clear operational playbooks.

**Spec anchors**
- Security controls + support-safe: `docs/05_SECURITY.md`
- Reliability + operations: `docs/06_OPERATIONS.md`

---

## Key Risks / Watch Items

- Large graph visualization performance: default to focused views; avoid full-graph rendering.
- Parser edge cases across languages: build “quarantine” and exclusion mechanisms for pathological files.
- Security: ensure no write paths exist for source repos (both permissions and code-level enforcement).
- Secret handling: ensure tokens never appear in logs/URLs/process args.
