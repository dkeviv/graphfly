import { createRuntime } from './runtime.js';
import { createGraphStoreFromEnv } from '../../stores/src/graph-store.js';
import { createDocStoreFromEnv } from '../../stores/src/doc-store.js';

export async function createRuntimeFromEnv({
  githubWebhookSecret,
  docsRepoFullName,
  docsRepoPath,
  docStore,
  indexQueue,
  docQueue,
  docsWriter,
  repoRegistry,
  repoFullName = 'local/source'
} = {}) {
  const store = await createGraphStoreFromEnv({ repoFullName });
  const docsStore = docStore ?? (await createDocStoreFromEnv({ repoFullName }));
  return createRuntime({
    githubWebhookSecret,
    docsRepoFullName,
    docsRepoPath,
    store,
    docStore: docsStore,
    indexQueue,
    docQueue,
    docsWriter,
    repoRegistry
  });
}
