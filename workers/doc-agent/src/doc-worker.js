import { validateDocBlockMarkdown } from '../../../packages/doc-blocks/src/validate.js';
import { renderContractDocBlock } from './doc-block-render.js';

function slugify(key) {
  return String(key).toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-+|-+$/g, '');
}

export function createDocWorker({ store, docsWriter, docStore }) {
  return {
    async handle(job) {
      const { tenantId, repoId } = job.payload ?? {};
      const entrypoints = store.listFlowEntrypoints({ tenantId, repoId });

      const prRun = docStore?.createPrRun?.({ tenantId, repoId, triggerSha: job.payload.sha ?? 'mock', status: 'running' }) ?? null;

      const files = [];
      for (const ep of entrypoints) {
        const symbolUid = ep.entrypoint_symbol_uid ?? ep.symbol_uid;
        const node = store.getNodeBySymbolUid({ tenantId, repoId, symbolUid });
        if (!node) continue;

        const contractPayload = {
          symbolUid: node.symbol_uid,
          qualifiedName: node.qualified_name,
          signature: node.signature,
          contract: node.contract ?? null,
          constraints: node.constraints ?? null,
          allowableValues: node.allowable_values ?? null,
          location: { filePath: node.file_path, lineStart: node.line_start, lineEnd: node.line_end }
        };

        const md = renderContractDocBlock(contractPayload);
        const v = validateDocBlockMarkdown(md);
        if (!v.ok) throw new Error(`doc_block_invalid:${v.reason}`);

        const docPath = `flows/${slugify(ep.entrypoint_key)}.md`;
        // Persist block metadata (optional in this repo's in-memory implementation).
        const block = docStore?.upsertBlock?.({
          tenantId,
          repoId,
          docFile: docPath,
          blockAnchor: `## ${contractPayload.qualifiedName ?? contractPayload.symbolUid}`,
          blockType: 'flow',
          content: md,
          status: 'fresh'
        }) ?? null;
        if (block && docStore?.setEvidence) {
          docStore.setEvidence({
            tenantId,
            repoId,
            blockId: block.id,
            evidence: [
              { symbolUid: contractPayload.symbolUid, filePath: contractPayload.location.filePath, lineStart: contractPayload.location.lineStart }
            ]
          });
        }
        files.push({ path: docPath, content: md });
      }

      const pr = await docsWriter.openPullRequest({
        targetRepoFullName: job.payload.docsRepoFullName,
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
