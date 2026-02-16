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

function parseRubyRequires(lines) {
  const req = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const m = line.match(/^(require|require_relative)\s+['"]([^'"]+)['"]/);
    if (m) req.push({ kind: m[1], spec: m[2], line: i + 1 });
  }
  return req;
}

function parseRubyDecls(lines) {
  const decls = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const cm = line.match(/^\s*class\s+([A-Z][A-Za-z0-9_:]*)/);
    if (cm) decls.push({ kind: 'class', name: cm[1], line: i + 1 });
    const mm = line.match(/^\s*module\s+([A-Z][A-Za-z0-9_:]*)/);
    if (mm) decls.push({ kind: 'module', name: mm[1], line: i + 1 });
    const fm = line.match(/^\s*def\s+([a-zA-Z_][A-Za-z0-9_!?=]*)/);
    if (fm) decls.push({ kind: 'function', name: fm[1], line: i + 1 });
  }
  return decls;
}

function makeSymbolNode({ kind, name, filePath, line, sha, containerUid }) {
  const qualifiedName = `${filePath}::${name}`;
  const signature = kind === 'function' ? `def ${name}()` : `${kind} ${name}`;
  const signatureHash = computeSignatureHash({ signature });
  const symbolUid = makeSymbolUid({ language: 'ruby', qualifiedName, signatureHash });
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
    language: 'ruby',
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

function resolveRubyRequireToFile({ fromFilePath, req, sourceFileExists }) {
  if (typeof sourceFileExists !== 'function') return null;
  const spec = String(req?.spec ?? '');
  if (!spec) return null;
  if (req?.kind === 'require_relative') {
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFilePath), spec));
    const candidates = base.endsWith('.rb') ? [base] : [`${base}.rb`, path.posix.join(base, 'init.rb')];
    for (const c of candidates) if (sourceFileExists(c)) return c;
    return null;
  }
  // "require 'foo/bar'" can be local in mono-repo style.
  const candidates = spec.endsWith('.rb') ? [spec] : [`${spec}.rb`];
  for (const c of candidates) if (sourceFileExists(c)) return c;
  return null;
}

export function* parseRubyFile({ filePath, lines, sha, containerUid, exportedByFile, packageToUid, sourceFileExists = null }) {
  const sourceUid = containerUid ?? null;
  const localByName = new Map();
  for (const d of parseRubyDecls(lines)) {
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

  for (const r of parseRubyRequires(lines)) {
    const resolved = resolveRubyRequireToFile({ fromFilePath: filePath, req: r, sourceFileExists });
    if (resolved) {
      const targetUid = makeSymbolUid({
        language: 'ruby',
        qualifiedName: resolved.replaceAll('/', '.'),
        signatureHash: computeSignatureHash({ signature: `file ${resolved}` })
      });
      yield { type: 'edge', data: { source_symbol_uid: sourceUid, target_symbol_uid: targetUid, edge_type: 'Imports', metadata: { require: r.spec }, first_seen_sha: sha, last_seen_sha: sha } };
      yield { type: 'edge_occurrence', data: { source_symbol_uid: sourceUid, target_symbol_uid: targetUid, edge_type: 'Imports', file_path: filePath, line_start: r.line, line_end: r.line, occurrence_kind: 'import', sha } };
      continue;
    }
    const name = r.spec.split('/')[0];
    const packageKey = `gem:${name}`;
    const ensured = ensurePackageNode({ packageKey, sha, packageToUid });
    if (ensured?.node) yield { type: 'node', data: ensured.node };
    const pkgUid = ensured?.uid ?? null;
    if (!pkgUid) continue;
    yield {
      type: 'observed_dependency',
      data: { source_symbol_uid: sourceUid, file_path: filePath, sha, package_key: packageKey, evidence: { require: r.spec, line: r.line } }
    };
    yield {
      type: 'edge',
      data: {
        source_symbol_uid: sourceUid,
        target_symbol_uid: pkgUid,
        edge_type: 'UsesPackage',
        metadata: { require: r.spec },
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
        line_start: r.line,
        line_end: r.line,
        occurrence_kind: 'use',
        sha
      }
    };
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('def ')) continue;
    const m = line.match(/\b([a-zA-Z_][A-Za-z0-9_!?=]*)\s*\(/);
    if (!m) continue;
    const name = m[1];
    const targetUid = localByName.get(name) ?? null;
    if (!targetUid) continue;
    const lineNo = i + 1;
    yield { type: 'edge', data: { source_symbol_uid: sourceUid, target_symbol_uid: targetUid, edge_type: 'Calls', metadata: { callee: name }, first_seen_sha: sha, last_seen_sha: sha } };
    yield { type: 'edge_occurrence', data: { source_symbol_uid: sourceUid, target_symbol_uid: targetUid, edge_type: 'Calls', file_path: filePath, line_start: lineNo, line_end: lineNo, occurrence_kind: 'call', sha } };
  }
}
