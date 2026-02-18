# Graphfly — Project Plan (Spec-Aligned Tracking)

**Canonical task list:** rows prefixed `P0-*`, `P1-*`, `P2-*` reflect the current execution order for the V0-inspired SaaS UX + backend wiring.  
**Status flow:** `PENDING` → `IN_PROGRESS` → `DONE` (mark `DONE` only when the Test Gate passes).

| Area | Spec Anchor | Requirement IDs | Status | Test Gate |
|---|---|---|---|---|
| Repo scaffolding (apps/workers/packages) | `plan.md` + `agents.md` | N/A | DONE | `npm test` |
| Encrypted secrets store (org-scoped) | `docs/05_SECURITY.md` | NFR-SEC-* | DONE | `npm test` |
| Orgs + members + RBAC (JWT mode) | `docs/02_REQUIREMENTS.md` + `docs/05_SECURITY.md` | FR-TM-01, FR-TM-02 | DONE | `npm test` |
| P0-01 Projects model (repo + locked code branch + docs repo) | `docs/02_REQUIREMENTS.md` + `docs/03_TECHNICAL_SPEC.md` + `docs/04_UX_SPEC.md` | FR-PROJ-01, FR-GH-03 | DONE | `npm test` + manual QA (create project → index → docs PR) |
| P0-02 Webhook/index gating by tracked branch | `docs/02_REQUIREMENTS.md` + `docs/04_UX_SPEC.md` | FR-CIG-02, FR-GH-04 | DONE | `npm test` (`test/tracked-branch.test.js`) |
| P0-03 Workspace shell (V0-inspired 3-column layout) | `docs/04_UX_SPEC.md` | FR-PROJ-01 | DONE | `npm test` (web shell + CSS guardrails) |
| GitHub OAuth connect + repo picker | `docs/02_REQUIREMENTS.md` | FR-GH-02 | DONE | `npm test` (OAuth endpoints + token storage; onboarding repo list + project creation triggers index) |
| Full index on repo connection (project create) | `docs/02_REQUIREMENTS.md` | FR-CIG-01 | DONE | `npm test` (`test/initial-index-helper.test.js`) |
| GitHub Reader App install + webhook indexing | `docs/02_REQUIREMENTS.md` | FR-GH-01, FR-GH-02, FR-GH-04, FR-CIG-02 | DONE | `npm test` (webhook verify+dedupe; indexing enqueued; removed files prune graph state) |
| GitHub Docs App install + docs-repo-only writes | `docs/02_REQUIREMENTS.md` | FR-GH-01B, FR-GH-05, FR-DOC-06 | DONE | `npm test` (docs repo verification + docs writer guard + PR creation stubbed when creds missing) |
| P0-07 Docs repo creation (optional, onboarding) | `docs/02_REQUIREMENTS.md` + `docs/04_UX_SPEC.md` | FR-GH-06 | DONE | `npm test` + manual QA (onboarding → create docs repo → verify) |
| CIG core (identity/store/blast radius) | `docs/03_TECHNICAL_SPEC.md` | FR-CIG-06, FR-GX-03 | DONE | `npm test` (blast radius traversal + impacted symbols) |
| NDJSON ingestion (node/edge/edge_occurrence + forward-compatible types) | `docs/01_ARCHITECTURE.md` | FR-CIG-06 | DONE | `npm test` |
| Public Contract Graph enforcement (no code bodies) | `docs/02_REQUIREMENTS.md` + `docs/05_SECURITY.md` | FR-CIG-07, FR-CIG-11 | DONE | `npm test` (`test/no-code-persistence.test.js`, `test/doc-blocks-validate.test.js`) |
| AST engines (Composite: TS compiler + Tree-sitter multi-language) | `docs/03_TECHNICAL_SPEC.md` + `docs/07_ADMIN_GUIDE.md` | FR-CIG-03 | DONE | `npm test` |
| Cross-file symbol resolution | `docs/02_REQUIREMENTS.md` + `docs/03_TECHNICAL_SPEC.md` | FR-CIG-04 | DONE | `npm test` (`test/indexer-builtin.test.js`) |
| Call graph + edge occurrences | `docs/02_REQUIREMENTS.md` + `docs/03_TECHNICAL_SPEC.md` | FR-CIG-04 | DONE | `npm test` (`test/indexer-builtin.test.js`) |
| Constraints/allowables extraction (validators) | `docs/02_REQUIREMENTS.md` + `docs/03_TECHNICAL_SPEC.md` | FR-CIG-08 | DONE | `npm test` (`test/indexer-builtin.test.js`) |
| Dev harness: mock indexer PCG enrichment (functions/classes + allowables/constraints) | `docs/03_TECHNICAL_SPEC.md` | N/A | DONE | `npm test` |
| Edge occurrence handling (dedupe + occurrences) | `docs/03_TECHNICAL_SPEC.md` | FR-CIG-04 | DONE | `npm test` (`test/cig-ingest.test.js`, `test/indexer-builtin.test.js`) |
| Edge occurrence storage (dedupe + occurrences) | `docs/03_TECHNICAL_SPEC.md` | N/A | DONE | `npm test` |
| Flow entities ingestion + APIs | `docs/03_TECHNICAL_SPEC.md` | FR-CIG-09 | DONE | `npm test` (entrypoints + trace + materialized flow_graph persisted) |
| Dependency & manifest intelligence (declared/observed/mismatch) | `docs/03_TECHNICAL_SPEC.md` | FR-CIG-10 | DONE | `npm test` (built-in indexer emits declared+observed deps + mismatches: declared_but_unused / used_but_undeclared / version_conflict) |
| Postgres schema + migrations + RLS | `docs/03_TECHNICAL_SPEC.md` | FR-CIG-06 | DONE | `npm test` (includes FORCE RLS; optional live RLS test when `DATABASE_URL` set) |
| Billing schema (org_billing, stripe_events, usage_counters) + RLS | `docs/02_REQUIREMENTS.md` + `docs/03_TECHNICAL_SPEC.md` | FR-BL-03, FR-BL-04 | DONE | `npm test` |
| Billing usage transparency endpoint | `docs/02_REQUIREMENTS.md` + `docs/03_TECHNICAL_SPEC.md` | FR-BL-05 | DONE | `npm test` |
| pgvector embeddings + HNSW index | `docs/03_TECHNICAL_SPEC.md` | FR-CIG-05 | DONE | `npm test` (schema + PgGraphStore semanticSearch ORDER BY embedding <=>) |
| Semantic search API | `docs/02_REQUIREMENTS.md` | FR-GX-04 | DONE | `npm test` (text + semantic; pg-native hook when available) |
| Impacted nodes (“blast radius”) correctness | `docs/02_REQUIREMENTS.md` | FR-GX-03 | DONE | `npm test` |
| Incremental correctness diagnostics | `docs/02_REQUIREMENTS.md` | FR-CIG-12 | DONE | `npm test` |
| GitHub Reader App integration (webhooks + clone @sha) | `docs/02_REQUIREMENTS.md` | FR-CIG-02 | DONE | `npm test` (webhook → index → docs pipeline wired; ephemeral cloneAtSha path; supports `GITHUB_READER_TOKEN` or GitHub App installation token (`GITHUB_APP_ID` + private key + install id)) |
| Doc agent: initial + surgical docs PRs | `docs/02_REQUIREMENTS.md` | FR-DOC-01, FR-DOC-04, FR-DOC-05, FR-DOC-06, FR-DOC-07 | DONE | `npm test` (docs-generate lock; tool/turn budgets; gateway retry; trace/evidence caps; docs-repo-only guard; `flows/` + `contracts/` layout; `test/doc-agent-guardrails.test.js`) |
| Doc blocks + evidence model (contract-first; no code bodies) | `docs/02_REQUIREMENTS.md` | FR-DOC-02, FR-DOC-03 | DONE | `npm test` |
| P0-04 Docs repository browser (docs repo file tree) | `docs/02_REQUIREMENTS.md` + `docs/04_UX_SPEC.md` | FR-DOC-08 | DONE | `npm test` + manual QA (browse tree → open file → evidence badge) |
| P0-05 Manual documentation editing (viewer/editor + Open PR) | `docs/02_REQUIREMENTS.md` + `docs/04_UX_SPEC.md` | FR-DOC-09 | DONE | `npm test` + manual QA (new file → edit → diff → Open PR) |
| P0-06 Chats + assistant threads (persistent, per project) | `docs/02_REQUIREMENTS.md` + `docs/04_UX_SPEC.md` | FR-AST-01 | DONE | `npm test` + manual QA (new thread → ask → citations) |
| P0-06B Assistant draft/edit docs via PR (UI: preview diff + confirm) | `docs/02_REQUIREMENTS.md` + `docs/04_UX_SPEC.md` | FR-AST-02 | DONE | `npm test` + manual QA (Draft PR → preview diff → confirm) |
| P0-08 Flows canvas (diagram + trace + contract evidence; open flow doc) | `docs/04_UX_SPEC.md` | FR-CIG-09, FR-CIG-11 | DONE | `npm test` + manual QA (select entrypoint → trace → inspect contract) |
| P0-09 Settings surface (billing usage + team invites) | `docs/02_REQUIREMENTS.md` + `docs/04_UX_SPEC.md` | FR-BL-05, FR-TM-03 | DONE | `npm test` + manual QA (view usage → create invite) |
| PgQueue stale-lock recovery + heartbeat | `docs/03_TECHNICAL_SPEC.md` + `docs/06_OPERATIONS.md` | N/A | DONE | `npm test` (`test/pg-queue-stale-lock.test.js`) |
| OpenClaw agent runtime integration (tool loop) | `docs/03_TECHNICAL_SPEC.md` | N/A | DONE | `npm test` |
| Graph enrichment agent (flow_summary annotations) | `docs/03_TECHNICAL_SPEC.md` | FR-CIG-09, FR-CIG-11 | DONE | `npm test` (graph worker enqueued after index; annotations stored separately from canonical graph) |
| Graph builder agent hardening (locks/retries/compaction/redaction) | `docs/03_TECHNICAL_SPEC.md` + `docs/07_ADMIN_GUIDE.md` | FR-CIG-11 | DONE | `npm test` (agent locks; HTTP/tool retry budgets; trace compaction; tool output redaction) |
| Support-safe mode enforcement | `docs/05_SECURITY.md` | FR-CIG-11 | DONE | `npm test` |
| Rate limiting + entitlements | `docs/02_REQUIREMENTS.md` | FR-* | DONE | `npm test` |
| Stripe billing + webhook processor | `docs/02_REQUIREMENTS.md` | FR-BL-* | DONE | `npm test` (webhook verify+dedupe; pg-backed stripe_events/org_billing when `DATABASE_URL` set; billing summary reads org_billing; checkout/portal support org stripe customer id + env price ids) |
| Phase-1 web app (hash routes; API exerciser) | `docs/04_UX_SPEC.md` | N/A | DONE | `npm test` (`test/web-hygiene.test.js`) |
| P1-01 Graph canvas (interactive viewer) | `docs/02_REQUIREMENTS.md` + `docs/04_UX_SPEC.md` | FR-GX-01, FR-GX-02, FR-GX-03, FR-GX-04, FR-GX-05 | DONE | `npm test` + manual QA (search → click result → relationships + doc links + trace) |
| P1-02 Git panel (PR runs + preview + diff) | `docs/04_UX_SPEC.md` | FR-DOC-06 | DONE | `npm test` + manual QA (list runs → select → preview docs + diff) |
| P2-01 LLM-agentic by default in prod (OpenClaw required) | `docs/06_OPERATIONS.md` + `docs/05_SECURITY.md` | NFR-OPS-* | DONE | `npm test` |
| P2-02 PG queue hardening (ops/runbook/admin tooling) | `docs/06_OPERATIONS.md` + `docs/07_ADMIN_GUIDE.md` | NFR-OPS-* | DONE | `npm test` + manual QA (jobs list includes graph; retry/cancel) |
| P2-03 Multi-instance realtime hub (replace in-memory) | `docs/02_REQUIREMENTS.md` + `docs/06_OPERATIONS.md` | FR-RT-01, FR-RT-02 | DONE | `npm test` |
| P2-04 Index lane serialization per (tenant, repo) | `docs/03_TECHNICAL_SPEC.md` | NFR-OPS-* | DONE | `npm test` |
| Operations (SLOs/monitoring/runbooks) | `docs/06_OPERATIONS.md` | NFR-* | DONE | `npm test` |
| Spec drift guardrails (spec-map + checklist + runtime fences) | `agents.md` + `PR_CHECKLIST.md` | N/A | DONE | `npm run check:spec` |

## Production Readiness Checklist (Enterprise)

| Area | Item | Acceptance | Status | Gate |
|---|---|---|---|---|
| Auth | Multi-user auth + org roles | API supports JWT sessions; `org_members` roles enforced; membership management endpoints; admin actions audited to `audit_log` | DONE | `npm test` + integration |
| GitHub | Prefer GitHub App installs (Reader + Docs) | Installation callbacks persist IDs; clones + PRs use installation tokens (no PATs) | DONE | `npm test` |
| GitHub | Webhook routing per org/project | Webhook maps repo→tenant/repo deterministically (by `github_repo_id`) and ignores non-tracked branches; durable delivery dedupe via `webhook_deliveries` | PARTIAL | `npm test` + integration |
| Indexing | Production indexer (no mock) | Built-in indexer-engine emits NDJSON (streamed) and ingests it; optional external NDJSON indexer supported via `GRAPHFLY_INDEXER_CMD`; mock remains dev-only | DONE | `npm test` + integration |
| Indexing | AST engine always available | Default `GRAPHFLY_AST_ENGINE=composite` in prod (TS compiler for JS/TS/TSX + Tree-sitter for others); missing AST modules fail fast in prod | DONE | `npm test` |
| Jobs | Durable queues + workers | Postgres-backed durable jobs; retries/backoff; worker runners; job status endpoints; workers support single-tenant (`TENANT_ID`) and multi-tenant (`leaseAny`) | DONE | `npm test` + integration |
| Storage | Required Postgres in prod | `GRAPHFLY_MODE=prod` enforces Postgres + pg queue + jwt auth + secret key | DONE | `npm test` |
| Docs | Docs repo selection UI + verification | Pick docs repo from GitHub per project; verify via server call using docs auth | PARTIAL | `npm test` + integration |
| Docs | Doc agent guardrails | Serialize doc runs per repo; enforce budgets; retry transient gateway failures; reject code-like doc blocks | DONE | `npm test` |
| Billing | Stripe customer lifecycle | Auto-create + persist Stripe customer when missing; checkout/portal require stored customer | DONE | `npm test` |
| Security | Secrets management hardening | Keyring-based secret key rotation + rewrap endpoint; no tokens in logs; RLS verified in CI | DONE | `npm test` + CI |
| Observability | Metrics + tracing | Structured JSON logs (API) + request IDs + Prometheus `/metrics` (token protected) + Admin dashboard | DONE | `npm test` + integration |
| UX | One-click onboarding | Sign in → create project (code repo + locked branch + docs repo) → auto index + docs PR | PARTIAL | manual QA |

## Gaps (Tracked, Phase-1 Blockers)

| Area | Spec Anchor | Requirement IDs | Status | Test Gate |
|---|---|---|---|---|
| Coverage dashboard (CIG completeness) | `docs/02_REQUIREMENTS.md` | FR-CV-01, FR-CV-02, FR-CV-03 | DONE | `npm test` |
| Team management (member invites) | `docs/02_REQUIREMENTS.md` | FR-TM-03 | DONE | `npm test` |
| Real-time progress streaming | `docs/02_REQUIREMENTS.md` + `docs/04_UX_SPEC.md` | FR-RT-01, FR-RT-02 | DONE | `npm test` |

## Code Intelligence Graph (CIG) Quality Checklist (Blockers)

| Item | Spec Anchor | Requirement IDs | Status | Evidence / Gate |
|---|---|---|---|---|
| Removed files prune graph state | `docs/02_REQUIREMENTS.md` | FR-GH-04 | DONE | `npm test` (`test/removed-files-prune.test.js`) |
| Cross-file/module resolution (import→file + import→symbol) | `docs/02_REQUIREMENTS.md` | FR-CIG-04 | DONE | `npm test` (`test/indexer-builtin.test.js`) |
| Call graph + per-callsite edge occurrences | `docs/02_REQUIREMENTS.md` + `docs/03_TECHNICAL_SPEC.md` | FR-CIG-04 | DONE | `npm test` (`test/indexer-builtin.test.js`) |
| Incremental indexing correctness (importer closure + impacted symbols + diagnostics) | `docs/02_REQUIREMENTS.md` | FR-CIG-02, FR-CIG-12 | DONE | `npm test` (`test/index-diagnostics.test.js`, `test/impact.test.js`) |
| Manifest/lockfile coverage expansion (npm, Go, Rust, Python, Ruby, Java, C#/.NET, PHP; incl. common lockfiles) | `docs/02_REQUIREMENTS.md` | FR-CIG-10 | DONE | `npm test` |
| Framework entrypoints + flow fidelity (HTTP + queue + cron across common stacks) | `docs/02_REQUIREMENTS.md` | FR-CIG-09 | DONE | `npm test` |
| Embeddings “real path” (provider-backed ingest + query + backfill tooling; HNSW) | `docs/03_TECHNICAL_SPEC.md` + `docs/07_ADMIN_GUIDE.md` | FR-CIG-05 | DONE | `npm test` |
| Performance + robustness hardening (file size caps, batch queries, isolation diagnostics) | `docs/06_OPERATIONS.md` + `docs/07_ADMIN_GUIDE.md` | NFR-* | DONE | `npm test` |
| Strict “no code bodies” enforcement (sanitization + doc block validation) | `docs/02_REQUIREMENTS.md` + `docs/05_SECURITY.md` | FR-CIG-07, FR-CIG-11 | DONE | `npm test` (`test/no-code-persistence.test.js`) |
