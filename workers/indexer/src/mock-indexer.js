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

function findJsDocBlock(lines, i) {
  // Find the closest /** ... */ immediately above line i (0-based), within a small window.
  const maxLookback = 40;
  let end = -1;
  for (let j = i - 1; j >= 0 && i - j <= maxLookback; j--) {
    if (lines[j].includes('*/')) {
      end = j;
      break;
    }
    if (lines[j].trim() !== '' && !lines[j].trim().startsWith('*') && !lines[j].trim().startsWith('//')) {
      break;
    }
  }
  if (end < 0) return null;

  let start = -1;
  for (let j = end; j >= 0 && i - j <= maxLookback; j--) {
    if (lines[j].includes('/**')) {
      start = j;
      break;
    }
  }
  if (start < 0) return null;
  return lines.slice(start, end + 1);
}

function parseJsDoc(jsdocLines) {
  if (!Array.isArray(jsdocLines) || jsdocLines.length === 0) return null;
  const clean = jsdocLines
    .map((l) => l.trim().replace(/^\/\*\*\s?/, '').replace(/\*\/\s?$/, '').replace(/^\*\s?/, '').trim())
    .filter((l) => l.length > 0);

  const params = new Map(); // name -> { type, optional, description }
  const constraints = Object.create(null); // name -> { min,max,pattern }
  const allowableValues = Object.create(null); // name -> array
  let returnsType = null;
  const descLines = [];

  for (const line of clean) {
    if (line.startsWith('@param')) {
      const m = line.match(/^@param\s+\{([^}]+)\}\s+(\[[^\]]+\]|[A-Za-z0-9_$]+)(?:\s*-\s*(.*))?$/);
      if (m) {
        const type = m[1].trim();
        let name = m[2].trim();
        const optional = name.startsWith('[') && name.endsWith(']');
        if (optional) name = name.slice(1, -1);
        const description = (m[3] ?? '').trim() || null;
        params.set(name, { type, optional, description });

        const values = [];
        for (const mm of type.matchAll(/'([^']+)'|\"([^\"]+)\"/g)) {
          const v = mm[1] ?? mm[2];
          if (v) values.push(v);
        }
        if (values.length > 0) allowableValues[name] = values;
      }
      continue;
    }
    if (line.startsWith('@returns')) {
      const m = line.match(/^@returns\s+\{([^}]+)\}/);
      if (m) returnsType = m[1].trim();
      continue;
    }
    if (line.startsWith('@min') || line.startsWith('@max') || line.startsWith('@pattern')) {
      const m = line.match(/^@(min|max|pattern)\s+([A-Za-z0-9_$]+)\s+(.+?)\s*$/);
      if (m) {
        const kind = m[1];
        const name = m[2];
        const value = m[3];
        if (!constraints[name]) constraints[name] = {};
        if (kind === 'min' || kind === 'max') {
          const n = Number(value);
          if (Number.isFinite(n)) constraints[name][kind] = n;
        } else {
          constraints[name].pattern = value;
        }
      }
      continue;
    }
    if (!line.startsWith('@')) descLines.push(line);
  }

  const description = descLines.length > 0 ? descLines.join(' ').trim() : null;
  const out = { description, params, returnsType, constraints, allowableValues };
  return out;
}

function parseParamNames(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return [];
  return s
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => p.replace(/=.*$/g, '').trim())
    .map((p) => p.replace(/^\.\.\./, '').trim())
    .filter((p) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(p));
}

function parseExportedDecls(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fm = line.match(/^\s*export\s+function\s+([A-Za-z0-9_$]+)\s*\(([^)]*)\)/);
    if (fm) {
      out.push({
        kind: 'function',
        name: fm[1],
        paramsRaw: fm[2],
        line: i + 1,
        jsdoc: parseJsDoc(findJsDocBlock(lines, i))
      });
      continue;
    }
    const cm = line.match(/^\s*export\s+class\s+([A-Za-z0-9_$]+)/);
    if (cm) {
      out.push({
        kind: 'class',
        name: cm[1],
        paramsRaw: '',
        line: i + 1,
        jsdoc: parseJsDoc(findJsDocBlock(lines, i))
      });
    }
  }
  return out;
}

function makeExportedSymbolNode({ kind, name, params, jsdoc, filePath, line, sha, language = 'js', containerUid = null }) {
  const qualifiedName = `${filePath}::${name}`;
  const paramNames = params.length > 0 ? params : Array.from(jsdoc?.params?.keys?.() ?? []);
  const signature = kind === 'class' ? `class ${name}` : `function ${name}(${paramNames.join(', ')})`;
  const signatureHash = computeSignatureHash({ signature });
  const symbolUid = makeSymbolUid({ language, qualifiedName, signatureHash });

  const parameters = paramNames.map((p) => {
    const info = jsdoc?.params?.get?.(p) ?? null;
    return { name: p, type: info?.type ?? null, optional: Boolean(info?.optional) || undefined, description: info?.description ?? null };
  });

  const contract =
    kind === 'class'
      ? { kind: 'class', name, constructor: { parameters } }
      : { kind: 'function', name, parameters, returns: jsdoc?.returnsType ? { type: jsdoc.returnsType } : null, description: jsdoc?.description ?? null };

  const constraints = jsdoc?.constraints && Object.keys(jsdoc.constraints).length > 0 ? jsdoc.constraints : null;
  const allowableValues = jsdoc?.allowableValues && Object.keys(jsdoc.allowableValues).length > 0 ? jsdoc.allowableValues : null;
  const embeddingText = `${qualifiedName} ${signature} ${jsdoc?.description ?? ''}`.trim();

  return {
    symbol_uid: symbolUid,
    qualified_name: qualifiedName,
    name,
    node_type: kind === 'class' ? 'Class' : 'Function',
    symbol_kind: kind === 'class' ? 'class' : 'function',
    container_uid: containerUid,
    file_path: filePath,
    line_start: line,
    line_end: line,
    language,
    visibility: 'public',
    signature,
    signature_hash: signatureHash,
    parameters,
    contract,
    constraints,
    allowable_values: allowableValues,
    embedding_text: embeddingText,
    embedding: embedText384(embeddingText),
    first_seen_sha: sha ?? 'mock',
    last_seen_sha: sha ?? 'mock'
  };
}

function makePackageNode({ ecosystem, name, sha }) {
  const qualifiedName = `${ecosystem}:${name}`;
  const signature = `package ${qualifiedName}`;
  const signatureHash = computeSignatureHash({ signature });
  const symbolUid = makeSymbolUid({ language: 'pkg', qualifiedName, signatureHash });
  return {
    symbol_uid: symbolUid,
    qualified_name: qualifiedName,
    name,
    node_type: 'Package',
    symbol_kind: 'package',
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
    external_ref: { ecosystem, name },
    first_seen_sha: sha ?? 'mock',
    last_seen_sha: sha ?? 'mock'
  };
}

function makeManifestNode({ filePath, sha }) {
  const qualifiedName = `manifest:${filePath}`;
  const signature = `manifest ${filePath}`;
  const signatureHash = computeSignatureHash({ signature });
  const symbolUid = makeSymbolUid({ language: 'manifest', qualifiedName, signatureHash });
  return {
    symbol_uid: symbolUid,
    qualified_name: qualifiedName,
    name: path.basename(filePath),
    node_type: 'Manifest',
    symbol_kind: 'manifest',
    file_path: filePath,
    line_start: 1,
    line_end: 1,
    language: 'manifest',
    visibility: 'internal',
    signature,
    signature_hash: signatureHash,
    contract: null,
    constraints: null,
    allowable_values: null,
    first_seen_sha: sha ?? 'mock',
    last_seen_sha: sha ?? 'mock'
  };
}

function makeFileNode({ filePath, language, sha }) {
  const qualifiedName = filePath.replaceAll('/', '.');
  const signature = `file ${filePath}`;
  const signatureHash = computeSignatureHash({ signature });
  const symbolUid = makeSymbolUid({ language, qualifiedName, signatureHash });
  return {
    symbol_uid: symbolUid,
    qualified_name: qualifiedName,
    name: path.basename(filePath),
    node_type: 'File',
    symbol_kind: 'module',
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
    embedding: embedText384(`${qualifiedName} ${signature}`),
    first_seen_sha: sha ?? 'mock',
    last_seen_sha: sha ?? 'mock'
  };
}

function makeApiEndpointNode({ method, routePath, filePath, line, sha, containerUid = null }) {
  const qualifiedName = `http.${method}.${routePath}`;
  const signature = `${method} ${routePath}`;
  const signatureHash = computeSignatureHash({ signature });
  const symbolUid = makeSymbolUid({ language: 'http', qualifiedName, signatureHash });
  return {
    symbol_uid: symbolUid,
    qualified_name: qualifiedName,
    name: signature,
    node_type: 'ApiEndpoint',
    symbol_kind: 'api_endpoint',
    container_uid: containerUid,
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
    embedding: embedText384(`${signature} endpoint`),
    first_seen_sha: sha ?? 'mock',
    last_seen_sha: sha ?? 'mock'
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
  const exportedByFile = new Map(); // file_path -> Map(exported_name -> symbol_uid)
  const declaredPackages = new Set(); // package_key
  const observedPackages = new Map(); // package_key -> Set(file_path)
  const declaredRanges = new Map(); // package_key -> Map(version_range -> Set(manifest_file_path))

  for (const absFile of sourceFiles) {
    const filePath = rel(absRoot, absFile);
    const node = makeFileNode({ filePath, language, sha });
    fileToSymbol.set(filePath, node.symbol_uid);
    emit({ type: 'node', data: node });
  }

  for (const absManifest of manifestFiles) {
    const filePath = rel(absRoot, absManifest);
    const manifestNode = makeManifestNode({ filePath, sha });
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
      if (!declaredRanges.has(packageKey)) declaredRanges.set(packageKey, new Map());
      if (!declaredRanges.get(packageKey).has(d.range)) declaredRanges.get(packageKey).set(d.range, new Set());
      declaredRanges.get(packageKey).get(d.range).add(filePath);

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
        const pkgNode = makePackageNode({ ecosystem: 'npm', name: d.name, sha });
        packageToSymbol.set(packageKey, pkgNode.symbol_uid);
        emit({ type: 'node', data: pkgNode });
      }

      emit({
        type: 'edge',
        data: {
          source_symbol_uid: manifestNode.symbol_uid,
          target_symbol_uid: packageToSymbol.get(packageKey),
          edge_type: 'DependsOn',
          metadata: { declared: true, scope: d.scope, version_range: d.range },
          first_seen_sha: sha,
          last_seen_sha: sha
        }
      });
    }
  }

  // Emit version conflict mismatches across manifests (monorepo) without assuming which side is correct.
  for (const [packageKey, ranges] of declaredRanges.entries()) {
    if (ranges.size <= 1) continue;
    const details = {
      package_key: packageKey,
      version_ranges: Array.from(ranges.keys()).sort(),
      manifests: Array.from(ranges.entries()).map(([range, files]) => ({ version_range: range, files: Array.from(files).sort() }))
    };
    emit({
      type: 'dependency_mismatch',
      data: {
        mismatch_type: 'version_conflict',
        package_key: packageKey,
        details,
        sha
      }
    });
  }

  for (const absFile of sourceFiles) {
    const filePath = rel(absRoot, absFile);
    const sourceUid = fileToSymbol.get(filePath);
    const lines = fs.readFileSync(absFile, 'utf8').split('\n');

    const decls = parseExportedDecls(lines);
    if (decls.length > 0) {
      const byName = new Map();
      for (const d of decls) {
        const params = parseParamNames(d.paramsRaw);
        const node = makeExportedSymbolNode({ kind: d.kind, name: d.name, params, jsdoc: d.jsdoc, filePath, line: d.line, sha, language, containerUid: sourceUid });
        byName.set(d.name, node.symbol_uid);
        emit({ type: 'node', data: node });

        emit({
          type: 'edge',
          data: {
            source_symbol_uid: sourceUid,
            target_symbol_uid: node.symbol_uid,
            edge_type: 'Defines',
            metadata: { kind: d.kind },
            first_seen_sha: sha,
            last_seen_sha: sha
          }
        });
        emit({
          type: 'edge_occurrence',
          data: {
            source_symbol_uid: sourceUid,
            target_symbol_uid: node.symbol_uid,
            edge_type: 'Defines',
            file_path: filePath,
            line_start: d.line,
            line_end: d.line,
            occurrence_kind: 'other',
            sha
          }
        });
      }
      exportedByFile.set(filePath, byName);
    }

    for (const r of parseExpressRoutes(lines)) {
      const epNode = makeApiEndpointNode({ method: r.method, routePath: r.path, filePath, line: r.line, sha, containerUid: sourceUid });
      emit({ type: 'node', data: epNode });

      emit({
        type: 'edge',
        data: {
          source_symbol_uid: sourceUid,
          target_symbol_uid: epNode.symbol_uid,
          edge_type: 'Defines',
          metadata: { kind: 'route' },
          first_seen_sha: sha,
          last_seen_sha: sha
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
          occurrence_kind: 'route_map',
          sha
        }
      });

      // Execution edge: entrypoint triggers handler code in the file (approx).
      emit({
        type: 'edge',
        data: {
          source_symbol_uid: epNode.symbol_uid,
          target_symbol_uid: sourceUid,
          edge_type: 'ControlFlow',
          metadata: { kind: 'route_handler_file' },
          first_seen_sha: sha,
          last_seen_sha: sha
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
          data: {
            source_symbol_uid: sourceUid,
            target_symbol_uid: targetUid,
            edge_type: 'Imports',
            metadata: null,
            first_seen_sha: sha,
            last_seen_sha: sha
          }
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
            occurrence_kind: 'import',
            sha
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
        const pkgNode = makePackageNode({ ecosystem: 'npm', name: pkgName, sha });
        packageToSymbol.set(packageKey, pkgNode.symbol_uid);
        emit({ type: 'node', data: pkgNode });
      }

      emit({
        type: 'edge',
        data: {
          source_symbol_uid: sourceUid,
          target_symbol_uid: packageToSymbol.get(packageKey),
          edge_type: 'UsesPackage',
          metadata: { import: imp.spec },
          first_seen_sha: sha,
          last_seen_sha: sha
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
          occurrence_kind: 'import',
          sha
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
        const resolvedExports = exportedByFile.get(resolved);
        const callTargetUid = resolvedExports?.get(name) ?? targetUid;
        const re = new RegExp(`\\b${name}\\s*\\(`);
        if (lines.some((l) => re.test(l))) {
          emit({
            type: 'edge',
            data: {
              source_symbol_uid: sourceUid,
              target_symbol_uid: callTargetUid,
              edge_type: 'Calls',
              metadata: { callee: name },
              first_seen_sha: sha,
              last_seen_sha: sha
            }
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
