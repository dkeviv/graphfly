function assertUuid(v, name) {
  if (typeof v !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
    throw new Error(`${name} must be a UUID string`);
  }
}

export class PgSecretsStore {
  constructor({ client } = {}) {
    if (!client || typeof client.query !== 'function') throw new Error('client.query is required');
    this._c = client;
  }

  async setSecret({ tenantId, key, ciphertext }) {
    assertUuid(tenantId, 'tenantId');
    if (typeof key !== 'string' || key.length === 0) throw new Error('key is required');
    if (typeof ciphertext !== 'string' || ciphertext.length === 0) throw new Error('ciphertext is required');
    await this._c.query(
      `INSERT INTO org_secrets (org_id, key, ciphertext)
       VALUES ($1,$2,$3)
       ON CONFLICT (org_id, key)
       DO UPDATE SET ciphertext=EXCLUDED.ciphertext, updated_at=now()`,
      [tenantId, key, ciphertext]
    );
    return { ok: true };
  }

  async getSecret({ tenantId, key }) {
    assertUuid(tenantId, 'tenantId');
    if (typeof key !== 'string' || key.length === 0) throw new Error('key is required');
    const res = await this._c.query(
      `SELECT ciphertext
       FROM org_secrets
       WHERE org_id=$1 AND key=$2
       LIMIT 1`,
      [tenantId, key]
    );
    return res.rows?.[0]?.ciphertext ?? null;
  }

  async deleteSecret({ tenantId, key }) {
    assertUuid(tenantId, 'tenantId');
    if (typeof key !== 'string' || key.length === 0) throw new Error('key is required');
    await this._c.query(`DELETE FROM org_secrets WHERE org_id=$1 AND key=$2`, [tenantId, key]);
    return { ok: true };
  }
}

