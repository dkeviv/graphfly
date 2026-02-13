export function assertDocsRepoOnlyWrite({ configuredDocsRepoFullName, targetRepoFullName }) {
  if (typeof configuredDocsRepoFullName !== 'string' || configuredDocsRepoFullName.length === 0) {
    throw new Error('configuredDocsRepoFullName is required');
  }
  if (typeof targetRepoFullName !== 'string' || targetRepoFullName.length === 0) {
    throw new Error('targetRepoFullName is required');
  }
  if (configuredDocsRepoFullName !== targetRepoFullName) {
    throw new Error('write_denied_target_not_docs_repo');
  }
}

