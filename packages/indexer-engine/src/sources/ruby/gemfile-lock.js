import fs from 'node:fs';
import path from 'node:path';
import { computeSignatureHash, makeSymbolUid } from '../../../../cig/src/identity.js';

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

function parseGemfileLock(text, { max = 1200 } = {}) {
  const deps = [];
  const lines = String(text ?? '').split('\n');
  let inSpecs = false;
  for (const line0 of lines) {
    const line = line0.replace(/\r/g, '');
    if (line.trim() === 'specs:') {
      inSpecs = true;
      continue;
    }
    if (!inSpecs) continue;
    if (line.trim() === '' || /^[A-Z ]+$/.test(line.trim())) continue;
    const m = line.match(/^\s{4}([A-Za-z0-9_.-]+)\s+\(([^)]+)\)/);
    if (m) {
      deps.push({ name: m[1], version: m[2] });
      if (deps.length >= max) break;
    }
  }
  return { deps };
}

export function parseGemfileLockManifest({ absManifestPath, filePath, sha, packageToUid }) {
  const records = [];
  const manifestNode = makeManifestNode({ filePath, sha });
  records.push({ type: 'node', data: manifestNode });

  const parsed = parseGemfileLock(fs.readFileSync(absManifestPath, 'utf8'));
  records.push({
    type: 'dependency_manifest',
    data: { file_path: filePath, sha, manifest_type: 'Gemfile.lock', manifest_key: `${filePath}::${sha}`, parsed: { deps_count: parsed.deps.length } }
  });

  for (const dep of parsed.deps) {
    const packageKey = `gem:${dep.name}`;
    records.push({
      type: 'declared_dependency',
      data: { manifest_key: `${filePath}::${sha}`, package_key: packageKey, scope: 'lock', version_range: dep.version, metadata: { locked: true } }
    });
    if (!packageToUid.has(packageKey)) {
      const pkgNode = makePackageNode({ ecosystem: 'gem', name: dep.name, sha });
      packageToUid.set(packageKey, pkgNode.symbol_uid);
      records.push({ type: 'node', data: pkgNode });
    }
    records.push({
      type: 'edge',
      data: { source_symbol_uid: manifestNode.symbol_uid, target_symbol_uid: packageToUid.get(packageKey), edge_type: 'DependsOn', metadata: { declared: true, scope: 'lock', version_range: dep.version, locked: true }, first_seen_sha: sha, last_seen_sha: sha }
    });
  }

  return records;
}

