import { computeSignatureHash, makeSymbolUid } from '../../../../cig/src/identity.js';
import { embedText384 } from '../../../../cig/src/embedding.js';
import path from 'node:path';

function parseIncludes(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] ?? '').trim();
    const m = line.match(/^#include\s+([<\"])([^\">]+)[\">]/);
    if (!m) continue;
    out.push({ kind: m[1] === '"' ? 'quote' : 'angle', spec: m[2].trim(), line: i + 1 });
  }
  return out;
}

function parseFunctions(lines) {
  const decls = [];
  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] ?? '');
    const m = line.match(/^\s*[A-Za-z_][A-Za-z0-9_\s\*\&:<>,]*\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^;]*)\)\s*\{/);
    if (!m) continue;
    const name = m[1];
    if (name === 'if' || name === 'for' || name === 'while' || name === 'switch') continue;
    decls.push({ name, line: i + 1 });
  }
  return decls;
}

function parseCalls(lines) {
  const calls = [];
  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] ?? '');
    if (line.includes('#include')) continue;
    const m = line.match(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (!m) continue;
    const name = m[1];
    if (name === 'if' || name === 'for' || name === 'while' || name === 'switch' || name === 'return' || name === 'sizeof') continue;
    calls.push({ name, line: i + 1 });
  }
  return calls;
}

function resolveIncludeToFile({ fromFilePath, inc, sourceFileExists }) {
  if (typeof sourceFileExists !== 'function') return null;
  if (inc.kind !== 'quote') return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFilePath), inc.spec));
  const candidates = [base, `${base}.h`, `${base}.hpp`];
  for (const c of candidates) if (sourceFileExists(c)) return c;
  return null;
}

function makeFunctionNode({ name, filePath, line, sha, containerUid }) {
  const qualifiedName = `${filePath}::${name}`;
  const signature = `fn ${name}()`;
  const signatureHash = computeSignatureHash({ signature });
  const symbolUid = makeSymbolUid({ language: 'c', qualifiedName, signatureHash });
  const embeddingText = `${qualifiedName} ${signature}`;
  return {
    symbol_uid: symbolUid,
    qualified_name: qualifiedName,
    name,
    node_type: 'Function',
    symbol_kind: 'function',
    container_uid: containerUid,
    file_path: filePath,
    line_start: line,
    line_end: line,
    language: 'c',
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

export function* parseCFile({ filePath, lines, sha, containerUid, exportedByFile, packageToUid, sourceFileExists = null }) {
  const sourceUid = containerUid ?? null;
  const localByName = new Map();

  for (const d of parseFunctions(lines)) {
    const node = makeFunctionNode({ name: d.name, filePath, line: d.line, sha, containerUid: sourceUid });
    yield { type: 'node', data: node };
    localByName.set(d.name, node.symbol_uid);
    yield { type: 'edge', data: { source_symbol_uid: sourceUid, target_symbol_uid: node.symbol_uid, edge_type: 'Defines', metadata: { kind: 'function' }, first_seen_sha: sha, last_seen_sha: sha } };
    yield { type: 'edge_occurrence', data: { source_symbol_uid: sourceUid, target_symbol_uid: node.symbol_uid, edge_type: 'Defines', file_path: filePath, line_start: d.line, line_end: d.line, occurrence_kind: 'other', sha } };
    if (!exportedByFile.has(filePath)) exportedByFile.set(filePath, new Map());
    exportedByFile.get(filePath).set(d.name, node.symbol_uid);
  }

  for (const inc of parseIncludes(lines)) {
    const resolved = resolveIncludeToFile({ fromFilePath: filePath, inc, sourceFileExists });
    if (resolved) {
      const targetUid = makeSymbolUid({ language: 'c', qualifiedName: resolved.replaceAll('/', '.'), signatureHash: computeSignatureHash({ signature: `file ${resolved}` }) });
      yield { type: 'edge', data: { source_symbol_uid: sourceUid, target_symbol_uid: targetUid, edge_type: 'Imports', metadata: { include: inc.spec }, first_seen_sha: sha, last_seen_sha: sha } };
      yield { type: 'edge_occurrence', data: { source_symbol_uid: sourceUid, target_symbol_uid: targetUid, edge_type: 'Imports', file_path: filePath, line_start: inc.line, line_end: inc.line, occurrence_kind: 'import', sha } };
      continue;
    }
    // External headers are treated as observed deps at a very coarse level.
    const root = inc.spec.split('/')[0] ?? inc.spec;
    if (!root) continue;
    const packageKey = `c:${root}`;
    if (typeof packageToUid?.has === 'function') {
      // Ensure a package node exists (reusing the shared packageToUid map).
      if (!packageToUid.has(packageKey)) {
        const qualifiedName = `c:${root}`;
        const signature = `package ${qualifiedName}`;
        const signatureHash = computeSignatureHash({ signature });
        const symbolUid = makeSymbolUid({ language: 'pkg', qualifiedName, signatureHash });
        packageToUid.set(packageKey, symbolUid);
        yield {
          type: 'node',
          data: {
            symbol_uid: symbolUid,
            qualified_name: qualifiedName,
            name: root,
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
            external_ref: { ecosystem: 'c', name: root },
            first_seen_sha: sha ?? 'mock',
            last_seen_sha: sha ?? 'mock'
          }
        };
      }
      const pkgUid = packageToUid.get(packageKey);
      yield { type: 'observed_dependency', data: { source_symbol_uid: sourceUid, file_path: filePath, sha, package_key: packageKey, evidence: { include: inc.spec, line: inc.line } } };
      yield { type: 'edge', data: { source_symbol_uid: sourceUid, target_symbol_uid: pkgUid, edge_type: 'UsesPackage', metadata: { include: inc.spec }, first_seen_sha: sha, last_seen_sha: sha } };
      yield { type: 'edge_occurrence', data: { source_symbol_uid: sourceUid, target_symbol_uid: pkgUid, edge_type: 'UsesPackage', file_path: filePath, line_start: inc.line, line_end: inc.line, occurrence_kind: 'use', sha } };
    }
  }

  for (const c of parseCalls(lines)) {
    const targetUid = localByName.get(c.name) ?? null;
    if (!targetUid) continue;
    yield { type: 'edge', data: { source_symbol_uid: sourceUid, target_symbol_uid: targetUid, edge_type: 'Calls', metadata: { callee: c.name }, first_seen_sha: sha, last_seen_sha: sha } };
    yield { type: 'edge_occurrence', data: { source_symbol_uid: sourceUid, target_symbol_uid: targetUid, edge_type: 'Calls', file_path: filePath, line_start: c.line, line_end: c.line, occurrence_kind: 'call', sha } };
  }
}

