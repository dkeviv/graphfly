import { computeSignatureHash, makeSymbolUid } from '../../../../cig/src/identity.js';
import { embedText384 } from '../../../../cig/src/embedding.js';
import path from 'node:path';

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

function parseRustPublicDecls(lines) {
  const decls = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fm = line.match(/^\s*pub\s+fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (fm) decls.push({ kind: 'function', name: fm[1], line: i + 1 });
    const sm = line.match(/^\s*pub\s+struct\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
    if (sm) decls.push({ kind: 'struct', name: sm[1], line: i + 1 });
    const em = line.match(/^\s*pub\s+enum\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
    if (em) decls.push({ kind: 'enum', name: em[1], line: i + 1 });
    const tm = line.match(/^\s*pub\s+trait\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
    if (tm) decls.push({ kind: 'trait', name: tm[1], line: i + 1 });
  }
  return decls;
}

function parseRustUses(lines) {
  const uses = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const m = line.match(/^use\s+([A-Za-z0-9_]+)::(.+?);/);
    if (m) uses.push({ root: m[1], path: m[2], line: i + 1 });
  }
  return uses;
}

function makeSymbolNode({ kind, name, filePath, line, sha, containerUid }) {
  const qualifiedName = `${filePath}::${name}`;
  const signature = kind === 'function' ? `fn ${name}()` : `${kind} ${name}`;
  const signatureHash = computeSignatureHash({ signature });
  const symbolUid = makeSymbolUid({ language: 'rust', qualifiedName, signatureHash });
  const embeddingText = `${qualifiedName} ${signature}`;
  return {
    symbol_uid: symbolUid,
    qualified_name: qualifiedName,
    name,
    node_type: kind === 'function' ? 'Function' : 'Class',
    symbol_kind: kind,
    container_uid: containerUid,
    file_path: filePath,
    line_start: line,
    line_end: line,
    language: 'rust',
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

function resolveRustUseToFile({ fromFilePath, useRoot, usePath, sourceFileExists }) {
  if (typeof sourceFileExists !== 'function') return null;
  const root = String(useRoot ?? '');
  if (root !== 'crate' && root !== 'self' && root !== 'super') return null;
  const cleaned = String(usePath ?? '').replaceAll('{', '').replaceAll('}', '').trim();
  const parts = cleaned.split('::').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  // Determine a repo-relative base: prefer "src/" if present in the current file path.
  const from = String(fromFilePath ?? '');
  const idx = from.indexOf('src/');
  const base = idx >= 0 ? from.slice(0, idx + 4) : '';
  const rel = parts.join('/');
  const candidates = [
    path.posix.join(base, `${rel}.rs`),
    path.posix.join(base, rel, 'mod.rs')
  ];
  for (const c of candidates) if (sourceFileExists(c)) return c;
  return null;
}

function parseRustCalls(lines) {
  const calls = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('fn ') || line.trim().startsWith('pub fn ')) continue;
    const m = line.match(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (m) calls.push({ name: m[1], line: i + 1 });
  }
  return calls;
}

export function* parseRustFile({ filePath, lines, sha, containerUid, exportedByFile, packageToUid, sourceFileExists = null }) {
  const sourceUid = containerUid ?? null;
  const localByName = new Map();

  for (const d of parseRustPublicDecls(lines)) {
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

  for (const u of parseRustUses(lines)) {
    const resolvedFile = resolveRustUseToFile({ fromFilePath: filePath, useRoot: u.root, usePath: u.path, sourceFileExists });
    if (resolvedFile) {
      const targetUid = makeSymbolUid({
        language: 'rust',
        qualifiedName: resolvedFile.replaceAll('/', '.'),
        signatureHash: computeSignatureHash({ signature: `file ${resolvedFile}` })
      });
      yield { type: 'edge', data: { source_symbol_uid: sourceUid, target_symbol_uid: targetUid, edge_type: 'Imports', metadata: { use: `${u.root}::${u.path}` }, first_seen_sha: sha, last_seen_sha: sha } };
      yield { type: 'edge_occurrence', data: { source_symbol_uid: sourceUid, target_symbol_uid: targetUid, edge_type: 'Imports', file_path: filePath, line_start: u.line, line_end: u.line, occurrence_kind: 'import', sha } };
      continue;
    }

    const packageKey = `cargo:${u.root}`;
    const ensured = ensurePackageNode({ packageKey, sha, packageToUid });
    if (ensured?.node) yield { type: 'node', data: ensured.node };
    const pkgUid = ensured?.uid ?? null;
    if (!pkgUid) continue;
    yield { type: 'observed_dependency', data: { source_symbol_uid: sourceUid, file_path: filePath, sha, package_key: packageKey, evidence: { use: `${u.root}::${u.path}`, line: u.line } } };
    yield { type: 'edge', data: { source_symbol_uid: sourceUid, target_symbol_uid: pkgUid, edge_type: 'UsesPackage', metadata: { use: `${u.root}::${u.path}` }, first_seen_sha: sha, last_seen_sha: sha } };
    yield { type: 'edge_occurrence', data: { source_symbol_uid: sourceUid, target_symbol_uid: pkgUid, edge_type: 'UsesPackage', file_path: filePath, line_start: u.line, line_end: u.line, occurrence_kind: 'use', sha } };
  }

  for (const c of parseRustCalls(lines)) {
    const targetUid = localByName.get(c.name) ?? null;
    if (!targetUid) continue;
    yield { type: 'edge', data: { source_symbol_uid: sourceUid, target_symbol_uid: targetUid, edge_type: 'Calls', metadata: { callee: c.name }, first_seen_sha: sha, last_seen_sha: sha } };
    yield { type: 'edge_occurrence', data: { source_symbol_uid: sourceUid, target_symbol_uid: targetUid, edge_type: 'Calls', file_path: filePath, line_start: c.line, line_end: c.line, occurrence_kind: 'call', sha } };
  }
}
