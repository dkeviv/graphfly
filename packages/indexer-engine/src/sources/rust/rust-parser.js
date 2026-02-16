import { computeSignatureHash, makeSymbolUid } from '../../../../cig/src/identity.js';
import { embedText384 } from '../../../../cig/src/embedding.js';

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
    const m = line.match(/^use\s+([A-Za-z0-9_]+)::/);
    if (m) uses.push({ crate: m[1], line: i + 1 });
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

export function* parseRustFile({ filePath, lines, sha, containerUid, exportedByFile, packageToUid }) {
  const sourceUid = containerUid ?? null;

  for (const d of parseRustPublicDecls(lines)) {
    const node = makeSymbolNode({ kind: d.kind, name: d.name, filePath, line: d.line, sha, containerUid: sourceUid });
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

  for (const u of parseRustUses(lines)) {
    const packageKey = `cargo:${u.crate}`;
    if (packageToUid?.has?.(packageKey)) {
      const pkgUid = packageToUid.get(packageKey);
      yield { type: 'observed_dependency', data: { file_path: filePath, sha, package_key: packageKey, evidence: { use_crate: u.crate, line: u.line } } };
      yield {
        type: 'edge',
        data: {
          source_symbol_uid: sourceUid,
          target_symbol_uid: pkgUid,
          edge_type: 'UsesPackage',
          metadata: { use_crate: u.crate },
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
  }
}

