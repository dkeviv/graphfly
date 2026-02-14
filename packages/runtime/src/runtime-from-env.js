import { createRuntime } from './runtime.js';
import { createGraphStoreFromEnv } from '../../stores/src/graph-store.js';

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
  return createRuntime({
    githubWebhookSecret,
    docsRepoFullName,
    docsRepoPath,
    store,
    docStore,
    indexQueue,
    docQueue,
    docsWriter,
    repoRegistry
  });
}

