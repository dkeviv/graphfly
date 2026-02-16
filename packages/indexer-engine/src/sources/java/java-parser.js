import { computeSignatureHash, makeSymbolUid } from '../../../../cig/src/identity.js';
import { embedText384 } from '../../../../cig/src/embedding.js';

function parseJavaImports(lines) {
  const imports = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const m = line.match(/^import\s+([A-Za-z0-9_\.]+)\s*;/);
    if (m) imports.push({ path: m[1], line: i + 1 });
  }
  return imports;
}

function parseJavaPublicDecls(lines) {
  const decls = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const cm = line.match(/^\s*public\s+(class|interface|enum)\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
    if (cm) decls.push({ kind: cm[1], name: cm[2], line: i + 1 });
    const mm = line.match(/^\s*public\s+(?:static\s+)?[A-Za-z0-9_<>\[\]]+\s+([a-zA-Z_][A-Za-z0-9_]*)\s*\(/);
    if (mm) decls.push({ kind: 'method', name: mm[1], line: i + 1 });
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

export function* parseJavaFile({ filePath, lines, sha, containerUid, exportedByFile, packageToUid }) {
  const sourceUid = containerUid ?? null;

  for (const d of parseJavaPublicDecls(lines)) {
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

  for (const imp of parseJavaImports(lines)) {
    const parts = imp.path.split('.');
    const pkg = parts.length > 0 ? parts[0] : null;
    if (!pkg) continue;
    const packageKey = `maven:${pkg}`;
    if (packageToUid?.has?.(packageKey)) {
      const pkgUid = packageToUid.get(packageKey);
      yield { type: 'observed_dependency', data: { file_path: filePath, sha, package_key: packageKey, evidence: { import_path: imp.path, line: imp.line } } };
      yield {
        type: 'edge',
        data: {
          source_symbol_uid: sourceUid,
          target_symbol_uid: pkgUid,
          edge_type: 'UsesPackage',
          metadata: { import_path: imp.path },
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
          line_start: imp.line,
          line_end: imp.line,
          occurrence_kind: 'use',
          sha
        }
      };
    }
  }
}

