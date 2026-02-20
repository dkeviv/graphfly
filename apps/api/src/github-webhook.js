import { verifyGitHubSignature256 } from '../../../packages/github-webhooks/src/verify.js';

export function makeGitHubWebhookHandler({ secret, dedupe, onPush }) {
  return async ({ headers, rawBody }) => {
    const deliveryId = headers['x-github-delivery'];
    if (typeof deliveryId !== 'string' || deliveryId.length === 0) {
      return { status: 400, body: { error: 'missing_delivery_id' } };
    }

    const sig = headers['x-hub-signature-256'];
    const verified = verifyGitHubSignature256({ secret, rawBody, signature256: sig });
    if (!verified.ok) {
      return { status: 401, body: { error: 'invalid_signature', reason: verified.reason } };
    }

    if (dedupe?.seen?.(deliveryId)) {
      return { status: 202, body: { ok: true, deduped: true } };
    }

    const event = headers['x-github-event'];
    if (event !== 'push') {
      dedupe?.mark?.(deliveryId);
      return { status: 200, body: { ok: true, ignored: true, event } };
    }

    let payload = null;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return { status: 400, body: { error: 'invalid_json' } };
    }

    const ref = payload?.ref ?? '';
    const sha = payload?.after ?? '';
    const fullName = payload?.repository?.full_name ?? '';
    const githubRepoId = payload?.repository?.id ?? null;
    const cloneUrl = payload?.repository?.clone_url ?? payload?.repository?.html_url ?? '';
    const commits = Array.isArray(payload?.commits) ? payload.commits : [];

    const changedFiles = new Set();
    const removedFiles = new Set();
    for (const c of commits) {
      for (const f of c?.added ?? []) changedFiles.add(f);
      for (const f of c?.modified ?? []) changedFiles.add(f);
      for (const f of c?.removed ?? []) removedFiles.add(f);
    }

    await onPush({
      deliveryId,
      fullName,
      githubRepoId: typeof githubRepoId === 'number' ? githubRepoId : null,
      ref,
      sha,
      cloneUrl: typeof cloneUrl === 'string' && cloneUrl.length > 0 ? cloneUrl : null,
      changedFiles: Array.from(changedFiles),
      removedFiles: Array.from(removedFiles)
    });

    dedupe?.mark?.(deliveryId);
    return { status: 200, body: { ok: true } };
  };
}
