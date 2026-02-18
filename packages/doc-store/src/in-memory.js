import { hashString } from '../../cig/src/types.js';

function repoKey({ tenantId, repoId }) {
  return `${tenantId}::${repoId}`;
}

export class InMemoryDocStore {
  constructor() {
    this._blocks = new Map(); // repoKey -> Map(blockId -> block)
    this._evidence = new Map(); // repoKey -> Map(blockId -> evidence[])
    this._prRuns = new Map(); // repoKey -> Map(prRunId -> prRun)
  }

  getBlockByKey({ tenantId, repoId, docFile, blockAnchor }) {
    const rk = repoKey({ tenantId, repoId });
    const id = hashString(`${docFile}::${blockAnchor}`);
    return this._blocks.get(rk)?.get(id) ?? null;
  }

  upsertBlock({ tenantId, repoId, docFile, blockAnchor, blockType, content, status = 'fresh', lastIndexSha = null, lastPrId = null }) {
    const rk = repoKey({ tenantId, repoId });
    if (!this._blocks.has(rk)) this._blocks.set(rk, new Map());
    const id = hashString(`${docFile}::${blockAnchor}`);
    const block = {
      id,
      tenantId,
      repoId,
      docFile,
      blockAnchor,
      blockType,
      status,
      content,
      contentHash: hashString(content),
      lastIndexSha,
      lastPrId,
      updatedAt: Date.now()
    };
    this._blocks.get(rk).set(id, block);
    if (!this._evidence.has(rk)) this._evidence.set(rk, new Map());
    if (!this._evidence.get(rk).has(id)) this._evidence.get(rk).set(id, []);
    return block;
  }

  listBlocks({ tenantId, repoId, status = null } = {}) {
    const rk = repoKey({ tenantId, repoId });
    const blocks = Array.from(this._blocks.get(rk)?.values() ?? []);
    return status ? blocks.filter((b) => b.status === status) : blocks;
  }

  listBlocksBySymbolUid({ tenantId, repoId, symbolUid, limit = 200 } = {}) {
    const rk = repoKey({ tenantId, repoId });
    const uid = String(symbolUid ?? '').trim();
    if (!uid) return [];
    const n = Number.isFinite(limit) ? Math.max(1, Math.min(1000, Math.trunc(limit))) : 200;
    const blocks = Array.from(this._blocks.get(rk)?.values() ?? []);
    const out = [];
    for (const b of blocks) {
      const ev = this.getEvidence({ tenantId, repoId, blockId: b.id });
      if ((ev ?? []).some((e) => String(e?.symbolUid ?? '') === uid)) out.push(b);
    }
    return out
      .sort((a, b) => String(a.docFile ?? '').localeCompare(String(b.docFile ?? '')) || String(a.blockAnchor ?? '').localeCompare(String(b.blockAnchor ?? '')))
      .slice(0, n);
  }

  getBlock({ tenantId, repoId, blockId }) {
    const rk = repoKey({ tenantId, repoId });
    return this._blocks.get(rk)?.get(blockId) ?? null;
  }

  setEvidence({ tenantId, repoId, blockId, evidence }) {
    const rk = repoKey({ tenantId, repoId });
    if (!this._evidence.has(rk)) this._evidence.set(rk, new Map());
    this._evidence.get(rk).set(blockId, evidence ?? []);
  }

  getEvidence({ tenantId, repoId, blockId }) {
    const rk = repoKey({ tenantId, repoId });
    return Array.from(this._evidence.get(rk)?.get(blockId) ?? []);
  }

  markBlocksStaleForSymbolUids({ tenantId, repoId, symbolUids }) {
    const rk = repoKey({ tenantId, repoId });
    const blocks = this._blocks.get(rk);
    if (!blocks) return 0;
    const s = new Set(symbolUids ?? []);
    let count = 0;
    for (const b of blocks.values()) {
      if (b.status === 'locked') continue;
      const ev = this.getEvidence({ tenantId, repoId, blockId: b.id });
      if (ev.some((e) => s.has(e.symbolUid))) {
        b.status = 'stale';
        count++;
      }
    }
    return count;
  }

  createPrRun({ tenantId, repoId, triggerSha, status = 'pending' }) {
    const rk = repoKey({ tenantId, repoId });
    if (!this._prRuns.has(rk)) this._prRuns.set(rk, new Map());
    const id = hashString(`${triggerSha}:${Date.now()}:${Math.random()}`);
    const pr = { id, tenantId, repoId, triggerSha, status, startedAt: Date.now(), createdAt: Date.now() };
    this._prRuns.get(rk).set(id, pr);
    return pr;
  }

  updatePrRun({ tenantId, repoId, prRunId, patch }) {
    const rk = repoKey({ tenantId, repoId });
    const pr = this._prRuns.get(rk)?.get(prRunId) ?? null;
    if (!pr) return null;
    const p = patch ?? {};
    if (p.status !== undefined) pr.status = p.status;
    if (p.docsBranch !== undefined) pr.docsBranch = p.docsBranch;
    if (p.docsPrNumber !== undefined) pr.docsPrNumber = p.docsPrNumber;
    if (p.docsPrUrl !== undefined) pr.docsPrUrl = p.docsPrUrl;
    if (p.blocksUpdated !== undefined) pr.blocksUpdated = p.blocksUpdated;
    if (p.blocksCreated !== undefined) pr.blocksCreated = p.blocksCreated;
    if (p.blocksUnchanged !== undefined) pr.blocksUnchanged = p.blocksUnchanged;
    if (p.errorMessage !== undefined) pr.errorMessage = p.errorMessage;
    if (p.completedAt !== undefined) pr.completedAt = p.completedAt;
    return pr;
  }

  listPrRuns({ tenantId, repoId, status = null, limit = 50 } = {}) {
    const rk = repoKey({ tenantId, repoId });
    const runs = Array.from(this._prRuns.get(rk)?.values() ?? []);
    const filtered = status ? runs.filter((r) => r.status === status) : runs;
    const n = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.trunc(limit))) : 50;
    return filtered.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, n);
  }

  getPrRun({ tenantId, repoId, prRunId }) {
    const rk = repoKey({ tenantId, repoId });
    return this._prRuns.get(rk)?.get(prRunId) ?? null;
  }

  listDocFilesByPrRunId({ tenantId, repoId, prRunId } = {}) {
    if (!prRunId) return [];
    const rk = repoKey({ tenantId, repoId });
    const blocks = Array.from(this._blocks.get(rk)?.values() ?? []);
    const files = new Set();
    for (const b of blocks) {
      if (!b?.docFile) continue;
      if (String(b.lastPrId ?? '') === String(prRunId)) files.add(String(b.docFile));
    }
    return Array.from(files).sort((a, b) => a.localeCompare(b));
  }
}
