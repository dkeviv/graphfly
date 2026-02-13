import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('migrations/001_init.sql contains core CIG tables + RLS + HNSW', () => {
  const sql = fs.readFileSync('migrations/001_init.sql', 'utf8');
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS graph_nodes'));
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS graph_edges'));
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS graph_edge_occurrences'));
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS doc_blocks'));
  assert.ok(sql.includes('ALTER TABLE graph_nodes ENABLE ROW LEVEL SECURITY'));
  assert.ok(sql.includes('USING hnsw'));
});

