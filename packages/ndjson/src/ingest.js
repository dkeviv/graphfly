import { parseNdjsonText } from './parse.js';
import { parseNdjsonStream } from './stream.js';
import { validateEdgeOccurrenceRecord, validateEdgeRecord, validateNodeRecord } from '../../cig/src/validate.js';

function assertRecordShape(record) {
  if (!record || typeof record !== 'object') throw new Error('invalid ndjson record');
  if (typeof record.type !== 'string') throw new Error('ndjson record missing type');
  if (!('data' in record)) throw new Error('ndjson record missing data');
}

export async function ingestNdjson({ tenantId, repoId, ndjsonText, store }) {
  for (const record of parseNdjsonText(ndjsonText)) {
    assertRecordShape(record);
    if (record.type === 'node') {
      const v = validateNodeRecord(record.data);
      if (!v.ok) throw new Error(`invalid_node:${v.reason}`);
      store.upsertNode({ tenantId, repoId, node: record.data });
      continue;
    }
    if (record.type === 'edge') {
      const v = validateEdgeRecord(record.data);
      if (!v.ok) throw new Error(`invalid_edge:${v.reason}`);
      store.upsertEdge({ tenantId, repoId, edge: record.data });
      continue;
    }
    if (record.type === 'edge_occurrence') {
      const v = validateEdgeOccurrenceRecord(record.data);
      if (!v.ok) throw new Error(`invalid_edge_occurrence:${v.reason}`);
      store.addEdgeOccurrence({ tenantId, repoId, occurrence: record.data });
      continue;
    }
    if (record.type === 'flow_entrypoint') {
      store.upsertFlowEntrypoint({ tenantId, repoId, entrypoint: record.data });
      continue;
    }
    if (record.type === 'dependency_manifest') {
      store.addDependencyManifest({ tenantId, repoId, manifest: record.data });
      continue;
    }
    if (record.type === 'declared_dependency') {
      store.addDeclaredDependency({ tenantId, repoId, declared: record.data });
      continue;
    }
    if (record.type === 'observed_dependency') {
      store.addObservedDependency({ tenantId, repoId, observed: record.data });
      continue;
    }
    if (record.type === 'dependency_mismatch') {
      store.addDependencyMismatch({ tenantId, repoId, mismatch: record.data });
      continue;
    }
    if (record.type === 'index_diagnostic') {
      store.addIndexDiagnostic({ tenantId, repoId, diagnostic: record.data });
      continue;
    }
    if (record.type === 'flow_graph') {
      store.upsertFlowGraph({ tenantId, repoId, flowGraph: record.data });
      continue;
    }
    // Unknown types are tolerated to allow forward-compatible indexer upgrades.
  }
}

export async function ingestNdjsonReadable({ tenantId, repoId, readable, store }) {
  for await (const record of parseNdjsonStream(readable)) {
    assertRecordShape(record);
    if (record.type === 'node') {
      const v = validateNodeRecord(record.data);
      if (!v.ok) throw new Error(`invalid_node:${v.reason}`);
      store.upsertNode({ tenantId, repoId, node: record.data });
      continue;
    }
    if (record.type === 'edge') {
      const v = validateEdgeRecord(record.data);
      if (!v.ok) throw new Error(`invalid_edge:${v.reason}`);
      store.upsertEdge({ tenantId, repoId, edge: record.data });
      continue;
    }
    if (record.type === 'edge_occurrence') {
      const v = validateEdgeOccurrenceRecord(record.data);
      if (!v.ok) throw new Error(`invalid_edge_occurrence:${v.reason}`);
      store.addEdgeOccurrence({ tenantId, repoId, occurrence: record.data });
      continue;
    }
    if (record.type === 'flow_entrypoint') {
      store.upsertFlowEntrypoint({ tenantId, repoId, entrypoint: record.data });
      continue;
    }
    if (record.type === 'dependency_manifest') {
      store.addDependencyManifest({ tenantId, repoId, manifest: record.data });
      continue;
    }
    if (record.type === 'declared_dependency') {
      store.addDeclaredDependency({ tenantId, repoId, declared: record.data });
      continue;
    }
    if (record.type === 'observed_dependency') {
      store.addObservedDependency({ tenantId, repoId, observed: record.data });
      continue;
    }
    if (record.type === 'dependency_mismatch') {
      store.addDependencyMismatch({ tenantId, repoId, mismatch: record.data });
      continue;
    }
    if (record.type === 'index_diagnostic') {
      store.addIndexDiagnostic({ tenantId, repoId, diagnostic: record.data });
      continue;
    }
    if (record.type === 'flow_graph') {
      store.upsertFlowGraph({ tenantId, repoId, flowGraph: record.data });
      continue;
    }
  }
}
