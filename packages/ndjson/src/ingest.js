import { parseNdjsonText } from './parse.js';
import { parseNdjsonStream } from './stream.js';
import { validateEdgeOccurrenceRecord, validateEdgeRecord, validateNodeRecord } from '../../cig/src/validate.js';

function assertRecordShape(record) {
  if (!record || typeof record !== 'object') throw new Error('invalid ndjson record');
  if (typeof record.type !== 'string') throw new Error('ndjson record missing type');
  if (!('data' in record)) throw new Error('ndjson record missing data');
}

export async function ingestNdjson({ tenantId, repoId, ndjsonText, store }) {
  if (typeof store?.ingestRecords === 'function') {
    const records = [];
    for (const record of parseNdjsonText(ndjsonText)) {
      assertRecordShape(record);
      if (record.type === 'node') {
        const v = validateNodeRecord(record.data);
        if (!v.ok) throw new Error(`invalid_node:${v.reason}`);
        records.push(record);
        continue;
      }
      if (record.type === 'edge') {
        const v = validateEdgeRecord(record.data);
        if (!v.ok) throw new Error(`invalid_edge:${v.reason}`);
        records.push(record);
        continue;
      }
      if (record.type === 'edge_occurrence') {
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
        record.type === 'index_diagnostic'
      ) {
        records.push(record);
        continue;
      }
      // Unknown types are tolerated.
    }
    await store.ingestRecords({ tenantId, repoId, records });
    return;
  }

  for (const record of parseNdjsonText(ndjsonText)) {
    assertRecordShape(record);
    if (record.type === 'node') {
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
      continue;
    }
    if (record.type === 'declared_dependency') {
      await store.addDeclaredDependency({ tenantId, repoId, declared: record.data });
      continue;
    }
    if (record.type === 'observed_dependency') {
      await store.addObservedDependency({ tenantId, repoId, observed: record.data });
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
    if (record.type === 'flow_graph') {
      await store.upsertFlowGraph({ tenantId, repoId, flowGraph: record.data });
      continue;
    }
    // Unknown types are tolerated to allow forward-compatible indexer upgrades.
  }
}

export async function ingestNdjsonReadable({ tenantId, repoId, readable, store }) {
  if (typeof store?.ingestRecords === 'function') {
    const batchSize = 500;
    const batch = [];

    async function flush() {
      if (batch.length === 0) return;
      const toWrite = batch.splice(0, batch.length);
      await store.ingestRecords({ tenantId, repoId, records: toWrite });
    }

    for await (const record of parseNdjsonStream(readable)) {
      assertRecordShape(record);
      if (record.type === 'node') {
        const v = validateNodeRecord(record.data);
        if (!v.ok) throw new Error(`invalid_node:${v.reason}`);
        batch.push(record);
      } else if (record.type === 'edge') {
        const v = validateEdgeRecord(record.data);
        if (!v.ok) throw new Error(`invalid_edge:${v.reason}`);
        batch.push(record);
      } else if (record.type === 'edge_occurrence') {
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
        record.type === 'index_diagnostic'
      ) {
        batch.push(record);
      }

      if (batch.length >= batchSize) await flush();
    }

    await flush();
    return;
  }

  for await (const record of parseNdjsonStream(readable)) {
    assertRecordShape(record);
    if (record.type === 'node') {
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
      continue;
    }
    if (record.type === 'declared_dependency') {
      await store.addDeclaredDependency({ tenantId, repoId, declared: record.data });
      continue;
    }
    if (record.type === 'observed_dependency') {
      await store.addObservedDependency({ tenantId, repoId, observed: record.data });
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
    if (record.type === 'flow_graph') {
      await store.upsertFlowGraph({ tenantId, repoId, flowGraph: record.data });
      continue;
    }
  }
}
