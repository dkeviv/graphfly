# Graphfly — UX Specification

**Version**: 1.0
**Last Updated**: February 2026
**Status**: Draft

---

## Navigation
- [← Technical Spec](03_TECHNICAL_SPEC.md)
- [← Index](00_INDEX.md)

---

## 1. Design Philosophy

### 1.1 Core Principles

Graphfly is a **developer tool**. The design draws from Stripe, Linear, and Vercel — products that developers deeply trust for their clarity, precision, and information density without clutter.

**Clarity over cleverness.** Every screen answers one question. Don't make users hunt for information.

**Evidence over trust.** Never show documentation without showing the code it came from. Developers don't trust docs they can't verify — so make verification effortless.

**Instant feedback.** Long operations (indexing, agent runs) must show live progress. Never show a loading spinner with no progress indication.

**Zero friction path.** The fastest path from "I just installed this" to "I have value" must be under 5 minutes. Every extra click is a potential drop-off.

### 1.2 Design System

```
Typography:
  Primary:  Inter (all UI text)
  Code:     JetBrains Mono (signatures, file paths, line numbers)

Color Palette:
  Background:     #0B1220 (workspace)
  Surface:        #0F1A30 (top nav + cards)
  Surface-2:      #101F3B (inputs + rail items)
  Border:         rgba(231, 238, 252, 0.12)
  Border-focus:   rgba(122, 162, 255, 0.65)

  Text-primary:   #E7EEFC
  Text-secondary: #A9B7D6
  Text-muted:     rgba(231, 238, 252, 0.65)

  Primary:        #7AA2FF
  Primary-hover:  #5B8CFF

  Success:        #2DD4BF
  Warning:        #F59E0B
  Error:          #FF5F6D

  Node-function:  #7AA2FF
  Node-class:     #2DD4BF
  Node-module:    #A9B7D6
  Node-package:   #F59E0B

Spacing:  8px grid
Radius:   rounded-lg (8px) for cards, rounded-md (6px) for buttons
Shadow:   shadow-sm (box-shadow: 0 1px 2px rgba(0,0,0,0.05))

Motion:   duration-150, ease-out
          Transitions only on interactive elements (hover, focus)
          No page-level animations (skeleton screens for loading)
```

### 1.3 Component Library

Use **shadcn/ui** (built on Radix UI + Tailwind) for:
- Buttons, inputs, selects, checkboxes
- Dialog/Sheet/Popover primitives
- Toast notifications (bottom-right, Stripe-style)
- Badge / Tag components

Build custom for:
- Graph canvas (Cytoscape.js)
- Doc block display (markdown renderer)
- Evidence panel (contract + location viewer; no source code bodies by default)
- Progress log stream
- PR timeline

**Enterprise UX note (Phase-1 UI in this repo):**
- Onboarding is presented as a **single guided project-creation flow** with progressive disclosure.
- “Advanced / dev-only” controls (PAT connect, local repo path, API URL) are tucked behind collapsible panels.
- Primary CTAs are visually distinct and the UI gates actions (indexing/docs writes require verified GitHub App access).

---

## 2. Application Structure

### 2.1 Workspace Layout (V0-inspired)

Graphfly’s SaaS UI is a single **workspace** optimized for “chat + canvas” workflows (inspired by Vercel v0):
- A fixed **icon rail** (sidebar)
- A **context panel** (Column 2)
- A **canvas** (Column 3)

Column 2 and Column 3 are independently scrollable.

```
┌───────────────────────────────────────────────────────────────────────────┐
│ [Logo] [Project ▾] [Code: main (locked)] [Docs: main ▾] [Model: … ▾] [Open PR] [👤]│
├──────────┬──────────────────────────────┬─────────────────────────────────┤
│ SIDEBAR  │ Column 2 (Context Panel)     │ Column 3 (Canvas / Viewer)      │
│          │ (scrollable)                 │ (scrollable)                    │
│ 💬 Chats │ Chat threads + agent         │ Flows canvas (default)           │
│ 📊 Graph │ (unchanged; see below)       │ Graph viewer (when toggled)      │
│ 📝 Docs  │ Docs repo file tree          │ Doc viewer/editor + block overlays│
│ 🔀 Git   │ PR runs / commits / status   │ Diff / PR preview                │
│ ⚙️ Settings│ Billing + integrations     │ Preview / confirmation            │
│ 💡 Feedback│ Feedback form              │ (keeps last canvas)               │
└──────────┴──────────────────────────────┴─────────────────────────────────┘
```

Top bar rules:
- **Project dropdown** is the primary navigation. Creating a new project triggers repo + branch selection.
- **Code branch** is selected at project creation and **cannot be changed** for an existing project (create a new project instead).
- **Docs branch** is selectable for viewing/previewing docs (`default` vs Graphfly-created preview branches from PR runs).
- **Model** selects the LLM model used by the assistant + background agents (when LLM is configured). In Phase‑1, this is org-scoped.
- **Open PR** is the single publishing action for docs changes (manual edits and assistant-drafted edits).

### 2.2 Navigation Modes

Sidebar items control the context panel (Column 2). The canvas (Column 3) follows the selected mode.

**Chats**
- Column 2: chat list (multiple threads per project) + conversation + input.
- Column 3: flows canvas by default (entrypoints, derived flows, architecture diagrams).

**Docs**
- Column 2: docs repo **file tree** (folders/files) + search.
- Column 3: doc viewer/editor for selected file.
  - Renders sanitized Markdown.
  - Overlays doc-block-managed sections (type/status + evidence).
  - Selecting a doc block opens an evidence inspector (contracts + locations only; no source code bodies by default).

**Git**
- Column 2: PR runs list + status + links.
- Column 3: PR preview / diff viewer (selected PR run or branch).

**Settings**
- Column 2: settings forms (billing, team, integrations, repos).
- Column 3: contextual preview/confirmation and “danger zone” confirmations.

**Feedback**
- Column 2: short feedback form (category, message, optional screenshot).
- Column 3: keeps the last canvas state (so users can reference what they’re reporting).

**Graph (special behavior)**
- Graph is a **canvas mode toggle**:
  - Selecting **Graph** switches Column 3 to the graph viewer.
  - Column 2 does **not** change (it stays on the last non-graph mode by default).
- Graph node detail (within the graph viewer) includes:
  - callers / callees, dependencies / dependents
  - linked doc blocks (open in docs viewer/editor)
  - flow trace controls (depth-limited)

### 2.3 Projects, Repos, and Branches

Definitions:
- **Project**: 1 connected **code repo** (GitHub) + 1 connected **docs repo** (GitHub) + a fixed tracked code branch.
- **Tracked code branch**: selected at project creation; webhooks/indexing only apply to this branch.
- **Docs branches**: view/edit context. Users can switch between:
  - default branch (merged docs)
  - preview branches created by Graphfly PR runs (unmerged docs)

Constraints:
- Each project tracks exactly one code repo + branch.
- Each project targets exactly one docs repo (writes are hard-failed if the target repo does not match).
- Changing code repo or tracked branch requires creating a new project (existing projects remain immutable).

### 2.4 Routes (SaaS target)

The SaaS app centers on a workspace route with deep links to selections:
- `/app/:projectId` — workspace shell
- `/app/:projectId?mode=chat&thread=:threadId`
- `/app/:projectId?mode=docs&path=:path&ref=:docsRef`
- `/app/:projectId?mode=git&run=:prRunId`
- `/app/:projectId?canvas=graph&focus=:symbolUid`

**Phase-1 implementation note (this repo):** the current UI is a lightweight single-page app using hash routes (`#/dashboard`, `#/graph`, `#/docs`, `#/coverage`, `#/admin`). This is not the target SaaS layout; it exists to exercise APIs and worker pipelines.

### 2.5 User Flows (Tables)

| Flow ID | Actor | Entry | Steps (happy path) | Success |
|---|---|---|---|---|
| UF-AUTH-01 | Any user | `/` | Sign in with GitHub → create first project | User lands in workspace with a selected project |
| UF-PROJ-01 | Admin+ | Project dropdown | Create new project → select code repo + branch → select docs repo | New project created; indexing starts automatically |
| UF-PROJ-02 | Any user | Project dropdown | Switch project | Workspace updates to selected project context |
| UF-CHAT-01 | Any user | Chats | Create thread → ask question → assistant responds with evidence links | User gets a grounded answer without source code bodies |
| UF-GRAPH-01 | Any user | Graph | Toggle graph canvas → search/select node | Focus subgraph rendered around selected node |
| UF-DOCS-01 | Any user | Docs | Browse file tree → select file | File rendered in viewer with block overlays |
| UF-DOCS-02 | Any user | Doc viewer | Click block overlay → view evidence (contracts + locations) | User can verify claims quickly |
| UF-DOCS-03 | Admin+ | Doc viewer | Edit Markdown → preview diff → click **Open PR** | PR opened in docs repo; preview branch available |
| UF-GIT-01 | Any user | Git | Select PR run → view details | User can open PR on GitHub and review diffs |
| UF-SET-01 | Owner/Admin | Settings | Update billing/team/integrations | Settings persisted; permissions enforced |
| UF-FB-01 | Any user | Feedback | Submit feedback | Feedback recorded with project context |

| Flow ID | Actor | Entry | Steps (failure path) | Recovery |
|---|---|---|---|---|
| UF-FAIL-INDEX-01 | Any user | Workspace | Index fails → banner shows error + run id | Retry indexing; open run logs summary |
| UF-FAIL-DOCS-01 | Any user | Docs | PR creation fails → error state in Git panel | Retry PR; view failure reason; admin runbook link |

---

## 3. Onboarding & First Project

Graphfly’s onboarding is optimized for a fast “first value” loop:
1. Sign in
2. Create a project (code repo + tracked branch + docs repo)
3. Indexing runs → initial docs PR opens automatically

### 3.1 Sign In (`/sign-in`)

**Purpose:** Authenticate the user. GitHub OAuth is the primary path.

```
Layout: Centered, 400px wide, vertically centered

┌───────────────────────────────────────────────────┐
│                      Graphfly                      │
│                                                    │
│     Your code. Documented. Always.                 │
│                                                    │
│  [ Continue with GitHub ]   ← primary CTA          │
│  [ Continue with Google ]   ← secondary            │
│                                                    │
│  ─────────── or ───────────                        │
│  Email address                                     │
│  [____________________________]                    │
│  [ Continue with email ]                           │
└───────────────────────────────────────────────────┘
```

**Design notes:**
- No “sign up” vs “sign in” distinction (provider handles both).
- Sign-in is the only full-page auth surface; onboarding happens inside the workspace.

---

### 3.2 Create First Project (`/app/new`)

**Appears:** Immediately after sign-in if the user has no projects yet, or via **Project ▾ → New project**.

**Purpose:** Create a project by selecting:
- **Code repo** + **tracked code branch** (locked after creation)
- **Docs repo** (Graphfly writes PRs to this repo only)

Project creation is a single guided flow (inspired by v0).

**OAuth Mode (Default / Simple Path)**

```
Create your first project

┌────────────────────────────────────────────────────────────┐
│ GitHub Connected ✓                                          │
│ Using OAuth access from sign-in                             │
│                                                            │
│ Code repo                                                   │
│ [ owner/my-api                                      ▼ ]     │
│ Tracked branch (locked):  main                              │
│                                                            │
│ Docs repo                                                   │
│ [ owner/my-api-docs                                 ▼ ]     │
│ or:  [+ Create new docs repo]                               │
│                                                            │
│                                    [Create project →]       │
└────────────────────────────────────────────────────────────┘
```

**Behavior (OAuth Mode):**
- OAuth token from sign-in is used for all GitHub operations (no separate app installs needed)
- Repo lists show all repos the user has access to via OAuth scope
- Creating a new docs repo uses the OAuth token (Apps are optional, not required)
- Creating a project immediately enqueues initial indexing
- Changing the code repo or tracked branch requires creating a new project (projects are immutable by default)

**GitHub Apps Mode (Enterprise / Optional)**

```
Create your first project

┌────────────────────────────────────────────────────────────┐
│ GitHub Apps                                                 │
│ Reader App (read-only; index code)   [Verified ✓]          │
│ Docs App   (write docs PRs only)     [Verified ✓]          │
│                                                            │
│ Code repo                                                   │
│ [ owner/my-api                                      ▼ ]     │
│ Tracked branch (locked):  main                              │
│                                                            │
│ Docs repo                                                   │
│ [ owner/my-api-docs                                 ▼ ]     │
│ or:  [+ Create new docs repo]                               │
│                                                            │
│                                    [Create project →]       │
└────────────────────────────────────────────────────────────┘
```

**Behavior (GitHub Apps Mode):**
- If GitHub Apps are already installed, shows "Verified ✓"
- If not installed, shows "Install / Verify →" buttons
- Repo lists are limited to repos accessible under the relevant GitHub App installation
- Apps provide fine-grained permissions + automatic webhook subscriptions
- Enabled when `GITHUB_APP_ID` environment variable is configured

```
Create your first project

┌────────────────────────────────────────────────────────────┐
│ Step 1 — Connect GitHub Apps                                │
│                                                            │
│ Reader App (read-only; index code)   [Install / Verify →]   │
│ Docs App   (write docs PRs only)     [Install / Verify →]   │
│                                                            │
│ Step 2 — Code repo                                          │
│ [ owner/my-api                                      ▼ ]     │
│ Tracked branch (locked):  main                              │
│                                                            │
│ Step 3 — Docs repo                                          │
│ [ owner/my-api-docs                                 ▼ ]     │
│ or:  [+ Create new docs repo]                               │
│                                                            │
│                                    [Create project →]       │
└────────────────────────────────────────────────────────────┘
```

**Behavior:**
- If GitHub Apps are already installed, “Install / Verify” becomes “Verified ✓”.
- Repo lists are limited to repos accessible under the relevant GitHub App installation.
- Creating a project immediately enqueues initial indexing. No further user action is required.
- Changing the code repo or tracked branch requires creating a new project (projects are immutable by default).

---

### 3.3 Indexing + First Docs PR

**Purpose:** Show real-time progress and deliver initial documentation automatically.

**Happy path:**
1. Index starts immediately (real-time banner + live counters).
2. When the graph is ready, the doc agent runs and opens the initial docs PR in the project’s docs repo.
3. The **Docs branch selector** gains a preview branch (unmerged PR branch) for in-app review.

**Failure path:**
- Indexing failure shows an error banner with the run id and a “Retry indexing” action.
- Docs PR failure shows an error state in **Git** (with retry and a runbook link).

---

## 4. Chats (Agent) (`/app/:projectId?mode=chat`)

**Purpose:** Primary interaction surface for the **Documentation Assistant**.

- **Column 2:** chat threads (multiple per project), conversation, input.
- **Column 3:** flows canvas by default (derived flows, architecture diagrams, entrypoint traces).

```
┌──────────┬──────────────────────────────┬─────────────────────────────────┐
│ SIDEBAR  │ Column 2: Agent              │ Column 3: Canvas                 │
│ 💬 Chats │ [Threads] [Search]           │ [Flow diagram / architecture]    │
│ 📊 Graph │ User: "What does billing do?"│ (scroll/zoom; shareable links)   │
│ 📝 Docs  │ AI:  grounded answer + refs  │                                  │
│ 🔀 Git   │ Tools: contracts.get(...)    │                                  │
│ ⚙️ Set   │                              │                                  │
│ 💡 Fb    │ [ Ask a question… ]          │                                  │
└──────────┴──────────────────────────────┴─────────────────────────────────┘
```

**Assistant UX rules:**
- Responses cite evidence (symbol UIDs, flow entrypoints, doc paths, PR run ids).
- The assistant must not fetch or display source code bodies/snippets by default.
- Tool calls/results are visible (collapsible) so developers can audit what informed the response.

---

## 5. Code Graph (Canvas Toggle) (`/app/:projectId?canvas=graph`)

**Purpose:** Explore the Code Intelligence Graph without leaving the workspace.

**Graph is special behavior:** selecting **Graph** switches **Column 3** into the graph viewer; **Column 2 stays in its last non-graph mode**.

**Default mode: Focus + lazy loading (enterprise-scale safe).**
- The canvas does **not** render the full repo graph by default.
- Initial view is a focused subgraph (search result, entrypoint flow, or selected node neighborhood).
- Nodes/edges are fetched on-demand (e.g., neighborhood expansion) as the user drills in.

**Core interactions:**
- Search (text + semantic) → focus neighborhood
- Click node → open node detail drawer (contract + relationships + linked docs)
- “Show blast radius” → highlight impacted nodes
- “Trace flow” → derive a flow graph for an entrypoint

**No code bodies:** node detail shows contracts + locations. “Open in GitHub” is explicit.

---

## 6. Documentation (Docs Repo File Tree + Viewer/Editor) (`/app/:projectId?mode=docs&path=:path&ref=:docsRef`)

**Purpose:** Browse documentation from the project’s **docs repo** and edit safely.

- **Column 2:** docs repo **file tree** (folders/files) + search.
- **Column 3:** viewer/editor for the selected file.

```
┌──────────┬──────────────────────────────┬─────────────────────────────────┐
│ SIDEBAR  │ Column 2: Docs tree          │ Column 3: Doc viewer/editor      │
│ 📝 Docs  │ docs/                        │ api/auth.md                       │
│          │  api/                        │ ───────────────────────────────  │
│          │   auth.md   ← selected       │ ## POST /auth/login   [fresh]     │
│          │   users.md                   │ (rendered markdown)               │
│          │  runbooks/                   │ ## POST /auth/logout  [stale]     │
│          │   oncall.md                  │ (block overlay + evidence icon)   │
│          │                              │ [Edit] [Diff]                     │
└──────────┴──────────────────────────────┴─────────────────────────────────┘
```

**Viewer rules:**
- Markdown is sanitized (no script execution).
- Doc-block-managed sections are overlaid with: block type, status (fresh/stale/locked), and evidence affordances.
- Selecting a block opens an evidence inspector (contracts + locations only; no code bodies by default).

**Editing rules (Admin+):**
- Editing happens on a preview branch and is shown as a diff before publish.
- Publishing is a single action: **Open PR** (top nav).
- Writes are hard-failed if the target repo is not the project’s configured docs repo.

---

## 7. Doc Block Evidence Inspector (in-doc drawer)

**Purpose:** Let developers verify documentation claims without exposing code bodies.

**Appears:** when a user clicks a block overlay (from the doc viewer/editor).

Contents:
- Block metadata: type, status, last PR run id
- Evidence list: symbol UID, file path + line range + sha, contract summary (signature/schema/constraints)
- Actions: view node in graph, regenerate block (developer+), lock/unlock (future)

**Privacy rule:** The inspector never fetches or renders source code bodies/snippets by default.

---

## 8. Git (PR Runs + Diff Viewer) (`/app/:projectId?mode=git&run=:prRunId`)

**Purpose:** Show documentation PR history and allow review before merging.

- **Column 2:** PR runs list + status.
- **Column 3:** PR preview / diff viewer (selected run/branch).

**Design notes:**
- A PR run is the canonical unit of “what changed and why” (trigger SHA + changed nodes + blocks updated/created).
- “View PR on GitHub” is always available as a safe escape hatch.

---

## 9. Coverage (Graph tab)

Coverage is accessible from Graph mode as a tab/sub-view (not a primary sidebar item). It answers:
- what is documented vs undocumented
- highest-impact undocumented entrypoints
- unresolved imports (graph gaps)

Coverage actions (“Document selected”) enqueue doc agent runs and surface results as PR runs.

---

## 10. Real-time Indexing Banner

Appears during indexing and doc generation to provide live progress feedback.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ↻  Indexing owner/my-api...  [████████████░░░░░░░░░░] 64%                  │
│     Currently: src/services/payment.ts  ·  342 nodes  ·  891 edges          │
└──────────────────────────────────────────────────────────────────────────────┘
```

Position: Sticky below the top navigation bar, above workspace content.
Dismissal: Fades out automatically when `index:complete` fires.

---

## 11. Agent Activity Live Feed

**Appears:** as a slide-over sheet during any active doc agent run (and linked from Git/Docs when a PR run is active).

```
Doc Agent: PR #15                              × Close

↻ Active  ·  Triggered by commit a3f8c2d

─────────────────────────────────────────────────────────

✓  graph.blast_radius(loginUser)                   142ms
   → 3 affected nodes found

✓  docs.get_block(block_auth_login)                89ms
   → api/auth.md ## POST /auth/login (stale)

✓  contracts.get([loginUser])                      234ms
   → signature + schema + constraints

↻  docs.update_block(...)                          [updating]
   Generating new documentation...

─────────────────────────────────────────────────────────

Blocks updated: 2 of 5 estimated
```

---

## 12. Settings (`/app/:projectId?mode=settings`)

Settings live in Column 2 (forms) with contextual previews/confirmations in Column 3.

**Settings sections (v1):**
- Billing (owner+)
- Team (admin+)
- GitHub integrations (install/verify Reader + Docs Apps)
- Project settings (repo bindings):
  - Code repo + tracked branch (display-only; immutable)
  - Docs repo (display-only; immutable by default)

**Changing repo bindings:** create a new project from the project dropdown.

---

## 13. Empty States

### No projects yet
- Show the Create First Project wizard immediately.

### Graph empty (indexing failed)
- Show error banner with run id, “Retry indexing”, and a link to logs.

### No documentation yet
- Show a friendly state explaining that docs appear after the first docs PR is opened.
- Provide a shortcut to Git (PR runs) and indexing status.

---

## Navigation
- [← Technical Spec](03_TECHNICAL_SPEC.md)
- [← Index](00_INDEX.md)
