# Migrations

Schema source of truth: `docs/03_TECHNICAL_SPEC.md`.

This folder contains SQL migrations intended for PostgreSQL.

## Notes

- RLS is enabled for tenant-scoped tables and expects the app to set `app.tenant_id` per request/connection.
- `pgvector` is required for embeddings (HNSW index).

