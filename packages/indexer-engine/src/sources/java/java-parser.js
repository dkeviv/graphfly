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

function parseJavaImports(lines) {
  const imports = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const m = line.match(/^import\s+(?:static\s+)?([A-Za-z0-9_\.]+)\s*;/);
    if (m) imports.push({ path: m[1], line: i + 1 });
  }
  return imports;
}

function parseSpringRoutes(lines) {
  const routes = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const mm = line.match(/^@(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping)\(\s*\"([^\"]+)\"/);
    if (mm) {
      const method = mm[1].replace('Mapping', '').toUpperCase();
      routes.push({ method, path: mm[2], line: i + 1 });
      continue;
    }
    const rm = line.match(/^@RequestMapping\((.+)\)/);
    if (rm) {
      const body = rm[1];
      const pathM = body.match(/value\s*=\s*\"([^\"]+)\"|path\s*=\s*\"([^\"]+)\"/);
      const methodM = body.match(/RequestMethod\.([A-Z]+)/);
      const p = pathM ? (pathM[1] ?? pathM[2]) : null;
      const m = methodM ? methodM[1] : 'GET';
      if (p) routes.push({ method: m, path: p, line: i + 1 });
    }
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

function parseJavaPublicDecls(lines) {
  const decls = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const cm = line.match(/^\s*(public\s+)?(class|interface|enum)\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
    if (cm) decls.push({ kind: cm[2], name: cm[3], line: i + 1 });
    const mm = line.match(/^\s*(public\s+)?(?:static\s+)?[A-Za-z0-9_<>\[\]]+\s+([a-zA-Z_][A-Za-z0-9_]*)\s*\(/);
    if (mm && mm[2] && mm[2] !== 'if' && mm[2] !== 'for' && mm[2] !== 'while') decls.push({ kind: 'method', name: mm[2], line: i + 1 });
  }
  return decls;
}

function makeSymbolNode({ kind, name, filePath, line, sha, containerUid }) {
  const qualifiedName = `${filePath}::${name}`;
  const signature = kind === 'method' ? `method ${name}()` : `${kind} ${name}`;
  const signatureHash = computeSignatureHash({ signature });
  const symbolUid = makeSymbolUid({ language: 'java', qualifiedName, signatureHash });
  const embeddingText = `${qualifiedName} ${signature}`;
  return {
    symbol_uid: symbolUid,
    qualified_name: qualifiedName,
    name,
    node_type: kind === 'method' ? 'Function' : 'Class',
    symbol_kind: kind,
    container_uid: containerUid,
    file_path: filePath,
    line_start: line,
    line_end: line,
    language: 'java',
    visibility: 'public',
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

export function* parseJavaFile({ filePath, lines, sha, containerUid, exportedByFile, packageToUid, sourceFileExists = null }) {
  const sourceUid = containerUid ?? null;
  const localByName = new Map();

  for (const r of parseSpringRoutes(lines)) {
    const ep = makeApiEndpointNode({ method: r.method, routePath: r.path, filePath, line: r.line, sha, containerUid: sourceUid });
    yield { type: 'node', data: ep };
    yield { type: 'edge', data: { source_symbol_uid: sourceUid, target_symbol_uid: ep.symbol_uid, edge_type: 'Defines', metadata: { kind: 'api_endpoint' }, first_seen_sha: sha, last_seen_sha: sha } };
    yield { type: 'edge_occurrence', data: { source_symbol_uid: sourceUid, target_symbol_uid: ep.symbol_uid, edge_type: 'Defines', file_path: filePath, line_start: r.line, line_end: r.line, occurrence_kind: 'route_map', sha } };
    yield { type: 'edge', data: { source_symbol_uid: ep.symbol_uid, target_symbol_uid: sourceUid, edge_type: 'ControlFlow', metadata: { kind: 'route_handler_file' }, first_seen_sha: sha, last_seen_sha: sha } };
    yield { type: 'flow_entrypoint', data: { entrypoint_key: `http:${r.method}:${r.path}`, entrypoint_type: 'http_route', method: r.method, path: r.path, symbol_uid: ep.symbol_uid, entrypoint_symbol_uid: ep.symbol_uid, file_path: filePath, line_start: r.line, line_end: r.line, sha } };
  }

  for (const d of parseJavaPublicDecls(lines)) {
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

  for (const imp of parseJavaImports(lines)) {
    const ip = String(imp.path ?? '');
    if (!ip || ip.endsWith('.*')) continue;
    const asPath = ip.replaceAll('.', '/') + '.java';
    if (typeof sourceFileExists === 'function' && sourceFileExists(asPath)) {
      const targetUid = makeSymbolUid({
        language: 'java',
        qualifiedName: asPath.replaceAll('/', '.'),
        signatureHash: computeSignatureHash({ signature: `file ${asPath}` })
      });
      yield { type: 'edge', data: { source_symbol_uid: sourceUid, target_symbol_uid: targetUid, edge_type: 'Imports', metadata: { import_path: ip }, first_seen_sha: sha, last_seen_sha: sha } };
      yield { type: 'edge_occurrence', data: { source_symbol_uid: sourceUid, target_symbol_uid: targetUid, edge_type: 'Imports', file_path: filePath, line_start: imp.line, line_end: imp.line, occurrence_kind: 'import', sha } };
      continue;
    }

    const parts = ip.split('.');
    const pkg = parts.length > 1 ? `${parts[0]}` : parts[0] ?? null;
    if (!pkg) continue;
    const packageKey = `maven:${pkg}`;
    const ensured = ensurePackageNode({ packageKey, sha, packageToUid });
    if (ensured?.node) yield { type: 'node', data: ensured.node };
    const pkgUid = ensured?.uid ?? null;
    if (!pkgUid) continue;
    yield { type: 'observed_dependency', data: { source_symbol_uid: sourceUid, file_path: filePath, sha, package_key: packageKey, evidence: { import_path: ip, line: imp.line } } };
    yield { type: 'edge', data: { source_symbol_uid: sourceUid, target_symbol_uid: pkgUid, edge_type: 'UsesPackage', metadata: { import_path: ip }, first_seen_sha: sha, last_seen_sha: sha } };
    yield { type: 'edge_occurrence', data: { source_symbol_uid: sourceUid, target_symbol_uid: pkgUid, edge_type: 'UsesPackage', file_path: filePath, line_start: imp.line, line_end: imp.line, occurrence_kind: 'use', sha } };
  }

  // Best-effort intra-file call edges: methodName(...)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('class ') || line.includes('interface ') || line.includes('enum ')) continue;
    const m = line.match(/\b([a-zA-Z_][A-Za-z0-9_]*)\s*\(/);
    if (!m) continue;
    const name = m[1];
    if (!localByName.has(name)) continue;
    const targetUid = localByName.get(name);
    const lineNo = i + 1;
    yield { type: 'edge', data: { source_symbol_uid: sourceUid, target_symbol_uid: targetUid, edge_type: 'Calls', metadata: { callee: name }, first_seen_sha: sha, last_seen_sha: sha } };
    yield { type: 'edge_occurrence', data: { source_symbol_uid: sourceUid, target_symbol_uid: targetUid, edge_type: 'Calls', file_path: filePath, line_start: lineNo, line_end: lineNo, occurrence_kind: 'call', sha } };
  }
}
