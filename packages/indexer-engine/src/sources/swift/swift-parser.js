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

function parseImports(lines) {
  const imports = [];
  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] ?? '').trim();
    const m = line.match(/^import\s+([A-Za-z0-9_\.]+)\s*$/);
    if (m) imports.push({ module: m[1], line: i + 1 });
  }
  return imports;
}

function parseDecls(lines) {
  const decls = [];
  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] ?? '');
    const cm = line.match(/^\s*(public\s+)?(class|struct|enum|protocol)\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
    if (cm) decls.push({ kind: 'class', name: cm[3], line: i + 1 });
    const fm = line.match(/^\s*(public\s+)?func\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (fm) decls.push({ kind: 'function', name: fm[2], line: i + 1 });
  }
  return decls;
}

function parseCalls(lines) {
  const calls = [];
  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] ?? '');
    if (line.includes('func ')) continue;
    const m = line.match(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (!m) continue;
    const name = m[1];
    if (name === 'if' || name === 'for' || name === 'while' || name === 'switch') continue;
    calls.push({ name, line: i + 1 });
  }
  return calls;
}

function makeSymbolNode({ kind, name, filePath, line, sha, containerUid }) {
  const qualifiedName = `${filePath}::${name}`;
  const signature = kind === 'class' ? `type ${name}` : `func ${name}()`;
  const signatureHash = computeSignatureHash({ signature });
  const symbolUid = makeSymbolUid({ language: 'swift', qualifiedName, signatureHash });
  const embeddingText = `${qualifiedName} ${signature}`;
  return {
    symbol_uid: symbolUid,
    qualified_name: qualifiedName,
    name,
    node_type: kind === 'class' ? 'Class' : 'Function',
    symbol_kind: kind,
    container_uid: containerUid,
    file_path: filePath,
    line_start: line,
    line_end: line,
    language: 'swift',
    visibility: 'internal',
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

export function* parseSwiftFile({ filePath, lines, sha, containerUid, exportedByFile, packageToUid }) {
  const sourceUid = containerUid ?? null;
  const localByName = new Map();

  for (const d of parseDecls(lines)) {
    const node = makeSymbolNode({ kind: d.kind, name: d.name, filePath, line: d.line, sha, containerUid: sourceUid });
    yield { type: 'node', data: node };
    localByName.set(d.name, node.symbol_uid);
    yield { type: 'edge', data: { source_symbol_uid: sourceUid, target_symbol_uid: node.symbol_uid, edge_type: 'Defines', metadata: { kind: d.kind }, first_seen_sha: sha, last_seen_sha: sha } };
    yield { type: 'edge_occurrence', data: { source_symbol_uid: sourceUid, target_symbol_uid: node.symbol_uid, edge_type: 'Defines', file_path: filePath, line_start: d.line, line_end: d.line, occurrence_kind: 'other', sha } };
    if (!exportedByFile.has(filePath)) exportedByFile.set(filePath, new Map());
    exportedByFile.get(filePath).set(d.name, node.symbol_uid);
  }

  for (const imp of parseImports(lines)) {
    const module = String(imp.module ?? '');
    if (!module) continue;
    const packageKey = `swift:${module}`;
    const ensured = ensurePackageNode({ packageKey, sha, packageToUid });
    if (ensured?.node) yield { type: 'node', data: ensured.node };
    const pkgUid = ensured?.uid ?? null;
    if (!pkgUid) continue;
    yield { type: 'observed_dependency', data: { source_symbol_uid: sourceUid, file_path: filePath, sha, package_key: packageKey, evidence: { import_module: module, line: imp.line } } };
    yield { type: 'edge', data: { source_symbol_uid: sourceUid, target_symbol_uid: pkgUid, edge_type: 'UsesPackage', metadata: { import_module: module }, first_seen_sha: sha, last_seen_sha: sha } };
    yield { type: 'edge_occurrence', data: { source_symbol_uid: sourceUid, target_symbol_uid: pkgUid, edge_type: 'UsesPackage', file_path: filePath, line_start: imp.line, line_end: imp.line, occurrence_kind: 'use', sha } };
  }

  for (const c of parseCalls(lines)) {
    const targetUid = localByName.get(c.name) ?? null;
    if (!targetUid) continue;
    yield { type: 'edge', data: { source_symbol_uid: sourceUid, target_symbol_uid: targetUid, edge_type: 'Calls', metadata: { callee: c.name }, first_seen_sha: sha, last_seen_sha: sha } };
    yield { type: 'edge_occurrence', data: { source_symbol_uid: sourceUid, target_symbol_uid: targetUid, edge_type: 'Calls', file_path: filePath, line_start: c.line, line_end: c.line, occurrence_kind: 'call', sha } };
  }
}

