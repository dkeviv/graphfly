function assertUuid(v, name) {
  if (typeof v !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
    throw new Error(`${name} must be a UUID string`);
  }
}

function normalizePlan(v) {
  const s = String(v ?? '').toLowerCase();
  if (s === 'free' || s === 'pro' || s === 'enterprise') return s;
  return 'free';
}

export class PgOrgStore {
  constructor({ client } = {}) {
    if (!client || typeof client.query !== 'function') throw new Error('client.query is required');
    this._c = client;
  }

  async ensureOrg({ tenantId, name = 'unknown' }) {
    assertUuid(tenantId, 'tenantId');
    await this._c.query(`INSERT INTO orgs (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [
      tenantId,
      String(name ?? 'unknown')
    ]);
    return this.getOrg({ tenantId });
  }

  async getOrg({ tenantId }) {
    assertUuid(tenantId, 'tenantId');
    const res = await this._c.query(
      `SELECT id, name, slug, display_name, plan, github_reader_install_id, github_docs_install_id, docs_repo_full_name, stripe_customer_id
       FROM orgs
       WHERE id=$1
       LIMIT 1`,
      [tenantId]
    );
    const row = res.rows?.[0] ?? null;
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      slug: row.slug ?? null,
      displayName: row.display_name ?? null,
      plan: normalizePlan(row.plan),
      githubReaderInstallId: row.github_reader_install_id ?? null,
      githubDocsInstallId: row.github_docs_install_id ?? null,
      docsRepoFullName: row.docs_repo_full_name ?? null,
      stripeCustomerId: row.stripe_customer_id ?? null
    };
  }

  async upsertOrg({ tenantId, patch }) {
    assertUuid(tenantId, 'tenantId');
    const p = patch && typeof patch === 'object' ? patch : {};
    await this.ensureOrg({ tenantId, name: p.name ?? 'unknown' });

    const plan = p.plan !== undefined ? normalizePlan(p.plan) : null;

    await this._c.query(
      `UPDATE orgs
       SET
         name=COALESCE($2, name),
         slug=COALESCE($3, slug),
         display_name=COALESCE($4, display_name),
         plan=COALESCE($5, plan),
         github_reader_install_id=COALESCE($6, github_reader_install_id),
         github_docs_install_id=COALESCE($7, github_docs_install_id),
         docs_repo_full_name=COALESCE($8, docs_repo_full_name),
         stripe_customer_id=COALESCE($9, stripe_customer_id),
         updated_at=now()
       WHERE id=$1`,
      [
        tenantId,
        p.name !== undefined ? (p.name ?? null) : null,
        p.slug !== undefined ? (p.slug ?? null) : null,
        p.displayName !== undefined ? (p.displayName ?? null) : null,
        p.plan !== undefined ? plan : null,
        p.githubReaderInstallId !== undefined ? (p.githubReaderInstallId ?? null) : null,
        p.githubDocsInstallId !== undefined ? (p.githubDocsInstallId ?? null) : null,
        p.docsRepoFullName !== undefined ? (p.docsRepoFullName ?? null) : null,
        p.stripeCustomerId !== undefined ? (p.stripeCustomerId ?? null) : null
      ]
    );

    return this.getOrg({ tenantId });
  }
}

