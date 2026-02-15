function assertUuid(v, name) {
  if (typeof v !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
    throw new Error(`${name} must be a UUID string`);
  }
}

export class PgRepoStore {
  constructor({ client } = {}) {
    if (!client || typeof client.query !== 'function') throw new Error('client.query is required');
    this._c = client;
  }

  async listRepos({ tenantId }) {
    assertUuid(tenantId, 'tenantId');
    const res = await this._c.query(
      `SELECT id, tenant_id, full_name, default_branch, github_repo_id
       FROM repos
       WHERE tenant_id=$1
       ORDER BY created_at DESC`,
      [tenantId]
    );
    return (res.rows ?? []).map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      fullName: r.full_name,
      defaultBranch: r.default_branch,
      githubRepoId: r.github_repo_id ?? null
    }));
  }

  async getRepo({ tenantId, repoId }) {
    assertUuid(tenantId, 'tenantId');
    assertUuid(repoId, 'repoId');
    const res = await this._c.query(
      `SELECT id, tenant_id, full_name, default_branch, github_repo_id
       FROM repos
       WHERE tenant_id=$1 AND id=$2
       LIMIT 1`,
      [tenantId, repoId]
    );
    const r = res.rows?.[0] ?? null;
    if (!r) return null;
    return {
      id: r.id,
      tenantId: r.tenant_id,
      fullName: r.full_name,
      defaultBranch: r.default_branch,
      githubRepoId: r.github_repo_id ?? null
    };
  }

  async findRepoByFullName({ fullName }) {
    if (typeof fullName !== 'string' || fullName.length === 0) throw new Error('fullName is required');
    const res = await this._c.query(
      `SELECT id, tenant_id, full_name, default_branch, github_repo_id
       FROM repos
       WHERE full_name=$1
       ORDER BY created_at DESC
       LIMIT 2`,
      [fullName]
    );
    const rows = res.rows ?? [];
    if (rows.length === 0) return null;
    if (rows.length > 1) throw new Error('ambiguous_repo_full_name');
    const r = rows[0];
    return {
      id: r.id,
      tenantId: r.tenant_id,
      fullName: r.full_name,
      defaultBranch: r.default_branch,
      githubRepoId: r.github_repo_id ?? null
    };
  }

  async findRepoByGitHubRepoId({ githubRepoId }) {
    const id = Number(githubRepoId);
    if (!Number.isFinite(id)) throw new Error('githubRepoId must be a number');
    const res = await this._c.query(
      `SELECT id, tenant_id, full_name, default_branch, github_repo_id
       FROM repos
       WHERE github_repo_id=$1
       ORDER BY created_at DESC
       LIMIT 2`,
      [Math.trunc(id)]
    );
    const rows = res.rows ?? [];
    if (rows.length === 0) return null;
    if (rows.length > 1) throw new Error('ambiguous_github_repo_id');
    const r = rows[0];
    return {
      id: r.id,
      tenantId: r.tenant_id,
      fullName: r.full_name,
      defaultBranch: r.default_branch,
      githubRepoId: r.github_repo_id ?? null
    };
  }

  async createRepo({ tenantId, fullName, defaultBranch = 'main', githubRepoId = null }) {
    assertUuid(tenantId, 'tenantId');
    if (typeof fullName !== 'string' || fullName.length === 0) throw new Error('fullName is required');
    const res = await this._c.query(
      `INSERT INTO repos (tenant_id, full_name, default_branch, github_repo_id)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id, full_name)
       DO UPDATE SET default_branch=EXCLUDED.default_branch, github_repo_id=EXCLUDED.github_repo_id
       RETURNING id`,
      [tenantId, fullName, defaultBranch ?? 'main', githubRepoId]
    );
    const id = res.rows?.[0]?.id ?? null;
    return this.getRepo({ tenantId, repoId: id });
  }

  async deleteRepo({ tenantId, repoId }) {
    assertUuid(tenantId, 'tenantId');
    assertUuid(repoId, 'repoId');
    const res = await this._c.query(`DELETE FROM repos WHERE tenant_id=$1 AND id=$2 RETURNING id`, [tenantId, repoId]);
    return { ok: true, deleted: Boolean(res.rows?.[0]?.id) };
  }
}
