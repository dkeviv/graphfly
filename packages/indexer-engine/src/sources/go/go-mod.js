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

function parseGoMod(text) {
  const lines = String(text ?? '').split('\n');
  let moduleName = null;
  const requires = [];
  let inBlock = false;

  for (const line0 of lines) {
    const line = line0.trim();
    if (!line || line.startsWith('//')) continue;
    const mm = line.match(/^module\s+(.+?)\s*$/);
    if (mm) {
      moduleName = mm[1].trim();
      continue;
    }
    if (line.startsWith('require (')) {
      inBlock = true;
      continue;
    }
    if (inBlock && line === ')') {
      inBlock = false;
      continue;
    }
    const rm = line.match(/^require\s+(.+?)\s+([^\s]+)\s*$/);
    if (rm && !inBlock) {
      requires.push({ name: rm[1].trim(), version: rm[2].trim() });
      continue;
    }
    if (inBlock) {
      const bm = line.match(/^(.+?)\s+([^\s]+)\s*$/);
      if (bm) requires.push({ name: bm[1].trim(), version: bm[2].trim() });
    }
  }

  return { moduleName, requires };
}

export function parseGoModManifest({ absManifestPath, filePath, sha, packageToUid }) {
  const records = [];

  const manifestNode = makeManifestNode({ filePath, sha });
  records.push({ type: 'node', data: manifestNode });

  const parsed = parseGoMod(fs.readFileSync(absManifestPath, 'utf8'));
  records.push({
    type: 'dependency_manifest',
    data: {
      file_path: filePath,
      sha,
      manifest_type: 'go.mod',
      manifest_key: `${filePath}::${sha}`,
      parsed
    }
  });

  for (const dep of parsed.requires ?? []) {
    const packageKey = `go:${dep.name}`;
    records.push({
      type: 'declared_dependency',
      data: {
        manifest_key: `${filePath}::${sha}`,
        package_key: packageKey,
        scope: 'prod',
        version_range: dep.version
      }
    });

    if (!packageToUid.has(packageKey)) {
      const pkgNode = makePackageNode({ ecosystem: 'go', name: dep.name, sha });
      packageToUid.set(packageKey, pkgNode.symbol_uid);
      records.push({ type: 'node', data: pkgNode });
    }

    records.push({
      type: 'edge',
      data: {
        source_symbol_uid: manifestNode.symbol_uid,
        target_symbol_uid: packageToUid.get(packageKey),
        edge_type: 'DependsOn',
        metadata: { declared: true, scope: 'prod', version_range: dep.version },
        first_seen_sha: sha,
        last_seen_sha: sha
      }
    });
  }

  return records;
}

