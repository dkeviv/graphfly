import fs from 'node:fs';
import path from 'node:path';
import { computeSignatureHash, makeSymbolUid } from '../../../packages/cig/src/identity.js';
import { embedText384 } from '../../../packages/cig/src/embedding.js';

function isSourceFile(filePath) {
  return filePath.endsWith('.js') || filePath.endsWith('.ts') || filePath.endsWith('.tsx') || filePath.endsWith('.jsx');
}

function isManifestFile(filePath) {
  return filePath.endsWith('package.json');
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.git')) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function rel(root, p) {
  return p.startsWith(root) ? p.slice(root.length + 1) : p;
}

function parseImports(lines) {
  const imports = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^\s*import\s+(.+?)\s+from\s+['"](.+?)['"]\s*;?\s*$/);
    if (!m) continue;
    const binding = m[1];
    const spec = m[2];
    const names = [];
    const named = binding.match(/\{([^}]+)\}/);
    if (named) {
      for (const part of named[1].split(',')) {
        const n = part.trim().split(/\s+as\s+/i)[0]?.trim();
        if (n) names.push(n);
      }
    } else {
      const def = binding.trim().split(',')[0]?.trim();
      if (def && def !== '*') names.push(def);
    }
    imports.push({ spec, names, line: i + 1 });
  }
  return imports;
}

function parseExpressRoutes(lines) {
  const routes = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/\bapp\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/);
    if (m) routes.push({ method: m[1].toUpperCase(), path: m[2], line: i + 1 });
  }
  return routes;
}

function resolveImport(fromFileRel, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFileRel), spec));
  return `${base}.js`;
}

function packageNameFromImport(spec) {
  if (!spec || spec.startsWith('.') || spec.startsWith('/')) return null;
  if (spec.startsWith('@')) {
    const parts = spec.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : spec;
  }
  return spec.split('/')[0];
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function makePackageNode({ ecosystem, name }) {
  const qualifiedName = `${ecosystem}:${name}`;
  const signature = `package ${qualifiedName}`;
  const signatureHash = computeSignatureHash({ signature });
  const symbolUid = makeSymbolUid({ language: 'pkg', qualifiedName, signatureHash });
  return {
    symbol_uid: symbolUid,
    qualified_name: qualifiedName,
    name,
    node_type: 'Package',
    file_path: '',
    line_start: 1,
    line_end: 1,
    language: 'external',
    visibility: 'public',
    signature,
    signature_hash: signatureHash,
    contract: null,
    constraints: null,
    allowable_values: null,
    external_ref: { ecosystem, name }
  };
}

function makeManifestNode({ filePath }) {
  const qualifiedName = `manifest:${filePath}`;
  const signature = `manifest ${filePath}`;
  const signatureHash = computeSignatureHash({ signature });
  const symbolUid = makeSymbolUid({ language: 'manifest', qualifiedName, signatureHash });
  return {
    symbol_uid: symbolUid,
    qualified_name: qualifiedName,
    name: path.basename(filePath),
    node_type: 'Manifest',
    file_path: filePath,
    line_start: 1,
    line_end: 1,
    language: 'manifest',
    visibility: 'internal',
    signature,
    signature_hash: signatureHash,
    contract: null,
    constraints: null,
    allowable_values: null
  };
}

function makeFileNode({ filePath, language }) {
  const qualifiedName = filePath.replaceAll('/', '.');
  const signature = `file ${filePath}`;
  const signatureHash = computeSignatureHash({ signature });
  const symbolUid = makeSymbolUid({ language, qualifiedName, signatureHash });
  return {
    symbol_uid: symbolUid,
    qualified_name: qualifiedName,
    name: path.basename(filePath),
    node_type: 'File',
    file_path: filePath,
    line_start: 1,
    line_end: 1,
    language,
    visibility: 'internal',
    signature,
    signature_hash: signatureHash,
    contract: null,
    constraints: null,
    allowable_values: null,
    embedding_text: `${qualifiedName} ${signature}`,
    embedding: embedText384(`${qualifiedName} ${signature}`)
  };
}

function makeApiEndpointNode({ method, routePath, filePath, line }) {
  const qualifiedName = `http.${method}.${routePath}`;
  const signature = `${method} ${routePath}`;
  const signatureHash = computeSignatureHash({ signature });
  const symbolUid = makeSymbolUid({ language: 'http', qualifiedName, signatureHash });
  return {
    symbol_uid: symbolUid,
    qualified_name: qualifiedName,
    name: signature,
    node_type: 'ApiEndpoint',
    file_path: filePath,
    line_start: line,
    line_end: line,
    language: 'http',
    visibility: 'public',
    signature,
    signature_hash: signatureHash,
    contract: { kind: 'http_route', method, path: routePath },
    constraints: null,
    allowable_values: null,
    embedding_text: `${signature} endpoint`,
    embedding: embedText384(`${signature} endpoint`)
  };
}

export function mockIndexRepo({
  repoRoot,
  language = 'js',
  sha = 'mock',
  emit = (record) => process.stdout.write(JSON.stringify(record) + '\n')
}) {
  const absRoot = path.resolve(repoRoot);
  const allFiles = walk(absRoot);
  const sourceFiles = allFiles.filter(isSourceFile);
  const manifestFiles = allFiles.filter(isManifestFile);

  emit({
    type: 'index_diagnostic',
    data: {
      sha,
      mode: 'full',
      reparsed_files: sourceFiles.map((p) => rel(absRoot, p)),
      impacted_files: [],
      note: 'mock indexer always performs a full parse'
    }
  });

  const fileToSymbol = new Map(); // file_path -> symbol_uid
  const packageToSymbol = new Map(); // package_key -> symbol_uid
  const declaredPackages = new Set(); // package_key
  const observedPackages = new Map(); // package_key -> Set(file_path)

  for (const absFile of sourceFiles) {
    const filePath = rel(absRoot, absFile);
    const node = makeFileNode({ filePath, language });
    fileToSymbol.set(filePath, node.symbol_uid);
    emit({ type: 'node', data: node });
  }

  for (const absManifest of manifestFiles) {
    const filePath = rel(absRoot, absManifest);
    const manifestNode = makeManifestNode({ filePath });
    emit({ type: 'node', data: manifestNode });

    emit({
      type: 'dependency_manifest',
      data: {
        file_path: filePath,
        sha,
        manifest_type: 'package.json',
        manifest_key: `${filePath}::${sha}`
      }
    });

    const pkg = safeJsonParse(fs.readFileSync(absManifest, 'utf8')) ?? {};
    const deps = Object.entries(pkg.dependencies ?? {});
    const devDeps = Object.entries(pkg.devDependencies ?? {});

    const declared = [
      ...deps.map(([name, range]) => ({ name, range, scope: 'prod' })),
      ...devDeps.map(([name, range]) => ({ name, range, scope: 'dev' }))
    ];

    for (const d of declared) {
      const packageKey = `npm:${d.name}`;
      declaredPackages.add(packageKey);

      emit({
        type: 'declared_dependency',
        data: {
          manifest_key: `${filePath}::${sha}`,
          package_key: packageKey,
          scope: d.scope,
          version_range: d.range
        }
      });

      if (!packageToSymbol.has(packageKey)) {
        const pkgNode = makePackageNode({ ecosystem: 'npm', name: d.name });
        packageToSymbol.set(packageKey, pkgNode.symbol_uid);
        emit({ type: 'node', data: pkgNode });
      }

      emit({
        type: 'edge',
        data: {
          source_symbol_uid: manifestNode.symbol_uid,
          target_symbol_uid: packageToSymbol.get(packageKey),
          edge_type: 'DependsOn',
          metadata: { declared: true, scope: d.scope, version_range: d.range }
        }
      });
    }
  }

  for (const absFile of sourceFiles) {
    const filePath = rel(absRoot, absFile);
    const sourceUid = fileToSymbol.get(filePath);
    const lines = fs.readFileSync(absFile, 'utf8').split('\n');

    for (const r of parseExpressRoutes(lines)) {
      const epNode = makeApiEndpointNode({ method: r.method, routePath: r.path, filePath, line: r.line });
      emit({ type: 'node', data: epNode });

      emit({
        type: 'edge',
        data: {
          source_symbol_uid: sourceUid,
          target_symbol_uid: epNode.symbol_uid,
          edge_type: 'Defines',
          metadata: { kind: 'route' }
        }
      });
      emit({
        type: 'edge_occurrence',
        data: {
          source_symbol_uid: sourceUid,
          target_symbol_uid: epNode.symbol_uid,
          edge_type: 'Defines',
          file_path: filePath,
          line_start: r.line,
          line_end: r.line,
          occurrence_kind: 'route_map'
        }
      });

      // Execution edge: entrypoint triggers handler code in the file (approx).
      emit({
        type: 'edge',
        data: {
          source_symbol_uid: epNode.symbol_uid,
          target_symbol_uid: sourceUid,
          edge_type: 'ControlFlow',
          metadata: { kind: 'route_handler_file' }
        }
      });

      emit({
        type: 'flow_entrypoint',
        data: {
          entrypoint_key: `http:${r.method}:${r.path}`,
          entrypoint_type: 'http_route',
          method: r.method,
          path: r.path,
          symbol_uid: epNode.symbol_uid,
          entrypoint_symbol_uid: epNode.symbol_uid,
          file_path: filePath,
          line_start: r.line,
          line_end: r.line
        }
      });
    }

    const imports = parseImports(lines);
    for (const imp of imports) {
      const resolved = resolveImport(filePath, imp.spec);
      if (resolved) {
        const targetUid = fileToSymbol.get(resolved);
        if (!targetUid) continue;

        emit({
          type: 'edge',
          data: { source_symbol_uid: sourceUid, target_symbol_uid: targetUid, edge_type: 'Imports', metadata: null }
        });
        emit({
          type: 'edge_occurrence',
          data: {
            source_symbol_uid: sourceUid,
            target_symbol_uid: targetUid,
            edge_type: 'Imports',
            file_path: filePath,
            line_start: imp.line,
            line_end: imp.line,
            occurrence_kind: 'import'
          }
        });
        continue;
      }

      const pkgName = packageNameFromImport(imp.spec);
      if (!pkgName) continue;
      const packageKey = `npm:${pkgName}`;
      if (!observedPackages.has(packageKey)) observedPackages.set(packageKey, new Set());
      observedPackages.get(packageKey).add(filePath);

      emit({
        type: 'observed_dependency',
        data: {
          package_key: packageKey,
          source_symbol_uid: sourceUid,
          evidence: { import: imp.spec, file_path: filePath, line: imp.line },
          first_seen_sha: sha,
          last_seen_sha: sha
        }
      });

      if (!packageToSymbol.has(packageKey)) {
        const pkgNode = makePackageNode({ ecosystem: 'npm', name: pkgName });
        packageToSymbol.set(packageKey, pkgNode.symbol_uid);
        emit({ type: 'node', data: pkgNode });
      }

      emit({
        type: 'edge',
        data: {
          source_symbol_uid: sourceUid,
          target_symbol_uid: packageToSymbol.get(packageKey),
          edge_type: 'UsesPackage',
          metadata: { import: imp.spec }
        }
      });
      emit({
        type: 'edge_occurrence',
        data: {
          source_symbol_uid: sourceUid,
          target_symbol_uid: packageToSymbol.get(packageKey),
          edge_type: 'UsesPackage',
          file_path: filePath,
          line_start: imp.line,
          line_end: imp.line,
          occurrence_kind: 'import'
        }
      });
    }

    // Naive call edges: if an imported name is invoked as `name(`, emit Calls edge to imported module/file.
    for (const imp of imports) {
      const resolved = resolveImport(filePath, imp.spec);
      if (!resolved) continue;
      const targetUid = fileToSymbol.get(resolved);
      if (!targetUid) continue;

      for (const name of imp.names ?? []) {
        const re = new RegExp(`\\b${name}\\s*\\(`);
        if (lines.some((l) => re.test(l))) {
          emit({
            type: 'edge',
            data: { source_symbol_uid: sourceUid, target_symbol_uid: targetUid, edge_type: 'Calls', metadata: { callee: name } }
          });
        }
      }
    }
  }

  const observedSet = new Set(observedPackages.keys());
  for (const p of declaredPackages) {
    if (!observedSet.has(p)) {
      emit({
        type: 'dependency_mismatch',
        data: { mismatch_type: 'declared_not_observed', package_key: p, details: { declared: true, observed: false }, sha }
      });
    }
  }
  for (const p of observedSet) {
    if (!declaredPackages.has(p)) {
      emit({
        type: 'dependency_mismatch',
        data: {
          mismatch_type: 'observed_not_declared',
          package_key: p,
          details: { declared: false, observed: true, locations: Array.from(observedPackages.get(p) ?? []) },
          sha
        }
      });
    }
  }
}

export function mockIndexRepoToRecords({ repoRoot, language = 'js' }) {
  const records = [];
  mockIndexRepo({ repoRoot, language, emit: (r) => records.push(r) });
  return records;
}

export function mockIndexRepoToNdjson({ repoRoot, language = 'js' }) {
  return mockIndexRepoToRecords({ repoRoot, language }).map((r) => JSON.stringify(r)).join('\n') + '\n';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const repoRoot = process.argv[2] ?? 'fixtures/sample-repo';
  mockIndexRepo({ repoRoot, language: 'js' });
}
