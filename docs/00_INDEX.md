# Graphfly — Specification Index

**Product**: Graphfly
**Version**: 1.0
**Date**: February 2026
**Status**: Draft

> **Graphfly** turns your GitHub codebase into a continuously maintained, evidence-backed documentation system. Connect a repo → auto-generate living docs → auto-PR updated `.md` files whenever code changes.

---

## Documents

| # | Document | Description |
|---|----------|-------------|
| 01 | [Architecture](01_ARCHITECTURE.md) | System architecture, service map, tech stack decisions |
| 02 | [Requirements](02_REQUIREMENTS.md) | Functional + non-functional requirements, user stories |
| 03 | [Technical Specification](03_TECHNICAL_SPEC.md) | DB schema, API, agent design, indexer protocol |
| 04 | [UX Specification](04_UX_SPEC.md) | All user flows, screen layouts, design system |
| 05 | [Security](05_SECURITY.md) | Threat model, GitHub permission model, data handling, controls |
| 06 | [Operations](06_OPERATIONS.md) | SLOs, monitoring, runbooks, scaling, backup/restore |

---

## Product Summary

### The Problem
Documentation goes stale the moment code changes. Engineers spend hours manually keeping docs in sync, or they don't — and docs become lies. There's no automated system that knows *which docs* need updating *because of which code change*.

### The Solution
Graphfly builds a **Code Intelligence Graph** — a rich, multi-layer map of your system (symbols, dependencies, schemas, flows, and contracts) — and uses it to keep documentation continuously correct. Every doc block is linked to **evidence metadata** (symbol IDs, locations, and contract snapshots) without exposing source code bodies. When code changes, Graphfly identifies exactly which doc blocks are impacted and opens a PR with surgical updates.

### The Wedge: Living Documentation
- **Connect** GitHub source repos (Reader App install, no code changes needed)
- **Auto-generate** structured `.md` documentation, organized by flows and API endpoints
- **Auto-PR** into a dedicated docs repo whenever relevant code changes
- **Evidence panel**: every doc block shows contract + location evidence (symbol ID, file:line, schema/constraints) without rendering code bodies by default
- **Coverage dashboard**: know what's documented, what isn't, prioritized by blast radius

### What Makes It Different
- **Graph-first**: not keyword search, not file diffs — actual code relationships
- **Surgical updates**: only updates the docs that need updating, not a full re-generation
- **Evidence-backed**: every doc block is grounded in contract + location evidence — docs you can trust
- **Developer workflow**: docs live in git, reviewed like code, merged with PRs

---

## Source Codebase Assets

| Asset | From | Status |
|-------|------|--------|
| 12 tree-sitter parsers (Python/JS/TS/Rust/Go/Java/C/C++/Ruby/PHP/Swift/Kotlin) | Yantra | Reuse as-is |
| Graph engine (petgraph DiGraph, 32 edge types) | Yantra | Extract to CLI |
| SymbolResolver (cross-file import resolution) | Yantra | Reuse as-is |
| IncrementalTracker (dirty file tracking) | Yantra | Reuse as-is |
| HNSW + fastembed embeddings (384-dim) | Yantra | Keep in Rust CLI; replace index with pgvector |
| Agent TurnOutcome loop | Yantra (`loop_core.rs`) | Port to TypeScript |
| Tool factory pattern (TypeBox schemas) | OpenClaw | Reuse pattern |
| Command queue | OpenClaw | Replace with BullMQ |
| Graph UI components (Cytoscape.js) | Yantra React | Adapt to REST API |
