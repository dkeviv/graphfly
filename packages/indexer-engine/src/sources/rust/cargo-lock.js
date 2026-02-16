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

function parseCargoLock(text, { max = 1000 } = {}) {
  const lines = String(text ?? '').split('\n');
  const deps = [];
  let inPkg = false;
  let name = null;
  let version = null;

  function flush() {
    if (name && version) deps.push({ name, version });
    name = null;
    version = null;
  }

  for (const line0 of lines) {
    const line = line0.trim();
    if (line === '[[package]]') {
      if (deps.length >= max) break;
      if (inPkg) flush();
      inPkg = true;
      continue;
    }
    if (!inPkg) continue;
    const nm = line.match(/^name\s*=\s*\"([^\"]+)\"/);
    if (nm) {
      name = nm[1];
      continue;
    }
    const vm = line.match(/^version\s*=\s*\"([^\"]+)\"/);
    if (vm) {
      version = vm[1];
      continue;
    }
  }
  if (inPkg) flush();
  return { deps };
}

export function parseCargoLockManifest({ absManifestPath, filePath, sha, packageToUid }) {
  const records = [];
  const manifestNode = makeManifestNode({ filePath, sha });
  records.push({ type: 'node', data: manifestNode });

  const parsed = parseCargoLock(fs.readFileSync(absManifestPath, 'utf8'));
  records.push({
    type: 'dependency_manifest',
    data: { file_path: filePath, sha, manifest_type: 'Cargo.lock', manifest_key: `${filePath}::${sha}`, parsed: { deps_count: parsed.deps.length } }
  });

  for (const dep of parsed.deps) {
    const packageKey = `cargo:${dep.name}`;
    records.push({
      type: 'declared_dependency',
      data: { manifest_key: `${filePath}::${sha}`, package_key: packageKey, scope: 'lock', version_range: dep.version, metadata: { locked: true } }
    });
    if (!packageToUid.has(packageKey)) {
      const pkgNode = makePackageNode({ ecosystem: 'cargo', name: dep.name, sha });
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

