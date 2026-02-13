# Graphfly — Architecture Specification

**Version**: 1.0
**Last Updated**: February 2026
**Status**: Draft

---

## Navigation
- [← Index](00_INDEX.md)
- [Next: Requirements →](02_REQUIREMENTS.md)

---

## 1. Architecture Analysis: Yantra → Graphfly SaaS

### 1.1 What Yantra Gets Right (Reuse)

Yantra's Code Intelligence Graph engine is genuinely strong. The key parts to carry forward:

| Component | File | Why It's Good |
|-----------|------|---------------|
| 12 tree-sitter parsers | `src-tauri/src/gnn/parser*.rs` | Production-quality AST parsing for all major languages, extracts functions/classes/imports/calls |
| 32-type edge model | `src-tauri/src/gnn/mod.rs` | Covers all relationship types: Calls, Imports, Inherits, DataFlow, ControlFlow, ExceptionFlow, AsyncFlow, ForeignKey — much richer than most graph tools |
| SymbolResolver | `src-tauri/src/gnn/symbol_resolver.rs` | Language-aware cross-file import resolution (venv, node_modules, Cargo registry), handles relative imports, aliases, star imports |
| IncrementalTracker | `src-tauri/src/gnn/incremental.rs` | <50ms per file change via SHA-based dirty tracking + cascading invalidation |
| fastembed + HNSW | `src-tauri/src/gnn/embeddings.rs`, `hnsw_index.rs` | 384-dim all-MiniLM-L6-v2, <10ms semantic search — keep embedding generation in Rust, move indexing to pgvector HNSW |
| Agent TurnOutcome loop | `src-tauri/src/agent/loop_core.rs` | Clean `Final | ToolCalls` state machine with proven convergence |
| Graph UI components | `src-ui-react/src/components/` | DependencyGraphView, BlastRadiusCard, CodeGraphSidebar — real Cytoscape.js integration, just needs Tauri `invoke()` replaced |

### 1.2 What Yantra Cannot Do in Cloud (Replace)

| Current Design | Why It Fails for SaaS | Replacement |
|----------------|----------------------|-------------|
| Tauri `invoke()` IPC | Desktop-only bridge, no HTTP | REST API + WebSocket |
| SQLite (single-file) | No concurrent writers, no tenant isolation, no vector ops, no cross-process access | PostgreSQL + pgvector |
| In-process HNSW index | Lives in one process's RAM, lost on restart, not tenant-isolated | pgvector HNSW (RLS applies automatically) |
| File-based session store (`~/.openclaw/`) | Not durable across restarts, not distributed, single machine | Redis + PostgreSQL |
| In-memory OpenClaw command queue | Lost on process restart, no retry, no dead-letter, no horizontal scale | BullMQ on Redis |
| Local `~/.yantra/` filesystem | Single machine, no multi-user, no cloud access | PostgreSQL + S3 |
| Tauri app bundle | Requires desktop install, no web access, no team sharing | React SPA (web) |
| No RBAC, no org concept | Not enterprise-safe | Row-Level Security + org/role model |

### 1.3 The Core Architecture Principle

**Split the indexing engine from the storage.**

Yantra's mistake is that the indexing logic (CPU-intensive, Rust, tree-sitter parsing) is tightly coupled to the storage (SQLite) and the UI (Tauri). For SaaS, these must be separated:

```
[Rust CLI: indexing engine]  →  [Node.js worker: persistence]  →  [PostgreSQL: storage]
         ↑                                    ↑                            ↑
   Keep in Rust              Streams NDJSON           Multi-tenant, RLS
   (CPU work, parsing)       over stdout              vector search
```

---

## 2. System Architecture

### 2.1 Service Map

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              INTERNET BOUNDARY                               │
│                                                                              │
│   GitHub Reader App Webhooks ─┐         Browser (React SPA)                 │
│                              │                   │                           │
└──────────────────────────────│───────────────────│───────────────────────────┘
                               │                   │
                       ┌───────▼───────────────────▼────────┐
                       │           API Gateway               │
                       │       (Node.js / Express 5)         │
                       │  • REST   /api/v1/                  │
                       │  • WS     /ws  (Socket.IO)          │
                       │  • Hooks  /webhooks/github           │
                       │  • Clerk JWT validation              │
                       │  • Tenant injection (RLS)            │
                       │  • Rate limiting (Redis)             │
                       └───────┬────────────────────────────┘
                               │
               ┌───────────────┼──────────────────┐
               │               │                  │
        ┌──────▼──────┐  ┌─────▼──────┐  ┌───────▼───────┐
        │  Indexer    │  │ DocAgent   │  │  GitHub       │
        │  Worker     │  │ Worker     │  │  Service      │
        │ (Node.js)   │  │ (Node.js)  │  │ (@octokit)    │
        │             │  │            │  │               │
        │ Pulls from  │  │ OpenClaw-  │  │ • Clone repos │
        │ index.jobs  │  │ style loop │  │ • Open PRs    │
        │ Spawns Rust │  │ Pulls from │  │ • Parse hooks │
        │ CLI process │  │ doc.jobs   │  │               │
        └──────┬──────┘  └─────┬──────┘  └───────┬───────┘
               │               │                  │
        ┌──────▼───────────────▼──────────────────▼───────┐
        │                  BullMQ (Redis)                   │
        │         Queues: index.jobs | doc.jobs             │
        │         Session store | Rate limit counters        │
        └──────────────────────────────────────────────────┘
               │
        ┌──────▼──────────────────────────────────────────┐
        │         PostgreSQL + pgvector                    │
        │         Row-Level Security (RLS)                 │
        │                                                  │
        │  orgs | users | org_members | repos              │
        │  graph_nodes | graph_edges                       │
        │  doc_blocks | doc_evidence | pr_runs             │
        └──────────────────────────────────────────────────┘
               │
        ┌──────▼──────────────────────────────────────────┐
        │       yantra-indexer  (Rust CLI binary)          │
        │                                                  │
        │  Extracted from Yantra GNNEngine:                │
        │  • 12 tree-sitter parsers                        │
        │  • SymbolResolver                                │
        │  • IncrementalTracker                            │
        │  • fastembed (384-dim embeddings)                │
        │                                                  │
        │  Input:  --repo-path --sha --files               │
        │  Output: NDJSON on stdout                        │
        └──────────────────────────────────────────────────┘
```

**GitHub access separation (enforced no-write to source repos):**
- **Reader App** (read-only) is installed on source repos and is the only credential used for cloning/indexing.
- **Docs App** (write) is installed on the docs repo only and is the only credential used to create branches/commits/PRs for documentation.

### 2.2 Package Structure

```
graphfly/
├── packages/
│   ├── api/               # Node.js API gateway
│   │   ├── src/
│   │   │   ├── routes/    # REST endpoint handlers
│   │   │   ├── middleware/ # Auth, tenant injection, rate limit
│   │   │   ├── ws/        # Socket.IO event handlers
│   │   │   └── webhooks/  # GitHub webhook receiver
│   │   └── package.json
│   │
│   ├── indexer/           # Rust CLI binary
│   │   ├── src/
│   │   │   ├── main.rs    # CLI entry point (NEW)
│   │   │   ├── gnn/       # Extracted from Yantra (unchanged)
│   │   │   │   ├── mod.rs
│   │   │   │   ├── parser.rs … parser_kotlin.rs
│   │   │   │   ├── symbol_resolver.rs
│   │   │   │   ├── incremental.rs
│   │   │   │   └── embeddings.rs
│   │   │   └── output.rs  # NDJSON serialization (NEW)
│   │   └── Cargo.toml
│   │
│   ├── indexer-worker/    # Node.js BullMQ consumer
│   │   └── src/
│   │       ├── worker.ts  # Queue consumer
│   │       ├── indexer.ts # Rust CLI subprocess manager
│   │       └── batcher.ts # PostgreSQL batch upsert
│   │
│   ├── doc-agent/         # Documentation agent
│   │   └── src/
│   │       ├── loop.ts    # TurnOutcome agent loop
│   │       ├── tools/     # 9 custom tools
│   │       └── prompts/   # System prompts
│   │
│   ├── github-service/    # GitHub Apps wrapper (Reader + Docs)
│   │   └── src/
│   │       ├── app-auth.ts
│   │       ├── clone.ts
│   │       └── pr.ts
│   │
│   ├── web/               # React SPA
│   │   └── src/
│   │       ├── pages/     # Dashboard, Graph, Docs, Coverage, Timeline
│   │       ├── components/ # Adapted from Yantra + new
│   │       └── api/       # REST client wrappers
│   │
│   └── shared/            # TypeScript types
│       └── src/
│           ├── graph.ts   # CodeNode, EdgeType (mirrors Rust structs)
│           ├── docs.ts    # DocBlock, DocEvidence
│           └── api.ts     # API request/response types
│
└── infrastructure/
    ├── postgres/          # db-migrate migration files
    ├── redis/             # Redis config
    └── docker/            # Docker Compose (local dev)
```

### 2.3 Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| API Server | Node.js 22 + Express 5 + TypeScript | Consistent with OpenClaw; rich GitHub/Clerk SDK ecosystem |
| Agent | TypeScript (TurnOutcome loop) | Direct port of Yantra's `loop_core.rs` |
| Queue / Jobs | BullMQ 5 on Redis 7 | Durability + retries + dead-letter vs OpenClaw in-memory |
| Code Indexer | Rust CLI (extracted from Yantra) | CPU-intensive parsing stays in Rust; NDJSON output is trivial |
| Database | PostgreSQL 16 + pgvector 0.7 | Multi-tenant RLS; vectors in-DB means RLS applies to semantic search; no separate vector DB |
| Auth | Clerk | Org + user management out-of-box; JWT claims carry `org_id`; webhook sync |
| Frontend | React 18 + Vite + Tailwind | Yantra UI components already exist; remove Tauri, adapt to REST |
| Graph Viz | Cytoscape.js 3 + dagre | Already in Yantra — just swap `invoke()` for `fetch()` |
| Real-time | Socket.IO 4 | Reconnect handling; room-based tenant isolation |
| GitHub | @octokit/app + @octokit/rest | Official GitHub App SDK |
| LLM | Anthropic Claude claude-sonnet-4-5-20250929 (primary) | Most capable for code analysis |

### 2.4 Data Flow: Code Push → Docs PR

```
1. Developer pushes commit to main branch
        │
        ▼
2. GitHub Reader App webhook: POST /webhooks/github
   Payload: { ref, sha, commits: [{modified, added, removed}] }
        │
        ▼
3. API Gateway: validate HMAC, extract changed_files[], enqueue job
   BullMQ: index.jobs { tenant_id, repo_id, sha, changed_files[] }
        │
        ▼
4. Indexer Worker picks up job:
   a. Clone repo@sha with installation token
   b. Spawn: yantra-indexer --repo-path /tmp/clone --sha <sha> --files '[...]'
   c. Stream NDJSON from stdout → batch upsert graph_nodes + graph_edges
   d. Emit Socket.IO: index:progress (per file), index:complete
        │
        ▼
5. On index:complete, enqueue doc agent job:
   BullMQ: doc.jobs { tenant_id, repo_id, sha, changed_files[] }
        │
        ▼
6. DocAgent Worker: runs TurnOutcome agent loop
   Phase 1: SQL blast radius → affected_node_ids
   Phase 2: SQL evidence join → stale_doc_blocks[]
   Phase 3: LLM updates each stale block (with graph + code context)
   Phase 4: Detect new undocumented nodes → create new blocks
   Phase 5: github.create_pr tool → PR in docs repo (via GitHub Docs App)
        │
        ▼
7. docs PR opened in owner/docs-repo
   Branch: docs/update-<sha[0:8]>
   Title: "docs: update for <sha[0:8]>"
   Body: lists changed blocks + triggering code nodes
        │
        ▼
8. pr_runs record persisted
   Socket.IO: agent:complete { prRunId, docsPrUrl, blocksUpdated }
   Dashboard updates live
```

---

## 3. Multi-Tenancy Design

### 3.1 Tenant Isolation Model

Every table carries `tenant_id UUID`. PostgreSQL Row-Level Security (RLS) enforces the isolation at the database level — even if application code has a bug, the DB will not return cross-tenant data.

**Connection setup (per request):**
```typescript
// middleware/tenant.ts
app.use(async (req, res, next) => {
  const { orgId } = verifyClerkJWT(req.headers.authorization);
  req.tenantId = orgId;
  const db = await pool.connect();
  try {
    // Set a session variable used by RLS policies for this request.
    // IMPORTANT: always RESET before releasing back to the pool.
    await db.query('SET app.tenant_id = $1', [orgId]);
    req.db = db;
    res.on('finish', async () => {
      try { await db.query('RESET app.tenant_id'); } finally { db.release(); }
    });
    next();
  } catch (err) {
    try { await db.query('RESET app.tenant_id'); } finally { db.release(); }
    next(err);
  }
});
```

**RLS policy pattern:**
```sql
ALTER TABLE graph_nodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON graph_nodes
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
-- Applied to: repos, graph_nodes, graph_edges, doc_blocks, doc_evidence, pr_runs
```

### 3.2 RBAC Model

```
org_role: owner | admin | developer | viewer

owner:     all permissions, including delete org, manage billing
admin:     manage members, repos, docs repo; trigger reindex; edit doc blocks
developer: view graph, view docs, trigger single-block regeneration
viewer:    view graph, view docs only
```

API middleware:
```typescript
// Protect admin-only routes
router.put('/docs/blocks/:id', requireRole(['owner', 'admin']), handler);
router.post('/repos/:id/reindex', requireRole(['owner', 'admin']), handler);
```

### 3.3 Rate Limiting Per Org

```
Free plan:     5 repos, 10 index jobs/day, 20 doc blocks/month
Pro plan:      25 repos, unlimited index jobs, 500 doc blocks/month
Enterprise:    unlimited, dedicated workers, SLA
```

Enforced via Redis counters in BullMQ job processor:
```typescript
const key = `rate:${tenantId}:index_jobs:${today}`;
const ttlSeconds = 60 * 60 * 48; // keep keys from accumulating forever
const usage = await redis.eval(
  `local v = redis.call('INCR', KEYS[1]);
   if v == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end;
   return v;`,
  1,
  key,
  ttlSeconds
);
if (usage > planLimit.indexJobsPerDay) {
  throw new Error('Daily index limit reached. Upgrade to Pro.');
}
```

---

## 4. Indexer Service Design

### 4.1 Extraction from Yantra

The `yantra-indexer` binary is created by extracting the graph engine from the Yantra Tauri application. The extraction is surgical:

**Files to extract (unchanged logic):**
```
/yantra/src-tauri/src/gnn/
  mod.rs              → CodeNode, NodeType, EdgeType, CodeEdge type definitions
  parser.rs           → Python tree-sitter parser
  parser_js.rs        → JavaScript / TypeScript / TSX
  parser_rust.rs      → Rust
  parser_go.rs        → Go
  parser_java.rs      → Java
  parser_c.rs         → C
  parser_cpp.rs       → C++
  parser_ruby.rs      → Ruby
  parser_php.rs       → PHP
  parser_swift.rs     → Swift
  parser_kotlin.rs    → Kotlin
  symbol_resolver.rs  → Cross-file import resolution
  incremental.rs      → Dirty tracking + cascading invalidation
  embeddings.rs       → fastembed all-MiniLM-L6-v2 384-dim
```

**Files to remove:**
```
persistence.rs        → SQLite (replaced by Node.js → PostgreSQL)
graph.rs              → petgraph in-process (replaced by PostgreSQL)
hnsw_index.rs         → In-process HNSW (replaced by pgvector)
auto_refresh.rs       → Tauri file watcher (not needed in CLI)
query.rs              → In-process query (replaced by SQL)
dependency_search.rs  → In-process traversal (replaced by SQL JOINs)
```

**New files:**
```
packages/indexer/src/main.rs      → CLI entry point, arg parsing, NDJSON output
packages/indexer/src/output.rs    → Serialize CodeNode/CodeEdge to NDJSON
```

### 4.2 NDJSON Output Protocol

The indexer writes one JSON object per line to stdout. Errors go to stderr. The Node.js wrapper reads with `readline` and processes each record.

```
Record types:
  start     → indexing started, total file count
  progress  → per-file progress update
  node      → a GraphNode (contract-first) extracted from source
  edge      → a GraphEdge between two nodes
  edge_occurrence → a reference site for an edge (file+lines), no code bodies
  done      → all processing complete, stats
  error     → non-fatal warning (continues processing)
```

```json
{"type":"start","sha":"a3f8c2d1","total_files":142,"mode":"incremental"}
{"type":"progress","pct":7,"file":"src/auth/login.ts","nodes_so_far":34}
{"type":"node","data":{
  "symbol_uid":"ts::src/auth/login.ts::loginUser::9f3c…",
  "node_key":"src/auth/login.ts::auth.loginUser::9f3c…",
  "node_type":"Function",
  "symbol_kind":"function",
  "name":"loginUser",
  "qualified_name":"auth.loginUser",
  "file_path":"src/auth/login.ts",
  "line_start":12,
  "line_end":45,
  "language":"typescript",
  "signature":"loginUser(email: string, password: string) -> Promise<AuthResult>",
  "docstring":null,
  "parameters":[{"name":"email","type":"string"},{"name":"password","type":"string"}],
  "return_type":"Promise<AuthResult>",
  "constraints":{"email":{"format":"email"},"password":{"minLength":8}},
  "allowable_values":null,
  "contract":{"type":"object","properties":{ "...": "..." }},
  "embedding":[0.12,-0.08,0.34,...]
}}
{"type":"edge","data":{
  "edge_type":"Calls",
  "source_symbol_uid":"ts::src/auth/login.ts::loginUser::9f3c…",
  "target_symbol_uid":"ts::src/db/users.ts::findByEmail::a81b…",
  "metadata":null
}}
{"type":"edge_occurrence","data":{
  "edge_type":"Calls",
  "source_symbol_uid":"ts::src/auth/login.ts::loginUser::9f3c…",
  "target_symbol_uid":"ts::src/db/users.ts::findByEmail::a81b…",
  "file_path":"src/auth/login.ts",
  "line_start":18,
  "line_end":18
}}
{"type":"done","stats":{
  "files_processed":3,
  "nodes_emitted":47,
  "edges_emitted":89,
  "duration_ms":1240,
  "unresolved_imports":5
}}
```

### 4.3 Node.js Indexer Worker

```typescript
// packages/indexer-worker/src/indexer.ts
import { spawn } from 'child_process';
import * as readline from 'readline';
import { Pool } from 'pg';

export async function runIndexer(job: IndexJob, db: Pool): Promise<IndexStats> {
  // Clone via GitHub Reader App token (read-only; no source repo writes possible)
  const clonePath = await cloneRepo(job.readerInstallId, job.fullName, job.sha);

  return new Promise((resolve, reject) => {
    const proc = spawn(INDEXER_BIN_PATH, [
      'index',
      '--repo-path', clonePath,
      '--sha', job.sha,
      '--files', JSON.stringify(job.changedFiles ?? []),
      '--embed', 'true',
      '--output-format', 'ndjson',
    ]);

    const rl = readline.createInterface({ input: proc.stdout });
    const batcher = new NodeEdgeBatcher(job.tenantId, job.repoId, db);

    rl.on('line', async (line) => {
      const record = JSON.parse(line);
      switch (record.type) {
        case 'node':    await batcher.addNode(record.data); break;
        case 'edge':    await batcher.addEdge(record.data); break;
        case 'edge_occurrence': await batcher.addEdgeOccurrence(record.data); break;
        case 'progress': emitProgress(job.repoId, record.pct, record.file); break;
        case 'done':    await batcher.flush(); resolve(record.stats); break;
        case 'error':   logger.warn('indexer', record.message); break;
      }
    });

    proc.on('error', reject);
    proc.stderr.on('data', d => logger.debug('indexer:stderr', d.toString()));
  });
}

// Batch INSERT for performance: 500 records per statement
class NodeEdgeBatcher {
  private nodeBatch: GraphNode[] = [];
  private edgeBatch: GraphEdge[] = [];
  private readonly BATCH_SIZE = 500;

  async addNode(node: GraphNode) {
    this.nodeBatch.push(node);
    if (this.nodeBatch.length >= this.BATCH_SIZE) await this.flushNodes();
  }

  async flushNodes() {
    if (this.nodeBatch.length === 0) return;
    // INSERT INTO graph_nodes (...) VALUES (...), (...), ...
    // ON CONFLICT (tenant_id, repo_id, node_key) DO UPDATE SET ...
    await batchUpsertNodes(this.db, this.tenantId, this.repoId, this.nodeBatch);
    this.nodeBatch = [];
  }
  // similar for edges...
}
```

**Why subprocess, not gRPC:**
- The Rust binary's natural output is stdout — maps to existing pattern
- Zero protocol overhead, no service lifecycle, no TLS between worker and indexer
- Platform binaries (darwin/linux/win32) ship as package assets
- Upgrade path: gRPC streaming protocol is identical to NDJSON protocol

---

## 5. Scalability Design

### 5.1 Horizontal Scaling

All workers are stateless — state is in PostgreSQL + Redis. Scale by adding worker processes:

```
BullMQ concurrency:
  indexer-worker: 5 concurrent index jobs per instance
  doc-agent-worker: 3 concurrent doc agent runs per instance

Multiple instances behind a load balancer (any cloud provider)
```

### 5.2 Large Repo Handling

Repos with >10,000 files are chunked:
```typescript
// Split into 500-file batches
const batches = chunk(allFiles, 500);
for (const batch of batches) {
  await indexQueue.add('incremental', { ...job, changedFiles: batch });
}
// After all batches: enqueue merge job to update coverage stats
```

### 5.3 pgvector (HNSW) Tuning

HNSW provides strong recall/latency tradeoffs for large graphs without maintaining per-tenant in-memory indexes.

**Index parameters (baseline):**
- `m`: graph connectivity (higher = better recall, more memory)
- `ef_construction`: build time vs recall quality

**Query-time parameter:**
- `hnsw.ef_search`: higher = better recall, more CPU

Example:
```sql
-- Build once; tune via `m` and `ef_construction` based on corpus size.
CREATE INDEX idx_gn_embedding_hnsw ON graph_nodes
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 200);

-- At query time (per session/transaction):
SET LOCAL hnsw.ef_search = 64;
```

### 5.4 Queue Priority

```typescript
// High priority: user-initiated actions
await indexQueue.add('full', job, { priority: 1 });

// Normal priority: webhook-triggered
await indexQueue.add('incremental', job, { priority: 5 });

// Low priority: background coverage recalculation
await indexQueue.add('coverage', job, { priority: 10 });
```

---

## Navigation
- [← Index](00_INDEX.md)
- [Next: Requirements →](02_REQUIREMENTS.md)
