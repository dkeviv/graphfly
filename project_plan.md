# Graphfly — Project Plan (Spec-Aligned Tracking)

| Area | Spec Anchor | Requirement IDs | Status | Test Gate |
|---|---|---|---|---|
| Repo scaffolding (apps/workers/packages) | `plan.md` + `agents.md` | N/A | DONE | `npm test` |
| CIG core (identity/store/blast radius) | `docs/03_TECHNICAL_SPEC.md` | FR-CIG-* | PARTIAL | `npm test` (node schema includes symbol_kind/container_uid for richer PCG context) |
| NDJSON ingestion (node/edge/edge_occurrence + forward-compatible types) | `docs/01_ARCHITECTURE.md` | FR-CIG-* | PARTIAL | `npm test` (streaming ingest + fast-path supports flow_graph) |
| Dev harness: mock indexer PCG enrichment (functions/classes + allowables/constraints) | `docs/03_TECHNICAL_SPEC.md` | N/A | DONE | `npm test` |
| Edge occurrence handling (dedupe + occurrences) | `docs/03_TECHNICAL_SPEC.md` | FR-CIG-* | DONE | `npm test` |
| Flow entities ingestion + APIs | `docs/03_TECHNICAL_SPEC.md` | FR-CIG-09 | DONE | `npm test` (entrypoints + trace + materialized flow_graph persisted) |
| Dependency & manifest intelligence (declared/observed/mismatch) | `docs/03_TECHNICAL_SPEC.md` | FR-CIG-10 | PARTIAL | `npm test` (adds version_conflict mismatch; persists parsed manifest summary) |
| Postgres schema + migrations + RLS | `docs/03_TECHNICAL_SPEC.md` | FR-CIG-06 | PARTIAL | `npm test` (+ bulk ingest + FORCE RLS; optional live RLS test when `DATABASE_URL` set) |
| Billing schema (org_billing, stripe_events, usage_counters) + RLS | `docs/02_REQUIREMENTS.md` + `docs/03_TECHNICAL_SPEC.md` | FR-BL-03, FR-BL-04 | DONE | `npm test` |
| Billing usage transparency endpoint | `docs/02_REQUIREMENTS.md` + `docs/03_TECHNICAL_SPEC.md` | FR-BL-05 | DONE | `npm test` |
| pgvector embeddings + HNSW index | `docs/03_TECHNICAL_SPEC.md` | FR-CIG-05 | PARTIAL | `npm test` (schema + PgGraphStore semanticSearch ORDER BY embedding <=>; live DB pending) |
| Semantic search API | `docs/02_REQUIREMENTS.md` | FR-GX-04 | DONE | `npm test` (text + semantic; pg-native hook when available) |
| Impacted nodes (“blast radius”) correctness | `docs/02_REQUIREMENTS.md` | FR-GX-03 | DONE | `npm test` |
| Incremental correctness diagnostics | `docs/02_REQUIREMENTS.md` | FR-CIG-12 | PARTIAL | `npm test` (reparse scope + impacted symbols + awaited stale marking; persisted via index_diagnostics) |
| GitHub Reader App integration (webhooks + clone @sha) | `docs/02_REQUIREMENTS.md` | FR-CIG-02 | DONE | `npm test` (webhook → index → docs pipeline wired; ephemeral cloneAtSha path; supports `GITHUB_READER_TOKEN` or GitHub App installation token (`GITHUB_APP_ID` + private key + install id)) |
| Docs repo onboarding + Docs App (docs-repo-only writes) | `docs/02_REQUIREMENTS.md` | FR-DOC-* | DONE | `npm test` (docs-repo-only guard + LocalDocsWriter; GitHubDocsWriter can open PR via REST when `GITHUB_DOCS_TOKEN` configured; org/repo onboarding APIs added) |
| Doc blocks + evidence model (contract-first; no code bodies) | `docs/02_REQUIREMENTS.md` | FR-DOC-02 | PARTIAL | `npm test` (validator + InMemory/Pg stores + read APIs + flow + contract doc generation; surgical regen supported) |
| OpenClaw agent runtime integration (tool loop) | `docs/03_TECHNICAL_SPEC.md` | N/A | PARTIAL | `npm test` (OpenClaw tool loop for doc PR run + per-block validation; `OPENCLAW_USE_REMOTE=1` enables gateway mode) |
| Support-safe mode enforcement | `docs/05_SECURITY.md` | FR-CIG-11 | DONE | `npm test` |
| Rate limiting + entitlements | `docs/02_REQUIREMENTS.md` | FR-* | PARTIAL | `npm test` (RPM limiter + Pg/InMemory entitlements + Pg/InMemory usage counters) |
| Stripe billing + webhook processor | `docs/02_REQUIREMENTS.md` | FR-BL-* | DONE | `npm test` (webhook verify+dedupe; pg-backed stripe_events/org_billing when `DATABASE_URL` set; billing summary reads org_billing; checkout/portal support org stripe customer id + env price ids) |
| Frontend onboarding + graph explorer UX | `docs/04_UX_SPEC.md` | UF-* + FR-GX-* | PARTIAL | `npm test` (focus mode + lazy neighborhood fetch) |
| Operations (SLOs/monitoring/runbooks) | `docs/06_OPERATIONS.md` | NFR-* | DONE | `npm test` |
