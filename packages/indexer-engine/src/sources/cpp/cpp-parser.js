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

function parseDecls(lines) {
  const decls = [];
  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] ?? '');
    const cm = line.match(/^\s*(class|struct)\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
    if (cm) decls.push({ kind: 'class', name: cm[2], line: i + 1 });
    const fm = line.match(/^\s*[A-Za-z_][A-Za-z0-9_\s\*\&:<>,]*\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^;]*)\)\s*\{/);
    if (fm) {
      const name = fm[1];
      if (name !== 'if' && name !== 'for' && name !== 'while' && name !== 'switch') decls.push({ kind: 'function', name, line: i + 1 });
    }
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
  const candidates = [base, `${base}.h`, `${base}.hpp`, `${base}.hh`];
  for (const c of candidates) if (sourceFileExists(c)) return c;
  return null;
}

function makeSymbolNode({ kind, name, filePath, line, sha, containerUid }) {
  const qualifiedName = `${filePath}::${name}`;
  const signature = kind === 'class' ? `class ${name}` : `fn ${name}()`;
  const signatureHash = computeSignatureHash({ signature });
  const symbolUid = makeSymbolUid({ language: 'cpp', qualifiedName, signatureHash });
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
    language: 'cpp',
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

export function* parseCppFile({ filePath, lines, sha, containerUid, exportedByFile, packageToUid, sourceFileExists = null }) {
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

  for (const inc of parseIncludes(lines)) {
    const resolved = resolveIncludeToFile({ fromFilePath: filePath, inc, sourceFileExists });
    if (resolved) {
      const targetUid = makeSymbolUid({ language: 'cpp', qualifiedName: resolved.replaceAll('/', '.'), signatureHash: computeSignatureHash({ signature: `file ${resolved}` }) });
      yield { type: 'edge', data: { source_symbol_uid: sourceUid, target_symbol_uid: targetUid, edge_type: 'Imports', metadata: { include: inc.spec }, first_seen_sha: sha, last_seen_sha: sha } };
      yield { type: 'edge_occurrence', data: { source_symbol_uid: sourceUid, target_symbol_uid: targetUid, edge_type: 'Imports', file_path: filePath, line_start: inc.line, line_end: inc.line, occurrence_kind: 'import', sha } };
    }
  }

  for (const c of parseCalls(lines)) {
    const targetUid = localByName.get(c.name) ?? null;
    if (!targetUid) continue;
    yield { type: 'edge', data: { source_symbol_uid: sourceUid, target_symbol_uid: targetUid, edge_type: 'Calls', metadata: { callee: c.name }, first_seen_sha: sha, last_seen_sha: sha } };
    yield { type: 'edge_occurrence', data: { source_symbol_uid: sourceUid, target_symbol_uid: targetUid, edge_type: 'Calls', file_path: filePath, line_start: c.line, line_end: c.line, occurrence_kind: 'call', sha } };
  }
}

