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

function parseArrayLiteral(line) {
  const m = String(line ?? '').match(/\[(.*)\]/);
  if (!m) return [];
  const body = m[1];
  const out = [];
  for (const part of body.split(',')) {
    const s = part.trim();
    const mm = s.match(/^['"]([^'"]+)['"]/);
    if (mm) out.push(mm[1]);
  }
  return out;
}

function parsePep508(dep) {
  const s = String(dep ?? '').trim();
  if (!s) return null;
  // e.g. "requests>=2.0", "pydantic (>=2.0)", "uvicorn[standard]>=0.23; python_version>='3.11'"
  const cleaned = s.split(';')[0].trim();
  const nameMatch = cleaned.match(/^([A-Za-z0-9_.-]+)/);
  if (!nameMatch) return null;
  const name = nameMatch[1];
  const version = cleaned.slice(name.length).trim() || '*';
  return { name, version };
}

function parsePyprojectToml(text) {
  const lines = String(text ?? '').split('\n');
  let section = null;
  let projectDeps = [];
  let poetryDeps = [];
  let optionalDeps = [];

  for (const line0 of lines) {
    const line = line0.trim();
    if (!line || line.startsWith('#')) continue;
    const sm = line.match(/^\[([^\]]+)\]\s*$/);
    if (sm) {
      section = sm[1];
      continue;
    }
    if (section === 'project' && line.startsWith('dependencies')) {
      projectDeps = parseArrayLiteral(line);
      continue;
    }
    if (section === 'project.optional-dependencies' && line.includes('=')) {
      // `group = [ ... ]`
      optionalDeps.push(...parseArrayLiteral(line));
      continue;
    }
    if (section === 'tool.poetry.dependencies' && line.includes('=')) {
      const m = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*['"]([^'"]+)['"]/);
      if (m) poetryDeps.push(`${m[1]}${m[2] ? m[2] : ''}`);
      continue;
    }
  }

  const deps = [];
  for (const raw of [...projectDeps, ...optionalDeps, ...poetryDeps]) {
    const p = parsePep508(raw);
    if (p) deps.push(p);
  }
  return { deps };
}

export function parsePyprojectTomlManifest({ absManifestPath, filePath, sha, packageToUid }) {
  const records = [];
  const manifestNode = makeManifestNode({ filePath, sha });
  records.push({ type: 'node', data: manifestNode });

  const parsed = parsePyprojectToml(fs.readFileSync(absManifestPath, 'utf8'));
  records.push({
    type: 'dependency_manifest',
    data: { file_path: filePath, sha, manifest_type: 'pyproject.toml', manifest_key: `${filePath}::${sha}`, parsed: { deps_count: parsed.deps.length } }
  });

  for (const dep of parsed.deps) {
    const packageKey = `pypi:${dep.name}`;
    records.push({ type: 'declared_dependency', data: { manifest_key: `${filePath}::${sha}`, package_key: packageKey, scope: 'prod', version_range: dep.version } });
    if (!packageToUid.has(packageKey)) {
      const pkgNode = makePackageNode({ ecosystem: 'pypi', name: dep.name, sha });
      packageToUid.set(packageKey, pkgNode.symbol_uid);
      records.push({ type: 'node', data: pkgNode });
    }
    records.push({
      type: 'edge',
      data: { source_symbol_uid: manifestNode.symbol_uid, target_symbol_uid: packageToUid.get(packageKey), edge_type: 'DependsOn', metadata: { declared: true, scope: 'prod', version_range: dep.version }, first_seen_sha: sha, last_seen_sha: sha }
    });
  }

  return records;
}

