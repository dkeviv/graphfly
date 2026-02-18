import { hashString } from '../../cig/src/types.js';

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

function coerceEvidenceRow(e) {
  return {
    symbol_uid: String(e?.symbolUid ?? e?.symbol_uid ?? ''),
    qualified_name: e?.qualifiedName ?? e?.qualified_name ?? null,
    file_path: e?.filePath ?? e?.file_path ?? null,
    line_start: Number.isFinite(e?.lineStart) ? Math.trunc(e.lineStart) : e?.line_start ?? null,
    line_end: Number.isFinite(e?.lineEnd) ? Math.trunc(e.lineEnd) : e?.line_end ?? null,
    sha: e?.sha ?? 'mock',
    contract_hash: e?.contractHash ?? e?.contract_hash ?? null,
    evidence_kind: e?.evidenceKind ?? e?.evidence_kind ?? 'contract_location',
    evidence_weight: Number.isFinite(e?.evidenceWeight) ? Number(e.evidenceWeight) : e?.evidence_weight ?? 1.0
  };
}

export class PgDocStore {
  constructor({ client, repoFullName = 'local/unknown' }) {
    if (!client || typeof client.query !== 'function') throw new Error('client.query is required');
    this._c = client;
    this._repoFullName = repoFullName;
    this._ensured = new Set(); // tenant::repo
  }

  _rk({ tenantId, repoId }) {
    return `${tenantId}::${repoId}`;
  }

  async _ensureOrgRepo({ tenantId, repoId }) {
    const k = this._rk({ tenantId, repoId });
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

  async upsertBlock({ tenantId, repoId, docFile, blockAnchor, blockType, content, status = 'fresh', lastIndexSha = null, lastPrId = null }) {
    await this._ensureOrgRepo({ tenantId, repoId });
    if (!isNonEmptyString(docFile)) throw new Error('docFile required');
    if (!isNonEmptyString(blockAnchor)) throw new Error('blockAnchor required');
    if (!isNonEmptyString(blockType)) throw new Error('blockType required');
    if (!isNonEmptyString(content)) throw new Error('content required');

    const contentHash = hashString(content);
    const res = await this._c.query(
      `INSERT INTO doc_blocks (
        tenant_id, repo_id, doc_file, block_anchor, block_type, status, content, content_hash, last_index_sha, last_pr_id
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
      )
      ON CONFLICT (tenant_id, repo_id, doc_file, block_anchor) DO UPDATE SET
        block_type=EXCLUDED.block_type,
        status=EXCLUDED.status,
        content=EXCLUDED.content,
        content_hash=EXCLUDED.content_hash,
        last_index_sha=COALESCE(EXCLUDED.last_index_sha, doc_blocks.last_index_sha),
        last_pr_id=COALESCE(EXCLUDED.last_pr_id, doc_blocks.last_pr_id),
        updated_at=now()
      RETURNING *`,
      [tenantId, repoId, docFile, blockAnchor, blockType, status, content, contentHash, lastIndexSha, lastPrId]
    );
    return res.rows?.[0] ?? null;
  }

  async listBlocks({ tenantId, repoId, status = null } = {}) {
    await this._ensureOrgRepo({ tenantId, repoId });
    if (status) {
      const res = await this._c.query(
        `SELECT * FROM doc_blocks WHERE tenant_id=$1 AND repo_id=$2 AND status=$3 ORDER BY doc_file ASC, block_anchor ASC`,
        [tenantId, repoId, status]
      );
      return Array.isArray(res.rows) ? res.rows : [];
    }
    const res = await this._c.query(`SELECT * FROM doc_blocks WHERE tenant_id=$1 AND repo_id=$2 ORDER BY doc_file ASC, block_anchor ASC`, [
      tenantId,
      repoId
    ]);
    return Array.isArray(res.rows) ? res.rows : [];
  }

  async listBlocksBySymbolUid({ tenantId, repoId, symbolUid, limit = 200 } = {}) {
    await this._ensureOrgRepo({ tenantId, repoId });
    if (!isNonEmptyString(symbolUid)) throw new Error('symbolUid required');
    const n = Number.isFinite(limit) ? Math.max(1, Math.min(1000, Math.trunc(limit))) : 200;
    const res = await this._c.query(
      `SELECT DISTINCT db.*
       FROM doc_blocks db
       JOIN doc_evidence de ON de.doc_block_id=db.id
       WHERE db.tenant_id=$1 AND db.repo_id=$2 AND de.symbol_uid=$3
       ORDER BY db.doc_file ASC, db.block_anchor ASC
       LIMIT $4`,
      [tenantId, repoId, String(symbolUid), n]
    );
    return Array.isArray(res.rows) ? res.rows : [];
  }

  async getBlockByKey({ tenantId, repoId, docFile, blockAnchor }) {
    await this._ensureOrgRepo({ tenantId, repoId });
    if (!isNonEmptyString(docFile)) throw new Error('docFile required');
    if (!isNonEmptyString(blockAnchor)) throw new Error('blockAnchor required');
    const res = await this._c.query(
      `SELECT * FROM doc_blocks WHERE tenant_id=$1 AND repo_id=$2 AND doc_file=$3 AND block_anchor=$4 LIMIT 1`,
      [tenantId, repoId, docFile, blockAnchor]
    );
    return res.rows?.[0] ?? null;
  }

  async getBlock({ tenantId, repoId, blockId }) {
    await this._ensureOrgRepo({ tenantId, repoId });
    const res = await this._c.query(`SELECT * FROM doc_blocks WHERE tenant_id=$1 AND repo_id=$2 AND id=$3 LIMIT 1`, [
      tenantId,
      repoId,
      blockId
    ]);
    return res.rows?.[0] ?? null;
  }

  async setEvidence({ tenantId, repoId, blockId, evidence }) {
    await this._ensureOrgRepo({ tenantId, repoId });
    await this._c.query(`DELETE FROM doc_evidence WHERE tenant_id=$1 AND repo_id=$2 AND doc_block_id=$3`, [tenantId, repoId, blockId]);

    const ev = Array.isArray(evidence) ? evidence.map(coerceEvidenceRow).filter((e) => isNonEmptyString(e.symbol_uid)) : [];
    if (ev.length === 0) return { ok: true, count: 0 };

    const symbolUids = Array.from(new Set(ev.map((e) => e.symbol_uid)));
    const nodeRes = await this._c.query(
      `SELECT id, symbol_uid, qualified_name
       FROM graph_nodes
       WHERE tenant_id=$1 AND repo_id=$2 AND symbol_uid = ANY($3::text[])`,
      [tenantId, repoId, symbolUids]
    );
    const nodeByUid = new Map((nodeRes.rows ?? []).map((r) => [r.symbol_uid, r]));

    const payload = ev.map((e) => {
      const n = nodeByUid.get(e.symbol_uid) ?? null;
      return {
        node_id: n?.id ?? null,
        symbol_uid: e.symbol_uid,
        qualified_name: e.qualified_name ?? n?.qualified_name ?? null,
        file_path: e.file_path ?? null,
        line_start: e.line_start ?? null,
        line_end: e.line_end ?? null,
        sha: e.sha ?? 'mock',
        contract_hash: e.contract_hash ?? null,
        evidence_kind: e.evidence_kind ?? 'contract_location',
        evidence_weight: e.evidence_weight ?? 1.0
      };
    });

    await this._c.query(
      `WITH data AS (
         SELECT * FROM jsonb_to_recordset($4::jsonb) AS x(
           node_id uuid,
           symbol_uid text,
           qualified_name text,
           file_path text,
           line_start int,
           line_end int,
           sha text,
           contract_hash text,
           evidence_kind text,
           evidence_weight numeric
         )
       )
       INSERT INTO doc_evidence (
         tenant_id, repo_id, doc_block_id, node_id, symbol_uid, qualified_name,
         file_path, line_start, line_end, sha, contract_hash, evidence_kind, evidence_weight
       )
       SELECT
         $1, $2, $3,
         x.node_id, x.symbol_uid, x.qualified_name,
         NULLIF(x.file_path, ''), x.line_start, x.line_end, x.sha, x.contract_hash, x.evidence_kind, x.evidence_weight
       FROM data x`,
      [tenantId, repoId, blockId, JSON.stringify(payload)]
    );

    return { ok: true, count: payload.length };
  }

  async getEvidence({ tenantId, repoId, blockId }) {
    await this._ensureOrgRepo({ tenantId, repoId });
    const res = await this._c.query(
      `SELECT symbol_uid, qualified_name, file_path, line_start, line_end, sha, evidence_kind, evidence_weight
       FROM doc_evidence
       WHERE tenant_id=$1 AND repo_id=$2 AND doc_block_id=$3
       ORDER BY evidence_weight DESC, symbol_uid ASC`,
      [tenantId, repoId, blockId]
    );
    return Array.isArray(res.rows) ? res.rows : [];
  }

  async markBlocksStaleForSymbolUids({ tenantId, repoId, symbolUids }) {
    await this._ensureOrgRepo({ tenantId, repoId });
    const uids = Array.isArray(symbolUids) ? symbolUids.filter(isNonEmptyString) : [];
    if (uids.length === 0) return 0;
    const res = await this._c.query(
      `WITH candidates AS (
         SELECT DISTINCT db.id
         FROM doc_blocks db
         JOIN doc_evidence de ON de.doc_block_id=db.id
         WHERE db.tenant_id=$1 AND db.repo_id=$2
           AND db.status <> 'locked'
           AND de.symbol_uid = ANY($3::text[])
       )
       UPDATE doc_blocks db
       SET status='stale', updated_at=now()
       FROM candidates c
       WHERE db.id=c.id AND db.status <> 'stale'
       RETURNING db.id`,
      [tenantId, repoId, uids]
    );
    return Array.isArray(res.rows) ? res.rows.length : 0;
  }

  async createPrRun({ tenantId, repoId, triggerSha, status = 'pending' }) {
    await this._ensureOrgRepo({ tenantId, repoId });
    if (!isNonEmptyString(triggerSha)) throw new Error('triggerSha required');
    const res = await this._c.query(
      `INSERT INTO pr_runs (tenant_id, repo_id, trigger_sha, status, started_at)
       VALUES ($1,$2,$3,$4, now())
       RETURNING *`,
      [tenantId, repoId, triggerSha, status]
    );
    return res.rows?.[0] ?? null;
  }

  async updatePrRun({ tenantId, repoId, prRunId, patch }) {
    await this._ensureOrgRepo({ tenantId, repoId });
    const allowed = {
      status: 'status',
      docsBranch: 'docs_branch',
      docsPrNumber: 'docs_pr_number',
      docsPrUrl: 'docs_pr_url',
      blocksUpdated: 'blocks_updated',
      blocksCreated: 'blocks_created',
      blocksUnchanged: 'blocks_unchanged',
      errorMessage: 'error_message',
      completedAt: 'completed_at'
    };

    const sets = [];
    const params = [tenantId, repoId, prRunId];
    for (const [k, col] of Object.entries(allowed)) {
      if (patch?.[k] === undefined) continue;
      params.push(patch[k]);
      sets.push(`${col} = $${params.length}`);
    }
    if (sets.length === 0) return null;

    const res = await this._c.query(
      `UPDATE pr_runs SET ${sets.join(', ')}
       WHERE tenant_id=$1 AND repo_id=$2 AND id=$3
       RETURNING *`,
      params
    );
    return res.rows?.[0] ?? null;
  }

  async listPrRuns({ tenantId, repoId, status = null, limit = 50 } = {}) {
    await this._ensureOrgRepo({ tenantId, repoId });
    const n = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.trunc(limit))) : 50;
    if (status) {
      const res = await this._c.query(
        `SELECT * FROM pr_runs WHERE tenant_id=$1 AND repo_id=$2 AND status=$3 ORDER BY created_at DESC LIMIT $4`,
        [tenantId, repoId, status, n]
      );
      return Array.isArray(res.rows) ? res.rows : [];
    }
    const res = await this._c.query(`SELECT * FROM pr_runs WHERE tenant_id=$1 AND repo_id=$2 ORDER BY created_at DESC LIMIT $3`, [
      tenantId,
      repoId,
      n
    ]);
    return Array.isArray(res.rows) ? res.rows : [];
  }

  async getPrRun({ tenantId, repoId, prRunId }) {
    await this._ensureOrgRepo({ tenantId, repoId });
    const res = await this._c.query(`SELECT * FROM pr_runs WHERE tenant_id=$1 AND repo_id=$2 AND id=$3 LIMIT 1`, [
      tenantId,
      repoId,
      prRunId
    ]);
    return res.rows?.[0] ?? null;
  }

  async listDocFilesByPrRunId({ tenantId, repoId, prRunId } = {}) {
    await this._ensureOrgRepo({ tenantId, repoId });
    if (!isNonEmptyString(prRunId)) return [];
    const res = await this._c.query(
      `SELECT DISTINCT doc_file
       FROM doc_blocks
       WHERE tenant_id=$1 AND repo_id=$2 AND last_pr_id=$3
       ORDER BY doc_file ASC`,
      [tenantId, repoId, prRunId]
    );
    return Array.isArray(res.rows) ? res.rows.map((r) => r.doc_file).filter(isNonEmptyString) : [];
  }
}
