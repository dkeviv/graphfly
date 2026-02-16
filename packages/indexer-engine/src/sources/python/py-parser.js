import { computeSignatureHash, makeSymbolUid } from '../../../../cig/src/identity.js';
import { embedText384 } from '../../../../cig/src/embedding.js';

function ensurePackageNode({ packageKey, sha, packageToUid }) {
  if (!packageKey) return null;
  if (packageToUid?.has?.(packageKey)) return { uid: packageToUid.get(packageKey), node: null };
  const [ecosystem, ...rest] = String(packageKey).split(':');
  const name = rest.join(':');
  const qualifiedName = `${ecosystem}:${name}`;
  const signature = `package ${qualifiedName}`;
  const signatureHash = computeSignatureHash({ signature });
  const symbolUid = makeSymbolUid({ language: 'pkg', qualifiedName, signatureHash });
  const node = {
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
  packageToUid?.set?.(packageKey, symbolUid);
  return { uid: symbolUid, node };
}

function parsePyImports(lines) {
  const imports = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('import ')) {
      const rest = line.slice('import '.length).trim();
      const mods = rest.split(',').map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean);
      for (const m of mods) imports.push({ module: m, line: i + 1 });
    } else if (line.startsWith('from ')) {
      const m = line.match(/^from\s+([A-Za-z0-9_\.]+)\s+import\s+/);
      if (m) imports.push({ module: m[1], line: i + 1 });
    }
  }
  return imports;
}

function parseFastApiRoutes(lines) {
  const routes = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const m = line.match(/^@(?:app|router)\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/);
    if (m) routes.push({ method: m[1].toUpperCase(), path: m[2], line: i + 1 });
  }
  return routes;
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

function parsePyPublicDecls(lines) {
  const decls = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fm = line.match(/^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*:/);
    if (fm) {
      decls.push({ kind: 'function', name: fm[1], paramsRaw: fm[2], line: i + 1 });
      continue;
    }
    const cm = line.match(/^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)\s*(\(|:)/);
    if (cm) {
      decls.push({ kind: 'class', name: cm[1], paramsRaw: '', line: i + 1 });
    }
  }
  return decls;
}

function parseParamNames(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return [];
  return s
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => p.replace(/=.*$/g, '').trim())
    .map((p) => p.replace(/^\*/, '').trim())
    .filter((p) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(p));
}

function makeExportedSymbolNode({ kind, name, params, filePath, line, sha, containerUid = null }) {
  const qualifiedName = `${filePath}::${name}`;
  const signature = kind === 'class' ? `class ${name}` : `def ${name}(${params.join(', ')})`;
  const signatureHash = computeSignatureHash({ signature });
  const symbolUid = makeSymbolUid({ language: 'python', qualifiedName, signatureHash });
  const parameters = params.map((p) => ({ name: p, type: null, optional: undefined, description: null }));
  const contract = kind === 'class' ? { kind: 'class', name, constructor: { parameters } } : { kind: 'function', name, parameters, returns: null, description: null };
  const embeddingText = `${qualifiedName} ${signature}`.trim();
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
    language: 'python',
    visibility: 'public',
    signature,
    signature_hash: signatureHash,
    parameters,
    contract,
    constraints: null,
    allowable_values: null,
    embedding_text: embeddingText,
    embedding: embedText384(embeddingText),
    first_seen_sha: sha ?? 'mock',
    last_seen_sha: sha ?? 'mock'
  };
}

export function* parsePythonFile({ filePath, lines, sha, containerUid, exportedByFile, packageToUid, sourceFileExists = null }) {
  const sourceUid = containerUid ?? null;

  for (const d of parsePyPublicDecls(lines)) {
    const params = parseParamNames(d.paramsRaw);
    const node = makeExportedSymbolNode({ kind: d.kind, name: d.name, params, filePath, line: d.line, sha, containerUid: sourceUid });
    yield { type: 'node', data: node };
    yield {
      type: 'edge',
      data: {
        source_symbol_uid: sourceUid,
        target_symbol_uid: node.symbol_uid,
        edge_type: 'Defines',
        metadata: { kind: d.kind },
        first_seen_sha: sha,
        last_seen_sha: sha
      }
    };
    yield {
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
    };
    if (!exportedByFile.has(filePath)) exportedByFile.set(filePath, new Map());
    exportedByFile.get(filePath).set(d.name, node.symbol_uid);
  }

  for (const r of parseFastApiRoutes(lines)) {
    const ep = makeApiEndpointNode({ method: r.method, routePath: r.path, filePath, line: r.line, sha, containerUid: sourceUid });
    yield { type: 'node', data: ep };
    yield {
      type: 'edge',
      data: {
        source_symbol_uid: sourceUid,
        target_symbol_uid: ep.symbol_uid,
        edge_type: 'Defines',
        metadata: { kind: 'api_endpoint' },
        first_seen_sha: sha,
        last_seen_sha: sha
      }
    };
    yield {
      type: 'edge_occurrence',
      data: {
        source_symbol_uid: sourceUid,
        target_symbol_uid: ep.symbol_uid,
        edge_type: 'Defines',
        file_path: filePath,
        line_start: r.line,
        line_end: r.line,
        occurrence_kind: 'route_map',
        sha
      }
    };
    yield {
      type: 'edge',
      data: {
        source_symbol_uid: ep.symbol_uid,
        target_symbol_uid: sourceUid,
        edge_type: 'ControlFlow',
        metadata: { kind: 'route_handler_file' },
        first_seen_sha: sha,
        last_seen_sha: sha
      }
    };
    yield {
      type: 'flow_entrypoint',
      data: {
        entrypoint_key: `http:${r.method}:${r.path}`,
        entrypoint_type: 'http_route',
        method: r.method,
        path: r.path,
        symbol_uid: ep.symbol_uid,
        entrypoint_symbol_uid: ep.symbol_uid,
        file_path: filePath,
        line_start: r.line,
        line_end: r.line,
        sha
      }
    };
  }

  for (const imp of parsePyImports(lines)) {
    const pkg = imp.module.split('.')[0];
    if (!pkg) continue;
    const packageKey = `pypi:${pkg}`;
    const ensured = ensurePackageNode({ packageKey, sha, packageToUid });
    if (ensured?.node) yield { type: 'node', data: ensured.node };
    const pkgUid = ensured?.uid ?? null;
    if (!pkgUid) continue;
    yield {
      type: 'observed_dependency',
      data: { source_symbol_uid: sourceUid, file_path: filePath, sha, package_key: packageKey, evidence: { import_module: imp.module, line: imp.line } }
    };
    yield {
      type: 'edge',
      data: {
        source_symbol_uid: sourceUid,
        target_symbol_uid: pkgUid,
        edge_type: 'UsesPackage',
        metadata: { import_module: imp.module },
        first_seen_sha: sha,
        last_seen_sha: sha
      }
    };
    yield {
      type: 'edge_occurrence',
      data: {
        source_symbol_uid: sourceUid,
        target_symbol_uid: pkgUid,
        edge_type: 'UsesPackage',
        file_path: filePath,
        line_start: imp.line,
        line_end: imp.line,
        occurrence_kind: 'use',
        sha
      }
    };
  }
}
