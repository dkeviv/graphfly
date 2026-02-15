export class InMemoryOrgStore {
  constructor({ seed = null } = {}) {
    this._byId = new Map();
    if (seed && seed.id) this._byId.set(seed.id, { ...seed });
  }

  async ensureOrg({ tenantId, name = 'unknown' }) {
    if (!tenantId) throw new Error('tenantId is required');
    const existing = this._byId.get(tenantId);
    if (existing) return existing;
    const org = {
      id: tenantId,
      name,
      slug: null,
      displayName: null,
      plan: 'free',
      githubReaderInstallId: null,
      githubDocsInstallId: null,
      docsRepoFullName: null,
      stripeCustomerId: null
    };
    this._byId.set(tenantId, org);
    return org;
  }

  async getOrg({ tenantId }) {
    if (!tenantId) throw new Error('tenantId is required');
    return this._byId.get(tenantId) ?? null;
  }

  async upsertOrg({ tenantId, patch }) {
    if (!tenantId) throw new Error('tenantId is required');
    const prev =
      (await this.getOrg({ tenantId })) ??
      (await this.ensureOrg({ tenantId, name: patch?.name ?? 'unknown' }));
    const next = { ...prev };
    if (patch && typeof patch === 'object') {
      if (patch.slug !== undefined) next.slug = patch.slug ?? null;
      if (patch.displayName !== undefined) next.displayName = patch.displayName ?? null;
      if (patch.plan !== undefined) next.plan = patch.plan ?? prev.plan;
      if (patch.githubReaderInstallId !== undefined) next.githubReaderInstallId = patch.githubReaderInstallId ?? null;
      if (patch.githubDocsInstallId !== undefined) next.githubDocsInstallId = patch.githubDocsInstallId ?? null;
      if (patch.docsRepoFullName !== undefined) next.docsRepoFullName = patch.docsRepoFullName ?? null;
      if (patch.stripeCustomerId !== undefined) next.stripeCustomerId = patch.stripeCustomerId ?? null;
      if (patch.name !== undefined) next.name = patch.name ?? prev.name;
    }
    this._byId.set(tenantId, next);
    return next;
  }
}

