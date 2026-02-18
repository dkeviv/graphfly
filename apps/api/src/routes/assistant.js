import { runDocsAssistantQuery, runDocsAssistantDraftDocs } from '../../../../packages/assistant-agent/src/assistant-agent.js';
import { validateDocBlockMarkdown } from '../../../../packages/doc-blocks/src/validate.js';
import { redactSecrets } from '../../../../packages/security/src/redact.js';

function clampInt(x, { min, max, fallback }) {
  const n = Number(x);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function truncateString(s, maxLen) {
  const str = String(s ?? '');
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '…';
}

function safeDocPath(p) {
  const s = String(p ?? '').replaceAll('\\', '/').replaceAll(/\/+/g, '/');
  if (!s || s.startsWith('/') || s.includes('..')) throw new Error('invalid_doc_path');
  if (!s.endsWith('.md')) throw new Error('doc_path_must_end_with_md');
  if (s.length > 500) throw new Error('doc_path_too_long');
  return s;
}

export function registerAssistantRoutes({
  router,
  store,
  docStore,
  assistantStore,
  orgStore,
  repoStore,
  docsRepoFullNameFallback = null,
  docsWriterFactory,
  docsReaderFactory,
  lockStore,
  realtime,
  auditEvent,
  requireRole,
  tenantIdFromCtx,
  DEFAULT_TENANT_ID,
  DEFAULT_REPO_ID
}) {
  if (!router) throw new Error('router is required');

  async function resolveOrgDocsRepo({ tenantId, repoId }) {
    const repo =
      repoId && repoStore?.getRepo ? await Promise.resolve(repoStore.getRepo({ tenantId, repoId })) : null;
    const org = await Promise.resolve(orgStore?.getOrg?.({ tenantId }));
    const docsRepoFullName = repo?.docsRepoFullName ?? org?.docsRepoFullName ?? docsRepoFullNameFallback ?? null;
    return { repo, org, docsRepoFullName };
  }

  const createThreadHandler = async (req) => {
    const tenantId = tenantIdFromCtx(req, DEFAULT_TENANT_ID);
    const forbid = requireRole(req, 'member');
    if (forbid) return forbid;
    const repoId = req.body?.repoId ?? req.query?.repoId ?? DEFAULT_REPO_ID;
    const title = req.body?.title ?? null;
    const mode = req.body?.mode ?? 'support_safe';
    if (!assistantStore?.createThread) return { status: 501, body: { error: 'assistant_threads_not_supported' } };
    const thread = await assistantStore.createThread({ tenantId, repoId, title, mode });
    return { status: 200, body: { thread } };
  };

  router.post('/assistant/threads', createThreadHandler);
  router.post('/api/v1/assistant/threads', createThreadHandler);

  const listThreadsHandler = async (req) => {
    const tenantId = tenantIdFromCtx(req, DEFAULT_TENANT_ID);
    const forbid = requireRole(req, 'member');
    if (forbid) return forbid;
    const repoId = req.query?.repoId ?? DEFAULT_REPO_ID;
    const limit = req.query?.limit ?? 50;
    const includeArchived = req.query?.includeArchived === '1' || req.query?.includeArchived === 'true';
    if (!assistantStore?.listThreads) return { status: 501, body: { error: 'assistant_threads_not_supported' } };
    const threads = await assistantStore.listThreads({ tenantId, repoId, includeArchived, limit });
    return { status: 200, body: { threads } };
  };

  router.get('/assistant/threads', listThreadsHandler);
  router.get('/api/v1/assistant/threads', listThreadsHandler);

  const getThreadHandler = async (req) => {
    const tenantId = tenantIdFromCtx(req, DEFAULT_TENANT_ID);
    const forbid = requireRole(req, 'member');
    if (forbid) return forbid;
    const repoId = req.query?.repoId ?? DEFAULT_REPO_ID;
    const threadId = req.query?.threadId ?? null;
    const limit = req.query?.limit ?? 50;
    if (typeof threadId !== 'string' || threadId.length === 0) return { status: 400, body: { error: 'threadId_required' } };
    if (!assistantStore?.getThread || !assistantStore?.listMessages) return { status: 501, body: { error: 'assistant_threads_not_supported' } };
    const thread = await assistantStore.getThread({ tenantId, repoId, threadId });
    if (!thread) return { status: 404, body: { error: 'not_found' } };
    const messages = await assistantStore.listMessages({ tenantId, repoId, threadId, limit });
    return { status: 200, body: { thread, messages } };
  };

  router.get('/assistant/thread', getThreadHandler);
  router.get('/api/v1/assistant/thread', getThreadHandler);

  const queryHandler = async (req) => {
    const tenantId = tenantIdFromCtx(req, DEFAULT_TENANT_ID);
    const forbid = requireRole(req, 'member');
    if (forbid) return forbid;
    const repoId = req.body?.repoId ?? req.query?.repoId ?? DEFAULT_REPO_ID;
    const question = req.body?.question ?? req.body?.q ?? null;
    const threadId = req.body?.threadId ?? req.query?.threadId ?? null;
    let mode = req.body?.mode ?? req.query?.mode ?? 'support_safe';
    if (typeof question !== 'string' || question.trim().length === 0) return { status: 400, body: { error: 'question_required' } };

    let contextMessages = null;
    if (threadId) {
      if (!assistantStore?.getThread || !assistantStore?.listMessages || !assistantStore?.addMessage) return { status: 501, body: { error: 'assistant_threads_not_supported' } };
      const thread = await assistantStore.getThread({ tenantId, repoId, threadId });
      if (!thread) return { status: 404, body: { error: 'thread_not_found' } };
      if (req.body?.mode == null && req.query?.mode == null) mode = thread.mode ?? mode;
      contextMessages = await assistantStore.listMessages({ tenantId, repoId, threadId, limit: 20 });
      await assistantStore.addMessage({ tenantId, repoId, threadId, role: 'user', content: question, citations: [] });
    }

    const { docsRepoFullName } = await resolveOrgDocsRepo({ tenantId, repoId });
    const docsReader =
      typeof docsReaderFactory === 'function' && docsRepoFullName
        ? await docsReaderFactory({ tenantId, configuredDocsRepoFullName: docsRepoFullName })
        : null;

    const out = await runDocsAssistantQuery({
      store,
      docStore,
      docsReader,
      tenantId,
      repoId,
      question,
      mode,
      contextMessages,
      onEvent: (type, payload) => realtime?.publish?.({ tenantId, repoId, type, payload })
    });

    if (threadId) {
      await assistantStore.addMessage({
        tenantId,
        repoId,
        threadId,
        role: 'assistant',
        content: out.answerMarkdown ?? '',
        citations: out.citations ?? []
      });
    }

    await auditEvent?.({
      tenantId,
      actorUserId: req.auth?.userId ?? null,
      action: 'assistant.query',
      targetType: 'repo',
      targetId: repoId,
      metadata: { mode, threadId: threadId ?? null }
    });
    return { status: 200, body: out };
  };

  router.post('/assistant/query', queryHandler);
  router.post('/api/v1/assistant/query', queryHandler);

  const draftHandler = async (req) => {
    const tenantId = tenantIdFromCtx(req, DEFAULT_TENANT_ID);
    const forbid = requireRole(req, 'admin');
    if (forbid) return forbid;
    const repoId = req.body?.repoId ?? req.query?.repoId ?? DEFAULT_REPO_ID;
    const instruction = req.body?.instruction ?? req.body?.prompt ?? null;
    const mode = req.body?.mode ?? 'support_safe';
    if (typeof instruction !== 'string' || instruction.trim().length === 0) return { status: 400, body: { error: 'instruction_required' } };

    const { docsRepoFullName } = await resolveOrgDocsRepo({ tenantId, repoId });
    if (!docsRepoFullName) return { status: 400, body: { error: 'docs_repo_not_configured' } };

    const docsReader =
      typeof docsReaderFactory === 'function' ? await docsReaderFactory({ tenantId, configuredDocsRepoFullName: docsRepoFullName }) : null;

    const out = await runDocsAssistantDraftDocs({
      store,
      docStore,
      docsReader,
      tenantId,
      repoId,
      instruction,
      docsRepoFullName,
      mode,
      onEvent: (type, payload) => realtime?.publish?.({ tenantId, repoId, type, payload })
    });

    const ttlHours = clampInt(process.env.GRAPHFLY_ASSISTANT_DRAFT_TTL_HOURS ?? 24, { min: 1, max: 168, fallback: 24 });
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();

    const draft = await assistantStore.createDraft({
      tenantId,
      repoId,
      draftType: 'docs_edit',
      status: 'draft',
      mode,
      prompt: instruction,
      answerMarkdown: out.summary ?? null,
      citations: out.citations ?? [],
      files: out.files ?? [],
      diff: out.diff ?? null,
      expiresAt
    });

    await auditEvent?.({
      tenantId,
      actorUserId: req.auth?.userId ?? null,
      action: 'assistant.docs_draft',
      targetType: 'repo',
      targetId: repoId,
      metadata: { draftId: draft?.id ?? null, files: (out.files ?? []).length }
    });

    return { status: 200, body: { ...out, draftId: draft?.id ?? null, expiresAt } };
  };

  router.post('/assistant/docs/draft', draftHandler);
  router.post('/api/v1/assistant/docs/draft', draftHandler);

  const listDraftsHandler = async (req) => {
    const tenantId = tenantIdFromCtx(req, DEFAULT_TENANT_ID);
    const forbid = requireRole(req, 'admin');
    if (forbid) return forbid;
    const repoId = req.query?.repoId ?? DEFAULT_REPO_ID;
    const status = req.query?.status ?? null;
    const limit = req.query?.limit ?? 50;
    const drafts = await assistantStore.listDrafts({ tenantId, repoId, status, limit });
    return { status: 200, body: { drafts } };
  };

  router.get('/assistant/drafts', listDraftsHandler);
  router.get('/api/v1/assistant/drafts', listDraftsHandler);

  const getDraftHandler = async (req) => {
    const tenantId = tenantIdFromCtx(req, DEFAULT_TENANT_ID);
    const forbid = requireRole(req, 'admin');
    if (forbid) return forbid;
    const repoId = req.query?.repoId ?? DEFAULT_REPO_ID;
    const draftId = req.query?.draftId ?? null;
    if (typeof draftId !== 'string' || draftId.length === 0) return { status: 400, body: { error: 'draftId_required' } };
    const draft = await assistantStore.getDraft({ tenantId, repoId, draftId });
    if (!draft) return { status: 404, body: { error: 'not_found' } };
    return { status: 200, body: { draft } };
  };

  router.get('/assistant/draft', getDraftHandler);
  router.get('/api/v1/assistant/draft', getDraftHandler);

  const confirmHandler = async (req) => {
    const tenantId = tenantIdFromCtx(req, DEFAULT_TENANT_ID);
    const forbid = requireRole(req, 'admin');
    if (forbid) return forbid;
    const repoId = req.body?.repoId ?? req.query?.repoId ?? DEFAULT_REPO_ID;
    const draftId = req.body?.draftId ?? null;
    if (typeof draftId !== 'string' || draftId.length === 0) return { status: 400, body: { error: 'draftId_required' } };

    const draft = await assistantStore.getDraft({ tenantId, repoId, draftId });
    if (!draft) return { status: 404, body: { error: 'not_found' } };
    const status = draft.status ?? null;
    if (status !== 'draft') return { status: 409, body: { error: 'draft_not_confirmable', status } };

    const { docsRepoFullName } = await resolveOrgDocsRepo({ tenantId, repoId });
    if (!docsRepoFullName) return { status: 400, body: { error: 'docs_repo_not_configured' } };

    const lockName = 'docs_generate';
    const ttlMs = Number(process.env.GRAPHFLY_ASSISTANT_DOCS_LOCK_TTL_MS ?? 30 * 60 * 1000);
    let lockToken = null;
    if (lockStore?.tryAcquire) {
      const lease = await lockStore.tryAcquire({
        tenantId,
        repoId,
        lockName,
        ttlMs: Number.isFinite(ttlMs) ? Math.trunc(ttlMs) : 30 * 60 * 1000
      });
      if (!lease.acquired) return { status: 409, body: { error: 'docs_lock_busy' } };
      lockToken = lease.token;
    }

    let prRun = null;
    try {
      if (docStore?.createPrRun) {
        prRun = await docStore.createPrRun({
          tenantId,
          repoId,
          triggerSha: `assistant:${String(draftId).slice(0, 32)}`,
          status: 'running'
        });
      }
    } catch {
      prRun = null;
    }

    try {
      const writer = typeof docsWriterFactory === 'function' ? await docsWriterFactory({ tenantId, configuredDocsRepoFullName: docsRepoFullName }) : docsWriterFactory;
      const files = Array.isArray(draft.files ?? draft.files_json ?? draft.filesJson) ? (draft.files ?? draft.files_json ?? draft.filesJson) : [];
      const safeFiles = files
        .map((f) => ({
          path: safeDocPath(f?.path ?? f?.docFile ?? ''),
          content: redactSecrets(String(f?.content ?? ''))
        }))
        .map((f) => {
          const v = validateDocBlockMarkdown(f.content);
          if (!v.ok) throw new Error(`assistant_draft_invalid:${v.reason}`);
          return f;
        });

      const sha8 = String(draftId).replaceAll(/[^a-z0-9]/gi, '').slice(0, 8) || 'draft';
      const branchName = `docs/assistant-${sha8}`;
      const title = `docs: assistant update ${sha8}`;
      const body =
        `Assistant draft: ${draftId}\n` +
        `Files: ${safeFiles.length}\n` +
        (draft.diff ? `\nPreview diff:\n\n${truncateString(String(draft.diff), 20_000)}\n` : '');

      const pr = await writer.openPullRequest({
        targetRepoFullName: docsRepoFullName,
        title,
        body,
        branchName,
        files: safeFiles
      });

      const requireCloudSync = process.env.GRAPHFLY_CLOUD_SYNC_REQUIRED === '1' || process.env.GRAPHFLY_MODE === 'prod';
      if (pr?.stub) {
        const msg = 'docs_cloud_sync_disabled: docs PR was stubbed (no docs write credentials).';
        if (requireCloudSync) throw new Error(msg);
      }

      if (prRun && docStore?.updatePrRun) {
        await docStore.updatePrRun({
          tenantId,
          repoId,
          prRunId: prRun.id,
          patch: {
            status: pr?.empty ? 'skipped' : 'success',
            docsBranch: pr?.branchName ?? branchName,
            docsPrNumber: pr?.prNumber ?? null,
            docsPrUrl: pr?.prUrl ?? null,
            completedAt: new Date().toISOString()
          }
        });
      }

      await assistantStore.updateDraft({
        tenantId,
        repoId,
        draftId,
        patch: {
          status: 'applied',
          prBranch: pr?.branchName ?? branchName,
          prNumber: pr?.prNumber ?? null,
          prUrl: pr?.prUrl ?? null
        }
      });

      await auditEvent?.({
        tenantId,
        actorUserId: req.auth?.userId ?? null,
        action: 'assistant.docs_confirm',
        targetType: 'repo',
        targetId: repoId,
        metadata: { draftId, prUrl: pr?.prUrl ?? null }
      });

      return { status: 200, body: { ok: true, prRunId: prRun?.id ?? null, pr } };
    } catch (e) {
      if (prRun && docStore?.updatePrRun) {
        try {
          await docStore.updatePrRun({
            tenantId,
            repoId,
            prRunId: prRun.id,
            patch: { status: 'failure', errorMessage: String(e?.message ?? e), completedAt: new Date().toISOString() }
          });
        } catch {}
      }
      const msg = String(e?.message ?? e);
      const code = msg.includes('assistant_draft_invalid') ? 400 : msg.includes('docs_cloud_sync_disabled') ? 501 : 500;
      return { status: code, body: { error: 'assistant_confirm_failed', message: msg, prRunId: prRun?.id ?? null } };
    } finally {
      if (lockStore?.release && lockToken) {
        await lockStore.release({ tenantId, repoId, lockName, token: lockToken });
      }
    }
  };

  router.post('/assistant/docs/confirm', confirmHandler);
  router.post('/api/v1/assistant/docs/confirm', confirmHandler);
}
