function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

function toPgVectorLiteral(v) {
  if (v == null) return null;
  if (!Array.isArray(v)) throw new Error('embedding must be array or null');
  return `[${v.map((n) => (Number.isFinite(n) ? String(n) : '0')).join(',')}]`;
}

function parsePackageKey(packageKey) {
  if (!isNonEmptyString(packageKey)) return { ecosystem: 'unknown', name: 'unknown' };
  const i = packageKey.indexOf(':');
  if (i <= 0) return { ecosystem: 'unknown', name: packageKey };
  return { ecosystem: packageKey.slice(0, i), name: packageKey.slice(i + 1) };
}

function splitManifestKey(k) {
  const s = String(k ?? '');
  const i = s.lastIndexOf('::');
  if (i <= 0) return { filePath: null, sha: null };
  return { filePath: s.slice(0, i), sha: s.slice(i + 2) };
}

function parseFlowGraphKey(k) {
  const s = String(k ?? '');
  const parts = s.split('::');
  if (parts.length < 3) return { entrypointKey: null, sha: null, depth: null };
  const depthStr = parts.at(-1);
  const sha = parts.at(-2);
  const entrypointKey = parts.slice(0, -2).join('::');
  const depth = Number(depthStr);
  return { entrypointKey, sha, depth: Number.isFinite(depth) ? Math.trunc(depth) : null };
}

export class PgGraphStore {
  constructor({ client }) {
    if (!client || typeof client.query !== 'function') throw new Error('client.query is required');
    this._c = client;
    this._nodeIdByKey = new Map(); // tenant::repo::symbol_uid -> uuid
    this._edgeIdByKey = new Map(); // tenant::repo::edgeKey -> uuid
    this._manifestIdByKey = new Map(); // tenant::repo::manifest_key -> uuid
    this._packageIdByKey = new Map(); // ecosystem::name -> uuid
    this._indexDiagnosticsByKey = new Map(); // tenant::repo -> Array
  }

  _rk({ tenantId, repoId }) {
    return `${tenantId}::${repoId}`;
  }

  _nk({ tenantId, repoId, symbolUid }) {
    return `${tenantId}::${repoId}::${symbolUid}`;
  }

  _ek({ tenantId, repoId, edgeKey }) {
    return `${tenantId}::${repoId}::${edgeKey}`;
  }

  async _getNodeId({ tenantId, repoId, symbolUid }) {
    const k = this._nk({ tenantId, repoId, symbolUid });
    const cached = this._nodeIdByKey.get(k);
    if (cached) return cached;
    const res = await this._c.query(
      'SELECT id FROM graph_nodes WHERE tenant_id=$1 AND repo_id=$2 AND symbol_uid=$3 LIMIT 1',
      [tenantId, repoId, symbolUid]
    );
    const id = res.rows?.[0]?.id ?? null;
    if (id) this._nodeIdByKey.set(k, id);
    return id;
  }

  async _getPackageId({ packageKey }) {
    const { ecosystem, name } = parsePackageKey(packageKey);
    const k = `${ecosystem}::${name}`;
    const cached = this._packageIdByKey.get(k);
    if (cached) return cached;
    const res = await this._c.query(
      `INSERT INTO packages (ecosystem, name)
       VALUES ($1, $2)
       ON CONFLICT (ecosystem, name) DO UPDATE SET ecosystem=EXCLUDED.ecosystem
       RETURNING id`,
      [ecosystem, name]
    );
    const id = res.rows?.[0]?.id ?? null;
    if (id) this._packageIdByKey.set(k, id);
    return id;
  }

  async _getEdgeIdByUids({ tenantId, repoId, sourceSymbolUid, edgeType, targetSymbolUid }) {
    const edgeKey = `${sourceSymbolUid}::${edgeType}::${targetSymbolUid}`;
    const k = this._ek({ tenantId, repoId, edgeKey });
    const cached = this._edgeIdByKey.get(k);
    if (cached) return cached;
    const res = await this._c.query(
      `SELECT e.id
       FROM graph_edges e
       JOIN graph_nodes s ON s.id=e.source_node_id
       JOIN graph_nodes t ON t.id=e.target_node_id
       WHERE e.tenant_id=$1 AND e.repo_id=$2 AND s.symbol_uid=$3 AND e.edge_type=$4 AND t.symbol_uid=$5
       LIMIT 1`,
      [tenantId, repoId, sourceSymbolUid, edgeType, targetSymbolUid]
    );
    const id = res.rows?.[0]?.id ?? null;
    if (id) this._edgeIdByKey.set(k, id);
    return id;
  }

  async getNodeBySymbolUid({ tenantId, repoId, symbolUid }) {
    const res = await this._c.query(
      'SELECT * FROM graph_nodes WHERE tenant_id=$1 AND repo_id=$2 AND symbol_uid=$3 LIMIT 1',
      [tenantId, repoId, symbolUid]
    );
    return res.rows?.[0] ?? null;
  }

  async listNodes({ tenantId, repoId }) {
    const res = await this._c.query('SELECT * FROM graph_nodes WHERE tenant_id=$1 AND repo_id=$2', [tenantId, repoId]);
    return Array.isArray(res.rows) ? res.rows : [];
  }

  async listEdges({ tenantId, repoId }) {
    const res = await this._c.query(
      `SELECT
         s.symbol_uid as source_symbol_uid,
         t.symbol_uid as target_symbol_uid,
         e.edge_type,
         e.metadata,
         e.first_seen_sha,
         e.last_seen_sha
       FROM graph_edges e
       JOIN graph_nodes s ON s.id=e.source_node_id
       JOIN graph_nodes t ON t.id=e.target_node_id
       WHERE e.tenant_id=$1 AND e.repo_id=$2`,
      [tenantId, repoId]
    );
    return Array.isArray(res.rows) ? res.rows : [];
  }

  async listEdgesByNode({ tenantId, repoId, symbolUid, direction = 'both' }) {
    if (direction === 'out') {
      const res = await this._c.query(
        `SELECT
           s.symbol_uid as source_symbol_uid,
           t.symbol_uid as target_symbol_uid,
           e.edge_type,
           e.metadata,
           e.first_seen_sha,
           e.last_seen_sha
         FROM graph_edges e
         JOIN graph_nodes s ON s.id=e.source_node_id
         JOIN graph_nodes t ON t.id=e.target_node_id
         WHERE e.tenant_id=$1 AND e.repo_id=$2 AND s.symbol_uid=$3`,
        [tenantId, repoId, symbolUid]
      );
      return Array.isArray(res.rows) ? res.rows : [];
    }
    if (direction === 'in') {
      const res = await this._c.query(
        `SELECT
           s.symbol_uid as source_symbol_uid,
           t.symbol_uid as target_symbol_uid,
           e.edge_type,
           e.metadata,
           e.first_seen_sha,
           e.last_seen_sha
         FROM graph_edges e
         JOIN graph_nodes s ON s.id=e.source_node_id
         JOIN graph_nodes t ON t.id=e.target_node_id
         WHERE e.tenant_id=$1 AND e.repo_id=$2 AND t.symbol_uid=$3`,
        [tenantId, repoId, symbolUid]
      );
      return Array.isArray(res.rows) ? res.rows : [];
    }
    const res = await this._c.query(
      `SELECT
         s.symbol_uid as source_symbol_uid,
         t.symbol_uid as target_symbol_uid,
         e.edge_type,
         e.metadata,
         e.first_seen_sha,
         e.last_seen_sha
       FROM graph_edges e
       JOIN graph_nodes s ON s.id=e.source_node_id
       JOIN graph_nodes t ON t.id=e.target_node_id
       WHERE e.tenant_id=$1 AND e.repo_id=$2 AND (s.symbol_uid=$3 OR t.symbol_uid=$3)`,
      [tenantId, repoId, symbolUid]
    );
    return Array.isArray(res.rows) ? res.rows : [];
  }

  async listEdgeOccurrencesForEdge({ tenantId, repoId, sourceSymbolUid, edgeType, targetSymbolUid }) {
    const edgeId = await this._getEdgeIdByUids({ tenantId, repoId, sourceSymbolUid, edgeType, targetSymbolUid });
    if (!edgeId) return [];
    const res = await this._c.query(
      `SELECT file_path, line_start, line_end, occurrence_kind, sha
       FROM graph_edge_occurrences
       WHERE tenant_id=$1 AND repo_id=$2 AND edge_id=$3
       ORDER BY file_path ASC, line_start ASC`,
      [tenantId, repoId, edgeId]
    );
    return Array.isArray(res.rows) ? res.rows : [];
  }

  async listFlowEntrypoints({ tenantId, repoId }) {
    const res = await this._c.query(
      `SELECT entrypoint_key, entrypoint_type, method, path, symbol_uid, file_path, line_start, line_end
       FROM flow_entrypoints
       WHERE tenant_id=$1 AND repo_id=$2
       ORDER BY entrypoint_key ASC`,
      [tenantId, repoId]
    );
    return Array.isArray(res.rows) ? res.rows : [];
  }

  async getFlowGraph({ tenantId, repoId, flowGraphKey }) {
    const { entrypointKey, sha, depth } = parseFlowGraphKey(flowGraphKey);
    if (!entrypointKey || !sha || !Number.isInteger(depth)) return null;
    const fgRes = await this._c.query(
      `SELECT id, entrypoint_key, start_symbol_uid, sha, depth
       FROM flow_graphs
       WHERE tenant_id=$1 AND repo_id=$2 AND entrypoint_key=$3 AND sha=$4 AND depth=$5
       LIMIT 1`,
      [tenantId, repoId, entrypointKey, sha, depth]
    );
    const fg = fgRes.rows?.[0] ?? null;
    if (!fg) return null;

    const nodesRes = await this._c.query(
      `SELECT n.symbol_uid
       FROM flow_graph_nodes fgn
       JOIN graph_nodes n ON n.id=fgn.node_id
       WHERE fgn.tenant_id=$1 AND fgn.repo_id=$2 AND fgn.flow_graph_id=$3`,
      [tenantId, repoId, fg.id]
    );
    const edgeRes = await this._c.query(
      `SELECT
         s.symbol_uid as source_symbol_uid,
         e.edge_type,
         t.symbol_uid as target_symbol_uid
       FROM flow_graph_edges fge
       JOIN graph_edges e ON e.id=fge.edge_id
       JOIN graph_nodes s ON s.id=e.source_node_id
       JOIN graph_nodes t ON t.id=e.target_node_id
       WHERE fge.tenant_id=$1 AND fge.repo_id=$2 AND fge.flow_graph_id=$3`,
      [tenantId, repoId, fg.id]
    );

    return {
      flow_graph_key: `${fg.entrypoint_key}::${fg.sha}::${fg.depth}`,
      entrypoint_key: fg.entrypoint_key,
      start_symbol_uid: fg.start_symbol_uid,
      sha: fg.sha,
      depth: fg.depth,
      node_uids: (nodesRes.rows ?? []).map((r) => r.symbol_uid),
      edge_keys: (edgeRes.rows ?? []).map((r) => `${r.source_symbol_uid}::${r.edge_type}::${r.target_symbol_uid}`)
    };
  }

  async listFlowGraphs({ tenantId, repoId }) {
    const res = await this._c.query(
      `SELECT entrypoint_key, start_symbol_uid, sha, depth
       FROM flow_graphs
       WHERE tenant_id=$1 AND repo_id=$2
       ORDER BY created_at DESC`,
      [tenantId, repoId]
    );
    return (res.rows ?? []).map((r) => ({
      flow_graph_key: `${r.entrypoint_key}::${r.sha}::${r.depth}`,
      entrypoint_key: r.entrypoint_key,
      start_symbol_uid: r.start_symbol_uid,
      sha: r.sha,
      depth: r.depth
    }));
  }

  async upsertNode({ tenantId, repoId, node }) {
    if (!isNonEmptyString(node?.symbol_uid)) throw new Error('node.symbol_uid required');
    if (!isNonEmptyString(node?.node_type)) throw new Error('node.node_type required');
    const nodeKey = node.node_key ?? node.symbol_uid;
    const firstSeenSha = node.first_seen_sha ?? node.last_seen_sha ?? 'mock';
    const lastSeenSha = node.last_seen_sha ?? node.first_seen_sha ?? 'mock';

    const res = await this._c.query(
      `INSERT INTO graph_nodes (
        tenant_id, repo_id, node_key, symbol_uid, qualified_name,
        name, node_type, language, file_path, line_start, line_end, visibility,
        signature, signature_hash, declaration, docstring, type_annotation, return_type,
        parameters, contract, constraints, allowable_values, external_ref,
        embedding, embedding_text,
        first_seen_sha, last_seen_sha
      ) VALUES (
        $1,$2,$3,$4,$5,
        $6,$7,$8,$9,$10,$11,$12,
        $13,$14,$15,$16,$17,$18,
        $19,$20,$21,$22,$23,
        $24,$25,
        $26,$27
      )
      ON CONFLICT (tenant_id, repo_id, symbol_uid) DO UPDATE SET
        node_key=EXCLUDED.node_key,
        qualified_name=EXCLUDED.qualified_name,
        name=EXCLUDED.name,
        node_type=EXCLUDED.node_type,
        language=EXCLUDED.language,
        file_path=EXCLUDED.file_path,
        line_start=EXCLUDED.line_start,
        line_end=EXCLUDED.line_end,
        visibility=EXCLUDED.visibility,
        signature=EXCLUDED.signature,
        signature_hash=EXCLUDED.signature_hash,
        declaration=EXCLUDED.declaration,
        docstring=EXCLUDED.docstring,
        type_annotation=EXCLUDED.type_annotation,
        return_type=EXCLUDED.return_type,
        parameters=EXCLUDED.parameters,
        contract=EXCLUDED.contract,
        constraints=EXCLUDED.constraints,
        allowable_values=EXCLUDED.allowable_values,
        external_ref=EXCLUDED.external_ref,
        embedding=EXCLUDED.embedding,
        embedding_text=EXCLUDED.embedding_text,
        last_seen_sha=EXCLUDED.last_seen_sha,
        indexed_at=now()
      RETURNING id`,
      [
        tenantId,
        repoId,
        nodeKey,
        node.symbol_uid,
        node.qualified_name ?? null,
        node.name ?? null,
        node.node_type,
        node.language ?? null,
        node.file_path ?? null,
        node.line_start ?? null,
        node.line_end ?? null,
        node.visibility ?? null,
        node.signature ?? null,
        node.signature_hash ?? null,
        node.declaration ?? null,
        node.docstring ?? null,
        node.type_annotation ?? null,
        node.return_type ?? null,
        node.parameters ?? null,
        node.contract ?? null,
        node.constraints ?? null,
        node.allowable_values ?? null,
        node.external_ref ?? null,
        toPgVectorLiteral(node.embedding ?? null),
        node.embedding_text ?? null,
        firstSeenSha,
        lastSeenSha
      ]
    );

    const id = res.rows?.[0]?.id ?? null;
    if (id) this._nodeIdByKey.set(this._nk({ tenantId, repoId, symbolUid: node.symbol_uid }), id);
    return id;
  }

  async upsertEdge({ tenantId, repoId, edge }) {
    if (!isNonEmptyString(edge?.source_symbol_uid)) throw new Error('edge.source_symbol_uid required');
    if (!isNonEmptyString(edge?.target_symbol_uid)) throw new Error('edge.target_symbol_uid required');
    if (!isNonEmptyString(edge?.edge_type)) throw new Error('edge.edge_type required');

    const sourceId = await this._getNodeId({ tenantId, repoId, symbolUid: edge.source_symbol_uid });
    const targetId = await this._getNodeId({ tenantId, repoId, symbolUid: edge.target_symbol_uid });
    if (!sourceId || !targetId) throw new Error('missing_node_for_edge');

    const firstSeenSha = edge.first_seen_sha ?? edge.last_seen_sha ?? 'mock';
    const lastSeenSha = edge.last_seen_sha ?? edge.first_seen_sha ?? 'mock';

    const res = await this._c.query(
      `INSERT INTO graph_edges (
        tenant_id, repo_id, source_node_id, target_node_id, edge_type, metadata, first_seen_sha, last_seen_sha
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (tenant_id, repo_id, source_node_id, target_node_id, edge_type) DO UPDATE SET
        metadata=EXCLUDED.metadata,
        last_seen_sha=EXCLUDED.last_seen_sha,
        indexed_at=now()
      RETURNING id`,
      [tenantId, repoId, sourceId, targetId, edge.edge_type, edge.metadata ?? null, firstSeenSha, lastSeenSha]
    );

    const id = res.rows?.[0]?.id ?? null;
    const edgeKey = `${edge.source_symbol_uid}::${edge.edge_type}::${edge.target_symbol_uid}`;
    if (id) this._edgeIdByKey.set(this._ek({ tenantId, repoId, edgeKey }), id);
    return id;
  }

  async addEdgeOccurrence({ tenantId, repoId, occurrence }) {
    if (!isNonEmptyString(occurrence?.source_symbol_uid)) throw new Error('occurrence.source_symbol_uid required');
    if (!isNonEmptyString(occurrence?.target_symbol_uid)) throw new Error('occurrence.target_symbol_uid required');
    if (!isNonEmptyString(occurrence?.edge_type)) throw new Error('occurrence.edge_type required');
    if (!isNonEmptyString(occurrence?.file_path)) throw new Error('occurrence.file_path required');

    const sha = occurrence.sha ?? 'mock';
    let edgeId = await this._getEdgeIdByUids({
      tenantId,
      repoId,
      sourceSymbolUid: occurrence.source_symbol_uid,
      edgeType: occurrence.edge_type,
      targetSymbolUid: occurrence.target_symbol_uid
    });
    if (!edgeId) {
      edgeId = await this.upsertEdge({
        tenantId,
        repoId,
        edge: {
          source_symbol_uid: occurrence.source_symbol_uid,
          target_symbol_uid: occurrence.target_symbol_uid,
          edge_type: occurrence.edge_type,
          metadata: null,
          first_seen_sha: sha,
          last_seen_sha: sha
        }
      });
    }

    await this._c.query(
      `INSERT INTO graph_edge_occurrences (
        tenant_id, repo_id, edge_id, file_path, line_start, line_end, occurrence_kind, sha
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (tenant_id, repo_id, edge_id, file_path, line_start, line_end) DO UPDATE SET
        occurrence_kind=EXCLUDED.occurrence_kind,
        sha=EXCLUDED.sha`,
      [
        tenantId,
        repoId,
        edgeId,
        occurrence.file_path,
        occurrence.line_start,
        occurrence.line_end,
        occurrence.occurrence_kind ?? 'other',
        sha
      ]
    );
  }

  async upsertFlowEntrypoint({ tenantId, repoId, entrypoint }) {
    if (!isNonEmptyString(entrypoint?.entrypoint_key)) throw new Error('entrypoint.entrypoint_key required');
    if (!isNonEmptyString(entrypoint?.entrypoint_type)) throw new Error('entrypoint.entrypoint_type required');
    await this._c.query(
      `INSERT INTO flow_entrypoints (
        tenant_id, repo_id, entrypoint_key, entrypoint_type, method, path, symbol_uid, file_path, line_start, line_end
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (tenant_id, repo_id, entrypoint_key) DO UPDATE SET
        entrypoint_type=EXCLUDED.entrypoint_type,
        method=EXCLUDED.method,
        path=EXCLUDED.path,
        symbol_uid=EXCLUDED.symbol_uid,
        file_path=EXCLUDED.file_path,
        line_start=EXCLUDED.line_start,
        line_end=EXCLUDED.line_end,
        indexed_at=now()`,
      [
        tenantId,
        repoId,
        entrypoint.entrypoint_key,
        entrypoint.entrypoint_type,
        entrypoint.method ?? null,
        entrypoint.path ?? null,
        entrypoint.symbol_uid ?? null,
        entrypoint.file_path ?? null,
        entrypoint.line_start ?? null,
        entrypoint.line_end ?? null
      ]
    );
  }

  async addDependencyManifest({ tenantId, repoId, manifest }) {
    if (!isNonEmptyString(manifest?.file_path)) throw new Error('manifest.file_path required');
    if (!isNonEmptyString(manifest?.sha)) throw new Error('manifest.sha required');
    if (!isNonEmptyString(manifest?.manifest_type)) throw new Error('manifest.manifest_type required');
    const res = await this._c.query(
      `INSERT INTO dependency_manifests (tenant_id, repo_id, manifest_type, file_path, sha, parsed)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (tenant_id, repo_id, file_path, sha) DO UPDATE SET
         manifest_type=EXCLUDED.manifest_type,
         parsed=COALESCE(dependency_manifests.parsed, EXCLUDED.parsed),
         parsed_at=now()
       RETURNING id`,
      [tenantId, repoId, manifest.manifest_type, manifest.file_path, manifest.sha, manifest.parsed ?? null]
    );
    const id = res.rows?.[0]?.id ?? null;
    const manifestKey = manifest.manifest_key ?? `${manifest.file_path}::${manifest.sha}`;
    if (id) this._manifestIdByKey.set(`${this._rk({ tenantId, repoId })}::${manifestKey}`, id);
    return id;
  }

  async addDeclaredDependency({ tenantId, repoId, declared }) {
    if (!isNonEmptyString(declared?.package_key)) throw new Error('declared.package_key required');
    const manifestKey = declared.manifest_key ?? null;
    let manifestId = null;
    if (manifestKey) {
      manifestId = this._manifestIdByKey.get(`${this._rk({ tenantId, repoId })}::${manifestKey}`) ?? null;
      if (!manifestId) {
        const { filePath, sha } = splitManifestKey(manifestKey);
        if (filePath && sha) {
          const res = await this._c.query(
            'SELECT id FROM dependency_manifests WHERE tenant_id=$1 AND repo_id=$2 AND file_path=$3 AND sha=$4 LIMIT 1',
            [tenantId, repoId, filePath, sha]
          );
          manifestId = res.rows?.[0]?.id ?? null;
        }
      }
    }
    if (!manifestId) throw new Error('missing_manifest_for_declared_dependency');

    const packageId = await this._getPackageId({ packageKey: declared.package_key });
    await this._c.query(
      `INSERT INTO declared_dependencies (tenant_id, repo_id, manifest_id, package_id, scope, version_range, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (tenant_id, repo_id, manifest_id, package_id, scope) DO UPDATE SET
         version_range=EXCLUDED.version_range,
         metadata=EXCLUDED.metadata`,
      [
        tenantId,
        repoId,
        manifestId,
        packageId,
        declared.scope ?? 'unknown',
        declared.version_range ?? null,
        declared.metadata ?? null
      ]
    );
  }

  async addObservedDependency({ tenantId, repoId, observed }) {
    if (!isNonEmptyString(observed?.package_key)) throw new Error('observed.package_key required');
    const packageId = await this._getPackageId({ packageKey: observed.package_key });
    const sourceNodeId = observed.source_symbol_uid
      ? await this._getNodeId({ tenantId, repoId, symbolUid: observed.source_symbol_uid })
      : null;
    const firstSeenSha = observed.first_seen_sha ?? observed.last_seen_sha ?? 'mock';
    const lastSeenSha = observed.last_seen_sha ?? observed.first_seen_sha ?? 'mock';
    await this._c.query(
      `INSERT INTO observed_dependencies (tenant_id, repo_id, package_id, source_node_id, evidence, first_seen_sha, last_seen_sha)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (tenant_id, repo_id, package_id, source_node_id) DO UPDATE SET
         evidence=EXCLUDED.evidence,
         last_seen_sha=EXCLUDED.last_seen_sha`,
      [tenantId, repoId, packageId, sourceNodeId, observed.evidence ?? null, firstSeenSha, lastSeenSha]
    );
  }

  async addDependencyMismatch({ tenantId, repoId, mismatch }) {
    if (!isNonEmptyString(mismatch?.mismatch_type)) throw new Error('mismatch.mismatch_type required');
    const packageId = mismatch.package_key ? await this._getPackageId({ packageKey: mismatch.package_key }) : null;
    await this._c.query(
      `INSERT INTO dependency_mismatches (tenant_id, repo_id, mismatch_type, package_id, details, sha)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [tenantId, repoId, mismatch.mismatch_type, packageId, mismatch.details ?? {}, mismatch.sha ?? 'mock']
    );
  }

  addIndexDiagnostic({ tenantId, repoId, diagnostic }) {
    const repoKey = this._rk({ tenantId, repoId });
    if (!this._indexDiagnosticsByKey.has(repoKey)) this._indexDiagnosticsByKey.set(repoKey, []);
    this._indexDiagnosticsByKey.get(repoKey).push(diagnostic);
  }

  listIndexDiagnostics({ tenantId, repoId }) {
    const repoKey = this._rk({ tenantId, repoId });
    return Array.from(this._indexDiagnosticsByKey.get(repoKey) ?? []);
  }

  async upsertFlowGraph({ tenantId, repoId, flowGraph }) {
    if (!isNonEmptyString(flowGraph?.entrypoint_key)) throw new Error('flowGraph.entrypoint_key required');
    if (!isNonEmptyString(flowGraph?.start_symbol_uid)) throw new Error('flowGraph.start_symbol_uid required');
    if (!isNonEmptyString(flowGraph?.sha)) throw new Error('flowGraph.sha required');
    if (!Number.isInteger(flowGraph?.depth)) throw new Error('flowGraph.depth required');

    const begin = await this._c.query('BEGIN');
    try {
      const fgRes = await this._c.query(
        `INSERT INTO flow_graphs (tenant_id, repo_id, entrypoint_key, start_symbol_uid, sha, depth)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (tenant_id, repo_id, entrypoint_key, sha, depth) DO UPDATE SET
           start_symbol_uid=EXCLUDED.start_symbol_uid
         RETURNING id`,
        [tenantId, repoId, flowGraph.entrypoint_key, flowGraph.start_symbol_uid, flowGraph.sha, flowGraph.depth]
      );
      const flowGraphId = fgRes.rows?.[0]?.id ?? null;
      if (!flowGraphId) throw new Error('flow_graph_upsert_failed');

      await this._c.query('DELETE FROM flow_graph_nodes WHERE tenant_id=$1 AND repo_id=$2 AND flow_graph_id=$3', [
        tenantId,
        repoId,
        flowGraphId
      ]);
      await this._c.query('DELETE FROM flow_graph_edges WHERE tenant_id=$1 AND repo_id=$2 AND flow_graph_id=$3', [
        tenantId,
        repoId,
        flowGraphId
      ]);

      const nodeUids = Array.isArray(flowGraph.node_uids) ? flowGraph.node_uids : [];
      for (const uid of nodeUids) {
        const nodeId = await this._getNodeId({ tenantId, repoId, symbolUid: uid });
        if (!nodeId) throw new Error('missing_node_for_flow_graph');
        await this._c.query(
          `INSERT INTO flow_graph_nodes (tenant_id, repo_id, flow_graph_id, node_id)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (tenant_id, repo_id, flow_graph_id, node_id) DO NOTHING`,
          [tenantId, repoId, flowGraphId, nodeId]
        );
      }

      const edgeKeys = Array.isArray(flowGraph.edge_keys) ? flowGraph.edge_keys : [];
      for (const ek of edgeKeys) {
        const [sourceUid, edgeType, targetUid] = String(ek).split('::');
        if (!sourceUid || !edgeType || !targetUid) continue;
        const edgeId =
          (await this._getEdgeIdByUids({ tenantId, repoId, sourceSymbolUid: sourceUid, edgeType, targetSymbolUid: targetUid })) ??
          null;
        if (!edgeId) throw new Error('missing_edge_for_flow_graph');
        await this._c.query(
          `INSERT INTO flow_graph_edges (tenant_id, repo_id, flow_graph_id, edge_id)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (tenant_id, repo_id, flow_graph_id, edge_id) DO NOTHING`,
          [tenantId, repoId, flowGraphId, edgeId]
        );
      }

      await this._c.query('COMMIT');
      return { ok: true, id: flowGraphId };
    } catch (err) {
      await this._c.query('ROLLBACK');
      throw err;
    } finally {
      void begin;
    }
  }
}
