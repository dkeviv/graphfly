import { InMemoryGraphStore } from '../../cig/src/store.js';
import { PgGraphStore } from '../../cig-pg/src/pg-store.js';
import { withTenantClient } from '../../pg-client/src/tenant.js';
import { getPgPoolFromEnv } from './pg-pool.js';

export class PgGraphStorePool {
  constructor({ pool, repoFullName = 'local/unknown' }) {
    this._pool = pool;
    this._repoFullName = repoFullName;
  }

  async ingestRecords({ tenantId, repoId, records }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgGraphStore({ client, repoFullName: this._repoFullName });
      return store.ingestRecords({ tenantId, repoId, records });
    });
  }

  async upsertNode({ tenantId, repoId, node }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgGraphStore({ client, repoFullName: this._repoFullName });
      return store.upsertNode({ tenantId, repoId, node });
    });
  }

  async upsertEdge({ tenantId, repoId, edge }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgGraphStore({ client, repoFullName: this._repoFullName });
      return store.upsertEdge({ tenantId, repoId, edge });
    });
  }

  async addEdgeOccurrence({ tenantId, repoId, occurrence }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgGraphStore({ client, repoFullName: this._repoFullName });
      return store.addEdgeOccurrence({ tenantId, repoId, occurrence });
    });
  }

  async upsertFlowEntrypoint({ tenantId, repoId, entrypoint }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgGraphStore({ client, repoFullName: this._repoFullName });
      return store.upsertFlowEntrypoint({ tenantId, repoId, entrypoint });
    });
  }

  async addDependencyManifest({ tenantId, repoId, manifest }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgGraphStore({ client, repoFullName: this._repoFullName });
      return store.addDependencyManifest({ tenantId, repoId, manifest });
    });
  }

  async addDeclaredDependency({ tenantId, repoId, declared }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgGraphStore({ client, repoFullName: this._repoFullName });
      return store.addDeclaredDependency({ tenantId, repoId, declared });
    });
  }

  async addObservedDependency({ tenantId, repoId, observed }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgGraphStore({ client, repoFullName: this._repoFullName });
      return store.addObservedDependency({ tenantId, repoId, observed });
    });
  }

  async addDependencyMismatch({ tenantId, repoId, mismatch }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgGraphStore({ client, repoFullName: this._repoFullName });
      return store.addDependencyMismatch({ tenantId, repoId, mismatch });
    });
  }

  async addIndexDiagnostic({ tenantId, repoId, diagnostic }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgGraphStore({ client, repoFullName: this._repoFullName });
      return store.addIndexDiagnostic({ tenantId, repoId, diagnostic });
    });
  }

  async listIndexDiagnostics({ tenantId, repoId, limit = 50 } = {}) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgGraphStore({ client, repoFullName: this._repoFullName });
      return store.listIndexDiagnostics({ tenantId, repoId, limit });
    });
  }

  async listDependencyMismatches({ tenantId, repoId }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgGraphStore({ client, repoFullName: this._repoFullName });
      return store.listDependencyMismatches({ tenantId, repoId });
    });
  }

  async listDependencyManifests({ tenantId, repoId }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgGraphStore({ client, repoFullName: this._repoFullName });
      return store.listDependencyManifests({ tenantId, repoId });
    });
  }

  async listDeclaredDependencies({ tenantId, repoId }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgGraphStore({ client, repoFullName: this._repoFullName });
      return store.listDeclaredDependencies({ tenantId, repoId });
    });
  }

  async listObservedDependencies({ tenantId, repoId }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgGraphStore({ client, repoFullName: this._repoFullName });
      return store.listObservedDependencies({ tenantId, repoId });
    });
  }

  async upsertFlowGraph({ tenantId, repoId, flowGraph }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgGraphStore({ client, repoFullName: this._repoFullName });
      return store.upsertFlowGraph({ tenantId, repoId, flowGraph });
    });
  }

  async getFlowGraph({ tenantId, repoId, flowGraphKey }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgGraphStore({ client, repoFullName: this._repoFullName });
      return store.getFlowGraph({ tenantId, repoId, flowGraphKey });
    });
  }

  async listFlowGraphs({ tenantId, repoId }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgGraphStore({ client, repoFullName: this._repoFullName });
      return store.listFlowGraphs({ tenantId, repoId });
    });
  }

  async listFlowEntrypoints({ tenantId, repoId }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgGraphStore({ client, repoFullName: this._repoFullName });
      return store.listFlowEntrypoints({ tenantId, repoId });
    });
  }

  async listNodes({ tenantId, repoId }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgGraphStore({ client, repoFullName: this._repoFullName });
      return store.listNodes({ tenantId, repoId });
    });
  }

  async getNodeBySymbolUid({ tenantId, repoId, symbolUid }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgGraphStore({ client, repoFullName: this._repoFullName });
      return store.getNodeBySymbolUid({ tenantId, repoId, symbolUid });
    });
  }

  async listEdges({ tenantId, repoId }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgGraphStore({ client, repoFullName: this._repoFullName });
      return store.listEdges({ tenantId, repoId });
    });
  }

  async listEdgesByNode({ tenantId, repoId, symbolUid, direction = 'both' }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgGraphStore({ client, repoFullName: this._repoFullName });
      return store.listEdgesByNode({ tenantId, repoId, symbolUid, direction });
    });
  }

  async listEdgeOccurrencesForEdge({ tenantId, repoId, sourceSymbolUid, edgeType, targetSymbolUid }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgGraphStore({ client, repoFullName: this._repoFullName });
      return store.listEdgeOccurrencesForEdge({ tenantId, repoId, sourceSymbolUid, edgeType, targetSymbolUid });
    });
  }

  async semanticSearch({ tenantId, repoId, query, limit = 10 }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgGraphStore({ client, repoFullName: this._repoFullName });
      return store.semanticSearch({ tenantId, repoId, query, limit });
    });
  }

  async upsertGraphAnnotation({ tenantId, repoId, annotation }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgGraphStore({ client, repoFullName: this._repoFullName });
      return store.upsertGraphAnnotation({ tenantId, repoId, annotation });
    });
  }

  async listGraphAnnotations({ tenantId, repoId, limit = 500 }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgGraphStore({ client, repoFullName: this._repoFullName });
      return store.listGraphAnnotations({ tenantId, repoId, limit });
    });
  }

  async listGraphAnnotationsBySymbolUid({ tenantId, repoId, symbolUid }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgGraphStore({ client, repoFullName: this._repoFullName });
      return store.listGraphAnnotationsBySymbolUid({ tenantId, repoId, symbolUid });
    });
  }
}

export async function createGraphStoreFromEnv({ repoFullName = 'local/unknown' } = {}) {
  const connectionString = process.env.DATABASE_URL ?? '';
  const mode = process.env.GRAPHFLY_GRAPH_STORE ?? (connectionString ? 'pg' : 'memory');
  if (!connectionString || mode !== 'pg') return new InMemoryGraphStore();

  const pool = await getPgPoolFromEnv({ connectionString, max: Number(process.env.PG_POOL_MAX ?? 10) });
  return new PgGraphStorePool({ pool, repoFullName });
}
