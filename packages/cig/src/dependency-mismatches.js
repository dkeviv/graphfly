function uniq(arr) {
  return Array.from(new Set(Array.isArray(arr) ? arr : []));
}

function filePathFromManifestKey(manifestKey) {
  const s = String(manifestKey ?? '');
  const idx = s.indexOf('::');
  if (idx <= 0) return null;
  return s.slice(0, idx);
}

export function computeDependencyMismatches({ declared = [], observed = [], sha = 'mock' } = {}) {
  const declaredByPkg = new Map(); // pkg -> { ranges:Set, scopes:Set, manifests:Set, files:Set }
  const observedByPkg = new Map(); // pkg -> { files:Set }

  for (const d of Array.isArray(declared) ? declared : []) {
    const pkg = String(d?.package_key ?? '');
    if (!pkg) continue;
    const range = String(d?.version_range ?? '*') || '*';
    const scope = String(d?.scope ?? 'unknown') || 'unknown';
    const manifestKey = String(d?.manifest_key ?? '');
    const filePath = filePathFromManifestKey(manifestKey);
    if (!declaredByPkg.has(pkg)) declaredByPkg.set(pkg, { ranges: new Set(), scopes: new Set(), manifests: new Set(), files: new Set() });
    const entry = declaredByPkg.get(pkg);
    entry.ranges.add(range);
    entry.scopes.add(scope);
    if (manifestKey) entry.manifests.add(manifestKey);
    if (filePath) entry.files.add(filePath);
  }

  for (const o of Array.isArray(observed) ? observed : []) {
    const pkg = String(o?.package_key ?? '');
    if (!pkg) continue;
    const filePath = typeof o?.file_path === 'string' ? o.file_path : null;
    if (!observedByPkg.has(pkg)) observedByPkg.set(pkg, { files: new Set() });
    if (filePath) observedByPkg.get(pkg).files.add(filePath);
  }

  const declaredKeys = new Set(declaredByPkg.keys());
  const observedKeys = new Set(observedByPkg.keys());

  const mismatches = [];

  for (const pkg of declaredKeys) {
    if (observedKeys.has(pkg)) continue;
    const entry = declaredByPkg.get(pkg);
    mismatches.push({
      mismatch_type: 'declared_not_observed',
      package_key: pkg,
      details: {
        declared_in_files: Array.from(entry.files).sort(),
        scopes: Array.from(entry.scopes).sort(),
        version_ranges: Array.from(entry.ranges).sort()
      },
      sha
    });
  }

  for (const pkg of observedKeys) {
    if (declaredKeys.has(pkg)) continue;
    const entry = observedByPkg.get(pkg);
    mismatches.push({
      mismatch_type: 'observed_not_declared',
      package_key: pkg,
      details: { observed_in_files: Array.from(entry.files).sort() },
      sha
    });
  }

  for (const [pkg, entry] of declaredByPkg.entries()) {
    const ranges = Array.from(entry.ranges);
    if (ranges.length <= 1) continue;
    const manifests = uniq(Array.from(entry.manifests)).sort();
    mismatches.push({
      mismatch_type: 'version_conflict',
      package_key: pkg,
      details: {
        package_key: pkg,
        version_ranges: ranges.sort(),
        manifests
      },
      sha
    });
  }

  return mismatches;
}

