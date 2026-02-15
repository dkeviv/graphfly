export class InMemoryRepoStore {
  constructor() {
    this._byId = new Map(); // repoId -> repo
    this._byFullName = new Map(); // tenantId::fullName -> repoId
  }

  _fk({ tenantId, fullName }) {
    return `${tenantId}::${String(fullName ?? '')}`;
  }

  async listRepos({ tenantId }) {
    if (!tenantId) throw new Error('tenantId is required');
    return Array.from(this._byId.values()).filter((r) => r.tenantId === tenantId);
  }

  async getRepo({ tenantId, repoId }) {
    if (!tenantId || !repoId) throw new Error('tenantId and repoId are required');
    const r = this._byId.get(repoId) ?? null;
    if (!r || r.tenantId !== tenantId) return null;
    return r;
  }

  async findRepoByFullName({ fullName }) {
    if (!fullName) throw new Error('fullName is required');
    // In-memory store has no global index; scan.
    const match = Array.from(this._byId.values()).filter((r) => r.fullName === fullName);
    if (match.length === 0) return null;
    if (match.length > 1) throw new Error('ambiguous_repo_full_name');
    return match[0];
  }

  async createRepo({ tenantId, repoId, fullName, defaultBranch = 'main', githubRepoId = null }) {
    if (!tenantId || !repoId || !fullName) throw new Error('tenantId, repoId, fullName are required');
    const fk = this._fk({ tenantId, fullName });
    if (this._byFullName.has(fk)) throw new Error('repo_already_exists');
    const repo = { id: repoId, tenantId, fullName, defaultBranch, githubRepoId };
    this._byId.set(repoId, repo);
    this._byFullName.set(fk, repoId);
    return repo;
  }

  async deleteRepo({ tenantId, repoId }) {
    const repo = await this.getRepo({ tenantId, repoId });
    if (!repo) return { ok: true, deleted: false };
    this._byId.delete(repoId);
    this._byFullName.delete(this._fk({ tenantId, fullName: repo.fullName }));
    return { ok: true, deleted: true };
  }
}

