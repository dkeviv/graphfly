import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('migrations/001_init.sql contains core CIG tables + RLS + HNSW', () => {
  const sql = fs.readFileSync('migrations/001_init.sql', 'utf8');
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS graph_nodes'));
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS graph_edges'));
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS graph_edge_occurrences'));
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS doc_blocks'));
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS index_diagnostics'));
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS org_billing'));
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS stripe_events'));
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS usage_counters'));
  assert.ok(sql.includes('ALTER TABLE graph_nodes ENABLE ROW LEVEL SECURITY'));
  assert.ok(sql.includes('ALTER TABLE graph_edge_occurrences ENABLE ROW LEVEL SECURITY'));
  assert.ok(sql.includes('ALTER TABLE flow_entrypoints ENABLE ROW LEVEL SECURITY'));
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS flow_graphs'));
  assert.ok(sql.includes('ALTER TABLE flow_graphs ENABLE ROW LEVEL SECURITY'));
  assert.ok(sql.includes('ALTER TABLE dependency_manifests ENABLE ROW LEVEL SECURITY'));
  assert.ok(sql.includes('ALTER TABLE index_diagnostics ENABLE ROW LEVEL SECURITY'));
  assert.ok(sql.includes('ALTER TABLE usage_counters ENABLE ROW LEVEL SECURITY'));
  assert.ok(sql.includes('FORCE ROW LEVEL SECURITY'));
  assert.ok(sql.includes('USING hnsw'));
});
