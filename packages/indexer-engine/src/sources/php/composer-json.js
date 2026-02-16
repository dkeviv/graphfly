import fs from 'node:fs';
import path from 'node:path';
import { computeSignatureHash, makeSymbolUid } from '../../../../cig/src/identity.js';

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function makeManifestNode({ filePath, sha }) {
  const qualifiedName = `manifest:${filePath}`;
  const signature = `manifest ${filePath}`;
  const signatureHash = computeSignatureHash({ signature });
  const symbolUid = makeSymbolUid({ language: 'manifest', qualifiedName, signatureHash });
  return {
    symbol_uid: symbolUid,
    qualified_name: qualifiedName,
    name: path.posix.basename(filePath),
    node_type: 'Manifest',
    symbol_kind: 'manifest',
    file_path: filePath,
    line_start: 1,
    line_end: 1,
    language: 'manifest',
    visibility: 'internal',
    signature,
    signature_hash: signatureHash,
    contract: null,
    constraints: null,
    allowable_values: null,
    first_seen_sha: sha ?? 'mock',
    last_seen_sha: sha ?? 'mock'
  };
}

function makePackageNode({ ecosystem, name, sha }) {
  const qualifiedName = `${ecosystem}:${name}`;
  const signature = `package ${qualifiedName}`;
  const signatureHash = computeSignatureHash({ signature });
  const symbolUid = makeSymbolUid({ language: 'pkg', qualifiedName, signatureHash });
  return {
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
}

export function parseComposerJsonManifest({ absManifestPath, filePath, sha, packageToUid }) {
  const records = [];
  const manifestNode = makeManifestNode({ filePath, sha });
  records.push({ type: 'node', data: manifestNode });

  const parsed = safeJsonParse(fs.readFileSync(absManifestPath, 'utf8')) ?? {};
  records.push({
    type: 'dependency_manifest',
    data: {
      file_path: filePath,
      sha,
      manifest_type: 'composer.json',
      manifest_key: `${filePath}::${sha}`,
      parsed: { require: parsed.require ?? {}, 'require-dev': parsed['require-dev'] ?? {} }
    }
  });

  const declared = [
    ...Object.entries(parsed.require ?? {}).map(([name, range]) => ({ name, range, scope: 'prod' })),
    ...Object.entries(parsed['require-dev'] ?? {}).map(([name, range]) => ({ name, range, scope: 'dev' }))
  ];

  for (const d of declared) {
    const packageKey = `composer:${d.name}`;
    records.push({
      type: 'declared_dependency',
      data: { manifest_key: `${filePath}::${sha}`, package_key: packageKey, scope: d.scope, version_range: String(d.range ?? '*') }
    });
    if (!packageToUid.has(packageKey)) {
      const pkgNode = makePackageNode({ ecosystem: 'composer', name: d.name, sha });
      packageToUid.set(packageKey, pkgNode.symbol_uid);
      records.push({ type: 'node', data: pkgNode });
    }
    records.push({
      type: 'edge',
      data: {
        source_symbol_uid: manifestNode.symbol_uid,
        target_symbol_uid: packageToUid.get(packageKey),
        edge_type: 'DependsOn',
        metadata: { declared: true, scope: d.scope, version_range: String(d.range ?? '*') },
        first_seen_sha: sha,
        last_seen_sha: sha
      }
    });
  }
  return records;
}

