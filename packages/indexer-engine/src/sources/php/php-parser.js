import { computeSignatureHash, makeSymbolUid } from '../../../../cig/src/identity.js';
import { embedText384 } from '../../../../cig/src/embedding.js';

function parsePhpUses(lines) {
  const uses = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const m = line.match(/^use\s+([A-Za-z0-9_\\\\]+)\s*;/);
    if (m) uses.push({ ns: m[1], line: i + 1 });
  }
  return uses;
}

function parsePhpDecls(lines) {
  const decls = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const cm = line.match(/^\s*(?:final\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (cm) decls.push({ kind: 'class', name: cm[1], line: i + 1 });
    const im = line.match(/^\s*interface\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (im) decls.push({ kind: 'interface', name: im[1], line: i + 1 });
    const fm = line.match(/^\s*function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (fm) decls.push({ kind: 'function', name: fm[1], line: i + 1 });
    const pm = line.match(/^\s*public\s+function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (pm) decls.push({ kind: 'method', name: pm[1], line: i + 1 });
  }
  return decls;
}

function makeSymbolNode({ kind, name, filePath, line, sha, containerUid }) {
  const qualifiedName = `${filePath}::${name}`;
  const signature = kind === 'function' || kind === 'method' ? `${kind} ${name}()` : `${kind} ${name}`;
  const signatureHash = computeSignatureHash({ signature });
  const symbolUid = makeSymbolUid({ language: 'php', qualifiedName, signatureHash });
  const embeddingText = `${qualifiedName} ${signature}`;
  return {
    symbol_uid: symbolUid,
    qualified_name: qualifiedName,
    name,
    node_type: kind === 'function' || kind === 'method' ? 'Function' : 'Class',
    symbol_kind: kind,
    container_uid: containerUid,
    file_path: filePath,
    line_start: line,
    line_end: line,
    language: 'php',
    visibility: kind === 'method' ? 'public' : 'public',
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

export function* parsePhpFile({ filePath, lines, sha, containerUid, exportedByFile, packageToUid }) {
  const sourceUid = containerUid ?? null;

  for (const d of parsePhpDecls(lines)) {
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

  for (const u of parsePhpUses(lines)) {
    const root = u.ns.split('\\')[0];
    if (!root) continue;
    const packageKey = `composer:${root.toLowerCase()}/${root.toLowerCase()}`;
    if (packageToUid?.has?.(packageKey)) {
      const pkgUid = packageToUid.get(packageKey);
      yield { type: 'observed_dependency', data: { file_path: filePath, sha, package_key: packageKey, evidence: { use_ns: u.ns, line: u.line } } };
      yield {
        type: 'edge',
        data: {
          source_symbol_uid: sourceUid,
          target_symbol_uid: pkgUid,
          edge_type: 'UsesPackage',
          metadata: { use_ns: u.ns },
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

