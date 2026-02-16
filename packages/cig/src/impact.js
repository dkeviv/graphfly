import { blastRadius } from './query.js';

function uniq(arr) {
  return Array.from(new Set(arr));
}

async function expandImporters({ store, tenantId, repoId, startFiles, maxDepth = 3, maxFiles = 5000 } = {}) {
  const seen = new Set(startFiles);
  let frontier = Array.from(startFiles);
  for (let d = 0; d < maxDepth; d++) {
    if (frontier.length === 0) break;
    const importers = await Promise.resolve(store.listImportersForFilePaths?.({ tenantId, repoId, filePaths: frontier }));
    const next = [];
    for (const fp of importers ?? []) {
      if (seen.has(fp)) continue;
      seen.add(fp);
      next.push(fp);
      if (seen.size >= maxFiles) return Array.from(seen);
    }
    frontier = next;
  }
  return Array.from(seen);
}

export async function computeImpact({
  store,
  tenantId,
  repoId,
  changedFiles = [],
  removedFiles = [],
  depth = 2
}) {
  const changedSet = new Set([...(Array.isArray(changedFiles) ? changedFiles : []), ...(Array.isArray(removedFiles) ? removedFiles : [])]);
  const startFiles = Array.from(changedSet);

  // Reparse scope includes reverse-importers deterministically (cross-file/module impacts).
  const impactedByImports = await expandImporters({ store, tenantId, repoId, startFiles: startFiles, maxDepth: 3 });

  // Changed symbols are any nodes in changed/removed files.
  const changedSymbolUids =
    (await Promise.resolve(store.listSymbolUidsForFilePaths?.({ tenantId, repoId, filePaths: Array.from(changedSet) }))) ?? [];

  const impactedSet = new Set(changedSymbolUids);
  for (const uid of changedSymbolUids ?? []) {
    for (const other of await blastRadius({ store, tenantId, repoId, symbolUid: uid, depth, direction: 'both' })) {
      impactedSet.add(other);
    }
  }

  const impactedSymbolUids = Array.from(impactedSet);
  const impactedFilesFromSymbols =
    typeof store.listFilePathsForSymbolUids === 'function'
      ? await Promise.resolve(store.listFilePathsForSymbolUids({ tenantId, repoId, symbolUids: impactedSymbolUids }))
      : (
          await Promise.all(
            impactedSymbolUids.map(async (uid) => (await store.getNodeBySymbolUid({ tenantId, repoId, symbolUid: uid }))?.file_path ?? null)
          )
        ).filter(Boolean);

  const impactedFiles = uniq([...impactedByImports, ...impactedFilesFromSymbols]);

  const reparsedFiles = uniq([...changedFiles, ...impactedFiles]);

  return {
    changedFiles,
    changedSymbolUids,
    impactedSymbolUids,
    impactedFiles,
    reparsedFiles
  };
}
