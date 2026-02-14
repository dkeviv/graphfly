import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createPgPool } from '../packages/pg-client/src/pool.js';
import { withTenantClient } from '../packages/pg-client/src/tenant.js';
import { applySqlMigration } from '../packages/migrations/src/apply.js';
import { PgGraphStore } from '../packages/cig-pg/src/pg-store.js';

function uuid() {
  return crypto.randomUUID();
}

test('pg live: RLS isolates tenants via app.tenant_id', async (t) => {
  const connectionString = process.env.DATABASE_URL ?? '';
  if (!connectionString) return t.skip('DATABASE_URL not set');

  // If pg dependency is missing, createPgPool will throw; treat as skip in this repo.
  let pool;
  try {
    pool = await createPgPool({ connectionString, max: 2 });
  } catch (err) {
    return t.skip(String(err?.message ?? err));
  }

  const schema = `graphfly_test_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
  const sqlText = fs.readFileSync('migrations/001_init.sql', 'utf8');

  // Apply migration into isolated schema (best-effort). Some managed DBs disallow CREATE EXTENSION; skip if so.
  const admin = await pool.connect();
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.query(`SET search_path TO ${schema}, public`);
    try {
      await applySqlMigration({ client: admin, sqlText });
    } catch (err) {
      t.skip(`migration failed (extensions/privileges?): ${String(err?.message ?? err)}`);
    }
  } finally {
    admin.release();
  }

  const tenantA = uuid();
  const tenantB = uuid();
  const repoA = uuid();
  const repoB = uuid();

  // Insert one node under tenant A.
  await withTenantClient({ pool, tenantId: tenantA, searchPath: `${schema}, public` }, async (client) => {
    const store = new PgGraphStore({ client, repoFullName: 'local/source' });
    await store.upsertNode({
      tenantId: tenantA,
      repoId: repoA,
      node: { symbol_uid: 'sym:A', node_type: 'File', qualified_name: 'a', file_path: 'a.js', line_start: 1, line_end: 1 }
    });
  });

  // Sanity: tenant A sees it via RLS even without tenant_id predicate.
  await withTenantClient({ pool, tenantId: tenantA, searchPath: `${schema}, public` }, async (client) => {
    const res = await client.query('SELECT count(*)::int as c FROM graph_nodes');
    assert.equal(res.rows[0].c, 1);
  });

  // Tenant B should not see tenant A rows.
  await withTenantClient({ pool, tenantId: tenantB, searchPath: `${schema}, public` }, async (client) => {
    const res = await client.query('SELECT count(*)::int as c FROM graph_nodes');
    assert.equal(res.rows[0].c, 0);
  });

  // Tenant B insert works independently.
  await withTenantClient({ pool, tenantId: tenantB, searchPath: `${schema}, public` }, async (client) => {
    const store = new PgGraphStore({ client, repoFullName: 'local/source' });
    await store.upsertNode({
      tenantId: tenantB,
      repoId: repoB,
      node: { symbol_uid: 'sym:B', node_type: 'File', qualified_name: 'b', file_path: 'b.js', line_start: 1, line_end: 1 }
    });
    const res = await client.query('SELECT count(*)::int as c FROM graph_nodes');
    assert.equal(res.rows[0].c, 1);
  });

  // Cleanup (best-effort).
  const cleanup = await pool.connect();
  try {
    await cleanup.query(`DROP SCHEMA ${schema} CASCADE`);
  } catch {
    // ignore
  } finally {
    cleanup.release();
    await pool.close();
  }
});
