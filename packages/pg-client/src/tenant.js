function assertUuid(v, name) {
  if (typeof v !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
    throw new Error(`${name} must be a UUID string`);
  }
}

export async function withTenantClient({ pool, tenantId }, fn) {
  if (!pool || typeof pool.connect !== 'function') throw new Error('pool.connect is required');
  assertUuid(tenantId, 'tenantId');

  const client = await pool.connect();
  try {
    await client.query('SET app.tenant_id = $1', [tenantId]);
    return await fn(client);
  } finally {
    try {
      await client.query('RESET app.tenant_id');
    } catch {
      // ignore; releasing client is best-effort
    }
    client.release();
  }
}

