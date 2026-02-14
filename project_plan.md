# Graphfly — Project Plan (Spec-Aligned Tracking)

| Area | Spec Anchor | Requirement IDs | Status | Test Gate |
|---|---|---|---|---|
| Repo scaffolding (apps/workers/packages) | `plan.md` + `agents.md` | N/A | DONE | `npm test` |
| CIG core (identity/store/blast radius) | `docs/03_TECHNICAL_SPEC.md` | FR-CIG-* | PARTIAL | `npm test` |
| NDJSON ingestion (node/edge/edge_occurrence + forward-compatible types) | `docs/01_ARCHITECTURE.md` | FR-CIG-* | PARTIAL | `npm test` (adds streaming ingest) |
| Edge occurrence handling (dedupe + occurrences) | `docs/03_TECHNICAL_SPEC.md` | FR-CIG-* | PARTIAL | `npm test` |
| Flow entities ingestion + APIs | `docs/03_TECHNICAL_SPEC.md` | FR-CIG-09 | PARTIAL | `npm test` (entrypoints + trace + materialized flow_graph; DB tables pending) |
| Dependency & manifest intelligence (declared/observed/mismatch) | `docs/03_TECHNICAL_SPEC.md` | FR-CIG-10 | PARTIAL | `npm test` (adds version_conflict mismatch) |
| Postgres schema + migrations + RLS | `docs/03_TECHNICAL_SPEC.md` | FR-CIG-06 | PARTIAL | `npm test` (adds flow_graph tables + expanded RLS; DB integration pending) |
| pgvector embeddings + HNSW index | `docs/03_TECHNICAL_SPEC.md` | FR-CIG-05 | PARTIAL | `npm test` (schema only) |
| Semantic search API | `docs/02_REQUIREMENTS.md` | FR-GX-04 | PARTIAL | `npm test` |
| Impacted nodes (“blast radius”) correctness | `docs/02_REQUIREMENTS.md` | FR-GX-03 | DONE | `npm test` |
| Incremental correctness diagnostics | `docs/02_REQUIREMENTS.md` | FR-CIG-12 | PARTIAL | `npm test` (reparse scope + impacted symbols + stale marking) |
| GitHub Reader App integration (webhooks + clone @sha) | `docs/02_REQUIREMENTS.md` | FR-CIG-02 | PARTIAL | `npm test` (webhook → index → docs pipeline wired; GitHub token clone pending) |
| Docs repo onboarding + Docs App (docs-repo-only writes) | `docs/02_REQUIREMENTS.md` | FR-DOC-* | PARTIAL | `npm test` (docs-repo-only guard + LocalDocsWriter + `local:run` CLI for local docs git repo) |
| Doc blocks + evidence model (contract-first; no code bodies) | `docs/02_REQUIREMENTS.md` | FR-DOC-02 | PARTIAL | `npm test` (doc-block validator + in-memory evidence store) |
| OpenClaw agent runtime integration (tool loop) | `docs/03_TECHNICAL_SPEC.md` | N/A | PARTIAL | `npm test` (tool loop + semantic search tool) |
| Support-safe mode enforcement | `docs/05_SECURITY.md` | FR-CIG-11 | PARTIAL | `npm test` |
| Rate limiting + entitlements | `docs/02_REQUIREMENTS.md` | FR-* | PARTIAL | `npm test` |
| Stripe billing + webhook processor | `docs/02_REQUIREMENTS.md` | FR-BL-* | PARTIAL | `npm test` (webhook verify+dedupe+plan sync; checkout/portal pending) |
| Frontend onboarding + graph explorer UX | `docs/04_UX_SPEC.md` | UF-* + FR-GX-* | PARTIAL | `npm test` (focus mode + lazy neighborhood fetch) |
| Operations (SLOs/monitoring/runbooks) | `docs/06_OPERATIONS.md` | NFR-* | PARTIAL | `npm test` |
