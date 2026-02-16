import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { InMemoryGraphStore } from '../packages/cig/src/store.js';
import { InMemoryQueue } from '../packages/queue/src/in-memory.js';
import { InMemoryDocStore } from '../packages/doc-store/src/in-memory.js';
import { createIndexerWorker } from '../workers/indexer/src/indexer-worker.js';

function write(p, text) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, 'utf8');
}

test('builtin indexer indexes JS/TS + Python + package.json deps (auto mode fallback)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'graphfly-indexer-builtin-test-'));
  try {
    write(
      path.join(tmp, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } }, null, 2)
    );
    write(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 'x', version: '1.0.0', dependencies: { lodash: '^4.17.0', unusedpkg: '^1.0.0' } }, null, 2)
    );
    write(path.join(tmp, 'packages', 'a', 'package.json'), JSON.stringify({ name: 'a', dependencies: { lodash: '^4.0.0' } }, null, 2));
    write(path.join(tmp, 'packages', 'b', 'package.json'), JSON.stringify({ name: 'b', dependencies: { lodash: '^3.0.0' } }, null, 2));
    write(path.join(tmp, 'go.mod'), ['module example.com/foo', '', 'require (', '  github.com/gin-gonic/gin v1.9.1', ')'].join('\n'));
    write(path.join(tmp, 'Cargo.toml'), ['[package]', 'name="foo"', '', '[dependencies]', 'serde = "1.0"'].join('\n'));
    write(path.join(tmp, 'requirements.txt'), ['fastapi==0.100.0', 'requests>=2.0'].join('\n'));
    write(path.join(tmp, 'composer.json'), JSON.stringify({ require: { 'monolog/monolog': '^3.0' } }, null, 2));
    write(
      path.join(tmp, 'src', 'mod.ts'),
      [
        "import _ from 'lodash';",
        "import leftPad from 'left-pad';",
        "import { b } from './b';",
        "import * as bmod from './b';",
        "import { util } from '@/util';",
        '',
        'export function callB() { return b(); }',
        'export function callB2() { return bmod.b(); }',
        'export function callUtil() { return util(); }',
        '',
        '/**',
        " * Says hello.",
        " * @param {'formal'|'casual'} style - greeting style",
        ' */',
        "export function hello(style) { return style === 'formal' ? 'Hello' : 'Hi'; }",
        '',
        "app.get('/health', () => 'ok');"
      ].join('\n')
    );
    write(path.join(tmp, 'src', 'b.ts'), ['export function b() { return 1; }'].join('\n'));
    write(path.join(tmp, 'src', 'util.ts'), ['export function util() { return 2; }'].join('\n'));
    write(
      path.join(tmp, 'src', 'app.py'),
      [
        'from fastapi import FastAPI',
        'app = FastAPI()',
        '',
        "@app.get('/ping')",
        'def ping():',
        "    return {'ok': True}",
        '',
        'class Greeter:',
        '    pass'
      ].join('\n')
    );
    write(
      path.join(tmp, 'src', 'main.go'),
      ['package main', 'import "github.com/gin-gonic/gin"', 'func Hello() {}', 'type Thing struct {}'].join('\n')
    );
    write(path.join(tmp, 'src', 'lib.rs'), ['use serde::Serialize;', 'pub fn hi() {}', 'pub struct S {}'].join('\n'));
    write(path.join(tmp, 'src', 'A.java'), ['package a;', 'public class A { public void m() {} }'].join('\n'));
    write(path.join(tmp, 'src', 'B.cs'), ['using System;', 'public class B { public void M() {} }'].join('\n'));
    write(path.join(tmp, 'src', 'c.rb'), ['require \"json\"', 'class C; end', 'def f; end'].join('\n'));
    write(path.join(tmp, 'src', 'd.php'), ['<?php', 'class D {}', 'function f() {}'].join('\n'));

    const prevCmd = process.env.GRAPHFLY_INDEXER_CMD;
    const prevMode = process.env.GRAPHFLY_INDEXER_MODE;
    try {
      delete process.env.GRAPHFLY_INDEXER_CMD;
      delete process.env.GRAPHFLY_INDEXER_ARGS_JSON;
      process.env.GRAPHFLY_INDEXER_MODE = 'auto';

      const store = new InMemoryGraphStore();
      const docQueue = new InMemoryQueue('doc');
      const docStore = new InMemoryDocStore();
      const worker = createIndexerWorker({ store, docQueue, docStore });
      await worker.handle({
        payload: { tenantId: 't-1', repoId: 'r-1', repoRoot: tmp, sha: 's1', changedFiles: [], removedFiles: [], docsRepoFullName: 'org/docs' }
      });

      const nodes = await store.listNodes({ tenantId: 't-1', repoId: 'r-1' });
      const edges = await store.listEdges({ tenantId: 't-1', repoId: 'r-1' });
      const occs = await store.listEdgeOccurrences({ tenantId: 't-1', repoId: 'r-1' });
      const mismatches = await store.listDependencyMismatches({ tenantId: 't-1', repoId: 'r-1' });

      const fileB = nodes.find((n) => n.node_type === 'File' && n.file_path === 'src/b.ts');
      assert.ok(fileB, 'expected File node for src/b.ts');
      assert.ok(edges.some((e) => e.edge_type === 'Imports' && e.target_symbol_uid === fileB.symbol_uid), 'expected Imports edge to src/b.ts');
      const fileUtil = nodes.find((n) => n.node_type === 'File' && n.file_path === 'src/util.ts');
      assert.ok(fileUtil, 'expected File node for src/util.ts');
      assert.ok(edges.some((e) => e.edge_type === 'Imports' && e.target_symbol_uid === fileUtil.symbol_uid), 'expected Imports edge to src/util.ts via tsconfig paths');

      assert.ok(nodes.some((n) => n.node_type === 'Manifest' && n.file_path === 'package.json'));
      assert.ok(nodes.some((n) => n.node_type === 'Package' && n.qualified_name === 'npm:lodash'));
      assert.ok(nodes.some((n) => n.node_type === 'Package' && n.qualified_name === 'npm:left-pad'));
      assert.ok(nodes.some((n) => n.node_type === 'Package' && n.qualified_name === 'npm:unusedpkg'));
      assert.ok(nodes.some((n) => n.node_type === 'Manifest' && n.file_path === 'go.mod'));
      assert.ok(nodes.some((n) => n.node_type === 'Package' && n.qualified_name === 'go:github.com/gin-gonic/gin'));
      assert.ok(nodes.some((n) => n.node_type === 'Manifest' && n.file_path === 'Cargo.toml'));
      assert.ok(nodes.some((n) => n.node_type === 'Package' && n.qualified_name === 'cargo:serde'));
      assert.ok(nodes.some((n) => n.node_type === 'Manifest' && n.file_path === 'requirements.txt'));
      assert.ok(nodes.some((n) => n.node_type === 'Package' && n.qualified_name === 'pypi:fastapi'));
      assert.ok(nodes.some((n) => n.node_type === 'Manifest' && n.file_path === 'composer.json'));
      assert.ok(nodes.some((n) => n.node_type === 'Package' && n.qualified_name === 'composer:monolog/monolog'));
      assert.ok(nodes.some((n) => n.node_type === 'ApiEndpoint' && n.signature === 'GET /health'));
      assert.ok(nodes.some((n) => n.node_type === 'ApiEndpoint' && n.signature === 'GET /ping'));
      assert.ok(nodes.some((n) => n.node_type === 'Function' && n.name === 'hello' && n.file_path === 'src/mod.ts'));
      const callB = nodes.find((n) => n.node_type === 'Function' && n.name === 'callB' && n.file_path === 'src/mod.ts');
      const callB2 = nodes.find((n) => n.node_type === 'Function' && n.name === 'callB2' && n.file_path === 'src/mod.ts');
      const fnB = nodes.find((n) => n.node_type === 'Function' && n.name === 'b' && n.file_path === 'src/b.ts');
      assert.ok(callB && callB2 && fnB, 'expected Function nodes callB, callB2 and b');
      assert.ok(
        edges.some((e) => e.edge_type === 'Calls' && e.source_symbol_uid === callB.symbol_uid && e.target_symbol_uid === fnB.symbol_uid),
        'expected Calls edge callB -> b'
      );
      assert.ok(
        edges.some((e) => e.edge_type === 'Calls' && e.source_symbol_uid === callB2.symbol_uid && e.target_symbol_uid === fnB.symbol_uid),
        'expected Calls edge callB2 -> b (namespace import member call)'
      );
      assert.ok(
        occs.some(
          (o) =>
            o.edge_type === 'Calls' &&
            o.source_symbol_uid === callB.symbol_uid &&
            o.target_symbol_uid === fnB.symbol_uid &&
            o.file_path === 'src/mod.ts'
        ),
        'expected Calls edge_occurrence in src/mod.ts'
      );
      assert.ok(
        occs.some(
          (o) =>
            o.edge_type === 'Calls' &&
            o.source_symbol_uid === callB2.symbol_uid &&
            o.target_symbol_uid === fnB.symbol_uid &&
            o.file_path === 'src/mod.ts'
        ),
        'expected Calls edge_occurrence for callB2 in src/mod.ts'
      );
      assert.ok(nodes.some((n) => n.node_type === 'Class' && n.name === 'Greeter' && n.file_path === 'src/app.py'));
      assert.ok(nodes.some((n) => n.language === 'go' && n.name === 'Hello'));
      assert.ok(nodes.some((n) => n.language === 'rust' && n.name === 'hi'));
      assert.ok(nodes.some((n) => n.language === 'java' && n.name === 'A'));
      assert.ok(nodes.some((n) => n.language === 'csharp' && n.name === 'B'));
      assert.ok(nodes.some((n) => n.language === 'ruby' && n.name === 'C'));
      assert.ok(nodes.some((n) => n.language === 'php' && n.name === 'D'));

      assert.ok(edges.some((e) => e.edge_type === 'UsesPackage'));
      assert.ok(mismatches.some((m) => m.mismatch_type === 'used_but_undeclared' && m.package_key === 'npm:left-pad'));
      assert.ok(mismatches.some((m) => m.mismatch_type === 'declared_but_unused' && m.package_key === 'npm:unusedpkg'));
      assert.ok(mismatches.some((m) => m.mismatch_type === 'version_conflict' && m.package_key === 'npm:lodash'));
    } finally {
      if (prevCmd === undefined) delete process.env.GRAPHFLY_INDEXER_CMD;
      else process.env.GRAPHFLY_INDEXER_CMD = prevCmd;
      if (prevMode === undefined) delete process.env.GRAPHFLY_INDEXER_MODE;
      else process.env.GRAPHFLY_INDEXER_MODE = prevMode;
    }
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {}
  }
});
