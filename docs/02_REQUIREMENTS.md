# Graphfly — Requirements Specification

**Version**: 1.0
**Last Updated**: February 2026
**Status**: Draft

---

## Navigation
- [← Architecture](01_ARCHITECTURE.md)
- [Next: Technical Spec →](03_TECHNICAL_SPEC.md)

---

## 1. Product Vision

### 1.1 Mission Statement
Graphfly keeps your documentation truthful, automatically. By grounding every doc block in evidence from the live **Code Intelligence Graph**, Graphfly ensures documentation is always provably current — not just "probably" current.

### 1.2 Target Users

| Persona | Role | Primary Need |
|---------|------|--------------|
| **Platform Engineer** | Owns the dev platform at a mid-large company | Reduce "docs are out of date" complaints from team |
| **Engineering Manager** | Runs a 5-15 person team | Onboarding new engineers faster, audit trail of system changes |
| **Senior Developer** | Owns a service or domain | Know when their changes affect other teams' documented contracts |
| **Tech Lead** | Owns architecture | Living runbooks, API contracts that auto-update |

### 1.3 Key Outcomes

1. **Developers trust the docs** — because every doc block is grounded in contract + location evidence
2. **Docs stay current automatically** — no manual update workflow
3. **New engineers onboard faster** — complete flow maps from day one
4. **Architecture drift is visible** — graph shows what's actually in the code, not what was planned

---

## 2. Functional Requirements

### 2.1 GitHub Integration

#### FR-GH-01: GitHub Reader App Installation (Source Repos)
- System shall provide a GitHub App that users install on their organization or personal account to connect **source code repositories**
- Reader App shall request: `contents:read`, `metadata:read` permissions
- Reader App shall subscribe to: `push`, `installation`, `installation_repositories` webhook events
- Installation shall not require any changes to the user's source code repository

#### FR-GH-01B: GitHub Docs App Installation (Docs Repo Only)
- System shall provide a separate GitHub App (Docs App) used **only** to write documentation to the configured docs repository
- Docs App shall request: `contents:write`, `pull_requests:write`, `metadata:read` permissions
- Docs App does not need to subscribe to `push` events (no indexing from docs repo)
- System shall guide the user to install the Docs App on exactly one selected docs repository per organization

#### FR-GH-02: Repository Connection
- After Reader App installation, user shall be able to select which source repos to connect to Graphfly
- System shall list all repos accessible via the Reader App installation
- Each connected repo shall get its own graph in the system
- Upon connecting a repo, system shall automatically enqueue the initial full index (no additional user action)

#### FR-GH-03: Docs Repository Configuration
- User shall set one "docs repo" per organization — the target for documentation PRs
- Docs repo shall be explicitly selected by the user as part of onboarding
- System shall provide an option to create a new empty docs repo
- System shall require the Docs App to be installed on the configured docs repo before opening any PRs

#### FR-GH-04: Webhook Processing
- System shall receive and validate GitHub push webhooks (HMAC-SHA256 signature)
- System shall only process pushes to the repo's default branch
- System shall extract the list of added, modified, and removed files from the push payload
- System shall handle the case of removed files (delete associated graph nodes)

#### FR-GH-05: Enforced No-Write To Source Code Repos
- System shall not request or possess `contents:write` permission on connected source code repositories
- System shall only write files to the configured docs repository (via the Docs App)
- System shall never open a PR that targets a source code repository
- System shall hard-fail any attempted write operation where the target repo is not the configured docs repo for the organization

---

### 2.2 Code Intelligence Graph Building

#### FR-CIG-01: Full Index on Connection
- Upon connecting a repo, system shall perform a full index of the default branch at HEAD
- Full index shall parse all supported source files and build the complete graph
- Full index progress shall be streamed to the user in real-time

#### FR-CIG-02: Incremental Index on Push
- Upon receiving a push webhook, system shall perform an incremental index
- Incremental index shall only re-parse files listed in the push payload
- Incremental index shall update the blast radius of changed nodes (re-resolve affected imports)
- Incremental index shall complete within 60 seconds for repos with <10,000 files

#### FR-CIG-03: Multi-Language Parsing
- System shall parse the following languages: Python, JavaScript, TypeScript, TSX, Rust, Go, Java, C, C++, Ruby, PHP, Swift, Kotlin
- For each source file, system shall extract: functions, classes, variables, imports, modules
- System shall extract call relationships between functions
- System shall extract import/inheritance/dataflow relationships

#### FR-CIG-04: Cross-File Symbol Resolution
- System shall resolve import statements to their target file and symbol
- System shall handle: relative imports, package imports, aliased imports, type-only imports
- Unresolved imports (external packages) shall be tracked but not fail the index

#### FR-CIG-05: Semantic Embeddings
- System shall generate 384-dimensional embeddings for contract-bearing nodes (e.g., Functions, Classes, API endpoints, Schemas, Flow entrypoints)
- Embeddings shall use all-MiniLM-L6-v2 model (consistent with Yantra's implementation)
- Embeddings shall be stored in PostgreSQL as `vector(384)` and indexed with pgvector HNSW

#### FR-CIG-06: Graph Persistence
- Graph shall be persisted to PostgreSQL with full tenant isolation
- Graph shall support: node lookup by key, edge lookup by source/target, semantic search
- Graph data shall be scoped to `(tenant_id, repo_id)` — cross-tenant data access is impossible

#### FR-CIG-07: Public Contract Graph (No Source Code Bodies)
- System shall derive and persist a **Public Contract Graph** from source analysis that contains:
  - API contracts (endpoints, request/response schemas, auth requirements)
  - Function/class/module contracts (signatures, types, constraints, defaults)
  - Allowable values (enums/literals) and validation constraints (min/max/regex)
- The Public Contract Graph shall be sufficient to generate technical documentation and user-flow documentation without requiring source code bodies to be displayed or stored in docs.

#### FR-CIG-08: Constraints & Allowable Values Extraction
- System shall extract allowable values and constraints from:
  - Type systems (enums, union/literal types)
  - Runtime validators (e.g., zod/joi/pydantic) where present
  - OpenAPI/JSON Schema artifacts where present
- The extracted constraints shall be persisted as structured data (not prose) and surfaced in docs and support tooling.

#### FR-CIG-09: Flow Entities (Entrypoints + Flow Graphs)
- System shall detect and persist flow entrypoints such as:
  - HTTP routes
  - UI routes (when available)
  - Queue consumers / job handlers
  - CLI commands / cron jobs
- System shall persist derived **Flow Graphs** that trace how an entrypoint propagates through the system (calls, data access, external API calls).

#### FR-CIG-10: Dependency & Manifest Intelligence
- System shall parse dependency manifests (e.g., `package.json`, `requirements.txt`, `pyproject.toml`, `Cargo.toml`, `go.mod`) and persist:
  - declared dependencies (name, version/range, scope)
  - license/source metadata where available
- System shall also infer dependencies from code (imports/usages) and persist both views without assuming either is “correct”.
- System shall represent package usage relationships in the Code Intelligence Graph (e.g., `UsesPackage` edges) to enable traversal and flow/debugging use cases.
- System shall detect and expose mismatches:
  - declared but unused dependencies
  - used but undeclared dependencies
  - version/range conflicts across manifests (monorepo)

#### FR-CIG-11: No Code Exposure in UI/Support Mode
- UI and support tooling shall not fetch or display source code bodies/snippets by default.
- Doc blocks shall not embed source code bodies/snippets.
- System shall provide a “support-safe” mode where only Public Contract Graph + Flow Graphs + metadata are accessible.

#### FR-CIG-12: Incremental Correctness Contract
- Incremental indexing shall correctly update the Code Intelligence Graph when:
  - files are modified, added, removed
  - files are moved/renamed (path changes)
  - dependency manifests change (declared deps change)
  - symbol resolution changes cause cascading impacts beyond the changed files
- System shall make the re-parse scope explicit (directly changed files + computed impacted set) and expose index diagnostics (what was re-parsed and why).

---

### 2.3 Documentation Generation

#### FR-DOC-01: Initial Documentation
- After the first successful index, system shall automatically generate initial documentation
- Initial docs shall cover: all public API endpoints (HTTP routes), all exported functions/classes, all modules
- Initial docs shall be opened as a PR to the docs repo

#### FR-DOC-02: Doc Block Structure
- Each doc block shall correspond to one markdown section (`## Heading`)
- Each doc block shall have a `block_type`: `function | class | flow | module | api_endpoint | schema | overview | package`
- Each doc block shall have at least one evidence link (graph node + file + line numbers)
- Doc blocks shall not embed or display source code bodies/snippets; they document contracts, schemas, and flows.

#### FR-DOC-03: Evidence Model
- Every doc block MUST link to the graph nodes that provide evidence for its content
- Evidence includes: node ID, file path, line start, line end, commit SHA
- Evidence is visible to users in the Doc Block view as contract + location metadata (no code bodies by default)
- When evidence nodes change, the associated doc block is marked `stale`

#### FR-DOC-04: Surgical Updates
- When a push is processed, system shall identify which doc blocks have stale evidence
- System shall only update doc blocks whose evidence nodes were changed or affected
- System shall not regenerate doc blocks whose evidence has not changed (content hash check)
- Changed doc blocks shall be updated via the documentation agent

#### FR-DOC-05: New Node Documentation
- When a push adds new functions or classes with no existing doc blocks, system shall generate new blocks
- New blocks shall be added to the appropriate doc file based on the node's module/file structure
- New blocks shall include all extracted metadata: signature, parameters, return type, docstring

#### FR-DOC-06: Docs PR Creation
- Updated and new doc blocks shall be committed to a new branch in the docs repo
- Branch naming: `docs/update-<sha[0:8]>`
- PR title: `docs: update for <commit-sha[0:8]>`
- PR body shall list: triggered by (source commit), blocks updated, blocks created, triggering graph nodes

#### FR-DOC-07: Doc Block Regeneration
- Admin users shall be able to manually trigger regeneration of a single doc block
- Regeneration shall re-run the doc agent for that block and open a new PR
- Regeneration shall update the evidence links if the underlying code has changed

---

### 2.4 Graph Exploration

#### FR-GX-01: Interactive Graph View
- System shall provide an interactive, navigable visualization of the Code Intelligence Graph
- Nodes shall be colored by type (Function, Class, Module, Package)
- Edges shall be styled by type (Calls = solid, Imports = dashed, DataFlow = wavy)
- User shall be able to click a node to see its details

#### FR-GX-02: Node Detail
- Clicking a node shall show: name, type, file:line, language, and public contract details (signature/schema/constraints)
- Node detail shall show: callers (who calls this), callees (what this calls), dependencies, dependents
- Node detail shall show: linked doc blocks with link to view/edit each

#### FR-GX-03: Blast Radius Visualization
- User shall be able to trigger blast radius analysis for any node
- Blast radius shall show nodes directly called by, and nodes that call, the selected node
- Affected nodes shall be highlighted on the graph with a distinct color ring
- Blast radius depth shall be configurable (1 or 2 hops for V1)

#### FR-GX-04: Search
- System shall support full-text search over node names
- System shall support semantic search using vector embeddings
- Search mode shall be switchable (text | semantic) per query
- Search results shall be clickable and navigate to the node in the graph

#### FR-GX-05: Flow Tracing
- System shall support tracing the call path from an entrypoint node
- Flow trace shall show the complete call chain up to configurable depth
- Flow visualization shall be available in the graph view

---

### 2.5 Coverage Tracking

#### FR-CV-01: Coverage Dashboard
- System shall compute documentation coverage as `(documented_nodes / total_nodes) * 100`
- Coverage shall be broken down by node type: Functions, Classes, Modules, Packages
- Coverage shall be recomputed after each index and after each docs PR

#### FR-CV-02: Undocumented Entry Points
- System shall identify "entry points" — nodes with many callers or no inbound import edges (likely public API)
- Undocumented entry points shall be listed, sorted by blast radius (most-impactful first)
- Each entry point shall have a "Document" button to trigger single-node doc generation

#### FR-CV-03: Unresolved Imports
- System shall track import statements that could not be resolved to a known file
- Unresolved imports shall be displayed transparently in the coverage dashboard
- External package imports (npm, pip, cargo) shall be categorized as "external — expected"

---

### 2.6 Team & Organization Management

#### FR-TM-01: Multi-User Organizations
- System shall support organizations with multiple members
- Users shall sign in with GitHub OAuth
- Each user can belong to one or more organizations

#### FR-TM-02: Role-Based Access Control
- System shall enforce 4 roles: Owner, Admin, Developer, Viewer
- Owner: all permissions + delete org + billing
- Admin: manage members + repos + docs repo + trigger reindex + edit doc blocks
- Developer: view graph + view docs + trigger single-block regeneration
- Viewer: view graph + view docs (read-only)

#### FR-TM-03: Member Invitations
- Admins shall be able to invite members by email address
- Invited users shall receive an invitation email with a link to accept
- Invitations shall expire after 7 days

---

### 2.7 Real-Time Feedback

#### FR-RT-01: Indexing Progress
- Users shall see live indexing progress: percentage, current file, nodes/edges processed
- Progress updates shall arrive via WebSocket (Socket.IO)
- When indexing completes, user shall see a toast notification with summary stats

#### FR-RT-02: Agent Activity Streaming
- Users shall see live agent activity: which tool is being called, with what args
- Agent activity shall stream via WebSocket during an active doc run
- When a docs PR is created, user shall see a notification with the PR link

---

### 2.8 Billing & Plans (Stripe)

#### FR-BL-01: Plan Purchase via Stripe Checkout
- System shall support paid plan purchase/upgrade via Stripe Checkout
- System shall create a Stripe Customer for each organization (tenant)
- System shall associate the Stripe customer ID to the organization record

#### FR-BL-02: Billing Portal (Self-Serve)
- System shall provide a customer billing portal (Stripe Customer Portal) for:
  - Updating payment method
  - Viewing invoices
  - Cancelling subscription
  - Switching plans (if enabled)

#### FR-BL-03: Stripe Webhook Processing
- System shall receive and validate Stripe webhooks (signature verification)
- System shall process subscription lifecycle events to keep `org.plan` and entitlements in sync:
  - subscription created/updated/cancelled
  - invoice paid/failed
- Webhook processing shall be idempotent (deduplicate by Stripe event ID)

#### FR-BL-04: Entitlements & Usage Enforcement
- System shall enforce plan-based entitlements for:
  - Connected repos
  - Index jobs per day (if limited)
  - Doc block generations per month (if limited)
- When a limit is exceeded, system shall:
  - Prevent the action
  - Explain which limit was reached
  - Provide a clear upgrade path (link to billing)

#### FR-BL-05: Usage Transparency
- System shall expose current usage vs limits in the Billing settings page
- Usage counters shall reset on the plan’s billing period boundaries (monthly for paid plans)

---

## 3. Non-Functional Requirements

### 3.1 Performance

| Metric | Target | Measurement |
|--------|--------|-------------|
| Graph node lookup | <10ms p99 | PostgreSQL indexed query |
| Blast radius query (2-hop) | <100ms p99 | JOIN query with indexes |
| Semantic search (top-10) | <50ms p99 | pgvector IVFFlat |
| Incremental index (50 files) | <60s | End-to-end wall clock |
| Full index (1,000 files) | <300s | End-to-end wall clock |
| Doc agent run (10 blocks) | <120s | End-to-end including LLM calls |
| API response (all list endpoints) | <500ms p99 | Including DB query |
| WebSocket event delivery | <2s from event | Graph → Socket.IO → browser |

### 3.2 Reliability

- Index jobs: automatic retry up to 3 times with exponential backoff (10s, 30s, 90s)
- Doc agent jobs: automatic retry up to 2 times
- Failed jobs: moved to dead-letter queue for manual inspection
- GitHub installation token refresh (Reader + Docs Apps): handled automatically by `@octokit/auth-app`
- Webhook replay protection: deduplicate on `X-GitHub-Delivery` header (Redis SET with 24h TTL)

### 3.3 Security

- **Tenant isolation**: PostgreSQL RLS — tenant A's data is physically inaccessible to tenant B's queries
- **GitHub secrets**: Reader + Docs App private keys stored in a secrets manager (Doppler/AWS Secrets Manager)
- **Webhook verification**: All GitHub webhooks validated with HMAC-SHA256 before processing
- **JWT validation**: All API requests validated against Clerk public key
- **Code not executed**: Graphfly only reads source files, never executes user code
- **Clone cleanup**: Ephemeral clones deleted after indexing completes

### 3.4 Scalability

- System shall support horizontal scaling via multiple worker instances (BullMQ)
- System shall support repos with up to 50,000 source files via chunked indexing
- System shall support up to 10,000 graph nodes per repo efficiently
- System shall support up to 100 organizations on shared infrastructure

### 3.5 Data Retention

- Graph data: retained while repo is connected; deleted when repo is disconnected
- PR run history: retained for 1 year (configurable per plan)
- Index job logs: retained for 30 days
- Cloned repos: ephemeral, deleted immediately after indexing

### 3.6 Availability

- Target: 99.5% uptime for API and UI
- Maintenance: zero-downtime deployments via rolling updates
- Database: managed PostgreSQL with daily automated backups
- Queue persistence: Redis with AOF persistence enabled

---

## 4. User Stories

### Epic 1: Connect & Index

**US-001**: As a developer, I can install the Graphfly Reader GitHub App on my organization so that Graphfly can read my source repositories.

**US-002**: As a developer, I can select which repositories to connect to Graphfly from the list of repos accessible via the Graphfly Reader App installation.

**US-003**: As a developer, I can specify a docs repository where Graphfly will open documentation PRs, and authorize write access to that docs repo only (Docs App).

**US-004**: As a developer, I see a live progress bar while my repository is being indexed, showing which files are being parsed and how many nodes and edges have been found.

**US-005**: As a developer, I receive a notification when indexing is complete with a summary of the graph that was built.

### Epic 2: Living Documentation

**US-010**: As a developer, when I push code to my repository's main branch, Graphfly automatically identifies which doc blocks reference the changed code and updates them via a PR.

**US-011**: As a developer, I can view the documentation PR that Graphfly opened and see which doc blocks were updated and why (which code nodes triggered the update).

**US-012**: As a developer, I can see for every doc block the contract + location evidence (symbol ID, file + line numbers, schema/constraints) that the documentation was generated from (evidence panel).

**US-013**: As a developer, I can manually trigger regeneration of a specific doc block from the UI.

**US-014**: As a developer, I can edit a doc block manually in the UI and have my changes committed as a separate PR (without triggering the agent).

### Epic 3: Graph Exploration

**US-020**: As a developer, I can view an interactive graph of my codebase showing all functions, classes, modules, and their relationships.

**US-021**: As a developer, I can click on any node in the graph to see its details: what calls it, what it calls, what documentation references it.

**US-022**: As a developer, I can select a node and see its blast radius — all nodes that would be affected if I change it.

**US-023**: As a developer, I can search my codebase by function/class name (text search) or by description (semantic search).

### Epic 4: Coverage & Quality

**US-030**: As an engineering manager, I can see the overall documentation coverage for each connected repository.

**US-031**: As an engineering manager, I can see a list of the most important undocumented entry points (sorted by how many callers they have).

**US-032**: As an engineering manager, I can trigger documentation generation for specific undocumented nodes from the coverage dashboard.

### Epic 5: Team Management

**US-040**: As an organization owner, I can invite team members by email with specific roles (Admin, Developer, Viewer).

**US-041**: As an organization owner, I can change a team member's role or remove them from the organization.

**US-042**: As an Admin, I can configure which repositories are connected and which docs repo receives PRs.

---

## 5. Out of Scope (V1)

The following features are explicitly out of scope for V1 and will be addressed in future releases:

- **Graph versions / historical views** — time-travel / per-commit snapshots of the Code Intelligence Graph
- **PR branch indexing** — only default branch is indexed
- **Multiple LLM providers** — Claude only for V1
- **Custom doc templates** — standard structure only
- **Doc block locks / pinning** — prevent agent from modifying specific blocks (manual override protection)
- **Webhook to Slack/email** — no notification integrations
- **Self-hosted deployment** — cloud-only for V1
- **Private network repos** — GitHub.com only (no GitHub Enterprise Server)
- **Monorepo splitting** — whole repo treated as one unit
- **CI/CD integration** — doc PRs are independent of CI pipeline

---

## Navigation
- [← Architecture](01_ARCHITECTURE.md)
- [Next: Technical Spec →](03_TECHNICAL_SPEC.md)
