# Graphfly — Operations Specification

**Version**: 1.0  
**Last Updated**: February 2026  
**Status**: Draft

---

## Navigation
- [← Security](05_SECURITY.md)
- [← Index](00_INDEX.md)

---

## 1. Service Level Objectives (SLOs)

**Availability**
- API + UI: **99.5%** monthly availability target (V1)

**Latency (p99 targets)**
- Graph node lookup: **<10ms**
- Blast radius (2-hop): **<100ms**
- Semantic search (top-10): **<50ms**

**Freshness**
- Incremental index for small change sets (e.g., ≤50 files): **<60s** end-to-end
- Docs PR after index completes (e.g., ≤10 blocks): **<3 minutes** end-to-end

---

## 2. Observability (Metrics, Logs, Traces)

### 2.1 Core metrics
- **Webhooks**: events received, signature failures, dedup hits, processing time
- **Queues (BullMQ)**: depth by queue, job wait time, retries, DLQ count
- **Indexer**: files/sec, nodes/sec, edges/sec, parse errors, peak memory, duration
- **Database**: query latency, connection pool saturation, RLS errors, lock waits
- **Doc agent**: blocks updated/created, tool-call durations, LLM latency/cost, failure rate

### 2.2 Logging
- Structured logs with correlation IDs:
  - `github_delivery_id`
  - `tenant_id`, `repo_id`
  - `index_job_id`, `doc_job_id`, `pr_run_id`
- Redaction: never log GitHub tokens, private keys, webhook secret, or clone credentials.

---

## 3. Alerting (Suggested)

- Webhook signature failures spike (possible attack or secret mismatch)
- Queue depth above threshold for sustained window (capacity issue)
- Indexer job failure rate above threshold (parser regression or repo pattern)
- Doc agent failure rate above threshold (tool errors, provider outage)
- Postgres connection pool saturation (leaks or slow queries)
- RLS errors / missing tenant setting (critical isolation risk)

---

## 4. Runbooks (Day-2)

### 4.1 Webhooks failing (signature errors)
1. Confirm `X-Hub-Signature-256` present and verification code path is correct.
2. Validate webhook secret rotation status and environment configuration.
3. Check for GitHub delivery retries and dedup behavior on `X-GitHub-Delivery`.

### 4.2 Index queue backlog growing
1. Check worker health and concurrency settings.
2. Inspect slow jobs (large repos, pathological files, parser errors).
3. Scale horizontally: add indexer-worker instances or reduce per-job batch size.

### 4.3 Indexer job repeatedly failing
1. Inspect stderr + last processed file from progress records.
2. Classify:
   - parse errors (tree-sitter grammar issue)
   - clone/auth errors (GitHub token/install scope)
   - DB upsert errors (schema/constraints)
3. If caused by a specific file type, temporarily exclude via config while patching parser.

### 4.4 Doc agent opens no PR / fails
1. Confirm docs repo configured and Docs App installed.
2. Verify rate limits/plan enforcement didn’t skip the run.
3. Inspect tool-call sequence (graph queries, read_snippet, update_block, create_pr).
4. If PR creation failed, confirm the docs app installation scope includes the docs repo.

### 4.5 Postgres performance degradation
1. Check slow query log / top queries (blast radius, semantic search).
2. Validate indexes exist and are used.
3. For pgvector HNSW:
   - validate HNSW index exists on embeddings
   - tune query-time parameters (e.g., `hnsw.ef_search`) for recall/latency
   - schedule periodic `REINDEX` if index bloat is observed (rare; validate first)

---

## 5. Backup / Restore & Disaster Recovery

- **PostgreSQL**: daily automated backups (plus PITR if available)
- **Redis**: persistence enabled (AOF) and managed backups if offered by provider
- **RPO/RTO targets (V1)**:
  - RPO: 24h (improve for enterprise)
  - RTO: 4h (improve for enterprise)

Restore drills should be run periodically and documented (steps, expected timings, validation checks).

---

## 6. Scaling Strategy

- API is stateless: scale horizontally behind a load balancer.
- Workers are stateless: scale `indexer-worker` and `doc-agent-worker` independently.
- Use queue priority to protect interactive/user-triggered actions during high webhook volume.

---

## 7. Maintenance

- Schema migrations: run forward-only migrations with rollback plans for critical tables.
- Secret rotation: rotate GitHub app keys and webhook secrets with documented procedure.
- Dependency upgrades: cadence (weekly/biweekly) with smoke tests on representative repos.

---

## 8. Local Development (No-Network Mode)

This repository includes a local/test mode that avoids external dependencies and network calls while still exercising the end-to-end pipeline.

**Key environment variables**
- `SOURCE_REPO_ROOT`: local filesystem path to the **source repo** to index (read-only). Default: `fixtures/sample-repo`.
- `DOCS_REPO_FULL_NAME`: configured docs repo identifier (string). Default: `org/docs`.
- `DOCS_REPO_PATH`: local filesystem path to a **separate docs git repository**. When set, docs updates are written by creating a new branch + commit (simulating a PR) and never touch the source repo.
- `GITHUB_WEBHOOK_SECRET`: secret used to verify GitHub `push` webhooks (HMAC-SHA256).
- `STRIPE_WEBHOOK_SECRET`: secret used to verify Stripe webhook signatures.

**Operational guardrails (must hold in all environments)**
- Documentation writes are denied unless the target repo matches the configured docs repo.
- Doc generation must not include source code bodies/snippets (contract-first blocks only).
