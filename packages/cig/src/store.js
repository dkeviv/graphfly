import { assert, isPlainObject } from './types.js';
import { sanitizeAnnotationForPersistence } from './no-code.js';

function key({ tenantId, repoId }) {
  return `${tenantId}::${repoId}`;
}

export class InMemoryGraphStore {
  constructor() {
    this._nodesByRepo = new Map(); // repoKey -> Map(symbol_uid -> node)
    this._edgesByRepo = new Map(); // repoKey -> Map(edgeKey -> edge)
    this._occByRepo = new Map(); // repoKey -> Map(occKey -> occurrence)
    this._flowEntrypointsByRepo = new Map(); // repoKey -> Map(entrypoint_key -> entrypoint)
    this._depManifestsByRepo = new Map(); // repoKey -> Map(manifest_key -> manifest)
    this._declaredDepsByRepo = new Map(); // repoKey -> Map(dep_key -> declared dep)
    this._observedDepsByRepo = new Map(); // repoKey -> Map(dep_key -> observed dep)
    this._depMismatchesByRepo = new Map(); // repoKey -> Map(mismatch_key -> mismatch)
    this._indexDiagnosticsByRepo = new Map(); // repoKey -> Array(diagnostic)
    this._flowGraphsByRepo = new Map(); // repoKey -> Map(flow_graph_key -> flow graph)
    this._annotationsByRepo = new Map(); // repoKey -> Map(annotationKey -> annotation)
    this._unresolvedImportsByRepo = new Map(); // repoKey -> Map(key -> unresolved_import)
  }

  upsertNode({ tenantId, repoId, node }) {
    assert(isPlainObject(node), 'node must be an object');
    assert(typeof node.symbol_uid === 'string' && node.symbol_uid.length > 0, 'node.symbol_uid required');
    const repoKey = key({ tenantId, repoId });
    if (!this._nodesByRepo.has(repoKey)) this._nodesByRepo.set(repoKey, new Map());
    this._nodesByRepo.get(repoKey).set(node.symbol_uid, node);
  }

  upsertEdge({ tenantId, repoId, edge }) {
    assert(isPlainObject(edge), 'edge must be an object');
    const { source_symbol_uid, target_symbol_uid, edge_type } = edge;
    assert(typeof source_symbol_uid === 'string' && source_symbol_uid.length > 0, 'edge.source_symbol_uid required');
    assert(typeof target_symbol_uid === 'string' && target_symbol_uid.length > 0, 'edge.target_symbol_uid required');
    assert(typeof edge_type === 'string' && edge_type.length > 0, 'edge.edge_type required');
    const repoKey = key({ tenantId, repoId });
    if (!this._edgesByRepo.has(repoKey)) this._edgesByRepo.set(repoKey, new Map());
    const edgeKey = `${source_symbol_uid}::${edge_type}::${target_symbol_uid}`;
    const existing = this._edgesByRepo.get(repoKey).get(edgeKey);
    this._edgesByRepo.get(repoKey).set(edgeKey, existing ? { ...existing, ...edge } : edge);
  }

  addEdgeOccurrence({ tenantId, repoId, occurrence }) {
    assert(isPlainObject(occurrence), 'occurrence must be an object');
    const { source_symbol_uid, target_symbol_uid, edge_type, file_path, line_start, line_end } = occurrence;
    assert(typeof file_path === 'string' && file_path.length > 0, 'occurrence.file_path required');
    assert(Number.isInteger(line_start) && line_start > 0, 'occurrence.line_start required');
    assert(Number.isInteger(line_end) && line_end >= line_start, 'occurrence.line_end required');
    assert(typeof source_symbol_uid === 'string' && source_symbol_uid.length > 0, 'occurrence.source_symbol_uid required');
    assert(typeof target_symbol_uid === 'string' && target_symbol_uid.length > 0, 'occurrence.target_symbol_uid required');
    assert(typeof edge_type === 'string' && edge_type.length > 0, 'occurrence.edge_type required');
    const repoKey = key({ tenantId, repoId });
    if (!this._occByRepo.has(repoKey)) this._occByRepo.set(repoKey, new Map());
    const occKey = `${source_symbol_uid}::${edge_type}::${target_symbol_uid}::${file_path}::${line_start}::${line_end}`;
    this._occByRepo.get(repoKey).set(occKey, occurrence);
  }

  getNodeBySymbolUid({ tenantId, repoId, symbolUid }) {
    const repoKey = key({ tenantId, repoId });
    return this._nodesByRepo.get(repoKey)?.get(symbolUid) ?? null;
  }

  listNodes({ tenantId, repoId }) {
    const repoKey = key({ tenantId, repoId });
    return Array.from(this._nodesByRepo.get(repoKey)?.values() ?? []);
  }

  listEdges({ tenantId, repoId }) {
    const repoKey = key({ tenantId, repoId });
    return Array.from(this._edgesByRepo.get(repoKey)?.values() ?? []);
  }

  listEdgesByNode({ tenantId, repoId, symbolUid, direction = 'both' }) {
    const edges = this.listEdges({ tenantId, repoId });
    if (direction === 'out') return edges.filter((e) => e.source_symbol_uid === symbolUid);
    if (direction === 'in') return edges.filter((e) => e.target_symbol_uid === symbolUid);
    return edges.filter((e) => e.source_symbol_uid === symbolUid || e.target_symbol_uid === symbolUid);
  }

  listEdgeOccurrences({ tenantId, repoId }) {
    const repoKey = key({ tenantId, repoId });
    return Array.from(this._occByRepo.get(repoKey)?.values() ?? []);
  }

  listEdgeOccurrencesForEdge({ tenantId, repoId, sourceSymbolUid, edgeType, targetSymbolUid }) {
    return this.listEdgeOccurrences({ tenantId, repoId }).filter(
      (o) =>
        o.source_symbol_uid === sourceSymbolUid &&
        o.edge_type === edgeType &&
        o.target_symbol_uid === targetSymbolUid
    );
  }

  upsertFlowEntrypoint({ tenantId, repoId, entrypoint }) {
    assert(isPlainObject(entrypoint), 'entrypoint must be an object');
    assert(typeof entrypoint.entrypoint_key === 'string' && entrypoint.entrypoint_key.length > 0, 'entrypoint.entrypoint_key required');
    const repoKey = key({ tenantId, repoId });
    if (!this._flowEntrypointsByRepo.has(repoKey)) this._flowEntrypointsByRepo.set(repoKey, new Map());
    this._flowEntrypointsByRepo.get(repoKey).set(entrypoint.entrypoint_key, entrypoint);
  }

  listFlowEntrypoints({ tenantId, repoId }) {
    const repoKey = key({ tenantId, repoId });
    return Array.from(this._flowEntrypointsByRepo.get(repoKey)?.values() ?? []);
  }

  addDependencyManifest({ tenantId, repoId, manifest }) {
    assert(isPlainObject(manifest), 'manifest must be an object');
    assert(typeof manifest.file_path === 'string' && manifest.file_path.length > 0, 'manifest.file_path required');
    assert(typeof manifest.sha === 'string' && manifest.sha.length > 0, 'manifest.sha required');
    const repoKey = key({ tenantId, repoId });
    if (!this._depManifestsByRepo.has(repoKey)) this._depManifestsByRepo.set(repoKey, new Map());
    const manifestKey = `${manifest.file_path}::${manifest.sha}`;
    this._depManifestsByRepo.get(repoKey).set(manifestKey, manifest);
  }

  listDependencyManifests({ tenantId, repoId }) {
    const repoKey = key({ tenantId, repoId });
    return Array.from(this._depManifestsByRepo.get(repoKey)?.values() ?? []);
  }

  addDeclaredDependency({ tenantId, repoId, declared }) {
    assert(isPlainObject(declared), 'declared dependency must be an object');
    assert(typeof declared.package_key === 'string' && declared.package_key.length > 0, 'declared.package_key required');
    const repoKey = key({ tenantId, repoId });
    if (!this._declaredDepsByRepo.has(repoKey)) this._declaredDepsByRepo.set(repoKey, new Map());
    const depKey = `${declared.manifest_key ?? 'unknown'}::${declared.package_key}::${declared.scope ?? 'unknown'}`;
    this._declaredDepsByRepo.get(repoKey).set(depKey, declared);
  }

  listDeclaredDependencies({ tenantId, repoId }) {
    const repoKey = key({ tenantId, repoId });
    return Array.from(this._declaredDepsByRepo.get(repoKey)?.values() ?? []);
  }

  addObservedDependency({ tenantId, repoId, observed }) {
    assert(isPlainObject(observed), 'observed dependency must be an object');
    assert(typeof observed.package_key === 'string' && observed.package_key.length > 0, 'observed.package_key required');
    const repoKey = key({ tenantId, repoId });
    if (!this._observedDepsByRepo.has(repoKey)) this._observedDepsByRepo.set(repoKey, new Map());
    const depKey = `${observed.source_symbol_uid ?? 'unknown'}::${observed.package_key}`;
    this._observedDepsByRepo.get(repoKey).set(depKey, observed);
  }

  listObservedDependencies({ tenantId, repoId }) {
    const repoKey = key({ tenantId, repoId });
    return Array.from(this._observedDepsByRepo.get(repoKey)?.values() ?? []);
  }

  addDependencyMismatch({ tenantId, repoId, mismatch }) {
    assert(isPlainObject(mismatch), 'mismatch must be an object');
    assert(typeof mismatch.mismatch_type === 'string' && mismatch.mismatch_type.length > 0, 'mismatch.mismatch_type required');
    const repoKey = key({ tenantId, repoId });
    if (!this._depMismatchesByRepo.has(repoKey)) this._depMismatchesByRepo.set(repoKey, new Map());
    const mismatchKey = `${mismatch.mismatch_type}::${mismatch.package_key ?? 'unknown'}::${mismatch.sha ?? 'unknown'}`;
    this._depMismatchesByRepo.get(repoKey).set(mismatchKey, mismatch);
  }

  listDependencyMismatches({ tenantId, repoId }) {
    const repoKey = key({ tenantId, repoId });
    return Array.from(this._depMismatchesByRepo.get(repoKey)?.values() ?? []);
  }

  addIndexDiagnostic({ tenantId, repoId, diagnostic }) {
    assert(isPlainObject(diagnostic), 'diagnostic must be an object');
    const repoKey = key({ tenantId, repoId });
    if (!this._indexDiagnosticsByRepo.has(repoKey)) this._indexDiagnosticsByRepo.set(repoKey, []);
    this._indexDiagnosticsByRepo.get(repoKey).push(diagnostic);
  }

  listIndexDiagnostics({ tenantId, repoId }) {
    const repoKey = key({ tenantId, repoId });
    return Array.from(this._indexDiagnosticsByRepo.get(repoKey) ?? []);
  }

  addUnresolvedImport({ tenantId, repoId, unresolvedImport }) {
    assert(isPlainObject(unresolvedImport), 'unresolvedImport must be an object');
    assert(typeof unresolvedImport.file_path === 'string' && unresolvedImport.file_path.length > 0, 'unresolvedImport.file_path required');
    assert(typeof unresolvedImport.spec === 'string' && unresolvedImport.spec.length > 0, 'unresolvedImport.spec required');
    const repoKey = key({ tenantId, repoId });
    if (!this._unresolvedImportsByRepo.has(repoKey)) this._unresolvedImportsByRepo.set(repoKey, new Map());
    const sha = String(unresolvedImport.sha ?? 'unknown');
    const line = Number(unresolvedImport.line ?? 0);
    const k = `${unresolvedImport.file_path}::${line}::${unresolvedImport.spec}::${sha}`;
    this._unresolvedImportsByRepo.get(repoKey).set(k, unresolvedImport);
  }

  listUnresolvedImports({ tenantId, repoId }) {
    const repoKey = key({ tenantId, repoId });
    return Array.from(this._unresolvedImportsByRepo.get(repoKey)?.values() ?? []);
  }

  upsertFlowGraph({ tenantId, repoId, flowGraph }) {
    assert(isPlainObject(flowGraph), 'flowGraph must be an object');
    assert(typeof flowGraph.flow_graph_key === 'string' && flowGraph.flow_graph_key.length > 0, 'flowGraph.flow_graph_key required');
    const repoKey = key({ tenantId, repoId });
    if (!this._flowGraphsByRepo.has(repoKey)) this._flowGraphsByRepo.set(repoKey, new Map());
    this._flowGraphsByRepo.get(repoKey).set(flowGraph.flow_graph_key, flowGraph);
  }

  getFlowGraph({ tenantId, repoId, flowGraphKey }) {
    const repoKey = key({ tenantId, repoId });
    return this._flowGraphsByRepo.get(repoKey)?.get(flowGraphKey) ?? null;
  }

  listFlowGraphs({ tenantId, repoId }) {
    const repoKey = key({ tenantId, repoId });
    return Array.from(this._flowGraphsByRepo.get(repoKey)?.values() ?? []);
  }

  upsertGraphAnnotation({ tenantId, repoId, annotation }) {
    assert(isPlainObject(annotation), 'annotation must be an object');
    assert(typeof annotation.symbol_uid === 'string' && annotation.symbol_uid.length > 0, 'annotation.symbol_uid required');
    assert(typeof annotation.annotation_type === 'string' && annotation.annotation_type.length > 0, 'annotation.annotation_type required');
    const repoKey = key({ tenantId, repoId });
    if (!this._annotationsByRepo.has(repoKey)) this._annotationsByRepo.set(repoKey, new Map());
    const k = `${annotation.symbol_uid}::${annotation.annotation_type}`;
    const existing = this._annotationsByRepo.get(repoKey).get(k);
    const next = existing ? { ...existing, ...annotation } : annotation;
    this._annotationsByRepo.get(repoKey).set(k, sanitizeAnnotationForPersistence(next));
  }

  listGraphAnnotations({ tenantId, repoId }) {
    const repoKey = key({ tenantId, repoId });
    return Array.from(this._annotationsByRepo.get(repoKey)?.values() ?? []);
  }

  listGraphAnnotationsBySymbolUid({ tenantId, repoId, symbolUid }) {
    return this.listGraphAnnotations({ tenantId, repoId }).filter((a) => a.symbol_uid === symbolUid);
  }
}
