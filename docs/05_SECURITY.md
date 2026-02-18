# Graphfly — Security Specification

**Version**: 1.0  
**Last Updated**: February 2026  
**Status**: Draft

---

## Navigation
- [← Index](00_INDEX.md)
- [Next: Operations →](06_OPERATIONS.md)

---

## 1. Security Goals

- **Tenant isolation by construction**: cross-org data access must be impossible at the database layer (PostgreSQL RLS).
- **No write access to source code repositories**: Graphfly must not have the ability to modify customer source repos.
- **No source code body exposure by default**: Graphfly must not fetch/render source code bodies/snippets in the UI or embed them in doc blocks by default.
- **No code in doc blocks**: doc block content must be validated and must reject fenced code, indented code blocks, and code-like multi-line bodies.
- **Least-privilege GitHub access**: minimize GitHub scopes and enforce separation of duties.
- **No code execution**: Graphfly reads and analyzes source code; it must never execute customer code.
- **Auditable actions**: every indexing run and documentation PR should be attributable and reviewable.

---

## 2. Threat Model (High Level)

**Primary assets**
- Source code contents (cloned / read via GitHub)
- Derived artifacts: graph nodes/edges, embeddings, doc blocks, evidence links
- Authentication tokens (Clerk JWTs), GitHub installation tokens, GitHub app private keys

**Primary threats**
- Cross-tenant data access (broken isolation)
- Unauthorized writes to customer source code
- Secret leakage (tokens in URLs/logs/process args)
- Webhook spoofing/replay
- Supply chain compromise in dependencies or CI

---

## 3. GitHub Permission Model (Enforced No-Write to Source Repos)

Graphfly uses two separate GitHub Apps:

### 3.1 Graphfly Reader App (Source Repos)
- Installed on the customer’s **source code repositories**
- Permissions: `contents:read`, `metadata:read`
- Subscribes to `push` webhooks to trigger incremental indexing

**Guarantee:** The Reader App cannot write to any repository (no `contents:write`), so even a compromised worker cannot modify source repos.

### 3.2 Graphfly Docs App (Docs Repo Only)
- Installed on exactly one customer-selected **docs repository**
- Permissions: `contents:write`, `pull_requests:write`, `metadata:read`
- Used only for: creating branches, committing markdown updates, opening PRs

**Guarantee:** All writes are restricted to the docs repo by (1) app installation scope and (2) server-side enforcement that rejects any write target other than the configured docs repo.

---

## 4. Webhook Security

- **HMAC verification**: validate `X-Hub-Signature-256` using constant-time comparison with equal-length buffers.
- **Replay protection**: deduplicate on `X-GitHub-Delivery` using durable storage (`webhook_deliveries` table, unique constraint).
- **Branch restriction**: only process push events to the project’s tracked branch.
- **Strict allowlist**: ignore unexpected event types and missing installation context.

---

## 5. Tenant Isolation (PostgreSQL RLS)

### 5.1 RLS policy pattern
- All tenant-scoped tables include `tenant_id`.
- RLS is enabled for all tenant-scoped tables.
- Requests borrow a DB connection, execute `SET app.tenant_id = $1`, and `RESET app.tenant_id` before releasing back to the pool.
- Policies use `current_setting('app.tenant_id', true)::uuid` to avoid hard errors when misconfigured.

### 5.2 Hardening recommendations
- Use a dedicated DB role for the application with no ability to `ALTER TABLE ... DISABLE ROW LEVEL SECURITY`.
- Consider `ALTER TABLE <table> FORCE ROW LEVEL SECURITY` for tenant-scoped tables to ensure RLS is always applied.
- Add automated tests that attempt cross-tenant reads/writes and must fail.

---

## 6. Data Handling & Retention

- **Clones**: stored ephemerally for indexing; deleted after indexing completes.
- **Stored in PostgreSQL**:
  - Graph nodes/edges
  - Doc blocks and evidence references
  - PR run history
  - Embeddings (pgvector)
- **Public Contract Graph**: persist contracts (schemas, signatures, constraints) that are safe to display and sufficient for documentation and support workflows.
- **Source code bodies/snippets**: not persisted as product data and not rendered by default in the UI.
- **Retention**: align with plan (e.g., PR run history 1 year, logs 30 days), and document deletion behavior when disconnecting a repo/org.

---

## 7. Secrets Management

**Secrets**
- GitHub Reader App private key
- GitHub Docs App private key
- GitHub webhook secret
- Database credentials, Redis credentials

**Controls**
- Store secrets in a secrets manager (Doppler/AWS Secrets Manager) with rotation support.
- Never embed tokens in clone URLs or log them.
- Redact secrets in structured logs and job payloads.

---

## 8. LLM Data Egress (Doc Agent + Product Documentation Assistant)

- **Principle:** only send the minimum **contract-first** context required to complete the task.
- **No source code bodies by default:** agent tools must not return code bodies/snippets. Agents should operate on:
  - Public Contract Graph fields (signatures/schemas/constraints/allowables)
  - Flow entities + bounded flow traces (contract-first)
  - Docs repo Markdown reads (sanitized; code blocks stripped; size capped)
- **No secrets:** redact credentials/tokens/secrets from all tool outputs before they reach the gateway.
- **No raw logs:** log tool usage and outputs at a high level (counts, IDs, timings), not raw content, unless explicitly enabled for debugging and access-controlled.

Assistant writes (FR-AST-02) are staged as drafts:
- Drafts are persisted in `assistant_drafts` and must be validated to reject code fences and code-like bodies.
- Chat history is persisted in `assistant_threads` / `assistant_messages` but is sanitized to strip fenced and indented code blocks by default.
- Applying a draft requires explicit user confirmation and writes only to the configured docs repo.

---

## 9. Support-Safe Mode

Graphfly must support a “support-safe” operating mode where:
- Support tooling and support agents can access Public Contract Graph + Flow Graphs + dependency intelligence.
- Support tooling and support agents cannot fetch or view source code bodies/snippets.
- Any optional “Open in GitHub” links are permissioned and explicitly user-initiated.

---

## 10. Auditability

- Persist PR runs (`pr_runs`) with trigger SHA, status, counts, error messages, and links to the resulting docs PR.
- Emit and retain agent tool-call metadata sufficient for debugging (tool name, duration, success/failure), without storing sensitive content by default.
