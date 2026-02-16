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

function parsePnpmLock(text, { max = 1200 } = {}) {
  const deps = [];
  const lines = String(text ?? '').split('\n');
  let inImporters = false;
  let inRootImporter = false;
  let inDeps = false;
  for (const line0 of lines) {
    const line = line0.replace(/\r/g, '');
    const t = line.trim();
    if (t === 'importers:') {
      inImporters = true;
      continue;
    }
    if (!inImporters) continue;
    if (/^[A-Za-z]/.test(t) && !t.endsWith(':')) {
      // best-effort: new top-level section
      inImporters = false;
      inRootImporter = false;
      inDeps = false;
      continue;
    }
    if (/^['"]?\.['"]?:$/.test(t)) {
      inRootImporter = true;
      inDeps = false;
      continue;
    }
    if (inRootImporter && (t === 'dependencies:' || t === 'devDependencies:' || t === 'optionalDependencies:')) {
      inDeps = true;
      continue;
    }
    if (inRootImporter && inDeps) {
      const m = t.match(/^(@?[^:]+):\s*(.+)\s*$/);
      if (!m) {
        if (!line.startsWith('    ')) inDeps = false;
        continue;
      }
      const name = m[1].trim();
      const version = m[2].trim().replace(/^['"]|['"]$/g, '') || '*';
      deps.push({ name, version });
      if (deps.length >= max) break;
    }
  }
  return deps;
}

export function parsePnpmLockManifest({ absManifestPath, filePath, sha, packageToUid }) {
  const records = [];
  const manifestNode = makeManifestNode({ filePath, sha });
  records.push({ type: 'node', data: manifestNode });

  const deps = parsePnpmLock(fs.readFileSync(absManifestPath, 'utf8'));
  records.push({
    type: 'dependency_manifest',
    data: { file_path: filePath, sha, manifest_type: 'pnpm-lock.yaml', manifest_key: `${filePath}::${sha}`, parsed: { deps_count: deps.length } }
  });

  for (const dep of deps) {
    const packageKey = `npm:${dep.name}`;
    records.push({ type: 'declared_dependency', data: { manifest_key: `${filePath}::${sha}`, package_key: packageKey, scope: 'lock', version_range: dep.version, metadata: { locked: true } } });
    if (!packageToUid.has(packageKey)) {
      const pkgNode = makePackageNode({ ecosystem: 'npm', name: dep.name, sha });
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
