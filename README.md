# Graphfly

Graphfly is specified in `docs/` and implemented as a Node.js monorepo in `apps/`, `packages/`, and `workers/`.

## Specs (source of truth)

- `docs/02_REQUIREMENTS.md`
- `docs/03_TECHNICAL_SPEC.md`
- `docs/04_UX_SPEC.md`
- `docs/05_SECURITY.md`
- `docs/06_OPERATIONS.md`

## Local smoke run (mock indexer)

This repo includes a mock indexer to validate the **Code Intelligence Graph** ingestion pipeline without external dependencies.

1. Generate NDJSON from a fixture repo:
   - `npm run index:mock > /tmp/graph.ndjson`
2. Ingest NDJSON in-process (tests cover this end-to-end):
   - `npm test`

Note: the sandbox environment used by this assistant may block binding a local TCP port, so API server smoke runs may need to be executed on your machine outside the sandbox.

## OpenClaw agent integration (doc/contract agent)

Graphfly uses OpenClaw as the agent runtime via the OpenResponses-compatible endpoint (`/v1/responses`), with **client-side tools** for safe access to the Public Contract Graph.

- Tool loop implementation: `packages/openclaw-client/src/openresponses.js`
- Graphfly tools (PCG-safe): `packages/openclaw-client/src/graphfly-tools.js`
- Minimal runner:
  - Online (requires OpenClaw gateway): `OPENCLAW_GATEWAY_URL=... node workers/doc-agent/src/run-contract-doc-agent.js <symbolUid>`
  - Offline deterministic render: `OFFLINE_RENDER=1 GRAPHFLY_API_URL=... node workers/doc-agent/src/run-contract-doc-agent.js <symbolUid>`

## Tests

- `npm test`
