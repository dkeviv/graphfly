import { blastRadius } from './query.js';

function uniq(arr) {
  return Array.from(new Set(arr));
}

export async function computeImpact({
  store,
  tenantId,
  repoId,
  changedFiles = [],
  depth = 2
}) {
  const changed = new Set(changedFiles);
  const nodes = await store.listNodes({ tenantId, repoId });
  const changedSymbolUids = nodes
    .filter((n) => n.file_path && changed.has(n.file_path))
    .map((n) => n.symbol_uid);

  const impactedSet = new Set(changedSymbolUids);
  for (const uid of changedSymbolUids) {
    for (const other of await blastRadius({ store, tenantId, repoId, symbolUid: uid, depth, direction: 'both' })) {
      impactedSet.add(other);
    }
  }

  const impactedSymbolUids = Array.from(impactedSet);
  const impactedFiles = uniq(
    (
      await Promise.all(
        impactedSymbolUids.map(async (uid) => (await store.getNodeBySymbolUid({ tenantId, repoId, symbolUid: uid }))?.file_path ?? null)
      )
    ).filter(Boolean)
  );

  const reparsedFiles = uniq([...changedFiles, ...impactedFiles]);

  return {
    changedFiles,
    changedSymbolUids,
    impactedSymbolUids,
    impactedFiles,
    reparsedFiles
  };
}
