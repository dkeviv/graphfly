import { parseNdjsonText } from './parse.js';
import { parseNdjsonStream } from './stream.js';
import { validateEdgeOccurrenceRecord, validateEdgeRecord, validateNodeRecord } from '../../cig/src/validate.js';
import { sanitizeEdgeForPersistence, sanitizeNodeForPersistence } from '../../cig/src/no-code.js';
import { createEmbeddingProviderFromEnv } from '../../cig/src/embeddings-provider.js';

function assertRecordShape(record) {
  if (!record || typeof record !== 'object') throw new Error('invalid ndjson record');
  if (typeof record.type !== 'string') throw new Error('ndjson record missing type');
  if (!('data' in record)) throw new Error('ndjson record missing data');
}

function pLimit(limit) {
  let active = 0;
  const queue = [];
  function next() {
    if (active >= limit) return;
    const item = queue.shift();
    if (!item) return;
    active++;
    Promise.resolve()
      .then(item.fn)
      .then((v) => item.resolve(v), (e) => item.reject(e))
      .finally(() => {
        active--;
        next();
      });
  }
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
}

async function ensureEmbedding(node, embed) {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node.embedding) && node.embedding.length === 384) return node;
  const text = node.embedding_text ?? node.embeddingText ?? null;
  if (typeof text !== 'string' || text.trim().length === 0) return node;
  const vec = await embed(text);
  node.embedding = vec;
  return node;
}

export async function ingestNdjson({ tenantId, repoId, ndjsonText, store, onRecord = null } = {}) {
  const embed = createEmbeddingProviderFromEnv({ env: process.env });
  const limit = pLimit(Number(process.env.GRAPHFLY_EMBEDDINGS_CONCURRENCY ?? 4));
  let sawDepSignals = false;

  if (typeof store?.ingestRecords === 'function') {
    const records = [];
    const embedTasks = [];
    for (const record of parseNdjsonText(ndjsonText)) {
      assertRecordShape(record);
      if (typeof onRecord === 'function') onRecord(record);
      if (record.type === 'node') {
        record.data = sanitizeNodeForPersistence(record.data);
        embedTasks.push(limit(() => ensureEmbedding(record.data, embed)));
        const v = validateNodeRecord(record.data);
        if (!v.ok) throw new Error(`invalid_node:${v.reason}`);
        records.push(record);
        continue;
      }
      if (record.type === 'edge') {
        record.data = sanitizeEdgeForPersistence(record.data);
        const v = validateEdgeRecord(record.data);
        if (!v.ok) throw new Error(`invalid_edge:${v.reason}`);
        records.push(record);
        continue;
      }
      if (record.type === 'edge_occurrence') {
        record.data = sanitizeEdgeForPersistence(record.data);
        const v = validateEdgeOccurrenceRecord(record.data);
        if (!v.ok) throw new Error(`invalid_edge_occurrence:${v.reason}`);
        records.push(record);
        continue;
      }
      if (
        record.type === 'flow_entrypoint' ||
        record.type === 'flow_graph' ||
        record.type === 'dependency_manifest' ||
        record.type === 'declared_dependency' ||
        record.type === 'observed_dependency' ||
        record.type === 'dependency_mismatch' ||
        record.type === 'index_diagnostic' ||
        record.type === 'unresolved_import'
      ) {
        if (record.type === 'dependency_manifest' || record.type === 'declared_dependency' || record.type === 'observed_dependency') {
          sawDepSignals = true;
        }
        records.push(record);
        continue;
      }
      // Unknown types are tolerated.
    }
    if (embedTasks.length) await Promise.all(embedTasks);
    await store.ingestRecords({ tenantId, repoId, records });
    if (sawDepSignals) await maybeRecomputeDependencyMismatches({ store, tenantId, repoId });
    return;
  }

  for (const record of parseNdjsonText(ndjsonText)) {
    assertRecordShape(record);
    if (typeof onRecord === 'function') onRecord(record);
    if (record.type === 'node') {
      record.data = sanitizeNodeForPersistence(record.data);
      await ensureEmbedding(record.data, embed);
      const v = validateNodeRecord(record.data);
      if (!v.ok) throw new Error(`invalid_node:${v.reason}`);
      await store.upsertNode({ tenantId, repoId, node: record.data });
      continue;
    }
    if (record.type === 'edge') {
      record.data = sanitizeEdgeForPersistence(record.data);
      const v = validateEdgeRecord(record.data);
      if (!v.ok) throw new Error(`invalid_edge:${v.reason}`);
      await store.upsertEdge({ tenantId, repoId, edge: record.data });
      continue;
    }
    if (record.type === 'edge_occurrence') {
      record.data = sanitizeEdgeForPersistence(record.data);
      const v = validateEdgeOccurrenceRecord(record.data);
      if (!v.ok) throw new Error(`invalid_edge_occurrence:${v.reason}`);
      await store.addEdgeOccurrence({ tenantId, repoId, occurrence: record.data });
      continue;
    }
    if (record.type === 'flow_entrypoint') {
      await store.upsertFlowEntrypoint({ tenantId, repoId, entrypoint: record.data });
      continue;
    }
    if (record.type === 'dependency_manifest') {
      await store.addDependencyManifest({ tenantId, repoId, manifest: record.data });
      sawDepSignals = true;
      continue;
    }
    if (record.type === 'declared_dependency') {
      await store.addDeclaredDependency({ tenantId, repoId, declared: record.data });
      sawDepSignals = true;
      continue;
    }
    if (record.type === 'observed_dependency') {
      await store.addObservedDependency({ tenantId, repoId, observed: record.data });
      sawDepSignals = true;
      continue;
    }
    if (record.type === 'dependency_mismatch') {
      await store.addDependencyMismatch({ tenantId, repoId, mismatch: record.data });
      continue;
    }
    if (record.type === 'index_diagnostic') {
      await store.addIndexDiagnostic({ tenantId, repoId, diagnostic: record.data });
      continue;
    }
    if (record.type === 'unresolved_import') {
      await store.addUnresolvedImport?.({ tenantId, repoId, unresolvedImport: record.data });
      continue;
    }
    if (record.type === 'flow_graph') {
      await store.upsertFlowGraph({ tenantId, repoId, flowGraph: record.data });
      continue;
    }
    // Unknown types are tolerated to allow forward-compatible indexer upgrades.
  }

  if (sawDepSignals) await maybeRecomputeDependencyMismatches({ store, tenantId, repoId });
}

export async function ingestNdjsonReadable({ tenantId, repoId, readable, store, onRecord = null } = {}) {
  const embed = createEmbeddingProviderFromEnv({ env: process.env });
  const limit = pLimit(Number(process.env.GRAPHFLY_EMBEDDINGS_CONCURRENCY ?? 4));
  let sawDepSignals = false;

  if (typeof store?.ingestRecords === 'function') {
    const batchSize = 500;
    const batch = [];
    const embedTasks = [];

    async function flush() {
      if (batch.length === 0) return;
      if (embedTasks.length) await Promise.all(embedTasks.splice(0, embedTasks.length));
      const toWrite = batch.splice(0, batch.length);
      await store.ingestRecords({ tenantId, repoId, records: toWrite });
    }

    for await (const record of parseNdjsonStream(readable)) {
      assertRecordShape(record);
      if (typeof onRecord === 'function') onRecord(record);
      if (record.type === 'node') {
        record.data = sanitizeNodeForPersistence(record.data);
        embedTasks.push(limit(() => ensureEmbedding(record.data, embed)));
        const v = validateNodeRecord(record.data);
        if (!v.ok) throw new Error(`invalid_node:${v.reason}`);
        batch.push(record);
      } else if (record.type === 'edge') {
        record.data = sanitizeEdgeForPersistence(record.data);
        const v = validateEdgeRecord(record.data);
        if (!v.ok) throw new Error(`invalid_edge:${v.reason}`);
        batch.push(record);
      } else if (record.type === 'edge_occurrence') {
        record.data = sanitizeEdgeForPersistence(record.data);
        const v = validateEdgeOccurrenceRecord(record.data);
        if (!v.ok) throw new Error(`invalid_edge_occurrence:${v.reason}`);
        batch.push(record);
      } else if (
        record.type === 'flow_entrypoint' ||
        record.type === 'flow_graph' ||
        record.type === 'dependency_manifest' ||
        record.type === 'declared_dependency' ||
        record.type === 'observed_dependency' ||
        record.type === 'dependency_mismatch' ||
        record.type === 'index_diagnostic' ||
        record.type === 'unresolved_import'
      ) {
        if (record.type === 'dependency_manifest' || record.type === 'declared_dependency' || record.type === 'observed_dependency') {
          sawDepSignals = true;
        }
        batch.push(record);
      }

      if (batch.length >= batchSize) await flush();
    }

    await flush();
    if (sawDepSignals) await maybeRecomputeDependencyMismatches({ store, tenantId, repoId });
    return;
  }

  for await (const record of parseNdjsonStream(readable)) {
    assertRecordShape(record);
    if (typeof onRecord === 'function') onRecord(record);
    if (record.type === 'node') {
      record.data = sanitizeNodeForPersistence(record.data);
      await ensureEmbedding(record.data, embed);
      const v = validateNodeRecord(record.data);
      if (!v.ok) throw new Error(`invalid_node:${v.reason}`);
      await store.upsertNode({ tenantId, repoId, node: record.data });
      continue;
    }
    if (record.type === 'edge') {
      const v = validateEdgeRecord(record.data);
      if (!v.ok) throw new Error(`invalid_edge:${v.reason}`);
      await store.upsertEdge({ tenantId, repoId, edge: record.data });
      continue;
    }
    if (record.type === 'edge_occurrence') {
      const v = validateEdgeOccurrenceRecord(record.data);
      if (!v.ok) throw new Error(`invalid_edge_occurrence:${v.reason}`);
      await store.addEdgeOccurrence({ tenantId, repoId, occurrence: record.data });
      continue;
    }
    if (record.type === 'flow_entrypoint') {
      await store.upsertFlowEntrypoint({ tenantId, repoId, entrypoint: record.data });
      continue;
    }
    if (record.type === 'dependency_manifest') {
      await store.addDependencyManifest({ tenantId, repoId, manifest: record.data });
      sawDepSignals = true;
      continue;
    }
    if (record.type === 'declared_dependency') {
      await store.addDeclaredDependency({ tenantId, repoId, declared: record.data });
      sawDepSignals = true;
      continue;
    }
    if (record.type === 'observed_dependency') {
      await store.addObservedDependency({ tenantId, repoId, observed: record.data });
      sawDepSignals = true;
      continue;
    }
    if (record.type === 'dependency_mismatch') {
      await store.addDependencyMismatch({ tenantId, repoId, mismatch: record.data });
      continue;
    }
    if (record.type === 'index_diagnostic') {
      await store.addIndexDiagnostic({ tenantId, repoId, diagnostic: record.data });
      continue;
    }
    if (record.type === 'unresolved_import') {
      await store.addUnresolvedImport?.({ tenantId, repoId, unresolvedImport: record.data });
      continue;
    }
    if (record.type === 'flow_graph') {
      await store.upsertFlowGraph({ tenantId, repoId, flowGraph: record.data });
      continue;
    }
  }

  if (sawDepSignals) await maybeRecomputeDependencyMismatches({ store, tenantId, repoId });
}

async function maybeRecomputeDependencyMismatches({ store, tenantId, repoId } = {}) {
  if (!store) return;
  if (typeof store.listDeclaredDependencies !== 'function' || typeof store.listObservedDependencies !== 'function') return;
  const { computeDependencyMismatches } = await import('../../cig/src/dependency-mismatches.js');
  const declared = await Promise.resolve(store.listDeclaredDependencies({ tenantId, repoId }));
  const observed = await Promise.resolve(store.listObservedDependencies({ tenantId, repoId }));
  const mismatches = computeDependencyMismatches({ declared, observed, sha: 'derived' });
  if (typeof store.replaceDependencyMismatches === 'function') {
    await Promise.resolve(store.replaceDependencyMismatches({ tenantId, repoId, sha: 'derived', mismatches }));
    return;
  }
  for (const mm of mismatches) await Promise.resolve(store.addDependencyMismatch?.({ tenantId, repoId, mismatch: mm }));
}
