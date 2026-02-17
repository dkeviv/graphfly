# Graphfly — Project Plan (Spec-Aligned Tracking)

| Area | Spec Anchor | Requirement IDs | Status | Test Gate |
|---|---|---|---|---|
| Repo scaffolding (apps/workers/packages) | `plan.md` + `agents.md` | N/A | DONE | `npm test` |
| Encrypted secrets store (org-scoped) | `docs/05_SECURITY.md` | NFR-SEC-* | DONE | `npm test` |
| Orgs + members + RBAC (JWT mode) | `docs/02_REQUIREMENTS.md` + `docs/05_SECURITY.md` | FR-TM-01, FR-TM-02 | DONE | `npm test` |
| GitHub OAuth connect + repo picker | `docs/02_REQUIREMENTS.md` | FR-GH-02 | DONE | `npm test` (OAuth endpoints + token storage; onboarding repo list + project creation triggers index) |
| Full index on repo connection (project create) | `docs/02_REQUIREMENTS.md` | FR-CIG-01 | DONE | `npm test` (`test/initial-index-helper.test.js`) |
| GitHub Reader App install + webhook indexing | `docs/02_REQUIREMENTS.md` | FR-GH-01, FR-GH-02, FR-GH-04, FR-CIG-02 | DONE | `npm test` (webhook verify+dedupe; indexing enqueued; removed files prune graph state) |
| GitHub Docs App install + docs-repo-only writes | `docs/02_REQUIREMENTS.md` | FR-GH-01B, FR-GH-03, FR-GH-05, FR-DOC-06 | DONE | `npm test` (docs repo verification + docs writer guard + PR creation stubbed when creds missing) |
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
| Docs repo onboarding + Docs App (docs-repo-only writes) | `docs/02_REQUIREMENTS.md` | FR-DOC-* | DONE | `npm test` (docs-repo-only guard + LocalDocsWriter; GitHubDocsWriter can open PR via REST when `GITHUB_DOCS_TOKEN` configured; org/repo onboarding APIs added) |
| Doc blocks + evidence model (contract-first; no code bodies) | `docs/02_REQUIREMENTS.md` | FR-DOC-02 | DONE | `npm test` |
| OpenClaw agent runtime integration (tool loop) | `docs/03_TECHNICAL_SPEC.md` | N/A | DONE | `npm test` |
| Graph enrichment agent (flow_summary annotations) | `docs/03_TECHNICAL_SPEC.md` | FR-CIG-09, FR-CIG-11 | DONE | `npm test` (graph worker enqueued after index; annotations stored separately from canonical graph) |
| Graph builder agent hardening (locks/retries/compaction/redaction) | `docs/03_TECHNICAL_SPEC.md` + `docs/07_ADMIN_GUIDE.md` | FR-CIG-11 | DONE | `npm test` (agent locks; HTTP/tool retry budgets; trace compaction; tool output redaction) |
| Support-safe mode enforcement | `docs/05_SECURITY.md` | FR-CIG-11 | DONE | `npm test` |
| Rate limiting + entitlements | `docs/02_REQUIREMENTS.md` | FR-* | DONE | `npm test` |
| Stripe billing + webhook processor | `docs/02_REQUIREMENTS.md` | FR-BL-* | DONE | `npm test` (webhook verify+dedupe; pg-backed stripe_events/org_billing when `DATABASE_URL` set; billing summary reads org_billing; checkout/portal support org stripe customer id + env price ids) |
| Frontend onboarding + graph explorer UX | `docs/04_UX_SPEC.md` | UF-* + FR-GX-* | DONE | `npm test` (enterprise shell: dashboard-first nav + org/project context switcher + toasts; focus mode + lazy neighborhood; onboarding stepper + progressive disclosure; local dev “Create Local Project” guarded by `GRAPHFLY_ALLOW_LOCAL_REPO_ROOT=1`) |
| Operations (SLOs/monitoring/runbooks) | `docs/06_OPERATIONS.md` | NFR-* | DONE | `npm test` |
| Spec drift guardrails (spec-map + checklist + runtime fences) | `agents.md` + `PR_CHECKLIST.md` | N/A | DONE | `npm run check:spec` |

## Production Readiness Checklist (Enterprise)

| Area | Item | Acceptance | Status | Gate |
|---|---|---|---|---|
| Auth | Multi-user auth + org roles | API supports JWT sessions; `org_members` roles enforced; membership management endpoints; admin actions audited to `audit_log` | DONE | `npm test` + integration |
| GitHub | Prefer GitHub App installs (Reader + Docs) | Installation callbacks persist IDs; clones + PRs use installation tokens (no PATs) | DONE | `npm test` |
| GitHub | Webhook routing per org/project | Webhook maps repo→tenant/repo deterministically (by `github_repo_id`); durable delivery dedupe via `webhook_deliveries` | DONE | `npm test` + integration |
| Indexing | Production indexer (no mock) | Built-in indexer-engine emits NDJSON (streamed) and ingests it; optional external NDJSON indexer supported via `GRAPHFLY_INDEXER_CMD`; mock remains dev-only | DONE | `npm test` + integration |
| Indexing | AST engine always available | Default `GRAPHFLY_AST_ENGINE=composite` in prod (TS compiler for JS/TS/TSX + Tree-sitter for others); missing AST modules fail fast in prod | DONE | `npm test` |
| Jobs | Durable queues + workers | Postgres-backed durable jobs; retries/backoff; worker runners; job status endpoints | DONE | `npm test` + integration |
| Storage | Required Postgres in prod | `GRAPHFLY_MODE=prod` enforces Postgres + pg queue + jwt auth + secret key | DONE | `npm test` |
| Docs | Docs repo selection UI + verification | Pick docs repo from GitHub; verify via server call using docs auth | DONE | `npm test` + integration |
| Billing | Stripe customer lifecycle | Auto-create + persist Stripe customer when missing; checkout/portal require stored customer | DONE | `npm test` |
| Security | Secrets management hardening | Keyring-based secret key rotation + rewrap endpoint; no tokens in logs; RLS verified in CI | DONE | `npm test` + CI |
| Observability | Metrics + tracing | Structured JSON logs (API) + request IDs + Prometheus `/metrics` (token protected) + Admin dashboard | DONE | `npm test` + integration |
| UX | One-click onboarding | Connect GitHub → pick docs repo → pick source repo → auto index + docs PR | DONE | manual QA |

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
