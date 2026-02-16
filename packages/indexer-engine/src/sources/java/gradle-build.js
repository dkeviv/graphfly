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

function parseGradle(text, { max = 800 } = {}) {
  const deps = [];
  const lines = String(text ?? '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (deps.length >= max) break;
    const line = lines[i].trim();
    if (!line || line.startsWith('//')) continue;
    const m = line.match(/^(implementation|api|compileOnly|runtimeOnly|testImplementation|testApi)\s+['"]([^'"]+)['"]/);
    if (!m) continue;
    const cfg = m[1];
    const coord = m[2];
    const parts = coord.split(':');
    if (parts.length < 2) continue;
    const groupId = parts[0];
    const artifactId = parts[1];
    const version = parts[2] ?? '*';
    const scope = cfg.startsWith('test') ? 'test' : cfg === 'compileOnly' ? 'build' : 'prod';
    deps.push({ groupId, artifactId, version, scope });
  }
  return { deps };
}

export function parseGradleBuildManifest({ absManifestPath, filePath, sha, packageToUid }) {
  const records = [];
  const manifestNode = makeManifestNode({ filePath, sha });
  records.push({ type: 'node', data: manifestNode });

  const parsed = parseGradle(fs.readFileSync(absManifestPath, 'utf8'));
  records.push({
    type: 'dependency_manifest',
    data: { file_path: filePath, sha, manifest_type: path.posix.basename(filePath), manifest_key: `${filePath}::${sha}`, parsed: { deps_count: parsed.deps.length } }
  });

  for (const dep of parsed.deps) {
    const name = `${dep.groupId}:${dep.artifactId}`;
    const packageKey = `maven:${name}`;
    records.push({
      type: 'declared_dependency',
      data: { manifest_key: `${filePath}::${sha}`, package_key: packageKey, scope: dep.scope ?? 'prod', version_range: dep.version ?? '*' }
    });
    if (!packageToUid.has(packageKey)) {
      const pkgNode = makePackageNode({ ecosystem: 'maven', name, sha });
      packageToUid.set(packageKey, pkgNode.symbol_uid);
      records.push({ type: 'node', data: pkgNode });
    }
    records.push({
      type: 'edge',
      data: { source_symbol_uid: manifestNode.symbol_uid, target_symbol_uid: packageToUid.get(packageKey), edge_type: 'DependsOn', metadata: { declared: true, scope: dep.scope ?? 'prod', version_range: dep.version ?? '*' }, first_seen_sha: sha, last_seen_sha: sha }
    });
  }

  return records;
}

