export class InMemoryRepoRegistry {
  constructor() {
    this._byFullName = new Map(); // fullName -> { tenantId, repoId, repoRoot, docsRepoFullName }
  }

  register({ fullName, tenantId, repoId, repoRoot, docsRepoFullName }) {
    if (!fullName || !tenantId || !repoId) throw new Error('fullName, tenantId, repoId are required');
    this._byFullName.set(fullName, { fullName, tenantId, repoId, repoRoot, docsRepoFullName });
  }

  get(fullName) {
    return this._byFullName.get(fullName) ?? null;
  }
}

