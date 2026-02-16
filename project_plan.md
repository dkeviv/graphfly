# Graphfly — Project Plan (Spec-Aligned Tracking)

| Area | Spec Anchor | Requirement IDs | Status | Test Gate |
|---|---|---|---|---|
| Repo scaffolding (apps/workers/packages) | `plan.md` + `agents.md` | N/A | DONE | `npm test` |
| Encrypted secrets store (org-scoped) | `docs/05_SECURITY.md` | NFR-SEC-* | DONE | `npm test` |
| GitHub OAuth connect + repo picker | `docs/02_REQUIREMENTS.md` | FR-CIG-02 | DONE | `npm test` (OAuth endpoints + dev token connect; repo list + project creation triggers index) |
| CIG core (identity/store/blast radius) | `docs/03_TECHNICAL_SPEC.md` | FR-CIG-* | DONE | `npm test` (import edges resolve to real files where possible) |
| NDJSON ingestion (node/edge/edge_occurrence + forward-compatible types) | `docs/01_ARCHITECTURE.md` | FR-CIG-* | DONE | `npm test` |
| Dev harness: mock indexer PCG enrichment (functions/classes + allowables/constraints) | `docs/03_TECHNICAL_SPEC.md` | N/A | DONE | `npm test` |
| Edge occurrence handling (dedupe + occurrences) | `docs/03_TECHNICAL_SPEC.md` | FR-CIG-* | DONE | `npm test` |
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
| Support-safe mode enforcement | `docs/05_SECURITY.md` | FR-CIG-11 | DONE | `npm test` |
| Rate limiting + entitlements | `docs/02_REQUIREMENTS.md` | FR-* | DONE | `npm test` |
| Stripe billing + webhook processor | `docs/02_REQUIREMENTS.md` | FR-BL-* | DONE | `npm test` (webhook verify+dedupe; pg-backed stripe_events/org_billing when `DATABASE_URL` set; billing summary reads org_billing; checkout/portal support org stripe customer id + env price ids) |
| Frontend onboarding + graph explorer UX | `docs/04_UX_SPEC.md` | UF-* + FR-GX-* | DONE | `npm test` (focus mode + lazy neighborhood fetch + onboarding config UI) |
| Operations (SLOs/monitoring/runbooks) | `docs/06_OPERATIONS.md` | NFR-* | DONE | `npm test` |
| Spec drift guardrails (spec-map + checklist + runtime fences) | `agents.md` + `PR_CHECKLIST.md` | N/A | DONE | `npm run check:spec` |

## Production Readiness Checklist (Enterprise)

| Area | Item | Acceptance | Status | Gate |
|---|---|---|---|---|
| Auth | Multi-user auth + org roles | API supports JWT sessions; `org_members` roles enforced; membership management endpoints; admin actions audited to `audit_log` | DONE | `npm test` + integration |
| GitHub | Prefer GitHub App installs (Reader + Docs) | Installation callbacks persist IDs; clones + PRs use installation tokens (no PATs) | DONE | `npm test` |
| GitHub | Webhook routing per org/project | Webhook maps repo→tenant/repo deterministically (by `github_repo_id`); durable delivery dedupe via `webhook_deliveries` | DONE | `npm test` + integration |
| Indexing | Production indexer (no mock) | Built-in indexer-engine emits NDJSON (streamed) and ingests it; optional external NDJSON indexer supported via `GRAPHFLY_INDEXER_CMD`; mock remains dev-only | DONE | `npm test` + integration |
| Jobs | Durable queues + workers | Postgres-backed durable jobs; retries/backoff; worker runners; job status endpoints | DONE | `npm test` + integration |
| Storage | Required Postgres in prod | `GRAPHFLY_MODE=prod` enforces Postgres + pg queue + jwt auth + secret key | DONE | `npm test` |
| Docs | Docs repo selection UI + verification | Pick docs repo from GitHub; verify via server call using docs auth | DONE | `npm test` + integration |
| Billing | Stripe customer lifecycle | Auto-create + persist Stripe customer when missing; checkout/portal require stored customer | DONE | `npm test` |
| Security | Secrets management hardening | Keyring-based secret key rotation + rewrap endpoint; no tokens in logs; RLS verified in CI | DONE | `npm test` + CI |
| Observability | Metrics + tracing | Structured JSON logs (API) + request IDs + Prometheus `/metrics` (token protected) + Admin dashboard | DONE | `npm test` + integration |
| UX | One-click onboarding | Connect GitHub → pick docs repo → pick source repo → auto index + docs PR | DONE | manual QA |
