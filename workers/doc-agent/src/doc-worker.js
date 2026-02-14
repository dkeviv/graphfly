import { generateFlowDocWithOpenClaw } from './openclaw-render.js';

function slugify(key) {
  return String(key).toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-+|-+$/g, '');
}

export function createDocWorker({ store, docsWriter, docStore }) {
  return {
    async handle(job) {
      const { tenantId, repoId } = job.payload ?? {};
      const docsRepoFullName = job.payload?.docsRepoFullName;
      if (typeof docsRepoFullName !== 'string' || docsRepoFullName.length === 0) {
        throw new Error('docsRepoFullName is required');
      }
      const entrypoints = await store.listFlowEntrypoints({ tenantId, repoId });

      const prRun = docStore?.createPrRun?.({ tenantId, repoId, triggerSha: job.payload.sha ?? 'mock', status: 'running' }) ?? null;

      const files = [];
      for (const ep of entrypoints) {
        const symbolUid = ep.entrypoint_symbol_uid ?? ep.symbol_uid;
        const { markdown: md, trace } = await generateFlowDocWithOpenClaw({ store, tenantId, repoId, symbolUid });
        const node = await store.getNodeBySymbolUid({ tenantId, repoId, symbolUid });

        const docPath = `flows/${slugify(ep.entrypoint_key)}.md`;
        // Persist block metadata (optional in this repo's in-memory implementation).
        const block = docStore?.upsertBlock?.({
          tenantId,
          repoId,
          docFile: docPath,
          blockAnchor: `## ${node?.qualified_name ?? symbolUid}`,
          blockType: 'flow',
          content: md,
          status: 'fresh'
        }) ?? null;
        if (block && docStore?.setEvidence) {
          docStore.setEvidence({
            tenantId,
            repoId,
            blockId: block.id,
            evidence: trace.nodes.map((n) => ({
              symbolUid: n.symbol_uid,
              filePath: n.file_path ?? null,
              lineStart: n.line_start ?? null
            }))
          });
        }
        files.push({ path: docPath, content: md });
      }

      const pr = await docsWriter.openPullRequest({
        targetRepoFullName: docsRepoFullName,
        title: 'Graphfly: update docs',
        body: 'Automated update based on Code Intelligence Graph evidence.',
        branchName: `graphfly/docs/${Date.now()}`,
        files
      });
      if (prRun) prRun.status = 'success';
      return { ok: true, pr };
    }
  };
}
