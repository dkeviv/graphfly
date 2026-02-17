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
  Background:     #FFFFFF (white)
  Surface:        #F9FAFB (gray-50, cards, sidebars)
  Border:         #E5E7EB (gray-200)
  Border-focus:   #4F46E5 (indigo-600)

  Text-primary:   #111827 (gray-900)
  Text-secondary: #6B7280 (gray-500)
  Text-muted:     #9CA3AF (gray-400)

  Primary:        #4F46E5 (indigo-600)
  Primary-hover:  #4338CA (indigo-700)
  Primary-bg:     #EEF2FF (indigo-50)

  Success:        #10B981 (emerald-500)
  Warning:        #F59E0B (amber-500)
  Error:          #EF4444 (red-500)

  Node-function:  #4F46E5 (indigo)
  Node-class:     #10B981 (emerald)
  Node-module:    #6B7280 (gray)
  Node-package:   #F59E0B (amber)

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
- Onboarding is presented as a **single guided stepper** with progressive disclosure.
- “Advanced / dev-only” controls (PAT connect, local repo path, API URL) are tucked behind collapsible panels.
- Primary CTAs are visually distinct and the UI gates actions (docs repo must be set before project creation).

---

## 2. Application Structure

### 2.1 Navigation

**Phase-1 implementation note (this repo):** the current UI is a lightweight single-page app using hash routes:
- `#/dashboard` — enterprise landing (org/project context + next actions)
- `#/onboarding` — Setup (GitHub connect, docs repo selection, project creation; auto index + docs)
- `#/graph` — search + focus mode explorer, with live indexing banner
- `#/docs` — doc blocks list + evidence detail, with live agent activity feed
- `#/coverage` — coverage KPIs + undocumented entry points + unresolved imports; “Document Selected”
- `#/admin` — admin overview, jobs/audit, team invites, secrets rotation, metrics preview
- `#/accept?...` — accept an invitation link (OAuth sign-in if needed)

```
Left Sidebar (240px fixed, collapsible on mobile):

  ┌─────────────────────────────────┐
  │  ◈ Graphfly                     │
  │  ─────────────────────────────  │
  │                                 │
  │  [owner ▼]  ← org switcher      │
  │                                 │
  │  owner/my-api  ▼  ← repo       │
  │                                 │
  │  ● Dashboard                    │
  │    Graph Explorer               │
  │    Documentation                │
  │    PR Timeline                  │
  │    Coverage                     │
  │                                 │
  │  ─────────────────────────────  │
  │  SETTINGS                       │
  │    Repositories                 │
  │    Docs Repo                    │
  │    Team                         │
  │    Billing                      │
  │                                 │
  │  ─────────────────────────────  │
  │  [+ Add Repository]             │
  └─────────────────────────────────┘
```

**Repo Switcher**: Dropdown showing all connected repos in the org. Shows index status badge (dot: gray=pending, yellow=indexing, green=ready, red=error).

**Org Switcher**: Dropdown for users who belong to multiple orgs.

### 2.2 Page Routes

```
/                         → Redirect to /dashboard (if logged in) or landing
/sign-in                  → Clerk-hosted auth
/onboarding               → Redirect to /onboarding/connect
/onboarding/connect       → Step 1: Connect GitHub
/onboarding/repos         → Step 2: Select repos
/onboarding/docs          → Step 3: Set docs repo
/onboarding/indexing      → Step 4: Live indexing progress
/onboarding/ready         → Step 5: First docs PR
/dashboard                → Home dashboard (default repo)
/repos/:repoId/graph      → Interactive graph explorer
/repos/:repoId/docs       → Documentation browser
/repos/:repoId/docs/blocks/:blockId  → Doc block detail
/repos/:repoId/pr-runs    → PR timeline
/repos/:repoId/coverage   → Coverage dashboard
/settings/repos           → Manage connected repos
/settings/docs-repo       → Configure docs repo
/settings/team            → Manage members
/settings/billing         → Plan + usage
```

### 2.3 User Flows (Tables)

The tables below capture the primary user journeys end-to-end. These are the flows the product must make effortless.

#### Authentication, Org, Repo

| Flow ID | Actor | Entry | Steps (happy path) | Success |
|---|---|---|---|---|
| UF-AUTH-01 | Any user | `/` | Redirect to `/sign-in` → authenticate (GitHub/Google/email) | User lands on onboarding (first-time) or `/dashboard` |
| UF-ORG-01 | Multi-org user | Left sidebar org switcher | Select org → tenant context switches | All views reflect selected org |
| UF-REPO-01 | Any user | Repo switcher | Select repo → navigate to last repo-scoped page | Repo-scoped pages show selected repo data |

#### Onboarding (Time-to-Value)

| Flow ID | Actor | Entry | Steps (happy path) | Success |
|---|---|---|---|---|
| UF-ONB-01 | Admin+ | `/onboarding/connect` | Install **Reader App** (read-only) → return → app detects `github_reader_install_id` | Advance to repo selection |
| UF-ONB-02 | Admin+ | `/onboarding/repos` | Select source repos → connect → full index jobs enqueued automatically | Advance to docs repo setup |
| UF-ONB-03 | Owner/Admin | `/onboarding/docs` | Select/create docs repo → install **Docs App** (write to docs repo only) → `github_docs_install_id` detected | “Start Indexing” enabled |
| UF-ONB-04 | Admin+ | `/onboarding/indexing` | Watch live index progress + live graph preview | `index:complete` → advance |
| UF-ONB-05 | Admin+ | `/onboarding/ready` | Watch agent activity → first docs PR created in docs repo | User can open PR or go to Graph Explorer |
| UF-ONB-LOCAL-01 (dev) | Admin+ | `#/onboarding` | Set docs repo → enter local git repo path → **Create Local Project** (guarded by `GRAPHFLY_ALLOW_LOCAL_REPO_ROOT=1`) | Local index + docs write pipeline runs end-to-end |

#### Dashboard & Day-to-Day Usage

| Flow ID | Actor | Entry | Steps (happy path) | Success |
|---|---|---|---|---|
| UF-DB-00 | Any user | `#/dashboard` | See org + project context → follow “Next action” CTAs | User reaches value quickly without hunting |
| UF-DB-01 | Any user | `/dashboard` | Click stat cards (Graph/Docs/Last PR/Stale) | Deep-links to relevant view with correct filters |
| UF-DB-02 | Developer+ | `/dashboard` | Click **Document** on an undocumented entry point | Doc agent run triggered; status visible; PR opened |
| UF-DB-03 | Developer+ | `/dashboard` | Select multiple entry points → **Document All Selected** | Bulk doc generation runs; PR(s) opened |

#### Graph Explorer (Focus Mode, Lazy Loaded)

| Flow ID | Actor | Entry | Steps (happy path) | Success |
|---|---|---|---|---|
| UF-GRAPH-01 | Any user | `/repos/:repoId/graph` | Search (text/semantic) → select result | Focus subgraph rendered around selected node |
| UF-GRAPH-02 | Any user | `/repos/:repoId/graph` | Click node → fetch/merge neighborhood on demand | Subgraph expands without rendering full repo graph |
| UF-GRAPH-03 | Any user | `/repos/:repoId/graph` | Click **Show Blast Radius** | Affected nodes highlighted; user can exit mode |
| UF-GRAPH-04 | Any user | `/repos/:repoId/graph` | Click **Trace Flow** on entrypoint | Call path displayed to configured depth |
| UF-GRAPH-05 | Any user | `/repos/:repoId/graph` | Double-click node / **View in GitHub** | Browser opens exact file+line in GitHub |

#### Documentation (Evidence-backed)

**Phase-1 implementation note (this repo):**
- Doc block detail renders a read-only Markdown preview and an Evidence list that inlines contract metadata (e.g., signature) plus file+line locations (no source code bodies/snippets).
- Regeneration is exposed as **Regenerate (Admin)** in the doc block detail view (admin-only in Phase‑1).

| Flow ID | Actor | Entry | Steps (happy path) | Success |
|---|---|---|---|---|
| UF-DOCS-01 | Any user | `/repos/:repoId/docs` | Filter by status/file/type → open a block | User reaches doc block detail |
| UF-DOCS-02 | Any user | `/repos/:repoId/docs/blocks/:blockId` | Read doc content + verify evidence (contracts + locations) | User can validate claims quickly |
| UF-DOCS-03 | Admin+ | Doc block detail | Click **Edit** → change markdown → save | Manual edit PR opened in docs repo |
| UF-DOCS-04 | Developer+ | Doc block detail | Click **Regenerate** | Agent updates block; PR opened; status updates |
| UF-DOCS-05 | Admin+ | Doc block detail | Click **+ Update Evidence** → add/remove nodes | Evidence links updated for future surgical updates |
| UF-DOCS-06 (future) | Admin+ | Doc block detail | Click **Lock** | Block pinned (agent cannot modify until unlocked) |

#### PR Timeline

| Flow ID | Actor | Entry | Steps (happy path) | Success |
|---|---|---|---|---|
| UF-PR-01 | Any user | `/repos/:repoId/pr-runs` | Select a run → view details → open PR | User reviews/merges docs PR on GitHub |
| UF-PR-02 | Any user | PR run detail | Click “See updated/created blocks” | User jumps to affected doc blocks |

#### Coverage

| Flow ID | Actor | Entry | Steps (happy path) | Success |
|---|---|---|---|---|
| UF-COV-01 | Any user | `/repos/:repoId/coverage` | Inspect coverage + undocumented entry points | Clear prioritized doc targets |
| UF-COV-02 | Developer+ | Coverage | Select nodes → **Document Selected** | Doc generation runs; PR opened |

#### Settings

| Flow ID | Actor | Entry | Steps (happy path) | Success |
|---|---|---|---|---|
| UF-SET-REPO-01 | Admin+ | `/settings/repos` | Connect repo | Repo appears; initial index queued |
| UF-SET-REPO-02 | Admin+ | `/settings/repos` | Click **Reindex** | Full index job queued; progress streamed |
| UF-SET-REPO-03 | Admin+ | `/settings/repos` | Click **Disconnect** | Repo stops updating; data retention policy applies |
| UF-SET-DOCS-01 | Admin+ | `/settings/docs-repo` | Change docs repo → install Docs App on new repo | Future PRs target new docs repo only |
| UF-SET-TEAM-01 | Owner/Admin | `/settings/team` | Invite member (role) → manage invitations | Team membership updated |
| UF-SET-BILL-01 | Owner | `/settings/billing` | Upgrade plan → Stripe Checkout | Subscription active; entitlements increased |
| UF-SET-BILL-02 | Owner | `/settings/billing` | Open Stripe Customer Portal | Payment/invoices managed self-serve |

#### Failure/Recovery

| Flow ID | Actor | Entry | Steps (failure path) | Recovery |
|---|---|---|---|---|
| UF-FAIL-INDEX-01 | Any user | Any repo page | Index fails → banner/toast shows error | View error details → retry indexing |
| UF-FAIL-AGENT-01 | Any user | Docs/PR timeline | Agent run fails → status=error | Retry regeneration; view run logs summary |

---

## 3. Onboarding Flow

### 3.1 Step 1: Sign In (`/sign-in`)

**Purpose:** Authenticate the user. GitHub OAuth is the primary path.

```
Layout: Centered, 400px wide, vertically centered, white background

┌───────────────────────────────────────────────────┐
│                                                   │
│              ◈ Graphfly                           │
│                                                   │
│     Your code. Documented. Always.                │
│                                                   │
│  ┌─────────────────────────────────────────────┐  │
│  │                                             │  │
│  │  [▼ Continue with GitHub]  ← primary CTA   │  │
│  │                                             │  │
│  │  [   Continue with Google  ]  ← secondary  │  │
│  │                                             │  │
│  │  ─────────── or ───────────                 │  │
│  │                                             │  │
│  │  Email address                              │  │
│  │  [____________________________]             │  │
│  │                                             │  │
│  │  [  Continue with email  ]                  │  │
│  │                                             │  │
│  └─────────────────────────────────────────────┘  │
│                                                   │
│  By signing up you agree to our Terms of Service  │
│                                                   │
└───────────────────────────────────────────────────┘
```

**Design notes:**
- GitHub button uses GitHub logo + indigo background (developers prefer GitHub SSO)
- No password field visible until email is submitted (progressive disclosure)
- No "sign up" vs "sign in" distinction — Clerk handles both

---

### 3.2 Step 2: Connect GitHub (`/onboarding/connect`)

**Purpose:** Install the GitHub **Reader App** (read-only) used to index source code repositories.

```
Layout: Centered 480px card, step progress dots at top

	        ● ─ ○ ─ ○ ─ ○    Steps 1–4
        ↑
        Active

┌──────────────────────────────────────────────────────┐
│                                                      │
│  Connect your GitHub repositories                    │
│                                                      │
│  Graphfly uses a read-only GitHub App to analyze     │
│  your source code repositories.                       │
│  Here's exactly what access we request:             │
│                                                      │
│  ✓ Read source files (to build the Code Intelligence Graph) │
│  ✓ Receive push events (to keep docs current)        │
│  ✗ No write access to your source code repos        │
│  ✗ We never execute your code                       │
│                                                      │
│  ─────────────────────────────────────────────────  │
│                                                      │
│  [  Install Reader App  →  ]   ← opens new tab      │
│                                                      │
│  Waiting for installation...  ● (animated dot)       │
│  (auto-detects when you return from GitHub)          │
│                                                      │
└──────────────────────────────────────────────────────┘
```

**Behavior:**
- Button opens Reader App install in a new tab
- Page polls `/api/v1/orgs/current` every 2s for `github_reader_install_id !== null`
- When detected: auto-advances to Step 3 without user action
- Shows a subtle "Still waiting..." after 30s with a "Try again" link

---

### 3.3 Step 3: Select Repos (`/onboarding/repos`)

**Purpose:** Choose which repos to connect.

```
       ● ─ ● ─ ○ ─ ○

┌──────────────────────────────────────────────────────┐
│                                                      │
│  Select repositories to document                    │
│                                                      │
│  [🔍  Filter by name...]                             │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │  ☑  owner/my-api         TypeScript  1,240 ⬤  │  │
│  │  ☑  owner/frontend       React         890 ⬤  │  │
│  │  ☐  owner/scripts        Python          42    │  │
│  │  ☐  owner/infra          HCL            200    │  │
│  │  ☐  owner/data-pipeline  Python       3,100    │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  ● = large repo (>500 files, estimated 5min index)  │
│                                                      │
│  2 repos selected                                    │
│                                                      │
│  [← Back]          [Connect 2 repos →]              │
│                                                      │
└──────────────────────────────────────────────────────┘
```

**Design notes:**
- Pre-select all repos (opt-out, not opt-in — shows more value immediately)
- Show language icon (colored dot based on primary language)
- Show file count as a proxy for "how long will indexing take"
- Repos with >1,000 files show a subtle size indicator
- Filter input with instant fuzzy search

---

### 3.4 Step 4: Set Docs Repo (`/onboarding/docs`)

**Purpose:** Choose where Graphfly opens PRs, then install the **Docs App** (write access to docs repo only).

```
       ● ─ ● ─ ● ─ ○

┌──────────────────────────────────────────────────────┐
│                                                      │
│  Set up your documentation repository               │
│                                                      │
│  Graphfly opens PRs here with updated .md files.    │
│  We use a separate GitHub App with write access     │
│  to this docs repo only (never your source repos).  │
│                                                      │
│  Use an existing repository:                         │
│  [owner/docs-repo                              ▼]   │
│                                                      │
│  ─────────────────── or ───────────────────────────  │
│                                                      │
│  [+ Create "owner/graphfly-docs"]                   │
│     Empty private repo, set up automatically        │
│                                                      │
│  ─────────────────────────────────────────────────  │
│                                                      │
│  Step required: authorize write access to docs repo   │
│  [  Install Docs App  →  ]                           │
│                                                      │
│  ─────────────────────────────────────────────────  │
│                                                      │
│  Example PR Graphfly will open:                     │
│  ┌────────────────────────────────────────────────┐  │
│  │  Branch:  docs/update-a3f8c2d1                │  │
│  │  Title:   docs: update api/auth.md             │  │
│  │  +12 -3   Changes to 2 files                  │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  [← Back]          [Start Indexing →]               │
│                                                      │
└──────────────────────────────────────────────────────┘
```

**Behavior:**
- “Start Indexing” is disabled until the Docs App installation is detected (`github_docs_install_id !== null`).
- On successful Docs App install, the UI confirms “Write access granted to docs repo” and enables “Start Indexing”.

---

### 3.5 Step 5: Live Indexing (`/onboarding/indexing`)

**Purpose:** Show that indexing is working. Make the wait feel productive.

```
       ● ─ ● ─ ● ─ ●

┌──────────────────────────────────────────────────────────────────────┐
│                                                                      │
│  Building your Code Intelligence Graph...                            │
│                                                                      │
│  Left 50% — Progress:              Right 50% — Live Graph Preview:  │
│  ┌──────────────────────────────┐  ┌──────────────────────────────┐  │
│  │                              │  │                              │  │
│  │  ████████████░░░░░  64%      │  │  [Cytoscape canvas]          │  │
│  │  src/services/payment.ts     │  │                              │  │
│  │                              │  │  Nodes appear in real-time   │  │
│  │  ─────────────────────────   │  │  as files are parsed.        │  │
│  │                              │  │                              │  │
│  │  ✓ src/auth/login.ts         │  │  ● Function (indigo)         │  │
│  │    → 3 functions, 1 class    │  │  ■ Class (emerald)           │  │
│  │  ✓ src/models/User.ts        │  │  ⬡ Module (gray)             │  │
│  │    → 1 class, 8 methods      │  │                              │  │
│  │  ✓ src/db/connection.ts      │  │                              │  │
│  │    → 2 functions             │  │                              │  │
│  │  ↻ src/services/payment.ts   │  │                              │  │
│  │    Parsing...                │  │                              │  │
│  │                              │  │                              │  │
│  │  342 nodes · 891 edges       │  │                              │  │
│  └──────────────────────────────┘  └──────────────────────────────┘  │
│                                                                      │
│  owner/my-api  ·  owner/frontend                                    │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

**Behavior:**
- WebSocket `index:progress` events update progress bar + log + counters
- Graph canvas updates in real-time (nodes fade in as they arrive)
- Auto-advances to Step 6 when `index:complete` fires
- If indexing fails: shows error message with "Retry" button

---

### 3.6 Step 6: First Docs PR (`/onboarding/ready`)

**Purpose:** Show the first tangible value — a real documentation PR.

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│  ✓ Graph ready                                       │
│    729 nodes · 1,847 edges indexed                  │
│                                                      │
│  ─────────────────────────────────────────────────  │
│                                                      │
│  Creating your first documentation...               │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │  ↻  Reading loginUser function...              │  │
│  │  ↻  Analyzing 3 call targets...                │  │
│  │  ↻  Writing api/auth.md...                     │  │
│  │  ↻  Writing models/user.md...                  │  │
│  │  ↻  Opening PR in owner/docs-repo...           │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │  ✓ First documentation PR created!            │  │
│  │                                               │  │
│  │  PR #1  ·  docs/update-initial                │  │
│  │  "docs: initial documentation"                │  │
│  │  12 blocks created across 4 files             │  │
│  │                                               │  │
│  │  [  View PR on GitHub ↗  ]                    │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  [  Explore your graph  →  ]                        │
│                                                      │
└──────────────────────────────────────────────────────┘
```

---

## 4. Dashboard (`/dashboard`)

**Purpose:** At-a-glance health of documentation across all connected repos.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ◈ Graphfly       [owner/my-api ▼]                          [+ Add Repo]    │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌─────────────┐  │
│  │  Code Intelligence Graph │  │ Documentation │  │   Last PR     │  │   Stale     │  │
│  │               │  │               │  │               │  │             │  │
│  │  729 nodes    │  │     73%       │  │   2 hours ago │  │  8 blocks   │  │
│  │  1,847 edges  │  │  documented   │  │   PR #14      │  │  need update│  │
│  └───────────────┘  └───────────────┘  └───────────────┘  └─────────────┘  │
│                                                                             │
│  ┌─────────────────────────────────────────────────────┐  ┌─────────────┐  │
│  │  Recent Documentation PRs               [View all]  │  │  Quick      │  │
│  │  ────────────────────────────────────────────────── │  │  Actions    │  │
│  │                                                     │  │  ─────────  │  │
│  │  ● PR #14  ·  2h ago  ·  3 updated  ·  ✓ success   │  │             │  │
│  │    auth: add refresh token endpoint                 │  │ [Reindex]   │  │
│  │                                                     │  │             │  │
│  │  ● PR #13  ·  6h ago  ·  1 created  ·  ✓ success   │  │ [Coverage]  │  │
│  │    models: add UserPreferences                      │  │             │  │
│  │                                                     │  │ [Explore    │  │
│  │  ● PR #12  ·  1d ago  ·  12 created ·  ✓ success   │  │  Graph]     │  │
│  │    Initial documentation                            │  │             │  │
│  └─────────────────────────────────────────────────────┘  └─────────────┘  │
│                                                                             │
│  Top Undocumented Entry Points                     [Document All Selected]  │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  Function              File                  Callers  Priority   Action     │
│  handlePayment()       src/billing.ts             12  ▲ HIGH    [Document]  │
│  processWebhook()      src/events.ts               8  ▲ HIGH    [Document]  │
│  syncInventory()       src/sync.ts                 5  ● MED     [Document]  │
│  createSubscription()  src/subscriptions.ts        4  ● MED     [Document]  │
│  sendNotification()    src/notifications.ts        3  ▼ LOW     [Document]  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Interactions:**
- Stats cards are clickable: Graph → /graph, Documentation → /docs, Last PR → /pr-runs, Stale → /docs?status=stale
- PR timeline entries click through to full PR run detail
- "Document" button on undocumented entries triggers single-node doc agent job
- "Document All Selected" bulk-triggers doc agent for checked entries
- Repo switcher in top nav (same row as Graphfly logo)

---

## 5. Graph Explorer (`/repos/:repoId/graph`)

**Purpose:** Understand the structure of the codebase and relationships between components.

**Default mode: Focus + lazy loading (enterprise-scale safe).**
- The canvas does **not** attempt to render the full repo graph by default.
- Initial view is a focused subgraph (search result, entrypoint flow, or selected node neighborhood).
- Nodes/edges are fetched on-demand (e.g., `GET /graph/neighborhood/:nodeId`) as the user drills in.
- A “Full graph” option can exist for small repos only (with a confirmation + hard cap), but Focus mode is the product default.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  [🔍  Search nodes...  ]  [Scope ▼]  [Type ▼]  [Layout ▼]  [+]  [−]  [⊡]   │
├─────────────────────────────────────────────────┬───────────────────────────┤
│                                                 │  Node Detail              │
│                                                 │  ─────────────────────── │
│  ●  loginUser                                   │                           │
│  ↓                                              │  loginUser                │
│  ●  findByEmail ─────────────── ●  getUserById  │  Function · TypeScript    │
│  ↓                                              │  src/auth/login.ts:12–45  │
│  ●  bcrypt.compare                              │                           │
│  ↓                                              │  Signature (contract):    │
│  ●  signJWT                                     │  loginUser(               │
│  ↓                                              │    email: string,         │
│  ●  setHttpCookie                               │    password: string       │
│                                                 │  ) → Promise<AuthResult>  │
│                                                 │                           │
│  (Graph canvas — Cytoscape.js with dagre        │  [Callers]  [Callees]     │
│   layout, zoom+pan, click to select)            │  [Deps]  [Dependents]     │
│                                                 │                           │
│                                                 │  ─────────────────────── │
│                                                 │  Documentation            │
│                                                 │                           │
│  Node Legend:                                   │  ## POST /auth/login      │
│  ● Function (indigo)                            │  Authenticates a user...  │
│  ■ Class (emerald)                              │  [View]  [Edit]           │
│  ⬡ Module (gray)                               │                           │
│  ◆ Package (amber)                              │  ─────────────────────── │
│                                                 │  [View in GitHub ↗]       │
│                                                 │  [Show Blast Radius]      │
│                                                 │  [Trace Flow]             │
└─────────────────────────────────────────────────┴───────────────────────────┘
```

**Toolbar controls:**
- **Search**: Instant text search; toggle button for semantic mode
- **Scope**: Focus (default) | Neighborhood | Flow Trace | Full graph (if eligible)
- **Type filter**: Multi-select: Function | Class | Module | Package
- **Layout**: Dagre (hierarchical, default) | Force | Radial
- **Zoom**: + / - buttons, plus scroll-to-zoom on canvas
- **Fit**: ⊡ button fits all nodes in view

**Canvas interactions:**
- Click node → populate right panel (API: `GET /graph/nodes/:nodeId`)
- Click node in Focus mode → fetch/merge its neighborhood into the current subgraph (lazy load)
- Hover node → tooltip: name, type, file:line
- Double-click node → open file at line in GitHub (new tab)
- Right-click node → context menu: View Code, Show Blast Radius, Document This Node, Copy Node ID
- Click edge → highlight both endpoints
- Click empty area → deselect, clear right panel

**Blast Radius mode:**
- Toggle "Show Blast Radius" button → selected node's affected nodes highlighted with amber ring
- Affected nodes show a count badge: "42 affected"
- "Exit Blast Radius" button clears the highlight

**Right panel tabs:**
- **Callers**: List of nodes that call this node (with file:line)
- **Callees**: List of nodes this node calls
- **Dependencies**: Import relationships
- **Dependents**: Who imports this node
- All tabs are clickable (navigating to that node in the graph)

---

## 6. Documentation Browser (`/repos/:repoId/docs`)

**Purpose:** Browse all documentation blocks, filter by status, file, or type.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Documentation · owner/my-api                                               │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  [🔍 Search docs...]  [Status: All ▼]  [File ▼]  [Type ▼]                 │
│                                                                             │
│  api/auth.md                                                       3 blocks │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  ● current  ## POST /auth/login              api_endpoint  2h ago   │   │
│  │  ● current  ## POST /auth/refresh            api_endpoint  2h ago   │   │
│  │  ⚠ stale   ## POST /auth/logout             api_endpoint  4d ago   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  api/users.md                                                      2 blocks │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  ● current  ## GET /users/:id                api_endpoint  1d ago   │   │
│  │  ● current  ## PUT /users/:id                api_endpoint  1d ago   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  models/user.md                                                    1 block  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  ● current  ## User                         class        6h ago    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Status badges:**
- `● current` — green dot, documentation is up to date
- `⚠ stale` — amber dot, evidence nodes have changed since last update
- `↻ generating` — spinning dot, agent is currently updating this block
- `✗ error` — red dot, last generation failed

---

## 7. Doc Block Detail (`/repos/:repoId/docs/blocks/:blockId`)

**Purpose:** View and verify a single documentation block with its evidence.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ← Documentation · api/auth.md                                              │
│  ## POST /auth/login  ·  ● current  ·  Updated by PR #14 · 2h ago          │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
├───────────────────────────────────┬─────────────────────────────────────────┤
│  DOCUMENTATION                    │  EVIDENCE  (3 contract references)      │
│  ─────────────────────────────── │  ─────────────────────────────────────  │
│                                   │                                         │
│  ## POST /auth/login              │  1. src/auth/login.ts  lines 12–45      │
│                                   │     Weight: primary ●                   │
│  Authenticates a user with email  │     Signature: loginUser(email, password)│
│  and password. Returns a signed   │     Returns: Promise<AuthResult>         │
│  JWT token and sets a session     │     Constraints:                          │
│  cookie.                          │     - email: format=email                │
│                                   │     - password: minLength=8              │
│  **Request body:**                │     [View Location]  [Open in GitHub ↗*] │
│  ```json                          │                                         │
│  {                                │  2. src/auth/jwt.ts  lines 8–22         │
│    "email": "user@example.com",   │     Weight: secondary ○                 │
│    "password": "secret"           │     Signature: signJWT(payload) → string│
│  }                                │     [View Location]  [Open in GitHub ↗*] │
│  ```                              │                                         │
│                                   │  3. src/models/User.ts  lines 1–45      │
│  **Response:**                    │     Weight: secondary ○                 │
│  ```json                          │     Contract: User schema (fields, types)│
│  {                                │     [View Location]  [Open in GitHub ↗*] │
│    "token": "eyJ...",             │                                         │
│    "user": { ... }                │                                         │
│  }                                │                                         │
│  ```                              │                                         │
│                                   │                                         │
│  **Errors:**                      │                                         │
│  - 401 Invalid credentials        │                                         │
│  - 422 Validation error           │                                         │
│                                   │                                         │
│  [Edit]  [Regenerate]  [Lock*]   │  ──────────────────────────────────────  │
│                                   │  [+ Update Evidence]                    │
│                                   │  [View node in Graph]                   │
└───────────────────────────────────┴─────────────────────────────────────────┘
```

**"Edit" button:** Opens an inline markdown editor. Saving creates a manual edit PR.

**"Regenerate" button:** Triggers the doc agent for this single block. Shows a progress indicator until the new PR is opened.

**"Lock" button (future):** Prevent the agent from modifying this block unless an admin unlocks it (manual override protection).

**Evidence panel privacy:** By default, the Evidence panel shows **contract + location metadata** only (signatures/schemas/constraints + file/line). It does not fetch or render source code bodies/snippets. “Open in GitHub” is an explicit user action and may reveal source code in GitHub.

**"View node in Graph":** Navigates to the Graph Explorer with the primary evidence node selected.

**"+ Update Evidence":** Opens a sheet to add or remove evidence nodes (search for nodes by name).

---

## 8. PR Timeline (`/repos/:repoId/pr-runs`)

**Purpose:** Full history of all documentation PRs Graphfly has opened.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Documentation PRs  ·  owner/my-api  →  owner/docs-repo                     │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  [All ▼]  [Date range ▼]                                                   │
│                                                                             │
│  FEBRUARY 2026                                                              │
│                                                                             │
│  ──●──────────────────────────────────────────────────────────────────────  │
│    │  PR #14  ·  ✓ success  ·  February 13, 2026 at 14:32                   │
│    │  Triggered by commit a3f8c2d                                           │
│    │  "auth: add refresh token endpoint" — by Jane Smith                    │
│    │                                                                        │
│    │  Changed nodes:   loginUser  ·  refreshToken  ·  validateJWT           │
│    │  3 blocks updated  ·  0 blocks created  ·  2 blocks unchanged          │
│    │                                                                        │
│    │  [View PR #14 on GitHub ↗]      [See 3 updated blocks]                │
│    │                                                                        │
│  ──●──────────────────────────────────────────────────────────────────────  │
│    │  PR #13  ·  ✓ success  ·  February 13, 2026 at 09:15                   │
│    │  Triggered by commit 9f2b1e4                                           │
│    │  "models: add UserPreferences" — by John Doe                           │
│    │  1 block created                                                       │
│    │                                                                        │
│    │  [View PR #13 on GitHub ↗]      [See 1 created block]                 │
│    │                                                                        │
│  JANUARY 2026                                                               │
│                                                                             │
│  ──●──────────────────────────────────────────────────────────────────────  │
│    │  PR #12  ·  ✓ success  ·  January 28, 2026 at 11:00                    │
│    │  Initial documentation                                                 │
│    │  12 blocks created across 4 files                                      │
│    │  [View PR #12 on GitHub ↗]      [See 12 created blocks]               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 9. Coverage Dashboard (`/repos/:repoId/coverage`)

**Purpose:** Understand what's documented, what isn't, and what to do next.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Documentation Coverage  ·  owner/my-api                                    │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌────────────────┐  ┌─────────┐ │
│  │    Overall      │  │   Functions     │  │    Classes     │  │ Modules │ │
│  │                 │  │                 │  │                │  │         │ │
│  │      73%        │  │      68%        │  │      91%       │  │  100%   │ │
│  │  ██████████░░░  │  │  █████████░░░░  │  │  ████████████░ │  │ ███████ │ │
│  │  438 / 600      │  │  354 / 521      │  │   41 / 45      │  │ 34 / 34 │ │
│  └─────────────────┘  └─────────────────┘  └────────────────┘  └─────────┘ │
│                                                                             │
│  Undocumented Entry Points              ☐ Select all  [Document Selected]  │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  ☐  handlePayment()       src/billing.ts:12         12 callers  ▲ HIGH      │
│  ☐  processWebhook()      src/events.ts:45           8 callers  ▲ HIGH      │
│  ☐  syncInventory()       src/sync.ts:78             5 callers  ● MED       │
│  ☐  createSubscription()  src/subscriptions.ts:23    4 callers  ● MED       │
│  ☐  sendNotification()    src/notifications.ts:11    3 callers  ▼ LOW       │
│  ☐  retryFailedJobs()     src/queue.ts:56            2 callers  ▼ LOW       │
│                                                                             │
│  [Show all 162 undocumented...]                                             │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  Unresolved Imports  (these appear as gaps in the graph)                    │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  stripe         npm package   ·  used in 8 files   ·  External ✓           │
│  pg             npm package   ·  used in 3 files   ·  External ✓           │
│  @internal/...  internal pkg  ·  used in 2 files   ·  ⚠ Not found          │
│                                                                             │
│  [Export Coverage Report →]                                                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 10. Real-time Indexing Banner

**Appears:** On any repo page while the repo is being indexed.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ↻  Indexing owner/my-api...  [████████████░░░░░░░░░░] 64%                  │
│     Currently: src/services/payment.ts  ·  342 nodes  ·  891 edges          │
└──────────────────────────────────────────────────────────────────────────────┘
```

Position: Sticky below the top navigation bar, above page content.
Animation: Progress bar fills smoothly as `index:progress` events arrive.
Dismissal: Fades out automatically when `index:complete` fires.

**Toast on complete (bottom-right):**
```
┌──────────────────────────────────────────┐
│  ✓  Graph ready                          │
│     729 nodes · 1,847 edges              │
│     Documentation PR queued             │
│                                          │
│                              [Dismiss]   │
└──────────────────────────────────────────┘
```

---

## 11. Agent Activity Live Feed

**Appears:** In onboarding Step 6 and as a slide-over sheet during any active doc agent run.

```
Doc Agent: PR #15                              × Close

↻ Active  ·  Triggered by commit a3f8c2d

─────────────────────────────────────────────────────────

✓  graph.blast_radius(loginUser)                   142ms
   → 3 affected nodes found

✓  docs.get_block(block_auth_login)                89ms
   → api/auth.md ## POST /auth/login (stale)

✓  contracts.get([loginUser])                       234ms
   → signature + schema + constraints

↻  docs.update_block(...)                          [updating]
   Generating new documentation...

─────────────────────────────────────────────────────────

Blocks updated: 2 of 5 estimated
```

---

## 12. Settings Pages

### Settings: Repositories (`/settings/repos`)

```
Connected Repositories

[+ Connect Repository]

owner/my-api          TypeScript  ●  ready    729 nodes   [Reindex]  [Disconnect]
owner/frontend        React       ●  ready    491 nodes   [Reindex]  [Disconnect]
```

### Settings: Docs Repo (`/settings/docs-repo`)

```
Documentation Repository

All Graphfly PRs are opened to:
owner/docs-repo    [Change]

Last PR:  #14 opened February 13, 2026
```

### Settings: Team (`/settings/team`)

```
Team Members                                          [Invite Member]

Jane Smith    jane@co.com     ●  Owner     joined Jan 2026
John Doe      john@co.com     ●  Admin     joined Jan 2026
Alice Wong    alice@co.com    ●  Developer joined Feb 2026

Pending Invitations

bob@company.com    Developer    invited 2h ago    [Resend]  [Cancel]
```

---

## 13. Empty States

### No repos connected
```
◈ Graphfly

  Connect your first repository to get started.

  Graphfly analyzes your code, builds a relationship graph,
  and automatically generates and maintains documentation.

  [Connect a Repository →]
```

### Graph empty (indexing failed)
```
  Graph data unavailable.

  The last index attempt failed:
  "Could not parse src/config.ts: syntax error on line 42"

  [View error details]  [Retry indexing]
```

### No doc blocks yet
```
  No documentation yet.

  Documentation will appear here after your first
  docs PR is opened (usually within 3 minutes of
  completing the index).

  [View indexing status]
```

---

## Navigation
- [← Technical Spec](03_TECHNICAL_SPEC.md)
- [← Index](00_INDEX.md)
