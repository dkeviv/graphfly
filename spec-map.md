# Graphfly — Spec-to-Work Item Map (Drift Guardrail)

This file maps each requirement in `docs/02_REQUIREMENTS.md` to:
- implementation status (✅ / ⚠️ / ❌)
- implementing areas and files/directories (best-effort pointers)
- whether it is a Phase-1 blocker

Regenerate: `npm run spec:map`

| Requirement | Spec Anchor | Status | Blocker | Implemented By |
|---|---:|---:|:---:|---|
| `FR-GH-01` — GitHub Authentication (OAuth or GitHub Apps) | `docs/02_REQUIREMENTS.md:42` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md`, apps/api/src/server.js, apps/api/src/github-webhook.js, packages/github-*, packages/repos* |
| `FR-PROJ-01` — Projects (Repo + Docs Repo) | `docs/02_REQUIREMENTS.md:67` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md` + `docs/03_TECHNICAL_SPEC.md` + `docs/04_UX_SPEC.md`, `docs/04_UX_SPEC.md`, docs/02_REQUIREMENTS.md, docs/03_TECHNICAL_SPEC.md |
| `FR-GH-02` — Repository Connection (Project Creation) | `docs/02_REQUIREMENTS.md:74` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md`, apps/api/src/server.js, apps/api/src/github-webhook.js, packages/github-*, packages/repos* |
| `FR-GH-03` — Docs Repository Configuration | `docs/02_REQUIREMENTS.md:80` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md` + `docs/03_TECHNICAL_SPEC.md` + `docs/04_UX_SPEC.md`, apps/api/src/server.js, apps/api/src/github-webhook.js, packages/github-*, packages/repos* |
| `FR-GH-06` — Create Docs Repo (Onboarding) | `docs/02_REQUIREMENTS.md:88` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md` + `docs/04_UX_SPEC.md`, apps/api/src/server.js, apps/api/src/github-webhook.js, packages/github-*, packages/repos* |
| `FR-GH-04` — Webhook Processing | `docs/02_REQUIREMENTS.md:104` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md` + `docs/04_UX_SPEC.md`, `docs/02_REQUIREMENTS.md`, apps/api/src/server.js, apps/api/src/github-webhook.js, packages/github-*, packages/repos* |
| `FR-GH-05` — Enforced No-Write To Source Code Repos | `docs/02_REQUIREMENTS.md:111` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md`, apps/api/src/server.js, apps/api/src/github-webhook.js, packages/github-*, packages/repos* |
| `FR-CIG-01` — Full Index on Connection | `docs/02_REQUIREMENTS.md:122` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md`, workers/indexer/, packages/cig/, packages/ndjson/, packages/cig-pg/, migrations/001_init.sql |
| `FR-CIG-02` — Incremental Index on Push | `docs/02_REQUIREMENTS.md:127` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md` + `docs/04_UX_SPEC.md`, `docs/02_REQUIREMENTS.md`, workers/indexer/, packages/cig/, packages/ndjson/, packages/cig-pg/, migrations/001_init.sql |
| `FR-CIG-03` — Multi-Language Parsing | `docs/02_REQUIREMENTS.md:133` | ✅ | BLOCKER | `docs/03_TECHNICAL_SPEC.md` + `docs/07_ADMIN_GUIDE.md`, workers/indexer/, packages/cig/, packages/ndjson/, packages/cig-pg/, migrations/001_init.sql |
| `FR-CIG-04` — Cross-File Symbol Resolution | `docs/02_REQUIREMENTS.md:139` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md` + `docs/03_TECHNICAL_SPEC.md`, `docs/03_TECHNICAL_SPEC.md`, workers/indexer/, packages/cig/, packages/ndjson/, packages/cig-pg/, migrations/001_init.sql |
| `FR-CIG-05` — Semantic Embeddings | `docs/02_REQUIREMENTS.md:144` | ✅ | BLOCKER | `docs/03_TECHNICAL_SPEC.md`, workers/indexer/, packages/cig/, packages/ndjson/, packages/cig-pg/, migrations/001_init.sql |
| `FR-CIG-06` — Graph Persistence | `docs/02_REQUIREMENTS.md:149` | ✅ | BLOCKER | `docs/03_TECHNICAL_SPEC.md`, `docs/01_ARCHITECTURE.md`, workers/indexer/, packages/cig/, packages/ndjson/, packages/cig-pg/, migrations/001_init.sql |
| `FR-CIG-07` — Public Contract Graph (No Source Code Bodies) | `docs/02_REQUIREMENTS.md:154` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md` + `docs/05_SECURITY.md`, workers/indexer/, packages/cig/, packages/ndjson/, packages/cig-pg/, migrations/001_init.sql |
| `FR-CIG-08` — Constraints & Allowable Values Extraction | `docs/02_REQUIREMENTS.md:161` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md` + `docs/03_TECHNICAL_SPEC.md`, workers/indexer/, packages/cig/, packages/ndjson/, packages/cig-pg/, migrations/001_init.sql |
| `FR-CIG-09` — Flow Entities (Entrypoints + Flow Graphs) | `docs/02_REQUIREMENTS.md:168` | ✅ | BLOCKER | `docs/03_TECHNICAL_SPEC.md`, `docs/04_UX_SPEC.md`, workers/indexer/, packages/cig/, packages/ndjson/, packages/cig-pg/, migrations/001_init.sql |
| `FR-CIG-10` — Dependency & Manifest Intelligence | `docs/02_REQUIREMENTS.md:176` | ✅ | BLOCKER | `docs/03_TECHNICAL_SPEC.md`, workers/indexer/, packages/cig/, packages/ndjson/, packages/cig-pg/, migrations/001_init.sql |
| `FR-CIG-11` — No Code Exposure in UI/Support Mode | `docs/02_REQUIREMENTS.md:187` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md` + `docs/05_SECURITY.md`, `docs/04_UX_SPEC.md`, `docs/03_TECHNICAL_SPEC.md`, `docs/03_TECHNICAL_SPEC.md` + `docs/07_ADMIN_GUIDE.md`, `docs/05_SECURITY.md`, workers/indexer/, packages/cig/, packages/ndjson/, packages/cig-pg/, migrations/001_init.sql |
| `FR-CIG-12` — Incremental Correctness Contract | `docs/02_REQUIREMENTS.md:192` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md`, workers/indexer/, packages/cig/, packages/ndjson/, packages/cig-pg/, migrations/001_init.sql |
| `FR-DOC-01` — Initial Documentation | `docs/02_REQUIREMENTS.md:208` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md`, workers/doc-agent/, packages/doc-blocks/, packages/doc-store/, packages/github-service/ |
| `FR-DOC-02` — Doc Block Structure | `docs/02_REQUIREMENTS.md:213` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md`, workers/doc-agent/, packages/doc-blocks/, packages/doc-store/, packages/github-service/ |
| `FR-DOC-03` — Evidence Model | `docs/02_REQUIREMENTS.md:220` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md`, workers/doc-agent/, packages/doc-blocks/, packages/doc-store/, packages/github-service/ |
| `FR-DOC-04` — Surgical Updates | `docs/02_REQUIREMENTS.md:226` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md`, workers/doc-agent/, packages/doc-blocks/, packages/doc-store/, packages/github-service/ |
| `FR-DOC-05` — New Node Documentation | `docs/02_REQUIREMENTS.md:232` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md`, workers/doc-agent/, packages/doc-blocks/, packages/doc-store/, packages/github-service/ |
| `FR-DOC-06` — Docs PR Creation | `docs/02_REQUIREMENTS.md:237` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md`, `docs/04_UX_SPEC.md`, workers/doc-agent/, packages/doc-blocks/, packages/doc-store/, packages/github-service/ |
| `FR-DOC-07` — Doc Block Regeneration | `docs/02_REQUIREMENTS.md:243` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md`, workers/doc-agent/, packages/doc-blocks/, packages/doc-store/, packages/github-service/ |
| `FR-DOC-08` — Docs Repository Browser (Read) | `docs/02_REQUIREMENTS.md:248` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md` + `docs/04_UX_SPEC.md`, workers/doc-agent/, packages/doc-blocks/, packages/doc-store/, packages/github-service/ |
| `FR-DOC-09` — Manual Documentation Editing (UI) | `docs/02_REQUIREMENTS.md:262` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md` + `docs/04_UX_SPEC.md`, workers/doc-agent/, packages/doc-blocks/, packages/doc-store/, packages/github-service/ |
| `FR-AST-01` — Product Documentation Assistant (Explain & Navigate) | `docs/02_REQUIREMENTS.md:278` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md` + `docs/04_UX_SPEC.md`, docs/02_REQUIREMENTS.md, docs/03_TECHNICAL_SPEC.md |
| `FR-AST-02` — Product Documentation Assistant (Draft & Edit Docs via PR) | `docs/02_REQUIREMENTS.md:287` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md` + `docs/04_UX_SPEC.md`, docs/02_REQUIREMENTS.md, docs/03_TECHNICAL_SPEC.md |
| `FR-GX-01` — Interactive Graph View | `docs/02_REQUIREMENTS.md:302` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md` + `docs/04_UX_SPEC.md`, apps/web/, apps/api/src/server.js, packages/cig/src/search.js |
| `FR-GX-02` — Node Detail | `docs/02_REQUIREMENTS.md:308` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md` + `docs/04_UX_SPEC.md`, apps/web/, apps/api/src/server.js, packages/cig/src/search.js |
| `FR-GX-03` — Blast Radius Visualization | `docs/02_REQUIREMENTS.md:313` | ✅ | BLOCKER | `docs/03_TECHNICAL_SPEC.md`, `docs/02_REQUIREMENTS.md`, `docs/02_REQUIREMENTS.md` + `docs/04_UX_SPEC.md`, apps/web/, apps/api/src/server.js, packages/cig/src/search.js |
| `FR-GX-04` — Search | `docs/02_REQUIREMENTS.md:319` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md`, `docs/02_REQUIREMENTS.md` + `docs/04_UX_SPEC.md`, apps/web/, apps/api/src/server.js, packages/cig/src/search.js |
| `FR-GX-05` — Flow Tracing | `docs/02_REQUIREMENTS.md:325` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md` + `docs/04_UX_SPEC.md`, apps/web/, apps/api/src/server.js, packages/cig/src/search.js |
| `FR-CV-01` — Coverage Dashboard | `docs/02_REQUIREMENTS.md:334` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md`, docs/02_REQUIREMENTS.md, docs/03_TECHNICAL_SPEC.md |
| `FR-CV-02` — Undocumented Entry Points | `docs/02_REQUIREMENTS.md:339` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md`, docs/02_REQUIREMENTS.md, docs/03_TECHNICAL_SPEC.md |
| `FR-CV-03` — Unresolved Imports | `docs/02_REQUIREMENTS.md:344` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md`, docs/02_REQUIREMENTS.md, docs/03_TECHNICAL_SPEC.md |
| `FR-TM-01` — Multi-User Organizations | `docs/02_REQUIREMENTS.md:353` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md` + `docs/05_SECURITY.md`, docs/02_REQUIREMENTS.md, docs/03_TECHNICAL_SPEC.md |
| `FR-TM-02` — Role-Based Access Control | `docs/02_REQUIREMENTS.md:358` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md` + `docs/05_SECURITY.md`, docs/02_REQUIREMENTS.md, docs/03_TECHNICAL_SPEC.md |
| `FR-TM-03` — Member Invitations | `docs/02_REQUIREMENTS.md:365` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md` + `docs/04_UX_SPEC.md`, `docs/02_REQUIREMENTS.md`, docs/02_REQUIREMENTS.md, docs/03_TECHNICAL_SPEC.md |
| `FR-RT-01` — Indexing Progress | `docs/02_REQUIREMENTS.md:374` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md` + `docs/06_OPERATIONS.md`, `docs/02_REQUIREMENTS.md` + `docs/04_UX_SPEC.md`, docs/02_REQUIREMENTS.md, docs/03_TECHNICAL_SPEC.md |
| `FR-RT-02` — Agent Activity Streaming | `docs/02_REQUIREMENTS.md:379` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md` + `docs/06_OPERATIONS.md`, `docs/02_REQUIREMENTS.md` + `docs/04_UX_SPEC.md`, docs/02_REQUIREMENTS.md, docs/03_TECHNICAL_SPEC.md |
| `FR-BL-01` — Plan Purchase via Stripe Checkout | `docs/02_REQUIREMENTS.md:388` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md`, apps/api/src/server.js, packages/billing*/, packages/stripe-*/, migrations/001_init.sql |
| `FR-BL-02` — Billing Portal (Self-Serve) | `docs/02_REQUIREMENTS.md:393` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md`, apps/api/src/server.js, packages/billing*/, packages/stripe-*/, migrations/001_init.sql |
| `FR-BL-03` — Stripe Webhook Processing | `docs/02_REQUIREMENTS.md:400` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md` + `docs/03_TECHNICAL_SPEC.md`, `docs/02_REQUIREMENTS.md`, apps/api/src/server.js, packages/billing*/, packages/stripe-*/, migrations/001_init.sql |
| `FR-BL-04` — Entitlements & Usage Enforcement | `docs/02_REQUIREMENTS.md:407` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md` + `docs/03_TECHNICAL_SPEC.md`, `docs/02_REQUIREMENTS.md`, apps/api/src/server.js, packages/billing*/, packages/stripe-*/, migrations/001_init.sql |
| `FR-BL-05` — Usage Transparency | `docs/02_REQUIREMENTS.md:417` | ✅ | BLOCKER | `docs/02_REQUIREMENTS.md` + `docs/03_TECHNICAL_SPEC.md`, `docs/02_REQUIREMENTS.md` + `docs/04_UX_SPEC.md`, `docs/02_REQUIREMENTS.md`, apps/api/src/server.js, packages/billing*/, packages/stripe-*/, migrations/001_init.sql |

---

Notes:
- ✅ means implemented per `project_plan.md` and covered by tests where applicable.
- ⚠️ means partial, env-gated, or needs verification against acceptance criteria.
- ❌ means not yet implemented or not yet tracked in `project_plan.md`.
