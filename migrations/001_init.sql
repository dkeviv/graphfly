-- Graphfly initial schema (spec-aligned)
-- Source of truth: docs/03_TECHNICAL_SPEC.md

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ═══════════════════════════════════════════════════════════════════════
-- ORGS / REPOS
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS orgs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Optional enterprise metadata columns (added in-place for forward-compat).
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free'
  CHECK (plan IN ('free','pro','enterprise'));
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS github_reader_install_id BIGINT;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS github_docs_install_id BIGINT;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS docs_repo_full_name TEXT;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS idx_orgs_slug_unique ON orgs(slug) WHERE slug IS NOT NULL;

CREATE TABLE IF NOT EXISTS repos (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id         UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    full_name         TEXT NOT NULL, -- "org/repo"
    default_branch    TEXT NOT NULL DEFAULT 'main',
    github_repo_id    BIGINT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, full_name)
);

-- ═══════════════════════════════════════════════════════════════════════
-- BILLING (Stripe) + USAGE COUNTERS (enterprise scaffolding)
-- ═══════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'stripe_subscription_status') THEN
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
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS org_billing (
    org_id                 UUID PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,
    stripe_customer_id     TEXT NOT NULL,
    stripe_subscription_id TEXT,
    stripe_price_id        TEXT,
    status                 stripe_subscription_status,
    current_period_start   TIMESTAMPTZ,
    current_period_end     TIMESTAMPTZ,
    cancel_at_period_end   BOOLEAN NOT NULL DEFAULT false,
    trial_end              TIMESTAMPTZ,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_org_billing_status ON org_billing(status);

CREATE TABLE IF NOT EXISTS stripe_events (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID REFERENCES orgs(id) ON DELETE SET NULL,
    stripe_event_id TEXT NOT NULL UNIQUE,
    type            TEXT NOT NULL,
    received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at    TIMESTAMPTZ,
    error_message   TEXT
);

CREATE TABLE IF NOT EXISTS usage_counters (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id        UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    key           TEXT NOT NULL,
    period_start  DATE NOT NULL,
    period_end    DATE NOT NULL,
    value         INTEGER NOT NULL DEFAULT 0,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, key, period_start)
);
CREATE INDEX IF NOT EXISTS idx_usage_org_key ON usage_counters(org_id, key);

-- ═══════════════════════════════════════════════════════════════════════
-- GRAPH NODES (Code Intelligence Graph + Public Contract Graph)
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS graph_nodes (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    repo_id         UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    node_key        TEXT NOT NULL,  -- legacy/deterministic per-indexer key

    -- Robust identity
    symbol_uid      TEXT NOT NULL,
    qualified_name  TEXT,
    symbol_kind     TEXT, -- function/method/class/module/etc. (contract-first; no bodies)
    container_uid   TEXT, -- symbol_uid of container (module/class/file), if any
    exported_name   TEXT, -- export name if different from `name`

    name            TEXT,
    node_type       TEXT NOT NULL,
    language        TEXT,
    file_path       TEXT,
    line_start      INTEGER,
    line_end        INTEGER,
    visibility      TEXT
                    CHECK (visibility IN ('public','internal','private')),

    -- Contract-first (no code bodies)
    signature       TEXT,
    signature_hash  TEXT,
    declaration     TEXT,
    docstring       TEXT,
    type_annotation TEXT,
    return_type     TEXT,
    parameters      JSONB,
    contract        JSONB,
    constraints     JSONB,
    allowable_values JSONB,
    external_ref    JSONB,

    -- Semantic search (pgvector)
    embedding       vector(384),
    embedding_text  TEXT,

    first_seen_sha  TEXT NOT NULL,
    last_seen_sha   TEXT NOT NULL,
    indexed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (tenant_id, repo_id, symbol_uid),
    UNIQUE (tenant_id, repo_id, node_key)
);

-- Optional schema enrichments (idempotent for existing DBs).
ALTER TABLE graph_nodes ADD COLUMN IF NOT EXISTS symbol_kind TEXT;
ALTER TABLE graph_nodes ADD COLUMN IF NOT EXISTS container_uid TEXT;
ALTER TABLE graph_nodes ADD COLUMN IF NOT EXISTS exported_name TEXT;
ALTER TABLE graph_nodes ADD COLUMN IF NOT EXISTS container_node_id UUID;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_graph_nodes_container_node') THEN
    ALTER TABLE graph_nodes
      ADD CONSTRAINT fk_graph_nodes_container_node
      FOREIGN KEY (container_node_id) REFERENCES graph_nodes(id) ON DELETE SET NULL;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_gn_repo ON graph_nodes(tenant_id, repo_id);
CREATE INDEX IF NOT EXISTS idx_gn_file ON graph_nodes(tenant_id, repo_id, file_path);
CREATE INDEX IF NOT EXISTS idx_gn_type ON graph_nodes(tenant_id, repo_id, node_type);
CREATE INDEX IF NOT EXISTS idx_gn_name ON graph_nodes(tenant_id, repo_id, name);
CREATE INDEX IF NOT EXISTS idx_gn_uid ON graph_nodes(tenant_id, repo_id, symbol_uid);
CREATE INDEX IF NOT EXISTS idx_gn_container_uid ON graph_nodes(tenant_id, repo_id, container_uid) WHERE container_uid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gn_embedding_hnsw ON graph_nodes
    USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 200);

-- ═══════════════════════════════════════════════════════════════════════
-- GRAPH EDGES + EDGE OCCURRENCES
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS graph_edges (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    repo_id         UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    source_node_id  UUID NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
    target_node_id  UUID NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
    edge_type       TEXT NOT NULL,
    metadata        JSONB,
    first_seen_sha  TEXT NOT NULL,
    last_seen_sha   TEXT NOT NULL,
    indexed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, repo_id, source_node_id, target_node_id, edge_type)
);

CREATE INDEX IF NOT EXISTS idx_ge_source ON graph_edges(tenant_id, source_node_id);
CREATE INDEX IF NOT EXISTS idx_ge_target ON graph_edges(tenant_id, target_node_id);
CREATE INDEX IF NOT EXISTS idx_ge_repo_type ON graph_edges(tenant_id, repo_id, edge_type);
CREATE INDEX IF NOT EXISTS idx_ge_repo_source_type ON graph_edges(tenant_id, repo_id, source_node_id, edge_type);
CREATE INDEX IF NOT EXISTS idx_ge_repo_target_type ON graph_edges(tenant_id, repo_id, target_node_id, edge_type);

CREATE TABLE IF NOT EXISTS graph_edge_occurrences (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    repo_id         UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    edge_id         UUID NOT NULL REFERENCES graph_edges(id) ON DELETE CASCADE,
    file_path       TEXT NOT NULL,
    line_start      INTEGER NOT NULL,
    line_end        INTEGER NOT NULL,
    occurrence_kind TEXT NOT NULL
                    CHECK (occurrence_kind IN ('call','import','inherit','use','dataflow','route_map','other')),
    sha             TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, repo_id, edge_id, file_path, line_start, line_end)
);

CREATE INDEX IF NOT EXISTS idx_geo_edge ON graph_edge_occurrences(tenant_id, repo_id, edge_id);
CREATE INDEX IF NOT EXISTS idx_geo_file ON graph_edge_occurrences(tenant_id, repo_id, file_path);

-- ═══════════════════════════════════════════════════════════════════════
-- FLOW ENTRYPOINTS
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS flow_entrypoints (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    repo_id         UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    entrypoint_key  TEXT NOT NULL,
    entrypoint_type TEXT NOT NULL,
    method          TEXT,
    path            TEXT,
    symbol_uid      TEXT,
    file_path       TEXT,
    line_start      INTEGER,
    line_end        INTEGER,
    indexed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, repo_id, entrypoint_key)
);

CREATE TABLE IF NOT EXISTS flow_graphs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    repo_id         UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    entrypoint_key  TEXT NOT NULL,
    start_symbol_uid TEXT NOT NULL,
    sha             TEXT NOT NULL,
    depth           INTEGER NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, repo_id, entrypoint_key, sha, depth)
);
CREATE INDEX IF NOT EXISTS idx_fg_repo ON flow_graphs(tenant_id, repo_id, created_at DESC);

CREATE TABLE IF NOT EXISTS flow_graph_nodes (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id     UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    repo_id       UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    flow_graph_id UUID NOT NULL REFERENCES flow_graphs(id) ON DELETE CASCADE,
    node_id       UUID NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, repo_id, flow_graph_id, node_id)
);
CREATE INDEX IF NOT EXISTS idx_fgn_graph ON flow_graph_nodes(tenant_id, repo_id, flow_graph_id);

CREATE TABLE IF NOT EXISTS flow_graph_edges (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id     UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    repo_id       UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    flow_graph_id UUID NOT NULL REFERENCES flow_graphs(id) ON DELETE CASCADE,
    edge_id       UUID NOT NULL REFERENCES graph_edges(id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, repo_id, flow_graph_id, edge_id)
);
CREATE INDEX IF NOT EXISTS idx_fge_graph ON flow_graph_edges(tenant_id, repo_id, flow_graph_id);

-- ═══════════════════════════════════════════════════════════════════════
-- DEPENDENCY & MANIFEST INTELLIGENCE
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS dependency_manifests (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id     UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    repo_id       UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    manifest_type TEXT NOT NULL,
    file_path     TEXT NOT NULL,
    sha           TEXT NOT NULL,
    parsed        JSONB,
    parsed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, repo_id, file_path, sha)
);

CREATE TABLE IF NOT EXISTS packages (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ecosystem     TEXT NOT NULL,
    name          TEXT NOT NULL,
    source        TEXT,
    homepage      TEXT,
    license       TEXT,
    UNIQUE (ecosystem, name)
);

CREATE TABLE IF NOT EXISTS declared_dependencies (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id     UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    repo_id       UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    manifest_id   UUID NOT NULL REFERENCES dependency_manifests(id) ON DELETE CASCADE,
    package_id    UUID NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
    scope         TEXT NOT NULL
                  CHECK (scope IN ('prod','dev','optional','peer','build','test','unknown')),
    version_range TEXT,
    metadata      JSONB,
    UNIQUE (tenant_id, repo_id, manifest_id, package_id, scope)
);

CREATE TABLE IF NOT EXISTS observed_dependencies (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id     UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    repo_id       UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    package_id    UUID NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
    source_node_id UUID REFERENCES graph_nodes(id) ON DELETE SET NULL,
    evidence      JSONB,
    first_seen_sha TEXT NOT NULL,
    last_seen_sha  TEXT NOT NULL,
    UNIQUE (tenant_id, repo_id, package_id, source_node_id)
);

CREATE TABLE IF NOT EXISTS dependency_mismatches (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id     UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    repo_id       UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    mismatch_type TEXT NOT NULL
                  CHECK (mismatch_type IN ('declared_not_observed','observed_not_declared','version_conflict')),
    package_id    UUID REFERENCES packages(id) ON DELETE SET NULL,
    details       JSONB NOT NULL,
    sha           TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════
-- INDEX DIAGNOSTICS (Incremental correctness transparency)
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS index_diagnostics (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id   UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    repo_id     UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    sha         TEXT NOT NULL,
    mode        TEXT NOT NULL
                CHECK (mode IN ('full','incremental')),
    diagnostic  JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, repo_id, sha, mode)
);
CREATE INDEX IF NOT EXISTS idx_idxdiag_repo ON index_diagnostics(tenant_id, repo_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════
-- DOC BLOCKS + EVIDENCE + PR RUNS (docs repo output)
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS doc_blocks (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    repo_id         UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    doc_file        TEXT NOT NULL,
    block_anchor    TEXT NOT NULL,
    block_type      TEXT NOT NULL
                    CHECK (block_type IN (
                        'overview', 'function', 'class', 'flow',
                        'module', 'api_endpoint', 'schema', 'package'
                    )),
    status          TEXT NOT NULL DEFAULT 'fresh'
                    CHECK (status IN ('fresh','stale','locked','error')),
    content         TEXT NOT NULL,
    content_hash    TEXT NOT NULL,
    last_index_sha  TEXT,
    last_pr_id      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, repo_id, doc_file, block_anchor)
);

CREATE TABLE IF NOT EXISTS doc_evidence (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    repo_id         UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    doc_block_id    UUID NOT NULL REFERENCES doc_blocks(id) ON DELETE CASCADE,
    node_id         UUID REFERENCES graph_nodes(id) ON DELETE SET NULL,
    symbol_uid      TEXT NOT NULL,
    qualified_name  TEXT,
    file_path       TEXT,
    line_start      INTEGER,
    line_end        INTEGER,
    sha             TEXT NOT NULL,
    contract_hash   TEXT,
    evidence_kind   TEXT NOT NULL DEFAULT 'contract_location'
                    CHECK (evidence_kind IN ('contract_location','flow','dependency','other')),
    evidence_weight NUMERIC(3,2) DEFAULT 1.0
);

CREATE INDEX IF NOT EXISTS idx_de_node_block ON doc_evidence(node_id, doc_block_id);
CREATE INDEX IF NOT EXISTS idx_de_symbol_uid ON doc_evidence(symbol_uid);
CREATE INDEX IF NOT EXISTS idx_de_block ON doc_evidence(doc_block_id);
CREATE INDEX IF NOT EXISTS idx_de_tenant ON doc_evidence(tenant_id);

CREATE TABLE IF NOT EXISTS pr_runs (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id        UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    repo_id          UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    trigger_sha      TEXT NOT NULL,
    trigger_pr_num   INTEGER,
    status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','running','success','failure','skipped')),
    docs_branch      TEXT,
    docs_pr_number   INTEGER,
    docs_pr_url      TEXT,
    blocks_updated   INTEGER DEFAULT 0,
    blocks_created   INTEGER DEFAULT 0,
    blocks_unchanged INTEGER DEFAULT 0,
    trigger_node_ids UUID[],
    agent_session_id TEXT,
    error_message    TEXT,
    started_at       TIMESTAMPTZ,
    completed_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pr_repo ON pr_runs(tenant_id, repo_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pr_status ON pr_runs(tenant_id, status);

ALTER TABLE doc_blocks
    ADD CONSTRAINT IF NOT EXISTS fk_last_pr
    FOREIGN KEY (last_pr_id) REFERENCES pr_runs(id) ON DELETE SET NULL;

-- ═══════════════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY (tenant-scoped tables)
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE orgs ENABLE ROW LEVEL SECURITY;
ALTER TABLE repos ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_billing ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_edge_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_entrypoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_graphs ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_graph_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_graph_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE dependency_manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE declared_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE observed_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE dependency_mismatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE index_diagnostics ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE pr_runs ENABLE ROW LEVEL SECURITY;

-- RLS policy pattern (replicate per table)
DROP POLICY IF EXISTS tenant_self_orgs ON orgs;
CREATE POLICY tenant_self_orgs ON orgs
    USING (id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_repos ON repos;
CREATE POLICY tenant_isolation_repos ON repos
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_org_billing ON org_billing;
CREATE POLICY tenant_isolation_org_billing ON org_billing
    USING (org_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_stripe_events ON stripe_events;
CREATE POLICY tenant_isolation_stripe_events ON stripe_events
    USING (org_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_usage_counters ON usage_counters;
CREATE POLICY tenant_isolation_usage_counters ON usage_counters
    USING (org_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_graph_nodes ON graph_nodes;
CREATE POLICY tenant_isolation_graph_nodes ON graph_nodes
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_graph_edges ON graph_edges;
CREATE POLICY tenant_isolation_graph_edges ON graph_edges
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_graph_edge_occurrences ON graph_edge_occurrences;
CREATE POLICY tenant_isolation_graph_edge_occurrences ON graph_edge_occurrences
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_flow_entrypoints ON flow_entrypoints;
CREATE POLICY tenant_isolation_flow_entrypoints ON flow_entrypoints
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_flow_graphs ON flow_graphs;
CREATE POLICY tenant_isolation_flow_graphs ON flow_graphs
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_flow_graph_nodes ON flow_graph_nodes;
CREATE POLICY tenant_isolation_flow_graph_nodes ON flow_graph_nodes
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_flow_graph_edges ON flow_graph_edges;
CREATE POLICY tenant_isolation_flow_graph_edges ON flow_graph_edges
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_dependency_manifests ON dependency_manifests;
CREATE POLICY tenant_isolation_dependency_manifests ON dependency_manifests
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_declared_dependencies ON declared_dependencies;
CREATE POLICY tenant_isolation_declared_dependencies ON declared_dependencies
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_observed_dependencies ON observed_dependencies;
CREATE POLICY tenant_isolation_observed_dependencies ON observed_dependencies
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_dependency_mismatches ON dependency_mismatches;
CREATE POLICY tenant_isolation_dependency_mismatches ON dependency_mismatches
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_index_diagnostics ON index_diagnostics;
CREATE POLICY tenant_isolation_index_diagnostics ON index_diagnostics
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_doc_blocks ON doc_blocks;
CREATE POLICY tenant_isolation_doc_blocks ON doc_blocks
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_doc_evidence ON doc_evidence;
CREATE POLICY tenant_isolation_doc_evidence ON doc_evidence
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_pr_runs ON pr_runs;
CREATE POLICY tenant_isolation_pr_runs ON pr_runs
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
