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

function parseCsproj(text, { max = 1200 } = {}) {
  const xml = String(text ?? '');
  const deps = [];
  const re = /<PackageReference\s+[^>]*Include=\"([^\"]+)\"[^>]*>/gi;
  let m;
  while ((m = re.exec(xml))) {
    if (deps.length >= max) break;
    const include = m[1];
    // Version can be an attribute or nested element; handle both best-effort.
    const tail = xml.slice(m.index, Math.min(xml.length, m.index + 600));
    const verAttr = tail.match(/Version=\"([^\"]+)\"/i)?.[1] ?? null;
    const verElem = tail.match(/<Version>\s*([^<\s]+)\s*<\/Version>/i)?.[1] ?? null;
    const version = verAttr ?? verElem ?? '*';
    deps.push({ name: include, version, scope: 'prod' });
  }
  return { deps };
}

export function parseCsprojManifest({ absManifestPath, filePath, sha, packageToUid }) {
  const records = [];
  const manifestNode = makeManifestNode({ filePath, sha });
  records.push({ type: 'node', data: manifestNode });

  const parsed = parseCsproj(fs.readFileSync(absManifestPath, 'utf8'));
  records.push({
    type: 'dependency_manifest',
    data: { file_path: filePath, sha, manifest_type: '*.csproj', manifest_key: `${filePath}::${sha}`, parsed: { deps_count: parsed.deps.length } }
  });

  for (const dep of parsed.deps) {
    const packageKey = `nuget:${dep.name}`;
    records.push({ type: 'declared_dependency', data: { manifest_key: `${filePath}::${sha}`, package_key: packageKey, scope: dep.scope ?? 'prod', version_range: dep.version } });
    if (!packageToUid.has(packageKey)) {
      const pkgNode = makePackageNode({ ecosystem: 'nuget', name: dep.name, sha });
      packageToUid.set(packageKey, pkgNode.symbol_uid);
      records.push({ type: 'node', data: pkgNode });
    }
    records.push({
      type: 'edge',
      data: { source_symbol_uid: manifestNode.symbol_uid, target_symbol_uid: packageToUid.get(packageKey), edge_type: 'DependsOn', metadata: { declared: true, scope: dep.scope ?? 'prod', version_range: dep.version }, first_seen_sha: sha, last_seen_sha: sha }
    });
  }

  return records;
}

