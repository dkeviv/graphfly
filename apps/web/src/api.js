export class ApiClient {
  constructor({ apiUrl, tenantId, repoId, mode }) {
    this.apiUrl = apiUrl;
    this.tenantId = tenantId;
    this.repoId = repoId;
    this.mode = mode;
  }

  async getJson(path) {
    const url = new URL(path, this.apiUrl);
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  search({ q, mode }) {
    return this.getJson(`/graph/search?tenantId=${encodeURIComponent(this.tenantId)}&repoId=${encodeURIComponent(this.repoId)}&q=${encodeURIComponent(q)}&mode=${encodeURIComponent(mode)}`);
  }

  blastRadius({ symbolUid, depth = 1, direction = 'both' }) {
    return this.getJson(
      `/graph/blast-radius?tenantId=${encodeURIComponent(this.tenantId)}&repoId=${encodeURIComponent(this.repoId)}&symbolUid=${encodeURIComponent(symbolUid)}&depth=${encodeURIComponent(String(depth))}&direction=${encodeURIComponent(direction)}&mode=${encodeURIComponent(this.mode)}`
    );
  }

  contractsGet({ symbolUid }) {
    return this.getJson(
      `/contracts/get?tenantId=${encodeURIComponent(this.tenantId)}&repoId=${encodeURIComponent(this.repoId)}&symbolUid=${encodeURIComponent(symbolUid)}`
    );
  }

  listDocBlocks({ status = null } = {}) {
    const s = status ? `&status=${encodeURIComponent(status)}` : '';
    return this.getJson(`/docs/blocks?tenantId=${encodeURIComponent(this.tenantId)}&repoId=${encodeURIComponent(this.repoId)}${s}`);
  }

  getDocBlock({ blockId }) {
    return this.getJson(`/docs/block?tenantId=${encodeURIComponent(this.tenantId)}&repoId=${encodeURIComponent(this.repoId)}&blockId=${encodeURIComponent(blockId)}`);
  }
}
