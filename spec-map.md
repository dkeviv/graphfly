# Graphfly — Spec-to-Work Item Map (Drift Guardrail)

This file maps each requirement in `docs/02_REQUIREMENTS.md` to:
- implementation status (✅ / ⚠️ / ❌)
- implementing areas and files/directories (best-effort pointers)
- whether it is a Phase-1 blocker

Regenerate: `npm run spec:map`

| Requirement | Spec Anchor | Status | Blocker | Implemented By |
|---|---:|---:|:---:|---|
| `FR-GH-01` — GitHub Reader App Installation (Source Repos) | `docs/02_REQUIREMENTS.md:42` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md`, apps/api/src/server.js, apps/api/src/github-webhook.js, packages/github-*, packages/repos* |
| `FR-GH-01B` — GitHub Docs App Installation (Docs Repo Only) | `docs/02_REQUIREMENTS.md:48` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md`, apps/api/src/server.js, apps/api/src/github-webhook.js, packages/github-*, packages/repos* |
| `FR-GH-02` — Repository Connection | `docs/02_REQUIREMENTS.md:54` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md`, apps/api/src/server.js, apps/api/src/github-webhook.js, packages/github-*, packages/repos* |
| `FR-GH-03` — Docs Repository Configuration | `docs/02_REQUIREMENTS.md:60` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md`, apps/api/src/server.js, apps/api/src/github-webhook.js, packages/github-*, packages/repos* |
| `FR-GH-04` — Webhook Processing | `docs/02_REQUIREMENTS.md:66` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md`, apps/api/src/server.js, apps/api/src/github-webhook.js, packages/github-*, packages/repos* |
| `FR-GH-05` — Enforced No-Write To Source Code Repos | `docs/02_REQUIREMENTS.md:72` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md`, apps/api/src/server.js, apps/api/src/github-webhook.js, packages/github-*, packages/repos* |
| `FR-CIG-01` — Full Index on Connection | `docs/02_REQUIREMENTS.md:82` | ❌ | BLOCKER | workers/indexer/, packages/cig/, packages/ndjson/, packages/cig-pg/, migrations/001_init.sql |
| `FR-CIG-02` — Incremental Index on Push | `docs/02_REQUIREMENTS.md:87` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md`, workers/indexer/, packages/cig/, packages/ndjson/, packages/cig-pg/, migrations/001_init.sql |
| `FR-CIG-03` — Multi-Language Parsing | `docs/02_REQUIREMENTS.md:93` | ⚠️ | BLOCKER | `docs/03_TECHNICAL_SPEC.md` + `docs/07_ADMIN_GUIDE.md`, workers/indexer/, packages/cig/, packages/ndjson/, packages/cig-pg/, migrations/001_init.sql |
| `FR-CIG-04` — Cross-File Symbol Resolution | `docs/02_REQUIREMENTS.md:99` | ⚠️ | BLOCKER | `docs/02_REQUIREMENTS.md` + `docs/03_TECHNICAL_SPEC.md`, `docs/03_TECHNICAL_SPEC.md`, workers/indexer/, packages/cig/, packages/ndjson/, packages/cig-pg/, migrations/001_init.sql |
| `FR-CIG-05` — Semantic Embeddings | `docs/02_REQUIREMENTS.md:104` | ✅ | BLOCKER | `docs/03_TECHNICAL_SPEC.md`, workers/indexer/, packages/cig/, packages/ndjson/, packages/cig-pg/, migrations/001_init.sql |
| `FR-CIG-06` — Graph Persistence | `docs/02_REQUIREMENTS.md:109` | ✅ | BLOCKER | `docs/03_TECHNICAL_SPEC.md`, `docs/01_ARCHITECTURE.md`, workers/indexer/, packages/cig/, packages/ndjson/, packages/cig-pg/, migrations/001_init.sql |
| `FR-CIG-07` — Public Contract Graph (No Source Code Bodies) | `docs/02_REQUIREMENTS.md:114` | ❌ | BLOCKER | workers/indexer/, packages/cig/, packages/ndjson/, packages/cig-pg/, migrations/001_init.sql |
| `FR-CIG-08` — Constraints & Allowable Values Extraction | `docs/02_REQUIREMENTS.md:121` | ⚠️ | BLOCKER | `docs/02_REQUIREMENTS.md` + `docs/03_TECHNICAL_SPEC.md`, workers/indexer/, packages/cig/, packages/ndjson/, packages/cig-pg/, migrations/001_init.sql |
| `FR-CIG-09` — Flow Entities (Entrypoints + Flow Graphs) | `docs/02_REQUIREMENTS.md:128` | ✅ | BLOCKER | `docs/03_TECHNICAL_SPEC.md`, workers/indexer/, packages/cig/, packages/ndjson/, packages/cig-pg/, migrations/001_init.sql |
| `FR-CIG-10` — Dependency & Manifest Intelligence | `docs/02_REQUIREMENTS.md:136` | ✅ | BLOCKER | `docs/03_TECHNICAL_SPEC.md`, workers/indexer/, packages/cig/, packages/ndjson/, packages/cig-pg/, migrations/001_init.sql |
| `FR-CIG-11` — No Code Exposure in UI/Support Mode | `docs/02_REQUIREMENTS.md:147` | ✅ | BLOCKER | `docs/03_TECHNICAL_SPEC.md`, `docs/03_TECHNICAL_SPEC.md` + `docs/07_ADMIN_GUIDE.md`, `docs/05_SECURITY.md`, workers/indexer/, packages/cig/, packages/ndjson/, packages/cig-pg/, migrations/001_init.sql |
| `FR-CIG-12` — Incremental Correctness Contract | `docs/02_REQUIREMENTS.md:152` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md`, workers/indexer/, packages/cig/, packages/ndjson/, packages/cig-pg/, migrations/001_init.sql |
| `FR-DOC-01` — Initial Documentation | `docs/02_REQUIREMENTS.md:168` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md`, workers/doc-agent/, packages/doc-blocks/, packages/doc-store/, packages/github-service/ |
| `FR-DOC-02` — Doc Block Structure | `docs/02_REQUIREMENTS.md:173` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md`, workers/doc-agent/, packages/doc-blocks/, packages/doc-store/, packages/github-service/ |
| `FR-DOC-03` — Evidence Model | `docs/02_REQUIREMENTS.md:180` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md`, workers/doc-agent/, packages/doc-blocks/, packages/doc-store/, packages/github-service/ |
| `FR-DOC-04` — Surgical Updates | `docs/02_REQUIREMENTS.md:186` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md`, workers/doc-agent/, packages/doc-blocks/, packages/doc-store/, packages/github-service/ |
| `FR-DOC-05` — New Node Documentation | `docs/02_REQUIREMENTS.md:192` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md`, workers/doc-agent/, packages/doc-blocks/, packages/doc-store/, packages/github-service/ |
| `FR-DOC-06` — Docs PR Creation | `docs/02_REQUIREMENTS.md:197` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md`, workers/doc-agent/, packages/doc-blocks/, packages/doc-store/, packages/github-service/ |
| `FR-DOC-07` — Doc Block Regeneration | `docs/02_REQUIREMENTS.md:203` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md`, workers/doc-agent/, packages/doc-blocks/, packages/doc-store/, packages/github-service/ |
| `FR-GX-01` — Interactive Graph View | `docs/02_REQUIREMENTS.md:212` | ✅ | BLOCKER | `docs/04_UX_SPEC.md`, apps/web/, apps/api/src/server.js, packages/cig/src/search.js |
| `FR-GX-02` — Node Detail | `docs/02_REQUIREMENTS.md:218` | ✅ | BLOCKER | `docs/04_UX_SPEC.md`, apps/web/, apps/api/src/server.js, packages/cig/src/search.js |
| `FR-GX-03` — Blast Radius Visualization | `docs/02_REQUIREMENTS.md:223` | ✅ | BLOCKER | `docs/03_TECHNICAL_SPEC.md`, `docs/02_REQUIREMENTS.md`, `docs/04_UX_SPEC.md`, apps/web/, apps/api/src/server.js, packages/cig/src/search.js |
| `FR-GX-04` — Search | `docs/02_REQUIREMENTS.md:229` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md`, `docs/04_UX_SPEC.md`, apps/web/, apps/api/src/server.js, packages/cig/src/search.js |
| `FR-GX-05` — Flow Tracing | `docs/02_REQUIREMENTS.md:235` | ✅ | BLOCKER | `docs/04_UX_SPEC.md`, apps/web/, apps/api/src/server.js, packages/cig/src/search.js |
| `FR-CV-01` — Coverage Dashboard | `docs/02_REQUIREMENTS.md:244` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md`, docs/02_REQUIREMENTS.md, docs/03_TECHNICAL_SPEC.md |
| `FR-CV-02` — Undocumented Entry Points | `docs/02_REQUIREMENTS.md:249` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md`, docs/02_REQUIREMENTS.md, docs/03_TECHNICAL_SPEC.md |
| `FR-CV-03` — Unresolved Imports | `docs/02_REQUIREMENTS.md:254` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md`, docs/02_REQUIREMENTS.md, docs/03_TECHNICAL_SPEC.md |
| `FR-TM-01` — Multi-User Organizations | `docs/02_REQUIREMENTS.md:263` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md` + `docs/05_SECURITY.md`, docs/02_REQUIREMENTS.md, docs/03_TECHNICAL_SPEC.md |
| `FR-TM-02` — Role-Based Access Control | `docs/02_REQUIREMENTS.md:268` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md` + `docs/05_SECURITY.md`, docs/02_REQUIREMENTS.md, docs/03_TECHNICAL_SPEC.md |
| `FR-TM-03` — Member Invitations | `docs/02_REQUIREMENTS.md:275` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md`, docs/02_REQUIREMENTS.md, docs/03_TECHNICAL_SPEC.md |
| `FR-RT-01` — Indexing Progress | `docs/02_REQUIREMENTS.md:284` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md` + `docs/04_UX_SPEC.md`, docs/02_REQUIREMENTS.md, docs/03_TECHNICAL_SPEC.md |
| `FR-RT-02` — Agent Activity Streaming | `docs/02_REQUIREMENTS.md:289` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md` + `docs/04_UX_SPEC.md`, docs/02_REQUIREMENTS.md, docs/03_TECHNICAL_SPEC.md |
| `FR-BL-01` — Plan Purchase via Stripe Checkout | `docs/02_REQUIREMENTS.md:298` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md`, apps/api/src/server.js, packages/billing*/, packages/stripe-*/, migrations/001_init.sql |
| `FR-BL-02` — Billing Portal (Self-Serve) | `docs/02_REQUIREMENTS.md:303` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md`, apps/api/src/server.js, packages/billing*/, packages/stripe-*/, migrations/001_init.sql |
| `FR-BL-03` — Stripe Webhook Processing | `docs/02_REQUIREMENTS.md:310` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md` + `docs/03_TECHNICAL_SPEC.md`, `docs/02_REQUIREMENTS.md`, apps/api/src/server.js, packages/billing*/, packages/stripe-*/, migrations/001_init.sql |
| `FR-BL-04` — Entitlements & Usage Enforcement | `docs/02_REQUIREMENTS.md:317` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md` + `docs/03_TECHNICAL_SPEC.md`, `docs/02_REQUIREMENTS.md`, apps/api/src/server.js, packages/billing*/, packages/stripe-*/, migrations/001_init.sql |
| `FR-BL-05` — Usage Transparency | `docs/02_REQUIREMENTS.md:327` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md` + `docs/03_TECHNICAL_SPEC.md`, `docs/02_REQUIREMENTS.md`, apps/api/src/server.js, packages/billing*/, packages/stripe-*/, migrations/001_init.sql |

---

Notes:
- ✅ means implemented per `project_plan.md` and covered by tests where applicable.
- ⚠️ means partial, env-gated, or needs verification against acceptance criteria.
- ❌ means not yet implemented or not yet tracked in `project_plan.md`.
