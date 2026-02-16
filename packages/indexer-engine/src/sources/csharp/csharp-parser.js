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

function parseCSharpUsings(lines) {
  const usings = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const m = line.match(/^using\s+([A-Za-z0-9_\.]+)\s*;/);
    if (m) usings.push({ ns: m[1], line: i + 1 });
  }
  return usings;
}

function parseCSharpPublicDecls(lines) {
  const decls = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const cm = line.match(/^\s*public\s+(class|interface|enum|struct)\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
    if (cm) decls.push({ kind: cm[1], name: cm[2], line: i + 1 });
    const mm = line.match(/^\s*public\s+(?:static\s+)?[A-Za-z0-9_<>\[\]]+\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (mm) decls.push({ kind: 'method', name: mm[1], line: i + 1 });
  }
  return decls;
}

function makeSymbolNode({ kind, name, filePath, line, sha, containerUid }) {
  const qualifiedName = `${filePath}::${name}`;
  const signature = kind === 'method' ? `method ${name}()` : `${kind} ${name}`;
  const signatureHash = computeSignatureHash({ signature });
  const symbolUid = makeSymbolUid({ language: 'csharp', qualifiedName, signatureHash });
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
    language: 'csharp',
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

function parseAspNetRoutes(lines) {
  const routes = [];
  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] ?? '').trim();
    const mm = line.match(/\bMap(Get|Post|Put|Delete|Patch)\(\s*\"([^\"]+)\"/);
    if (mm) {
      routes.push({ method: mm[1].toUpperCase(), path: mm[2], line: i + 1 });
      continue;
    }
    const am = line.match(/^\[(HttpGet|HttpPost|HttpPut|HttpDelete|HttpPatch)\(\s*\"([^\"]+)\"/);
    if (am) {
      routes.push({ method: am[1].replace('Http', '').toUpperCase(), path: am[2], line: i + 1 });
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

export function* parseCSharpFile({ filePath, lines, sha, containerUid, exportedByFile, packageToUid, sourceFileExists = null }) {
  const sourceUid = containerUid ?? null;
  const localByName = new Map();

  for (const r of parseAspNetRoutes(lines)) {
    const ep = makeApiEndpointNode({ method: r.method, routePath: r.path, filePath, line: r.line, sha, containerUid: sourceUid });
    yield { type: 'node', data: ep };
    yield { type: 'edge', data: { source_symbol_uid: sourceUid, target_symbol_uid: ep.symbol_uid, edge_type: 'Defines', metadata: { kind: 'api_endpoint' }, first_seen_sha: sha, last_seen_sha: sha } };
    yield { type: 'edge_occurrence', data: { source_symbol_uid: sourceUid, target_symbol_uid: ep.symbol_uid, edge_type: 'Defines', file_path: filePath, line_start: r.line, line_end: r.line, occurrence_kind: 'route_map', sha } };
    yield { type: 'edge', data: { source_symbol_uid: ep.symbol_uid, target_symbol_uid: sourceUid, edge_type: 'ControlFlow', metadata: { kind: 'route_handler_file' }, first_seen_sha: sha, last_seen_sha: sha } };
    yield { type: 'flow_entrypoint', data: { entrypoint_key: `http:${r.method}:${r.path}`, entrypoint_type: 'http_route', method: r.method, path: r.path, symbol_uid: ep.symbol_uid, entrypoint_symbol_uid: ep.symbol_uid, file_path: filePath, line_start: r.line, line_end: r.line, sha } };
  }

  for (const d of parseCSharpPublicDecls(lines)) {
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

  for (const u of parseCSharpUsings(lines)) {
    const root = u.ns.split('.')[0];
    if (!root) continue;
    const asPath = u.ns.replaceAll('.', '/') + '.cs';
    if (typeof sourceFileExists === 'function' && sourceFileExists(asPath)) {
      const targetUid = makeSymbolUid({
        language: 'csharp',
        qualifiedName: asPath.replaceAll('/', '.'),
        signatureHash: computeSignatureHash({ signature: `file ${asPath}` })
      });
      yield { type: 'edge', data: { source_symbol_uid: sourceUid, target_symbol_uid: targetUid, edge_type: 'Imports', metadata: { using_ns: u.ns }, first_seen_sha: sha, last_seen_sha: sha } };
      yield { type: 'edge_occurrence', data: { source_symbol_uid: sourceUid, target_symbol_uid: targetUid, edge_type: 'Imports', file_path: filePath, line_start: u.line, line_end: u.line, occurrence_kind: 'import', sha } };
      continue;
    }
    const packageKey = `nuget:${root}`;
    const ensured = ensurePackageNode({ packageKey, sha, packageToUid });
    if (ensured?.node) yield { type: 'node', data: ensured.node };
    const pkgUid = ensured?.uid ?? null;
    if (!pkgUid) continue;
    yield {
      type: 'observed_dependency',
      data: { source_symbol_uid: sourceUid, file_path: filePath, sha, package_key: packageKey, evidence: { using_ns: u.ns, line: u.line } }
    };
    yield {
      type: 'edge',
      data: {
        source_symbol_uid: sourceUid,
        target_symbol_uid: pkgUid,
        edge_type: 'UsesPackage',
        metadata: { using_ns: u.ns },
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
        line_start: u.line,
        line_end: u.line,
        occurrence_kind: 'use',
        sha
      }
    };
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (!m) continue;
    const name = m[1];
    const targetUid = localByName.get(name) ?? null;
    if (!targetUid) continue;
    const lineNo = i + 1;
    yield { type: 'edge', data: { source_symbol_uid: sourceUid, target_symbol_uid: targetUid, edge_type: 'Calls', metadata: { callee: name }, first_seen_sha: sha, last_seen_sha: sha } };
    yield { type: 'edge_occurrence', data: { source_symbol_uid: sourceUid, target_symbol_uid: targetUid, edge_type: 'Calls', file_path: filePath, line_start: lineNo, line_end: lineNo, occurrence_kind: 'call', sha } };
  }
}
