# Graphfly — Technical Specification

**Version**: 1.0
**Last Updated**: February 2026
**Status**: Draft

---

## Navigation
- [← Requirements](02_REQUIREMENTS.md)
- [Next: UX Spec →](04_UX_SPEC.md)

---

## 1. Database Schema

All tables carry `tenant_id UUID`. PostgreSQL Row-Level Security enforces isolation.
API middleware sets `SET app.tenant_id = $1` on a borrowed connection for the duration of the request, and `RESET app.tenant_id` before releasing it back to the pool (so RLS applies to every query on that connection).

```sql
-- ═══════════════════════════════════════════════════════════════════════
-- EXTENSIONS
-- ═══════════════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";      -- pgvector 0.7+

-- ═══════════════════════════════════════════════════════════════════════
-- TENANTS (Organizations)
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE orgs (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug                  TEXT NOT NULL UNIQUE,        -- URL-safe identifier
    display_name          TEXT NOT NULL,
    plan                  TEXT NOT NULL DEFAULT 'free'
                          CHECK (plan IN ('free','pro','enterprise')),
    github_reader_install_id BIGINT,                   -- GitHub Reader App installation ID (source repos)
    github_docs_install_id   BIGINT,                   -- GitHub Docs App installation ID (docs repo only)
    docs_repo_full_name   TEXT,                        -- e.g. "owner/docs-repo"
    stripe_customer_id    TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════
-- BILLING (Stripe)
-- Stripe is the source of truth for subscription state. We persist a
-- denormalized snapshot for fast authz/entitlement checks + UX display.
-- ═══════════════════════════════════════════════════════════════════════
CREATE TYPE stripe_subscription_status AS ENUM (
  'incomplete',
  'incomplete_expired',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'paused'
);

CREATE TABLE org_billing (
    org_id                 UUID PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,
    stripe_customer_id     TEXT NOT NULL,   -- duplicated from orgs for convenience/joins
    stripe_subscription_id TEXT,
    stripe_price_id        TEXT,            -- current active price (plan)
    status                 stripe_subscription_status,
    current_period_start   TIMESTAMPTZ,
    current_period_end     TIMESTAMPTZ,
    cancel_at_period_end   BOOLEAN NOT NULL DEFAULT false,
    trial_end              TIMESTAMPTZ,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_org_billing_status ON org_billing(status);

-- Idempotency for Stripe webhooks
CREATE TABLE stripe_events (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID REFERENCES orgs(id) ON DELETE SET NULL,
    stripe_event_id TEXT NOT NULL UNIQUE,
    type            TEXT NOT NULL,
    received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at    TIMESTAMPTZ,
    error_message   TEXT
);

-- Usage counters for plan enforcement and billing UX.
-- Keys are intentionally generic to allow future additions without schema churn.
CREATE TABLE usage_counters (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id        UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    key           TEXT NOT NULL,             -- e.g. "index_jobs_daily", "doc_blocks_monthly"
    period_start  DATE NOT NULL,             -- start of counting window in org timezone (default UTC for V1)
    period_end    DATE NOT NULL,             -- exclusive
    value         INTEGER NOT NULL DEFAULT 0,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, key, period_start)
);
CREATE INDEX idx_usage_org_key ON usage_counters(org_id, key);

-- ═══════════════════════════════════════════════════════════════════════
-- USERS & RBAC
-- ═══════════════════════════════════════════════════════════════════════
CREATE TYPE org_role AS ENUM ('owner', 'admin', 'developer', 'viewer');

CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clerk_id      TEXT NOT NULL UNIQUE,  -- Clerk subject (sub claim)
    email         TEXT NOT NULL,
    display_name  TEXT,
    avatar_url    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE org_members (
    org_id        UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role          org_role NOT NULL DEFAULT 'developer',
    invited_by    UUID REFERENCES users(id),
    invited_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    accepted_at   TIMESTAMPTZ,
    PRIMARY KEY (org_id, user_id)
);
CREATE INDEX idx_org_members_user ON org_members(user_id);

-- ═══════════════════════════════════════════════════════════════════════
-- REPOS
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE repos (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    github_repo_id      BIGINT NOT NULL,
    full_name           TEXT NOT NULL,      -- "owner/repo"
    default_branch      TEXT NOT NULL DEFAULT 'main',
    language_hint       TEXT,               -- primary language detected
    index_status        TEXT NOT NULL DEFAULT 'pending'
                        CHECK (index_status IN ('pending','indexing','ready','error')),
    last_indexed_sha    TEXT,
    last_indexed_at     TIMESTAMPTZ,
    graph_node_count    INTEGER DEFAULT 0,
    graph_edge_count    INTEGER DEFAULT 0,
    coverage_pct        NUMERIC(5,2) DEFAULT 0,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, github_repo_id)
);
CREATE INDEX idx_repos_tenant ON repos(tenant_id);
CREATE INDEX idx_repos_status ON repos(tenant_id, index_status);

-- ═══════════════════════════════════════════════════════════════════════
-- GRAPH NODES
-- Code Intelligence Graph nodes (symbols, modules, packages, schemas, etc.)
--
-- IMPORTANT: This is a *public contract-first* representation.
-- - No source code bodies are persisted or required for docs/support flows.
-- - The graph stores stable identity, locations, relationships, and contracts.
--
-- Identity:
-- - `symbol_uid` is the stable identifier for a symbol within a repo.
-- - `node_key` is a human/debug key and may include file path; do not depend on it for stability.
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE graph_nodes (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    repo_id         UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    symbol_uid      TEXT NOT NULL,  -- e.g. "ts::pkg.module.Class.method::<sig_hash>"
    node_key        TEXT NOT NULL,  -- e.g. "<file_path>::<qualified_name>::<sig_hash>" (debug/display)
    node_type       TEXT NOT NULL
                    CHECK (node_type IN (
                        'Function', 'Class', 'Variable', 'Import',
                        'Module', 'Package', 'DatabaseTable', 'DatabaseColumn', 'Pattern',
                        'ApiEndpoint', 'UiRoute', 'QueueJob', 'CronJob', 'CliCommand', 'Schema'
                    )),
    symbol_kind     TEXT NOT NULL
                    CHECK (symbol_kind IN (
                        'function','method','constructor','getter','setter',
                        'class','interface','type','enum','module','package',
                        'variable','constant','parameter',
                        'api_endpoint','ui_route','queue_job','cron_job','cli_command',
                        'schema'
                    )),
    name            TEXT NOT NULL,
    qualified_name  TEXT NOT NULL,  -- language-specific FQN (namespace/module/class-qualified)
    file_path       TEXT NOT NULL,
    line_start      INTEGER NOT NULL,
    line_end        INTEGER NOT NULL,
    language        TEXT,
    container_uid   TEXT,       -- symbol_uid of container (module/class), if any
    container_node_id UUID REFERENCES graph_nodes(id) ON DELETE SET NULL,
    exported_name   TEXT,       -- export name if different from `name`
    visibility      TEXT NOT NULL DEFAULT 'internal'
                    CHECK (visibility IN ('public','internal','private')),
    signature       TEXT,       -- normalized signature (no body)
    signature_hash  TEXT,       -- stable hash of normalized signature
    declaration     TEXT,       -- single-line declaration/route definition (no body)
    docstring       TEXT,       -- extracted doc comment (redacted if needed)
    type_annotation TEXT,
    return_type     TEXT,
    parameters      JSONB,      -- [{ "name": "email", "type": "string" }, ...]
    -- Public contract graph (structured, safe to display)
    contract        JSONB,      -- JSON Schema / OpenAPI-ish contract for this node
    constraints     JSONB,      -- validation constraints (min/max/regex/required/default)
    allowable_values JSONB,     -- enumerations/literals (when applicable)
    external_ref    JSONB,      -- package/schema external identity (ecosystem/name/version/license/source), when applicable
    -- Semantic search
    embedding       vector(384), -- embedding computed from contract + metadata (not code bodies)
    embedding_text  TEXT,        -- canonical text used to generate embedding (for debugging/audit)
    first_seen_sha  TEXT NOT NULL,
    last_seen_sha   TEXT NOT NULL,
    indexed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, repo_id, symbol_uid),
    UNIQUE (tenant_id, repo_id, node_key)
);
CREATE INDEX idx_gn_repo ON graph_nodes(tenant_id, repo_id);
CREATE INDEX idx_gn_file ON graph_nodes(tenant_id, repo_id, file_path);
CREATE INDEX idx_gn_type ON graph_nodes(tenant_id, repo_id, node_type);
CREATE INDEX idx_gn_name ON graph_nodes(tenant_id, repo_id, name);
CREATE INDEX idx_gn_uid ON graph_nodes(tenant_id, repo_id, symbol_uid);
-- Vector similarity search (tenant-isolated via RLS)
-- HNSW provides strong recall/latency tradeoffs for large graphs.
CREATE INDEX idx_gn_embedding_hnsw ON graph_nodes
    USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 200);

-- ═══════════════════════════════════════════════════════════════════════
-- GRAPH EDGES
-- Maps to Yantra's EdgeType enum (32 variants).
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE graph_edges (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    repo_id         UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    source_node_id  UUID NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
    target_node_id  UUID NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
    edge_type       TEXT NOT NULL,
    -- Supported edge_types:
    -- Calls, Uses, Imports, Inherits, Defines, Documents, Tests, TestDependency
    -- DataFlow, ControlFlow, ExceptionFlow, AsyncFlow
    -- UsesPackage, DependsOn, ConflictsWith
    -- ForeignKey, HasColumn, UsesTable, ReferencedBy
    metadata        JSONB,  -- Optional. Prefer aggregating multiple callsites into one edge (e.g., metadata.locations[]).
    first_seen_sha  TEXT NOT NULL,
    last_seen_sha   TEXT NOT NULL,
    indexed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, repo_id, source_node_id, target_node_id, edge_type)
);
CREATE INDEX idx_ge_source ON graph_edges(tenant_id, source_node_id);
CREATE INDEX idx_ge_target ON graph_edges(tenant_id, target_node_id);
CREATE INDEX idx_ge_repo_type ON graph_edges(tenant_id, repo_id, edge_type);
CREATE INDEX idx_ge_repo_source_type ON graph_edges(tenant_id, repo_id, source_node_id, edge_type);
CREATE INDEX idx_ge_repo_target_type ON graph_edges(tenant_id, repo_id, target_node_id, edge_type);

-- ═══════════════════════════════════════════════════════════════════════
-- EDGE OCCURRENCES
-- Stores exact reference locations (callsites/import sites/etc.) without
-- storing code bodies. Enables "show me where" and usage counts.
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE graph_edge_occurrences (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id     UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    repo_id       UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    edge_id       UUID NOT NULL REFERENCES graph_edges(id) ON DELETE CASCADE,
    file_path     TEXT NOT NULL,
    line_start    INTEGER NOT NULL,
    line_end      INTEGER NOT NULL,
    occurrence_kind TEXT NOT NULL
                  CHECK (occurrence_kind IN ('call','import','inherit','use','dataflow','route_map','other')),
    sha           TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, repo_id, edge_id, file_path, line_start, line_end)
);
CREATE INDEX idx_geo_edge ON graph_edge_occurrences(tenant_id, repo_id, edge_id);
CREATE INDEX idx_geo_file ON graph_edge_occurrences(tenant_id, repo_id, file_path);

-- ═══════════════════════════════════════════════════════════════════════
-- FLOW ENTRYPOINTS & FLOW GRAPHS
-- Derived flow entities enable user-flow documentation and support workflows
-- without exposing source code bodies.
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE flow_entrypoints (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id     UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    repo_id       UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    node_id       UUID NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
    entrypoint_kind TEXT NOT NULL
                  CHECK (entrypoint_kind IN ('http_route','ui_route','queue_job','cron_job','cli_command','event_handler')),
    display_name  TEXT NOT NULL,
    method        TEXT,     -- for http_route
    path          TEXT,     -- for http_route/ui_route when available
    metadata      JSONB,    -- auth, tags, ownership, external services, etc.
    first_seen_sha TEXT NOT NULL,
    last_seen_sha  TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, repo_id, entrypoint_kind, display_name, method, path)
);
CREATE INDEX idx_flow_entry_repo ON flow_entrypoints(tenant_id, repo_id);
CREATE INDEX idx_flow_entry_node ON flow_entrypoints(tenant_id, repo_id, node_id);

CREATE TABLE flow_graphs (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id     UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    repo_id       UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    entrypoint_id UUID NOT NULL REFERENCES flow_entrypoints(id) ON DELETE CASCADE,
    sha           TEXT NOT NULL,
    max_depth     INTEGER NOT NULL DEFAULT 5,
    summary       JSONB, -- high-level derived summary safe for support/docs
    generated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, repo_id, entrypoint_id, sha, max_depth)
);
CREATE INDEX idx_flow_graph_repo ON flow_graphs(tenant_id, repo_id);

CREATE TABLE flow_graph_nodes (
    flow_graph_id UUID NOT NULL REFERENCES flow_graphs(id) ON DELETE CASCADE,
    node_id       UUID NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
    depth         INTEGER NOT NULL,
    role          TEXT,   -- e.g., "entrypoint", "handler", "db", "external"
    PRIMARY KEY (flow_graph_id, node_id)
);

CREATE TABLE flow_graph_edges (
    flow_graph_id UUID NOT NULL REFERENCES flow_graphs(id) ON DELETE CASCADE,
    edge_id       UUID NOT NULL REFERENCES graph_edges(id) ON DELETE CASCADE,
    PRIMARY KEY (flow_graph_id, edge_id)
);

-- ═══════════════════════════════════════════════════════════════════════
-- DEPENDENCY & MANIFEST INTELLIGENCE
-- Capture declared dependencies (manifests) and observed dependencies (code),
-- without assuming either view is correct.
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE dependency_manifests (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id     UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    repo_id       UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    file_path     TEXT NOT NULL,  -- e.g. package.json, pyproject.toml
    manifest_type TEXT NOT NULL
                  CHECK (manifest_type IN ('npm','pip','poetry','cargo','gomod','maven','gradle','other')),
    content_hash  TEXT NOT NULL,
    sha           TEXT NOT NULL,
    metadata      JSONB,          -- workspace/package name, private, etc.
    parsed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, repo_id, file_path, sha)
);
CREATE INDEX idx_manifest_repo ON dependency_manifests(tenant_id, repo_id, manifest_type);

CREATE TABLE packages (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ecosystem     TEXT NOT NULL,  -- npm, pypi, cargo, go, maven, etc.
    name          TEXT NOT NULL,
    source        TEXT,           -- repository URL / source registry (if known)
    homepage      TEXT,
    license       TEXT,
    UNIQUE (ecosystem, name)
);

CREATE TABLE declared_dependencies (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id     UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    repo_id       UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    manifest_id   UUID NOT NULL REFERENCES dependency_manifests(id) ON DELETE CASCADE,
    package_id    UUID NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
    scope         TEXT NOT NULL
                  CHECK (scope IN ('prod','dev','optional','peer','build','test','unknown')),
    version_range TEXT,           -- declared range (as-is from manifest)
    metadata      JSONB,          -- extras, markers, workspace flags
    UNIQUE (tenant_id, repo_id, manifest_id, package_id, scope)
);
CREATE INDEX idx_declared_deps_repo ON declared_dependencies(tenant_id, repo_id);

CREATE TABLE observed_dependencies (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id     UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    repo_id       UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    package_id    UUID NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
    source_node_id UUID REFERENCES graph_nodes(id) ON DELETE SET NULL, -- file/module/symbol that uses it
    evidence      JSONB,          -- import strings, counts, locations (no code bodies)
    first_seen_sha TEXT NOT NULL,
    last_seen_sha  TEXT NOT NULL,
    UNIQUE (tenant_id, repo_id, package_id, source_node_id)
);
CREATE INDEX idx_observed_deps_repo ON observed_dependencies(tenant_id, repo_id);

CREATE TABLE dependency_mismatches (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id     UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    repo_id       UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    mismatch_type TEXT NOT NULL
                  CHECK (mismatch_type IN ('declared_not_observed','observed_not_declared','version_conflict')),
    package_id    UUID REFERENCES packages(id) ON DELETE SET NULL,
    details       JSONB NOT NULL, -- structured explanation (manifests involved, version ranges, locations)
    sha           TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_dep_mismatch_repo ON dependency_mismatches(tenant_id, repo_id, mismatch_type);

-- ═══════════════════════════════════════════════════════════════════════
-- DOC BLOCKS
-- One doc block = one markdown section (## Heading ... to next ##)
-- Doc blocks are contract-first: they must not embed source code bodies/snippets.
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE doc_blocks (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    repo_id         UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    doc_file        TEXT NOT NULL,      -- "api/auth.md"
    block_anchor    TEXT NOT NULL,      -- "## POST /auth/login"
    block_type      TEXT NOT NULL
                    CHECK (block_type IN (
                        'overview', 'function', 'class', 'flow',
                        'module', 'api_endpoint', 'schema', 'package'
                    )),
    status          TEXT NOT NULL DEFAULT 'fresh'
                    CHECK (status IN ('fresh','stale','locked','error')),
    content         TEXT NOT NULL,      -- Full markdown of this section
    content_hash    TEXT NOT NULL,      -- hash of content (sha256 in production; stable hash in dev/test)
    last_index_sha  TEXT,
    last_pr_id      UUID,               -- FK to pr_runs (set after FK circle resolved)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, repo_id, doc_file, block_anchor)
);
CREATE INDEX idx_db_repo ON doc_blocks(tenant_id, repo_id);
CREATE INDEX idx_db_file ON doc_blocks(tenant_id, repo_id, doc_file);
CREATE INDEX idx_db_status ON doc_blocks(tenant_id, repo_id, status);

-- ═══════════════════════════════════════════════════════════════════════
-- DOC EVIDENCE
-- Provenance: Code Intelligence Graph node → documentation block.
-- This is the critical link that enables surgical updates.
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE doc_evidence (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    repo_id         UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    doc_block_id    UUID NOT NULL REFERENCES doc_blocks(id) ON DELETE CASCADE,
    node_id         UUID REFERENCES graph_nodes(id) ON DELETE SET NULL,
    symbol_uid      TEXT NOT NULL,      -- Denormalized stable identity (for UI/support without extra joins)
    qualified_name  TEXT,               -- Denormalized for display/search
    file_path       TEXT,               -- Denormalized for fast display (no code bodies)
    line_start      INTEGER,
    line_end        INTEGER,
    sha             TEXT NOT NULL,
    contract_hash   TEXT,               -- Hash of the public contract at time of doc generation
    evidence_kind   TEXT NOT NULL DEFAULT 'contract_location'
                    CHECK (evidence_kind IN ('contract_location','flow','dependency','other')),
    evidence_weight NUMERIC(3,2) DEFAULT 1.0  -- 1.0=primary, 0.5=secondary
);
-- CRITICAL: reverse lookup for surgical update algorithm
-- Given changed node_id → find all stale doc_block_ids
CREATE INDEX idx_de_node_block ON doc_evidence(node_id, doc_block_id);
CREATE INDEX idx_de_symbol_uid ON doc_evidence(symbol_uid);
CREATE INDEX idx_de_block ON doc_evidence(doc_block_id);
CREATE INDEX idx_de_tenant ON doc_evidence(tenant_id);

-- ═══════════════════════════════════════════════════════════════════════
-- PR RUNS
-- History of all documentation PRs opened by Graphfly.
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE pr_runs (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id        UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    repo_id          UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    trigger_sha      TEXT NOT NULL,
    trigger_pr_num   INTEGER,           -- Source code PR that triggered this (if known)
    status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','running','success','failure','skipped')),
    docs_branch      TEXT,              -- Branch in docs repo
    docs_pr_number   INTEGER,
    docs_pr_url      TEXT,
    blocks_updated   INTEGER DEFAULT 0,
    blocks_created   INTEGER DEFAULT 0,
    blocks_unchanged INTEGER DEFAULT 0,
    trigger_node_ids UUID[],            -- Changed graph nodes that triggered this run
    agent_session_id TEXT,              -- For log correlation
    error_message    TEXT,
    started_at       TIMESTAMPTZ,
    completed_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pr_repo ON pr_runs(tenant_id, repo_id, created_at DESC);
CREATE INDEX idx_pr_status ON pr_runs(tenant_id, status);

-- Close FK circle
ALTER TABLE doc_blocks ADD CONSTRAINT fk_last_pr
    FOREIGN KEY (last_pr_id) REFERENCES pr_runs(id) ON DELETE SET NULL;

-- ═══════════════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY (applied to all tenant-scoped tables)
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE repos ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE pr_runs ENABLE ROW LEVEL SECURITY;

-- Pattern for each table (substitute table name):
CREATE POLICY tenant_isolation ON repos
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
-- Replicate for: graph_nodes, graph_edges, doc_blocks, doc_evidence, pr_runs
```

---

## 1A. Code Intelligence Graph Model

Graphfly’s core artifact is the **Code Intelligence Graph (CIG)**. It is a multi-layer graph stored in PostgreSQL (`graph_nodes`, `graph_edges`, and related tables) designed to power many use cases beyond documentation: user flows, support workflows, impact analysis, dependency intelligence, and semantic debugging.

### 1A.1 Public Contract Graph (PCG)

The CIG includes a **Public Contract Graph** representation that is safe to display and sufficient for documentation and support.

**What the PCG contains (examples):**
- Function/class contracts: signatures, parameter names/types, return types, and structured constraints.
- API endpoint contracts: method/path, request/response schemas, auth requirements, error shapes.
- Schema contracts: JSON Schema-like definitions with allowable values and validation constraints.

**What the PCG explicitly does not contain:**
- Source code bodies/snippets persisted in the database.
- Source code bodies/snippets embedded in doc blocks.

### 1A.2 Robust Node Identity

To support refactors and cross-file resolution, nodes use `symbol_uid` and `qualified_name`:
- `symbol_uid`: stable identity used for upserts and joins (avoid path/name collisions).
- `qualified_name`: language-specific fully qualified name used for display and search.
- `signature_hash`: disambiguates overloads and same-name symbols.

### 1A.3 Edge Occurrences (Where/How Evidence)

Edges capture relationships at an entity level (`graph_edges`) and **reference sites** in `graph_edge_occurrences` (file+line ranges) without storing code bodies. This enables:
- “Show me where this is used”
- Usage counts and ranking
- Evidence for docs and support agents without code exposure

### 1A.4 Flow Entities (User Flows)

User-flow documentation is generated from explicit flow entities:
- `flow_entrypoints`: HTTP routes, UI routes, queue jobs, cron jobs, CLI commands, event handlers.
- `flow_graphs`: derived traces for a specific `sha` and depth.
- `flow_graph_nodes` / `flow_graph_edges`: the materialized subgraph for fast UI rendering.

### 1A.5 Dependency & Manifest Intelligence

Graphfly persists both:
- **Declared dependencies** (from manifests) in `declared_dependencies`
- **Observed dependencies** (from code) in `observed_dependencies`

and records mismatches in `dependency_mismatches` without assuming which side is correct.

For graph traversal and flow/debugging use cases, package relationships are also represented as:
- `graph_nodes` with `node_type='Package'` (and `external_ref` for ecosystem/name/license/source)
- `graph_edges` with `edge_type='UsesPackage'` from code symbols/modules → package nodes

### 1A.6 Semantic Search (Embeddings)

Embeddings are computed from the **public contract text** (contract + constraints + metadata), not from code bodies. This supports:
- Rich semantic search across symbols, endpoints, schemas, and flows
- Semantic clustering/debugging later (“find similar handlers/contracts”)

Vectors are stored in pgvector and indexed with **HNSW** for performance.

### 1A.7 Incremental Correctness (Indexing Contract)

Incremental indexing must be correct in the presence of:
- file adds/modifies/removes
- moves/renames (path changes)
- manifest changes (declared dependencies change)
- cascading symbol-resolution impacts

The indexer must compute a “re-parse scope” (changed files + impacted files) and persist diagnostics about what was re-parsed and why.

### 1A.8 Graph Versions (Future Phase)

V1 stores `first_seen_sha`/`last_seen_sha` on nodes/edges to support basic “when did this exist” questions. Full per-commit snapshots (“time travel”) should be implemented as a future phase via a `graph_versions` table and version-scoped node/edge materialization.

## 2. Documentation Agent Specification

### 2.1 Agent Architecture

The doc agent is a TypeScript `TurnOutcome`-driven agentic loop. It is a direct port of Yantra's `loop_core.rs` pattern (`src-tauri/src/agent/loop_core.rs`).

```typescript
// packages/doc-agent/src/loop.ts

type TurnOutcome =
  | { type: 'final'; summary: string }
  | { type: 'tool_calls'; calls: ToolCall[] }

interface DocAgentJob {
  tenantId: string;
  repoId: string;
  prRunId: string;
  triggerSha: string;
  changedFiles: string[];
}

const SYSTEM_PROMPT = `
You are Graphfly's documentation agent. You maintain the living documentation
for a software codebase. Your job is to:

1. Identify which doc blocks need updating (tools will tell you)
2. Read the current doc block content and its evidence nodes
3. Read the **public contract** for each evidence node (signatures, schemas, constraints)
4. Update the doc block with accurate, concise documentation (no source code bodies)
5. Create doc blocks for any undocumented functions/classes you find
6. Open a PR with all changes

RULES:
- Keep doc blocks concise and factual — do not add prose
- Every doc block MUST reference at least one specific code location
- Do not change a doc block if the code change is cosmetic (formatting, comments only)
- Preserve the existing markdown structure; only update content within sections
- When done with all updates, call github.create_pr to open the PR
`;

async function runDocAgentLoop(job: DocAgentJob): Promise<void> {
  await updatePrRunStatus(job.prRunId, 'running');

  const history: Message[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildTriggerMessage(job) }
  ];

  let iterations = 0;
  const MAX_ITERATIONS = 40;

  while (iterations < MAX_ITERATIONS) {
    const response = await callLLM({
      messages: history,
      tools: DOC_AGENT_TOOLS,
      model: 'claude-sonnet-4-5-20250929',
      maxTokens: 4096,
    });

    const outcome: TurnOutcome = parseTurnOutcome(response);
    history.push({ role: 'assistant', content: response.content });

    if (outcome.type === 'final') {
      await updatePrRunStatus(job.prRunId, 'success', outcome.summary);
      return;
    }

    for (const call of outcome.calls) {
      const result = await executeDocTool(call, job);
      history.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
      // Stream to UI via Socket.IO
      await emitAgentEvent(job.prRunId, 'agent:tool_call', {
        tool: call.name,
        args: call.arguments,
        result_summary: summarizeResult(result),
      });
    }

    iterations++;
  }

  await updatePrRunStatus(job.prRunId, 'failure', 'Max iterations reached');
}

function buildTriggerMessage(job: DocAgentJob): string {
  return `
A push to the repository has been processed. The following files were changed:
${job.changedFiles.map(f => `- ${f}`).join('\n')}

Please:
1. Find all doc blocks that reference the changed code (they are already marked stale)
2. Update each stale block with accurate documentation based on the new code
3. Create new doc blocks for any new undocumented functions/classes
4. Open a PR when done

Repository ID: ${job.repoId}
Triggered by commit: ${job.triggerSha}
PR Run ID: ${job.prRunId}
  `;
}
```

### 2.2 Surgical Update Algorithm

```typescript
// Phase 1: Identify affected nodes (SQL)
async function getAffectedNodeIds(
  repoId: string,
  changedFiles: string[],
  db: Pool
): Promise<string[]> {
  // Direct: nodes in changed files
  const { rows: directNodes } = await db.query(`
    SELECT id FROM graph_nodes
    WHERE repo_id = $1 AND file_path = ANY($2)
  `, [repoId, changedFiles]);

  const directIds = directNodes.map(r => r.id);

  // 1-hop: nodes that depend on the changed nodes (inbound edges),
  // plus immediate downstream connections (outbound edges) for context.
  //
  // NOTE: "impact" is primarily **dependents** (callers/importers), so inbound edges
  // must be included or docs will miss breaking-change blast radius.
  const EDGE_TYPES_FOR_IMPACT = [
    'Calls', 'Uses', 'Imports', 'Inherits', 'DependsOn',
    'DataFlow', 'ControlFlow', 'AsyncFlow', 'ExceptionFlow'
  ];

  const { rows: oneHop } = await db.query(`
    WITH direct AS (
      SELECT unnest($1::uuid[]) AS node_id
    )
    SELECT DISTINCT ge.source_node_id AS id
    FROM graph_edges ge
    JOIN direct d ON ge.target_node_id = d.node_id
    WHERE ge.repo_id = $2
      AND ge.edge_type = ANY($3::text[])
    UNION
    SELECT DISTINCT ge.target_node_id AS id
    FROM graph_edges ge
    JOIN direct d ON ge.source_node_id = d.node_id
    WHERE ge.repo_id = $2
      AND ge.edge_type = ANY($3::text[])
  `, [directIds, repoId, EDGE_TYPES_FOR_IMPACT]);

  return [...new Set([...directIds, ...oneHop.map(r => r.id)])];
}

// Phase 2: Find stale doc blocks (SQL)
async function getStaleDocBlocks(
  repoId: string,
  affectedNodeIds: string[],
  db: Pool
): Promise<DocBlock[]> {
  const { rows } = await db.query(`
    SELECT DISTINCT
      db.id, db.doc_file, db.block_anchor, db.block_type,
      db.content, db.content_hash, db.status
    FROM doc_blocks db
    JOIN doc_evidence de ON de.doc_block_id = db.id
    WHERE de.node_id = ANY($1)
      AND db.repo_id = $2
    ORDER BY db.doc_file, db.block_anchor
  `, [affectedNodeIds, repoId]);

  // Mark as stale in DB
  await db.query(`
    UPDATE doc_blocks SET status = 'stale'
    WHERE id = ANY($1)
  `, [rows.map(r => r.id)]);

  return rows;
}

// Phase 3: LLM updates blocks (in agent loop via tools)
// Phase 4: Detect new undocumented nodes
async function getUndocumentedNodes(
  repoId: string,
  changedFiles: string[],
  db: Pool
): Promise<GraphNode[]> {
  const { rows } = await db.query(`
    SELECT gn.*
    FROM graph_nodes gn
    LEFT JOIN doc_evidence de ON de.node_id = gn.id
    WHERE gn.repo_id = $1
      AND gn.file_path = ANY($2)
      AND gn.node_type IN ('Function', 'Class', 'Module')
      AND de.id IS NULL
  `, [repoId, changedFiles]);
  return rows;
}

// Phase 5: Create PR (via github.create_pr tool)
// Tool calls: github.create_pr({ repo_id, files, commit_message, pr_title, pr_body })
```

### 2.3 Doc Agent Tools

**MVP implementation note (this repo):** the current OpenClaw-backed doc agent loop is implemented as a tool-driven pipeline using these concrete tool names:
- `flows_entrypoints_list`
- `contracts_get`
- `flows_trace`
- `docs_upsert_block`
- `github_create_pr`

These map to the same conceptual capabilities described below (graph queries, contracts/flows, doc block CRUD, and docs PR creation). A future phase can add the expanded dotted tool naming (`graph.*`, `contracts.*`, `docs.*`) once the public API surface is finalized.

All tools use TypeBox schema pattern from OpenClaw (`openclaw/src/agents/openclaw-tools.ts`):

```typescript
// packages/doc-agent/src/tools/index.ts

export const DOC_AGENT_TOOLS: Tool[] = [
  {
    name: 'graph.query',
    description: 'Fetch graph nodes and their edges by node IDs',
    inputSchema: Type.Object({
      repo_id: Type.String(),
      node_ids: Type.Array(Type.String()),
      include_edges: Type.Boolean({ default: true }),
      depth: Type.Number({ default: 1 }),
    }),
    execute: async (args, ctx) => {
      const nodes = await getNodesByIds(ctx.db, ctx.tenantId, args.repo_id, args.node_ids);
      const edges = args.include_edges
        ? await getEdgesForNodes(ctx.db, ctx.tenantId, args.node_ids)
        : [];
      return { nodes, edges };
    }
  },

  {
    name: 'graph.blast_radius',
    description: 'Find nodes impacted by changes to a given node (N-hop traversal)',
    inputSchema: Type.Object({
      repo_id: Type.String(),
      node_id: Type.String(),
      depth: Type.Number({ default: 2 }),
    }),
    execute: async (args, ctx) => blastRadius(ctx.db, ctx.tenantId, args)
  },

  {
    name: 'graph.flow',
    description: 'Trace the call path from an entrypoint node (e.g., HTTP route handler)',
    inputSchema: Type.Object({
      repo_id: Type.String(),
      entrypoint_node_id: Type.String(),
      max_depth: Type.Number({ default: 5 }),
    }),
    execute: async (args, ctx) => traceFlow(ctx.db, ctx.tenantId, args)
  },

  {
    name: 'graph.semantic_search',
    description: 'Find semantically similar nodes using vector similarity',
    inputSchema: Type.Object({
      repo_id: Type.String(),
      query: Type.String(),
      top_k: Type.Number({ default: 10 }),
    }),
    execute: async (args, ctx) => {
      const embedding = await generateEmbedding(args.query);
      const embeddingVector = `[${embedding.join(',')}]`; // pgvector text format
      // HNSW tuning (session-scoped)
      await ctx.db.query(`SET LOCAL hnsw.ef_search = 64`);
      const { rows } = await ctx.db.query(`
        SELECT id, symbol_uid, qualified_name, name, file_path, line_start, node_type,
               1 - (embedding <=> $1::vector) AS similarity
        FROM graph_nodes
        WHERE repo_id = $2
          AND embedding IS NOT NULL
        ORDER BY embedding <=> $1::vector
        LIMIT $3
      `, [embeddingVector, args.repo_id, args.top_k]);
      return rows;
    }
  },

  {
    name: 'contracts.get',
    description: 'Fetch public contract details for nodes (no code bodies)',
    inputSchema: Type.Object({
      repo_id: Type.String(),
      node_ids: Type.Array(Type.String()),
    }),
    execute: async (args, ctx) => {
      const { rows } = await ctx.db.query(`
        SELECT
          id, symbol_uid, qualified_name, node_type, symbol_kind,
          signature, return_type, parameters,
          contract, constraints, allowable_values,
          file_path, line_start, line_end, last_seen_sha
        FROM graph_nodes
        WHERE repo_id = $1
          AND id = ANY($2::uuid[])
      `, [args.repo_id, args.node_ids]);
      return rows;
    }
  },

  {
    name: 'docs.get_block',
    description: 'Fetch a doc block content and all its evidence links',
    inputSchema: Type.Object({
      doc_block_id: Type.String(),
    }),
    execute: async (args, ctx) => {
      const block = await getDocBlock(ctx.db, args.doc_block_id);
      const evidence = await getBlockEvidence(ctx.db, args.doc_block_id);
      return { block, evidence };
    }
  },

  {
    name: 'docs.update_block',
    description: 'Update a doc block with new content and evidence provenance',
    inputSchema: Type.Object({
      doc_block_id: Type.String(),
      content: Type.String(),
      evidence: Type.Array(Type.Object({
        node_id: Type.String(),
        file_path: Type.String(),
        line_start: Type.Number(),
        line_end: Type.Number(),
        commit_sha: Type.String(),
        evidence_weight: Type.Number({ default: 1.0 }),
      })),
    }),
    execute: async (args, ctx) => {
      const contentHash = sha256(args.content);
      const existingBlock = await getDocBlock(ctx.db, args.doc_block_id);

      if (contentHash === existingBlock.content_hash) {
        return { updated: false, reason: 'content unchanged' };
      }

      await updateDocBlock(ctx.db, args.doc_block_id, args.content, contentHash);
      await updateDocEvidence(ctx.db, args.doc_block_id, args.evidence);
      ctx.updatedBlocks.push(args.doc_block_id);
      return { updated: true, doc_file: existingBlock.doc_file };
    }
  },

  {
    name: 'docs.create_block',
    description: 'Create a new doc block for a previously undocumented node',
    inputSchema: Type.Object({
      repo_id: Type.String(),
      doc_file: Type.String(),
      block_anchor: Type.String(),
      block_type: Type.String(),
      content: Type.String(),
      evidence: Type.Array(Type.Object({
        node_id: Type.String(),
        file_path: Type.String(),
        line_start: Type.Number(),
        line_end: Type.Number(),
        commit_sha: Type.String(),
      })),
    }),
    execute: async (args, ctx) => {
      const block = await createDocBlock(ctx.db, ctx.tenantId, ctx.repoId, args);
      ctx.createdBlocks.push(block.id);
      return { created: true, doc_block_id: block.id };
    }
  },

  {
    name: 'github.create_pr',
    description: 'Open a PR in the docs repo with the updated markdown files',
    inputSchema: Type.Object({
      repo_id: Type.String(),
      files: Type.Array(Type.Object({
        path: Type.String(),         // "api/auth.md"
        content: Type.String(),      // full file content
      })),
      commit_message: Type.String(),
      pr_title: Type.String(),
      pr_body: Type.String(),
    }),
	    execute: async (args, ctx) => {
	      const result = await ctx.githubService.createDocsPR({
	        installationId: ctx.docsInstallationId, // GitHub Docs App installation (docs repo only)
	        docsRepo: ctx.docsRepo,
	        branch: `docs/update-${ctx.triggerSha.slice(0, 8)}`,
	        files: args.files,
	        commitMessage: args.commit_message,
        prTitle: args.pr_title,
        prBody: args.pr_body,
      });
      await updatePrRunWithPR(ctx.db, ctx.prRunId, result.prUrl, result.prNumber);
      return { pr_url: result.prUrl, pr_number: result.prNumber };
    }
  },
];
```

**Implementation note (dev/test mode):** In environments without GitHub network access, the `github.create_pr` tool may be backed by a local docs writer that operates on a user-provided **docs git repo path** (create branch → write files → commit). This must still enforce “docs repo only” targeting and must never write to source repos.

---

## 3. REST API Specification

### 3.1 Authentication

All endpoints (except `/webhooks/github`) require:
```
Authorization: Bearer <clerk_jwt>
```

The JWT contains org_id in claims. Middleware:
1. Validates JWT signature against Clerk public key
2. Extracts `org_id` from claims
3. Sets `req.tenantId = org_id`
4. Borrows a DB connection, sets `SET app.tenant_id = $1`, and guarantees `RESET app.tenant_id` before release

### 3.2 Endpoints

```
─── AUTH ──────────────────────────────────────────────────────────────
POST /api/v1/auth/webhook
  Body: Clerk webhook payload
  Action: Upsert user record from Clerk event

GET /api/v1/auth/me
  Response: { id, email, display_name, orgs: [{ id, slug, role }] }

─── ORGANIZATIONS ─────────────────────────────────────────────────────
GET /api/v1/orgs/current
  Response: { id, slug, display_name, plan, github_reader_install_id, github_docs_install_id, docs_repo_full_name }

PUT /api/v1/orgs/current
  Body: { docs_repo_full_name?: string, display_name?: string }
  Permission: admin+

GET /api/v1/orgs/current/members
  Response: [{ user_id, email, display_name, role, accepted_at }]

POST /api/v1/orgs/current/members/invite
  Body: { email: string, role: org_role }
  Permission: admin+

DELETE /api/v1/orgs/current/members/:userId
  Permission: admin+

─── BILLING (Stripe) ───────────────────────────────────────────────────
GET /api/v1/billing/summary
  Response: { plan, status, current_period_end, cancel_at_period_end }

GET /api/v1/billing/usage
  Response: { limits: { ... }, usage: { ... }, period_start, period_end }

POST /api/v1/billing/checkout
  Body: { plan: 'pro' | 'enterprise' }
  Action: Create Stripe Checkout Session
  Response: { url: string }
  Permission: owner+

POST /api/v1/billing/portal
  Action: Create Stripe Customer Portal Session
  Response: { url: string }
  Permission: owner+

─── GITHUB APPS ───────────────────────────────────────────────────────
GET /api/v1/github/reader-app-url
  Response: { install_url: string }  // https://github.com/apps/graphfly-reader/installations/new

GET /api/v1/github/docs-app-url
  Response: { install_url: string }  // https://github.com/apps/graphfly-docs/installations/new

GET /api/v1/github/reader/callback?installation_id=<id>&setup_action=install
  Action: Store github_reader_install_id on org, list accessible repos
  Response: Redirect to /onboarding/repos

GET /api/v1/github/docs/callback?installation_id=<id>&setup_action=install
  Action: Store github_docs_install_id on org (docs repo write), verify docs repo configured
  Response: Redirect to /onboarding/indexing (or /onboarding/ready if indexing already complete)

─── REPOS ─────────────────────────────────────────────────────────────
GET /api/v1/repos
  Response: [Repo]

POST /api/v1/repos
  Body: { github_repo_id: number }
  Action: Create repo record, enqueue full index job
  Response: Repo

DELETE /api/v1/repos/:repoId
  Action: Soft-delete (set is_active=false), stop future indexing
  Permission: admin+

GET /api/v1/repos/:repoId
  Response: Repo (with coverage_pct, graph_node_count, last_indexed_at)

POST /api/v1/repos/:repoId/reindex
  Action: Enqueue full index job (force re-parse all files)
  Permission: admin+

─── GRAPH ─────────────────────────────────────────────────────────────
GET /api/v1/repos/:repoId/graph/nodes
  Query: ?type=Function&file=src/auth.ts&page=1&limit=50
  Response: { nodes: [GraphNode], total: number, page: number }

GET /api/v1/repos/:repoId/graph/nodes/:nodeId
  Response: GraphNode (public contract fields included; embedding omitted by default; include with ?include_embedding=true). Never returns source code bodies.

GET /api/v1/repos/:repoId/graph/edges
  Query: ?source=<nodeId>&target=<nodeId>&type=Calls
  Response: [GraphEdge]

GET /api/v1/repos/:repoId/graph/edges/:edgeId/occurrences
  Query: ?page=1&limit=200
  Response: { occurrences: [GraphEdgeOccurrence], total: number }

GET /api/v1/repos/:repoId/graph/blast-radius/:nodeId
  Query: ?depth=2
  Response: { affected_nodes: [GraphNode], edges: [GraphEdge], depth: number }

GET /api/v1/repos/:repoId/graph/neighborhood/:nodeId
  Query: ?depth=1&limit=500&edge_types=Calls,Uses,Imports
  Response: { center: GraphNode, nodes: [GraphNode], edges: [GraphEdge], depth: number }

GET /api/v1/repos/:repoId/graph/flow/:entrypointNodeId
  Query: ?max_depth=5
  Response: { path: [GraphNode], edges: [GraphEdge] }

GET /api/v1/repos/:repoId/graph/search
  Query: ?q=loginUser&mode=text|semantic&limit=20
  Response: { nodes: [GraphNode & { score: number }] }

─── FLOWS (Entrypoints + Flow Graphs) ──────────────────────────────────
GET /api/v1/repos/:repoId/flows/entrypoints
  Query: ?kind=http_route
  Response: [FlowEntrypoint]

GET /api/v1/repos/:repoId/flows/entrypoints/:entrypointId
  Response: FlowEntrypoint

GET /api/v1/repos/:repoId/flows/entrypoints/:entrypointId/graph
  Query: ?sha=<commit>&max_depth=5
  Response: { nodes: [GraphNode], edges: [GraphEdge] }  // materialized flow graph (no code bodies)

─── DEPENDENCIES (Manifests + Observed) ─────────────────────────────────
GET /api/v1/repos/:repoId/deps/manifests
  Response: [DependencyManifest]

GET /api/v1/repos/:repoId/deps/declared
  Query: ?scope=prod
  Response: [DeclaredDependency]

GET /api/v1/repos/:repoId/deps/observed
  Response: [ObservedDependency]

GET /api/v1/repos/:repoId/deps/mismatches
  Response: [DependencyMismatch]

─── DOCUMENTATION ─────────────────────────────────────────────────────
GET /api/v1/repos/:repoId/docs/blocks
  Query: ?status=stale&file=api/auth.md&type=function&page=1&limit=20
  Response: { blocks: [DocBlock], total: number }

GET /api/v1/repos/:repoId/docs/blocks/:blockId
  Response: DocBlock

GET /api/v1/repos/:repoId/docs/blocks/:blockId/evidence
  Response: [DocEvidence & { node: GraphNode }]

PUT /api/v1/repos/:repoId/docs/blocks/:blockId
  Body: { content: string }
  Action: Update content + hash, enqueue PR for this single block
  Permission: admin+

POST /api/v1/repos/:repoId/docs/blocks/:blockId/regenerate
  Action: Enqueue doc agent job for single block only
  Permission: developer+

─── PR RUNS ───────────────────────────────────────────────────────────
GET /api/v1/repos/:repoId/pr-runs
  Query: ?page=1&limit=20&status=success
  Response: { runs: [PrRun], total: number }

GET /api/v1/repos/:repoId/pr-runs/:runId
  Response: PrRun (full)

GET /api/v1/repos/:repoId/pr-runs/:runId/blocks
  Response: { updated: [DocBlock], created: [DocBlock] }

─── COVERAGE ──────────────────────────────────────────────────────────
GET /api/v1/repos/:repoId/coverage
  Response: {
    overall_pct: number,
    by_type: { Function: number, Class: number, Module: number },
    total_nodes: number,
    documented_nodes: number,
    undocumented_entry_points: [{ node: GraphNode, caller_count: number }],
    unresolved_imports: [{ module: string, count: number, category: string }]
  }

─── WEBHOOKS (no JWT — HMAC only) ─────────────────────────────────────
POST /webhooks/github
  Headers: X-Hub-Signature-256, X-GitHub-Event, X-GitHub-Delivery
  Events handled: push, installation, installation_repositories

POST /webhooks/stripe
  Headers: Stripe-Signature
  Events handled: checkout.session.completed, customer.subscription.*, invoice.*
```

**Stripe webhook processing (idempotent):**
- Verify signature using Stripe’s signing secret for the endpoint.
- Deduplicate by Stripe event ID (`stripe_events.stripe_event_id` unique).
- Update `org_billing` snapshot + `orgs.plan` as needed, then recompute entitlements.

```typescript
// Pseudocode
async function handleStripeWebhook(rawBody: Buffer, signature: string | undefined) {
  const event = stripe.webhooks.constructEvent(rawBody, signature!, STRIPE_WEBHOOK_SECRET);
  const alreadySeen = await db.stripe_events.tryInsert(event.id, event.type);
  if (!alreadySeen.inserted) return { ok: true, deduped: true };

  switch (event.type) {
    case 'checkout.session.completed':
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'invoice.paid':
    case 'invoice.payment_failed':
      await syncOrgBillingFromStripe(event);
      break;
  }
  return { ok: true };
}
```

### 3.3 WebSocket Events (Socket.IO)

Client connects:
```javascript
const socket = io(GRAPHFLY_WS_URL, { auth: { token: clerkJwt } });
socket.emit('subscribe', { repoId: 'uuid...' });
```

Server events:
```typescript
// Indexing
socket.emit('index:progress', {
  repoId: string,
  pct: number,      // 0-100
  file: string,     // current file being parsed
  nodesProcessed: number,
  edgesProcessed: number,
});
socket.emit('index:complete', {
  repoId: string,
  sha: string,
  stats: { files_processed, nodes_emitted, edges_emitted, duration_ms }
});
socket.emit('index:error', { repoId: string, error: string });

// Doc Agent
socket.emit('agent:start', {
  repoId: string,
  prRunId: string,
  triggerSha: string,
});
socket.emit('agent:tool_call', {
  prRunId: string,
  tool: string,
  args: Record<string, unknown>,
});
socket.emit('agent:tool_result', {
  prRunId: string,
  tool: string,
  result_summary: string,  // Short human-readable summary
});
socket.emit('agent:complete', {
  prRunId: string,
  docs_pr_url: string,
  blocks_updated: number,
  blocks_created: number,
});
socket.emit('agent:error', {
  prRunId: string,
  error: string,
});
```

---

## 4. GitHub Apps Integration

### 4.1 App Configuration

```yaml
# GitHub Reader App Manifest (source repos; read-only)
name: Graphfly Reader
url: https://graphfly.app
webhook_url: https://graphfly.app/webhooks/github
webhook_secret: ${GITHUB_WEBHOOK_SECRET}

permissions:
  contents: read        # Read source files for indexing (NO WRITES)
  metadata: read        # List repos in installation

events:
  - push
  - installation
  - installation_repositories
---
# GitHub Docs App Manifest (docs repo only; write docs PRs)
name: Graphfly Docs
url: https://graphfly.app
webhook_url: https://graphfly.app/webhooks/github
webhook_secret: ${GITHUB_WEBHOOK_SECRET}

permissions:
  contents: write       # Create branches, commit markdown files (docs repo only)
  pull_requests: write  # Open PRs in docs repo
  metadata: read

events:
  - installation
  - installation_repositories
```

### 4.2 Webhook Signature Validation

```typescript
function verifyWebhookSignature(
  body: Buffer,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature) return false;
  const hmac = createHmac('sha256', secret);
  hmac.update(body);
  const expected = `sha256=${hmac.digest('hex')}`;
  // Constant-time comparison (requires equal length)
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
```

### 4.3 Push Webhook Processing

```typescript
async function handlePushWebhook(payload: PushEvent) {
  const repo = payload.repository;
  const branch = payload.ref.replace('refs/heads/', '');

  // Only process pushes to default branch
  if (branch !== repo.default_branch) return;

  // Webhook is from the Reader App installation. Resolve org + repo safely.
  const org = await db.orgs.findByReaderInstallationId(payload.installation.id);
  if (!org) return;

  const repoRecord = await db.repos.findByTenantAndGithubRepoId(org.id, repo.id);
  if (!repoRecord) return;
  if (!repoRecord.is_active) return;

  // Extract changed files (add + modify; handle removes separately)
  const changedFiles = [...new Set(
    payload.commits.flatMap(c => [...c.added, ...c.modified])
  )];
  const removedFiles = [...new Set(
    payload.commits.flatMap(c => c.removed)
  )];

  // Enqueue incremental index
  await indexQueue.add('incremental', {
    tenantId: repoRecord.tenant_id,
    repoId: repoRecord.id,
    readerInstallId: payload.installation.id,
    fullName: repo.full_name,
    sha: payload.after,
    changedFiles,
    removedFiles,
  }, {
    jobId: `index:${repoRecord.id}:${payload.after}`,  // Dedup by sha
    priority: 5,
  });
}
```

### 4.4 Installation Token Authentication

```typescript
// packages/github-service/src/app-auth.ts
import { createAppAuth } from '@octokit/auth-app';

const readerAuth = createAppAuth({
  appId: process.env.GITHUB_READER_APP_ID!,
  privateKey: process.env.GITHUB_READER_PRIVATE_KEY!,  // From secrets manager
});

const docsAuth = createAppAuth({
  appId: process.env.GITHUB_DOCS_APP_ID!,
  privateKey: process.env.GITHUB_DOCS_PRIVATE_KEY!,
});

export async function cloneRepo(
  readerInstallationId: number,
  fullName: string,
  sha: string
): Promise<string> {
  const { token } = await readerAuth({
    type: 'installation',
    installationId: readerInstallationId,
  });

  const [owner, repo] = fullName.split('/');
  const clonePath = `/tmp/graphfly/${sha}-${Date.now()}`;

  // SECURITY: do not embed tokens in clone URLs (leaks via logs/process lists).
  // Prefer auth via headers/askpass and keep token out of command args.
  await git.clone(`https://github.com/${owner}/${repo}.git`, clonePath, ['--depth', '1', '--no-single-branch'], {
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      // e.g., GIT_ASKPASS points to a script that reads token from env and prints it.
      GIT_ASKPASS: process.env.GIT_ASKPASS_HELPER_PATH!,
      GRAPHFLY_GIT_USERNAME: 'x-access-token',
      GRAPHFLY_GIT_PASSWORD: token,
    }
  });
  await git.checkout(sha, { cwd: clonePath });

  return clonePath;
}

export async function getDocsInstallationToken(docsInstallationId: number): Promise<string> {
  const { token } = await docsAuth({
    type: 'installation',
    installationId: docsInstallationId,
  });
  return token;
}
```

---

## 5. Build Sequence

### Phase 1: Foundation (Weeks 1–3)
**Goal:** Graph data in PostgreSQL from a manually triggered index

1. Database: PostgreSQL + pgvector schema (all tables above), db-migrate
2. Redis + BullMQ setup with `index.jobs` queue
3. API skeleton: Express + Clerk JWT middleware + RLS tenant injection
4. **Extract `yantra-indexer` Rust CLI** from Yantra:
   - Source: `/Users/vivekdurairaj/Projects/yantra/src-tauri/src/gnn/`
   - Keep: `mod.rs`, all 12 parsers, `symbol_resolver.rs`, `incremental.rs`, `embeddings.rs`
   - Remove: `persistence.rs`, `hnsw_index.rs`, `graph.rs`, all `tauri::*`
   - Add: `packages/indexer/src/main.rs` (CLI args + NDJSON stdout)
5. `IndexerWorker`: BullMQ consumer → spawn Rust CLI → stream NDJSON → batch upsert PostgreSQL
6. Socket.IO `index:progress` / `index:complete` events
7. Basic graph query endpoints: `/graph/nodes`, `/graph/edges`

**Milestone:** Manually trigger index on test repo → `GET /graph/nodes` returns real data

### Phase 2: GitHub Integration (Weeks 4–5)
8. Register GitHub Reader App (source repos, read-only) and GitHub Docs App (docs repo only, write)
9. Implement `/api/v1/github/reader/callback` and `/api/v1/github/docs/callback`
10. Implement `POST /webhooks/github` → HMAC validation + push → incremental index jobs (Reader App only)
11. `GitHubService.cloneRepo()` using Reader installation token (no token-in-URL)
12. Clerk integration: JWT validation, org creation, request-scoped tenant injection (`SET` + `RESET`), RBAC
13. Onboarding API: connect source repos, select docs repo, validate Docs App installation

**Milestone:** Install Reader App + connect repo → push triggers automatic incremental index; Docs App installed on docs repo → docs PRs open automatically

### Phase 3: Documentation Agent (Weeks 6–8)
14. `DocAgentWorker` with `TurnOutcome` loop (port of Yantra's `loop_core.rs`)
15. All 9 doc agent tools implemented with PostgreSQL backend
16. Surgical update algorithm (phases 1–5 above)
17. `pr_runs` table + `/pr-runs` API endpoints
18. Socket.IO `agent:*` event streaming

**Milestone:** Push code → automatic docs PR opens in docs repo within 3 minutes

### Phase 4: Frontend (Weeks 9–11)
19. React SPA setup with routing (React Router v6)
20. Adapt Yantra UI components:
    - `DependencyGraphView.tsx` → remove `invoke()`, use REST
    - `BlastRadiusCard.tsx` → use `/graph/blast-radius/:nodeId` API
    - `CodeGraphSidebar.tsx` → add doc block links
21. Dashboard, Graph Explorer, Doc Block View
22. PR Timeline + Coverage Dashboard
23. Full onboarding flow (6 steps from UX spec)
24. Real-time socket updates wired into all views

**Milestone:** Complete UX, <5 min onboarding, all views functional

### Phase 5: Enterprise Hardening (Weeks 12–14)
25. RLS penetration test (verify tenant A cannot see tenant B data)
26. Rate limiting enforcement per plan tier
27. Large repo chunked indexing (>10,000 files)
28. Stripe billing integration + plan enforcement
29. Monitoring (Datadog): queue depth, index latency, agent duration, error rates
30. Secrets management (Doppler): GitHub private key, webhook secret, DB credentials
31. Webhook replay dedup (`X-GitHub-Delivery` in Redis with 24h TTL)

---

## 6. Critical Source Files Reference

| Purpose | Source File |
|---------|-------------|
| Graph types (CodeNode, NodeType, EdgeType) — defines Rust↔Node contract | `yantra/src-tauri/src/gnn/mod.rs` |
| SQLite schema to migrate to PostgreSQL | `yantra/src-tauri/src/gnn/persistence.rs` |
| Blast radius traversal (port to SQL JOINs) | `yantra/src-tauri/src/gnn/dependency_search.rs` |
| Incremental dirty tracking (keep in Rust) | `yantra/src-tauri/src/gnn/incremental.rs` |
| SymbolResolver for cross-file imports | `yantra/src-tauri/src/gnn/symbol_resolver.rs` |
| Agent TurnOutcome loop (port to TypeScript) | `yantra/src-tauri/src/agent/loop_core.rs` |
| Tool factory pattern with TypeBox schemas | `openclaw/src/agents/openclaw-tools.ts` |
| Command queue to adapt to BullMQ | `openclaw/src/process/command-queue.ts` |
| Webhook routing pattern | `openclaw/src/gateway/hooks-mapping.ts` |
| Graph visualization component | `yantra/src-ui-react/src/components/DependencyGraphView.tsx` |
| Blast radius UI component | `yantra/src-ui-react/src/components/BlastRadiusCard.tsx` |
| Node detail sidebar | `yantra/src-ui-react/src/components/CodeGraphSidebar.tsx` |
| Activity timeline (for PR history) | `yantra/src-ui-react/src/components/ActivityTimeline.tsx` |

---

## Navigation
- [← Requirements](02_REQUIREMENTS.md)
- [Next: UX Spec →](04_UX_SPEC.md)
