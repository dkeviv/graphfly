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

function parseGoImports(lines) {
  const imports = [];
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('import (')) {
      inBlock = true;
      continue;
    }
    if (inBlock && line === ')') {
      inBlock = false;
      continue;
    }
    const sm = line.match(/^import\s+(?:(?:([A-Za-z_][A-Za-z0-9_]*)|\.)\s+)?\"([^\"]+)\"/);
    if (sm) imports.push({ alias: sm[1] ?? null, path: sm[2], line: i + 1 });
    if (inBlock) {
      const bm = line.match(/^(?:(?:([A-Za-z_][A-Za-z0-9_]*)|\.)\s+)?\"([^\"]+)\"/);
      if (bm) imports.push({ alias: bm[1] ?? null, path: bm[2], line: i + 1 });
    }
  }
  return imports;
}

function parseGoDecls(lines) {
  const decls = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fm = line.match(/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (fm) decls.push({ kind: 'function', name: fm[1], line: i + 1 });
    const tm = line.match(/^\s*type\s+([A-Za-z_][A-Za-z0-9_]*)\s+(struct|interface)\b/);
    if (tm) decls.push({ kind: 'type', name: tm[1], line: i + 1 });
  }
  return decls;
}

function makeSymbolNode({ kind, name, filePath, line, sha, containerUid }) {
  const qualifiedName = `${filePath}::${name}`;
  const signature = kind === 'type' ? `type ${name}` : `func ${name}()`;
  const signatureHash = computeSignatureHash({ signature });
  const symbolUid = makeSymbolUid({ language: 'go', qualifiedName, signatureHash });
  const embeddingText = `${qualifiedName} ${signature}`;
  const visibility = /^[A-Z]/.test(name) ? 'public' : 'internal';
  return {
    symbol_uid: symbolUid,
    qualified_name: qualifiedName,
    name,
    node_type: kind === 'type' ? 'Class' : 'Function',
    symbol_kind: kind,
    container_uid: containerUid,
    file_path: filePath,
    line_start: line,
    line_end: line,
    language: 'go',
    visibility,
    signature,
    signature_hash: signatureHash,
    parameters: [],
    contract: null,
    constraints: null,
    allowable_values: null,
    embedding_text: embeddingText,
    embedding: embedText384(embeddingText),
    first_seen_sha: sha ?? 'mock',
    last_seen_sha: sha ?? 'mock'
  };
}

function resolveGoImportToFile({ impPath, goModuleName, fileByGoImportPath }) {
  const p = String(impPath ?? '');
  if (!p) return null;
  if (!goModuleName) return null;
  if (!p.startsWith(goModuleName)) return null;
  return fileByGoImportPath?.get?.(p) ?? null;
}

function parseGoCalls(lines) {
  const calls = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('func ')) continue;
    // pkg.Func(...)
    const member = Array.from(line.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/g));
    for (const m of member) calls.push({ kind: 'member', a: m[1], b: m[2], line: i + 1 });
    // Func(...)
    const direct = Array.from(line.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g));
    for (const m of direct) calls.push({ kind: 'direct', a: m[1], line: i + 1 });
  }
  return calls;
}

function functionScopes(lines) {
  const scopes = [];
  let current = null;
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fm = line.match(/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (fm) {
      current = { name: fm[1], startLine: i + 1 };
      depth = 0;
    }
    if (current) {
      depth += (line.match(/{/g) ?? []).length;
      depth -= (line.match(/}/g) ?? []).length;
      if (depth <= 0 && i + 1 > current.startLine) {
        scopes.push({ name: current.name, startLine: current.startLine, endLine: i + 1 });
        current = null;
      }
    }
  }
  return scopes;
}

function enclosingFuncForLine(scopes, line) {
  for (const s of scopes) {
    if (line >= s.startLine && line <= s.endLine) return s.name;
  }
  return null;
}

function parseGoHttpEntrypoints(lines) {
  const routes = [];
  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] ?? '');
    const hm = line.match(/\bhttp\.HandleFunc\(\s*\"([^\"]+)\"/);
    if (hm) {
      routes.push({ method: 'GET', path: hm[1], line: i + 1 });
      continue;
    }
    const gm = line.match(/\b(?:router|r)\.(GET|POST|PUT|DELETE|PATCH)\(\s*\"([^\"]+)\"/);
    if (gm) routes.push({ method: gm[1], path: gm[2], line: i + 1 });
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

export function* parseGoFile({ filePath, lines, sha, containerUid, exportedByFile, packageToUid, goModuleName = null, fileByGoImportPath = null, sourceFileExists = null }) {
  const sourceUid = containerUid ?? null;
  const localByName = new Map();

  for (const r of parseGoHttpEntrypoints(lines)) {
    const ep = makeApiEndpointNode({ method: r.method, routePath: r.path, filePath, line: r.line, sha, containerUid: sourceUid });
    yield { type: 'node', data: ep };
    yield { type: 'edge', data: { source_symbol_uid: sourceUid, target_symbol_uid: ep.symbol_uid, edge_type: 'Defines', metadata: { kind: 'api_endpoint' }, first_seen_sha: sha, last_seen_sha: sha } };
    yield { type: 'edge_occurrence', data: { source_symbol_uid: sourceUid, target_symbol_uid: ep.symbol_uid, edge_type: 'Defines', file_path: filePath, line_start: r.line, line_end: r.line, occurrence_kind: 'route_map', sha } };
    yield { type: 'edge', data: { source_symbol_uid: ep.symbol_uid, target_symbol_uid: sourceUid, edge_type: 'ControlFlow', metadata: { kind: 'route_handler_file' }, first_seen_sha: sha, last_seen_sha: sha } };
    yield { type: 'flow_entrypoint', data: { entrypoint_key: `http:${r.method}:${r.path}`, entrypoint_type: 'http_route', method: r.method, path: r.path, symbol_uid: ep.symbol_uid, entrypoint_symbol_uid: ep.symbol_uid, file_path: filePath, line_start: r.line, line_end: r.line, sha } };
  }

  for (const d of parseGoDecls(lines)) {
    const node = makeSymbolNode({ kind: d.kind, name: d.name, filePath, line: d.line, sha, containerUid: sourceUid });
    yield { type: 'node', data: node };
    localByName.set(d.name, node.symbol_uid);
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

  for (const imp of parseGoImports(lines)) {
    const resolvedFile = resolveGoImportToFile({ impPath: imp.path, goModuleName, fileByGoImportPath });
    if (resolvedFile) {
      const targetUid = makeSymbolUid({
        language: 'go',
        qualifiedName: resolvedFile.replaceAll('/', '.'),
        signatureHash: computeSignatureHash({ signature: `file ${resolvedFile}` })
      });
      yield { type: 'edge', data: { source_symbol_uid: sourceUid, target_symbol_uid: targetUid, edge_type: 'Imports', metadata: { import_path: imp.path }, first_seen_sha: sha, last_seen_sha: sha } };
      yield { type: 'edge_occurrence', data: { source_symbol_uid: sourceUid, target_symbol_uid: targetUid, edge_type: 'Imports', file_path: filePath, line_start: imp.line, line_end: imp.line, occurrence_kind: 'import', sha } };
      continue;
    }

    const pkgKey = imp.path.includes('.') ? `go:${imp.path}` : null;
    if (!pkgKey) continue;
    const ensured = ensurePackageNode({ packageKey: pkgKey, sha, packageToUid });
    if (ensured?.node) yield { type: 'node', data: ensured.node };
    const pkgUid = ensured?.uid ?? null;
    if (!pkgUid) continue;
    yield { type: 'observed_dependency', data: { source_symbol_uid: sourceUid, file_path: filePath, sha, package_key: pkgKey, evidence: { import_path: imp.path, line: imp.line } } };
    yield { type: 'edge', data: { source_symbol_uid: sourceUid, target_symbol_uid: pkgUid, edge_type: 'UsesPackage', metadata: { import_path: imp.path }, first_seen_sha: sha, last_seen_sha: sha } };
    yield { type: 'edge_occurrence', data: { source_symbol_uid: sourceUid, target_symbol_uid: pkgUid, edge_type: 'UsesPackage', file_path: filePath, line_start: imp.line, line_end: imp.line, occurrence_kind: 'use', sha } };
  }

  const scopes = functionScopes(lines);
  for (const c of parseGoCalls(lines)) {
    const line = Number(c.line ?? 1);
    const enclosing = enclosingFuncForLine(scopes, line);
    const container = enclosing && localByName.has(enclosing) ? localByName.get(enclosing) : sourceUid;
    if (c.kind === 'direct') {
      const targetUid = localByName.get(c.a) ?? null;
      if (!targetUid) continue;
      yield { type: 'edge', data: { source_symbol_uid: container, target_symbol_uid: targetUid, edge_type: 'Calls', metadata: { callee: c.a }, first_seen_sha: sha, last_seen_sha: sha } };
      yield { type: 'edge_occurrence', data: { source_symbol_uid: container, target_symbol_uid: targetUid, edge_type: 'Calls', file_path: filePath, line_start: line, line_end: line, occurrence_kind: 'call', sha } };
    }
  }
}
