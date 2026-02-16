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

function parsePackagesLock(json, { max = 2000 } = {}) {
  const out = [];
  const deps = json?.dependencies && typeof json.dependencies === 'object' ? json.dependencies : null;
  if (!deps) return out;
  for (const [name, info] of Object.entries(deps)) {
    if (out.length >= max) break;
    const resolved = info?.resolved ?? info?.requested ?? null;
    const version = typeof resolved === 'string' ? resolved : typeof info?.version === 'string' ? info.version : '*';
    out.push({ name, version });
  }
  return out;
}

export function parseNuGetPackagesLockManifest({ absManifestPath, filePath, sha, packageToUid }) {
  const records = [];
  const manifestNode = makeManifestNode({ filePath, sha });
  records.push({ type: 'node', data: manifestNode });

  const parsed = safeJsonParse(fs.readFileSync(absManifestPath, 'utf8')) ?? {};
  const deps = parsePackagesLock(parsed);
  records.push({
    type: 'dependency_manifest',
    data: { file_path: filePath, sha, manifest_type: 'packages.lock.json', manifest_key: `${filePath}::${sha}`, parsed: { deps_count: deps.length } }
  });

  for (const dep of deps) {
    const packageKey = `nuget:${dep.name}`;
    records.push({ type: 'declared_dependency', data: { manifest_key: `${filePath}::${sha}`, package_key: packageKey, scope: 'lock', version_range: dep.version, metadata: { locked: true } } });
    if (!packageToUid.has(packageKey)) {
      const pkgNode = makePackageNode({ ecosystem: 'nuget', name: dep.name, sha });
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

