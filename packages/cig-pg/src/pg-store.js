import { embedText384 } from '../../cig/src/embedding.js';

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
  constructor({ client, repoFullName = 'local/unknown' }) {
    if (!client || typeof client.query !== 'function') throw new Error('client.query is required');
    this._c = client;
    this._repoFullName = repoFullName;
    this._nodeIdByKey = new Map(); // tenant::repo::symbol_uid -> uuid
    this._edgeIdByKey = new Map(); // tenant::repo::edgeKey -> uuid
    this._manifestIdByKey = new Map(); // tenant::repo::manifest_key -> uuid
    this._packageIdByKey = new Map(); // ecosystem::name -> uuid
    this._indexDiagnosticsByKey = new Map(); // tenant::repo -> Array
    this._ensured = new Set(); // tenant::repo
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
    await this._ensureOrgRepo({ tenantId, repoId });
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
    await this._ensureOrgRepo({ tenantId, repoId });
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
    await this._ensureOrgRepo({ tenantId, repoId });
    const res = await this._c.query(
      'SELECT * FROM graph_nodes WHERE tenant_id=$1 AND repo_id=$2 AND symbol_uid=$3 LIMIT 1',
      [tenantId, repoId, symbolUid]
    );
    return res.rows?.[0] ?? null;
  }

  async listNodes({ tenantId, repoId }) {
    await this._ensureOrgRepo({ tenantId, repoId });
    const res = await this._c.query('SELECT * FROM graph_nodes WHERE tenant_id=$1 AND repo_id=$2', [tenantId, repoId]);
    return Array.isArray(res.rows) ? res.rows : [];
  }

  async listEdges({ tenantId, repoId }) {
    await this._ensureOrgRepo({ tenantId, repoId });
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
    await this._ensureOrgRepo({ tenantId, repoId });
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
    await this._ensureOrgRepo({ tenantId, repoId });
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
    await this._ensureOrgRepo({ tenantId, repoId });
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
    await this._ensureOrgRepo({ tenantId, repoId });
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
    await this._ensureOrgRepo({ tenantId, repoId });
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

  async semanticSearch({ tenantId, repoId, query, limit = 10 }) {
    await this._ensureOrgRepo({ tenantId, repoId });
    const q = String(query ?? '').trim();
    if (!q) return [];
    const vec = toPgVectorLiteral(embedText384(q));
    const n = Number.isFinite(limit) ? Math.max(1, Math.min(50, Math.trunc(limit))) : 10;
    const res = await this._c.query(
      `SELECT *, (1 - (embedding <=> $3::vector)) as score
       FROM graph_nodes
       WHERE tenant_id=$1 AND repo_id=$2 AND embedding IS NOT NULL
       ORDER BY embedding <=> $3::vector
       LIMIT $4`,
      [tenantId, repoId, vec, n]
    );
    return (res.rows ?? []).map((row) => {
      const { score, ...node } = row;
      return { node, score: Number(score) };
    });
  }

  async upsertNode({ tenantId, repoId, node }) {
    await this._ensureOrgRepo({ tenantId, repoId });
    if (!isNonEmptyString(node?.symbol_uid)) throw new Error('node.symbol_uid required');
    if (!isNonEmptyString(node?.node_type)) throw new Error('node.node_type required');
    const nodeKey = node.node_key ?? node.symbol_uid;
    const firstSeenSha = node.first_seen_sha ?? node.last_seen_sha ?? 'mock';
    const lastSeenSha = node.last_seen_sha ?? node.first_seen_sha ?? 'mock';

    const res = await this._c.query(
      `INSERT INTO graph_nodes (
        tenant_id, repo_id, node_key, symbol_uid, qualified_name,
        symbol_kind, container_uid, exported_name,
        name, node_type, language, file_path, line_start, line_end, visibility,
        signature, signature_hash, declaration, docstring, type_annotation, return_type,
        parameters, contract, constraints, allowable_values, external_ref,
        embedding, embedding_text,
        first_seen_sha, last_seen_sha
      ) VALUES (
        $1,$2,$3,$4,$5,
        $6,$7,$8,
        $9,$10,$11,$12,$13,$14,$15,
        $16,$17,$18,$19,$20,$21,
        $22,$23,$24,$25,$26,
        $27,$28,
        $29,$30
      )
      ON CONFLICT (tenant_id, repo_id, symbol_uid) DO UPDATE SET
        node_key=EXCLUDED.node_key,
        qualified_name=EXCLUDED.qualified_name,
        symbol_kind=EXCLUDED.symbol_kind,
        container_uid=EXCLUDED.container_uid,
        exported_name=EXCLUDED.exported_name,
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
        node.symbol_kind ?? null,
        node.container_uid ?? null,
        node.exported_name ?? null,
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
    await this._ensureOrgRepo({ tenantId, repoId });
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
    await this._ensureOrgRepo({ tenantId, repoId });
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
    await this._ensureOrgRepo({ tenantId, repoId });
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
    await this._ensureOrgRepo({ tenantId, repoId });
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
    await this._ensureOrgRepo({ tenantId, repoId });
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
    await this._ensureOrgRepo({ tenantId, repoId });
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
    await this._ensureOrgRepo({ tenantId, repoId });
    if (!isNonEmptyString(mismatch?.mismatch_type)) throw new Error('mismatch.mismatch_type required');
    const packageId = mismatch.package_key ? await this._getPackageId({ packageKey: mismatch.package_key }) : null;
    await this._c.query(
      `INSERT INTO dependency_mismatches (tenant_id, repo_id, mismatch_type, package_id, details, sha)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [tenantId, repoId, mismatch.mismatch_type, packageId, mismatch.details ?? {}, mismatch.sha ?? 'mock']
    );
  }

  async listDependencyManifests({ tenantId, repoId }) {
    await this._ensureOrgRepo({ tenantId, repoId });
    const res = await this._c.query(
      `SELECT manifest_type, file_path, sha, parsed, parsed_at
       FROM dependency_manifests
       WHERE tenant_id=$1 AND repo_id=$2
       ORDER BY parsed_at DESC`,
      [tenantId, repoId]
    );
    return Array.isArray(res.rows) ? res.rows : [];
  }

  async listDeclaredDependencies({ tenantId, repoId }) {
    await this._ensureOrgRepo({ tenantId, repoId });
    const res = await this._c.query(
      `SELECT
         dm.file_path as manifest_file_path,
         dm.sha as manifest_sha,
         p.ecosystem,
         p.name as package_name,
         dd.scope,
         dd.version_range,
         dd.metadata
       FROM declared_dependencies dd
       JOIN dependency_manifests dm ON dm.id=dd.manifest_id
       JOIN packages p ON p.id=dd.package_id
       WHERE dd.tenant_id=$1 AND dd.repo_id=$2
       ORDER BY dm.file_path ASC, p.ecosystem ASC, p.name ASC`,
      [tenantId, repoId]
    );
    return Array.isArray(res.rows)
      ? res.rows.map((r) => ({
          manifest_key: `${r.manifest_file_path}::${r.manifest_sha}`,
          package_key: `${r.ecosystem}:${r.package_name}`,
          scope: r.scope,
          version_range: r.version_range ?? null,
          metadata: r.metadata ?? null
        }))
      : [];
  }

  async listObservedDependencies({ tenantId, repoId }) {
    await this._ensureOrgRepo({ tenantId, repoId });
    const res = await this._c.query(
      `SELECT
         p.ecosystem,
         p.name as package_name,
         n.symbol_uid as source_symbol_uid,
         od.evidence,
         od.first_seen_sha,
         od.last_seen_sha
       FROM observed_dependencies od
       JOIN packages p ON p.id=od.package_id
       LEFT JOIN graph_nodes n ON n.id=od.source_node_id
       WHERE od.tenant_id=$1 AND od.repo_id=$2
       ORDER BY p.ecosystem ASC, p.name ASC`,
      [tenantId, repoId]
    );
    return Array.isArray(res.rows)
      ? res.rows.map((r) => ({
          package_key: `${r.ecosystem}:${r.package_name}`,
          source_symbol_uid: r.source_symbol_uid ?? null,
          evidence: r.evidence ?? null,
          first_seen_sha: r.first_seen_sha,
          last_seen_sha: r.last_seen_sha
        }))
      : [];
  }

  async listDependencyMismatches({ tenantId, repoId }) {
    await this._ensureOrgRepo({ tenantId, repoId });
    const res = await this._c.query(
      `SELECT
         dm.mismatch_type,
         p.ecosystem,
         p.name as package_name,
         dm.details,
         dm.sha,
         dm.created_at
       FROM dependency_mismatches dm
       LEFT JOIN packages p ON p.id=dm.package_id
       WHERE dm.tenant_id=$1 AND dm.repo_id=$2
       ORDER BY dm.created_at DESC`,
      [tenantId, repoId]
    );
    return Array.isArray(res.rows)
      ? res.rows.map((r) => ({
          mismatch_type: r.mismatch_type,
          package_key: r.ecosystem && r.package_name ? `${r.ecosystem}:${r.package_name}` : null,
          details: r.details ?? null,
          sha: r.sha,
          created_at: r.created_at
        }))
      : [];
  }

  async addIndexDiagnostic({ tenantId, repoId, diagnostic }) {
    await this._ensureOrgRepo({ tenantId, repoId });
    const d = diagnostic ?? {};
    const sha = String(d.sha ?? 'mock');
    const mode = String(d.mode ?? 'full');
    await this._c.query(
      `INSERT INTO index_diagnostics (tenant_id, repo_id, sha, mode, diagnostic)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tenant_id, repo_id, sha, mode) DO UPDATE SET
         diagnostic=EXCLUDED.diagnostic,
         created_at=now()`,
      [tenantId, repoId, sha, mode, d]
    );
  }

  async listIndexDiagnostics({ tenantId, repoId, limit = 50 } = {}) {
    await this._ensureOrgRepo({ tenantId, repoId });
    const n = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.trunc(limit))) : 50;
    const res = await this._c.query(
      `SELECT diagnostic
       FROM index_diagnostics
       WHERE tenant_id=$1 AND repo_id=$2
       ORDER BY created_at DESC
       LIMIT $3`,
      [tenantId, repoId, n]
    );
    return Array.isArray(res.rows) ? res.rows.map((r) => r.diagnostic).filter(Boolean) : [];
  }

  async upsertFlowGraph({ tenantId, repoId, flowGraph }) {
    await this._ensureOrgRepo({ tenantId, repoId });
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

  async ingestRecords({ tenantId, repoId, records }) {
    await this._ensureOrgRepo({ tenantId, repoId });
    if (!Array.isArray(records)) throw new Error('records must be array');

    const hasFlowGraph = records.some((r) => r?.type === 'flow_graph');
    if (hasFlowGraph) throw new Error('flow_graph records must be ingested via upsertFlowGraph, not ingestRecords');

    const nodesByUid = new Map();
    const edgesByKey = new Map();
    const occByKey = new Map();
    const entrypointsByKey = new Map();
    const manifests = [];
    const declared = [];
    const observed = [];
    const mismatches = [];

    for (const r of records) {
      const t = r?.type;
      if (t === 'node') {
        if (r.data?.symbol_uid) nodesByUid.set(r.data.symbol_uid, r.data);
      } else if (t === 'edge') {
        const e = r.data;
        if (!e?.source_symbol_uid || !e?.target_symbol_uid || !e?.edge_type) continue;
        const k = `${e.source_symbol_uid}::${e.edge_type}::${e.target_symbol_uid}`;
        edgesByKey.set(k, e);
      } else if (t === 'edge_occurrence') {
        const o = r.data;
        if (!o?.source_symbol_uid || !o?.target_symbol_uid || !o?.edge_type || !o?.file_path) continue;
        const k = `${o.source_symbol_uid}::${o.edge_type}::${o.target_symbol_uid}::${o.file_path}::${o.line_start}::${o.line_end}`;
        occByKey.set(k, o);
      } else if (t === 'flow_entrypoint') {
        const ep = r.data;
        if (!ep?.entrypoint_key) continue;
        entrypointsByKey.set(ep.entrypoint_key, ep);
      }
      else if (t === 'dependency_manifest') manifests.push(r.data);
      else if (t === 'declared_dependency') declared.push(r.data);
      else if (t === 'observed_dependency') observed.push(r.data);
      else if (t === 'dependency_mismatch') mismatches.push(r.data);
      else if (t === 'index_diagnostic') this.addIndexDiagnostic({ tenantId, repoId, diagnostic: r.data });
    }

    const nodes = Array.from(nodesByUid.values());
    const edges = Array.from(edgesByKey.values());
    const occ = Array.from(occByKey.values());
    const entrypoints = Array.from(entrypointsByKey.values());

    await this._c.query('BEGIN');
    try {
      if (nodes.length) await this._bulkUpsertNodes({ tenantId, repoId, nodes });
      if (edges.length) await this._bulkUpsertEdges({ tenantId, repoId, edges });
      if (occ.length) await this._bulkUpsertEdgeOccurrences({ tenantId, repoId, occurrences: occ });
      if (entrypoints.length) await this._bulkUpsertFlowEntrypoints({ tenantId, repoId, entrypoints });
      for (const m of manifests) await this.addDependencyManifest({ tenantId, repoId, manifest: m });
      for (const d of declared) await this.addDeclaredDependency({ tenantId, repoId, declared: d });
      for (const o of observed) await this.addObservedDependency({ tenantId, repoId, observed: o });
      for (const mm of mismatches) await this.addDependencyMismatch({ tenantId, repoId, mismatch: mm });
      await this._c.query('COMMIT');
    } catch (err) {
      await this._c.query('ROLLBACK');
      throw err;
    }
  }

  async _bulkUpsertNodes({ tenantId, repoId, nodes }) {
    const payload = nodes.map((n) => ({
      ...n,
      node_key: n.node_key ?? null,
      file_path: n.file_path ?? null,
      embedding_vec: n.embedding ? toPgVectorLiteral(n.embedding) : null,
      first_seen_sha: n.first_seen_sha ?? null,
      last_seen_sha: n.last_seen_sha ?? null
    }));

    await this._c.query(
      `WITH data AS (
         SELECT * FROM jsonb_to_recordset($3::jsonb) AS x(
           symbol_uid text,
           qualified_name text,
           symbol_kind text,
           container_uid text,
           exported_name text,
           name text,
           node_type text,
           language text,
           file_path text,
           line_start int,
           line_end int,
           visibility text,
           signature text,
           signature_hash text,
           declaration text,
           docstring text,
           type_annotation text,
           return_type text,
           parameters jsonb,
           contract jsonb,
           constraints jsonb,
           allowable_values jsonb,
           external_ref jsonb,
           embedding_text text,
           embedding_vec text,
           first_seen_sha text,
           last_seen_sha text,
           node_key text
         )
       )
       INSERT INTO graph_nodes (
         tenant_id, repo_id, node_key, symbol_uid, qualified_name,
         symbol_kind, container_uid, exported_name,
         name, node_type, language, file_path, line_start, line_end, visibility,
         signature, signature_hash, declaration, docstring, type_annotation, return_type,
         parameters, contract, constraints, allowable_values, external_ref,
         embedding, embedding_text,
         first_seen_sha, last_seen_sha
       )
       SELECT
         $1, $2,
         COALESCE(x.node_key, x.symbol_uid),
         x.symbol_uid, x.qualified_name,
         x.symbol_kind, x.container_uid, x.exported_name,
         x.name, x.node_type, x.language, NULLIF(x.file_path, ''),
         x.line_start, x.line_end, x.visibility,
         x.signature, x.signature_hash, x.declaration, x.docstring, x.type_annotation, x.return_type,
         x.parameters, x.contract, x.constraints, x.allowable_values, x.external_ref,
         CASE WHEN x.embedding_vec IS NULL OR x.embedding_vec = '' THEN NULL ELSE x.embedding_vec::vector END,
         x.embedding_text,
         COALESCE(x.first_seen_sha, 'mock'),
         COALESCE(x.last_seen_sha, 'mock')
       FROM data x
       ON CONFLICT (tenant_id, repo_id, symbol_uid) DO UPDATE SET
         node_key=EXCLUDED.node_key,
         qualified_name=EXCLUDED.qualified_name,
         symbol_kind=EXCLUDED.symbol_kind,
         container_uid=EXCLUDED.container_uid,
         exported_name=EXCLUDED.exported_name,
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
         indexed_at=now()`,
      [tenantId, repoId, JSON.stringify(payload)]
    );
  }

  async _bulkUpsertEdges({ tenantId, repoId, edges }) {
    const payload = edges.map((e) => ({
      ...e,
      first_seen_sha: e.first_seen_sha ?? null,
      last_seen_sha: e.last_seen_sha ?? null
    }));

    await this._c.query(
      `WITH data AS (
         SELECT * FROM jsonb_to_recordset($3::jsonb) AS x(
           source_symbol_uid text,
           target_symbol_uid text,
           edge_type text,
           metadata jsonb,
           first_seen_sha text,
           last_seen_sha text
         )
       )
       INSERT INTO graph_edges (
         tenant_id, repo_id, source_node_id, target_node_id, edge_type, metadata, first_seen_sha, last_seen_sha
       )
       SELECT
         $1, $2,
         s.id, t.id,
         x.edge_type,
         x.metadata,
         COALESCE(x.first_seen_sha, 'mock'),
         COALESCE(x.last_seen_sha, 'mock')
       FROM data x
       JOIN graph_nodes s ON s.tenant_id=$1 AND s.repo_id=$2 AND s.symbol_uid=x.source_symbol_uid
       JOIN graph_nodes t ON t.tenant_id=$1 AND t.repo_id=$2 AND t.symbol_uid=x.target_symbol_uid
       ON CONFLICT (tenant_id, repo_id, source_node_id, target_node_id, edge_type) DO UPDATE SET
         metadata=EXCLUDED.metadata,
         last_seen_sha=EXCLUDED.last_seen_sha,
         indexed_at=now()`,
      [tenantId, repoId, JSON.stringify(payload)]
    );
  }

  async _bulkUpsertEdgeOccurrences({ tenantId, repoId, occurrences }) {
    const payload = occurrences.map((o) => ({
      ...o,
      sha: o.sha ?? null
    }));

    await this._c.query(
      `WITH data AS (
         SELECT * FROM jsonb_to_recordset($3::jsonb) AS x(
           source_symbol_uid text,
           target_symbol_uid text,
           edge_type text,
           file_path text,
           line_start int,
           line_end int,
           occurrence_kind text,
           sha text
         )
       )
       INSERT INTO graph_edge_occurrences (
         tenant_id, repo_id, edge_id, file_path, line_start, line_end, occurrence_kind, sha
       )
       SELECT
         $1, $2,
         e.id,
         x.file_path,
         x.line_start,
         x.line_end,
         COALESCE(x.occurrence_kind, 'other'),
         COALESCE(x.sha, 'mock')
       FROM data x
       JOIN graph_nodes s ON s.tenant_id=$1 AND s.repo_id=$2 AND s.symbol_uid=x.source_symbol_uid
       JOIN graph_nodes t ON t.tenant_id=$1 AND t.repo_id=$2 AND t.symbol_uid=x.target_symbol_uid
       JOIN graph_edges e ON e.tenant_id=$1 AND e.repo_id=$2 AND e.source_node_id=s.id AND e.target_node_id=t.id AND e.edge_type=x.edge_type
       ON CONFLICT (tenant_id, repo_id, edge_id, file_path, line_start, line_end) DO UPDATE SET
         occurrence_kind=EXCLUDED.occurrence_kind,
         sha=EXCLUDED.sha`,
      [tenantId, repoId, JSON.stringify(payload)]
    );
  }

  async _bulkUpsertFlowEntrypoints({ tenantId, repoId, entrypoints }) {
    const payload = entrypoints.map((ep) => ({ ...ep }));
    await this._c.query(
      `WITH data AS (
         SELECT * FROM jsonb_to_recordset($3::jsonb) AS x(
           entrypoint_key text,
           entrypoint_type text,
           method text,
           path text,
           symbol_uid text,
           file_path text,
           line_start int,
           line_end int
         )
       )
       INSERT INTO flow_entrypoints (
         tenant_id, repo_id, entrypoint_key, entrypoint_type, method, path, symbol_uid, file_path, line_start, line_end
       )
       SELECT
         $1, $2,
         x.entrypoint_key,
         x.entrypoint_type,
         x.method,
         x.path,
         x.symbol_uid,
         NULLIF(x.file_path, ''),
         x.line_start,
         x.line_end
       FROM data x
       ON CONFLICT (tenant_id, repo_id, entrypoint_key) DO UPDATE SET
         entrypoint_type=EXCLUDED.entrypoint_type,
         method=EXCLUDED.method,
         path=EXCLUDED.path,
         symbol_uid=EXCLUDED.symbol_uid,
         file_path=EXCLUDED.file_path,
         line_start=EXCLUDED.line_start,
         line_end=EXCLUDED.line_end,
         indexed_at=now()`,
      [tenantId, repoId, JSON.stringify(payload)]
    );
  }

  async _ensureOrgRepo({ tenantId, repoId }) {
    const k = `${tenantId}::${repoId}`;
    if (this._ensured.has(k)) return;
    await this._c.query(`INSERT INTO orgs (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [
      tenantId,
      'graphfly'
    ]);
    await this._c.query(
      `INSERT INTO repos (id, tenant_id, full_name, default_branch)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [repoId, tenantId, this._repoFullName, 'main']
    );
    this._ensured.add(k);
  }
}
