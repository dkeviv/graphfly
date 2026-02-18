export class ApiClient {
  constructor({ apiUrl, tenantId, repoId, mode, authToken = null }) {
    this.apiUrl = apiUrl;
    this.tenantId = tenantId;
    this.repoId = repoId;
    this.mode = mode;
    this.authToken = authToken;
  }

  _headersJson() {
    const h = { accept: 'application/json', 'content-type': 'application/json; charset=utf-8' };
    if (this.authToken) h.authorization = `Bearer ${this.authToken}`;
    return h;
  }

  _headersAccept() {
    const h = { accept: 'application/json' };
    if (this.authToken) h.authorization = `Bearer ${this.authToken}`;
    return h;
  }

  async _readJson(res) {
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  _httpError(status, data) {
    const msg = data?.message ?? data?.error ?? `HTTP ${status}`;
    const err = new Error(String(msg));
    err.status = status;
    err.data = data ?? null;
    return err;
  }

  async sendJson(method, path, body) {
    const url = new URL(path, this.apiUrl);
    const res = await fetch(url, {
      method,
      headers: this._headersJson(),
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await this._readJson(res);
    if (!res.ok) throw this._httpError(res.status, data);
    return data;
  }

  async getJson(path) {
    const url = new URL(path, this.apiUrl);
    const res = await fetch(url, { headers: this._headersAccept() });
    const data = await this._readJson(res);
    if (!res.ok) throw this._httpError(res.status, data);
    return data;
  }

  search({ q, mode }) {
    return this.getJson(
      `/graph/search?tenantId=${encodeURIComponent(this.tenantId)}&repoId=${encodeURIComponent(this.repoId)}&q=${encodeURIComponent(q)}&mode=${encodeURIComponent(mode)}&viewMode=${encodeURIComponent(this.mode)}`
    );
  }

  blastRadius({ symbolUid, depth = 1, direction = 'both' }) {
    return this.getJson(
      `/graph/blast-radius?tenantId=${encodeURIComponent(this.tenantId)}&repoId=${encodeURIComponent(this.repoId)}&symbolUid=${encodeURIComponent(symbolUid)}&depth=${encodeURIComponent(String(depth))}&direction=${encodeURIComponent(direction)}&mode=${encodeURIComponent(this.mode)}`
    );
  }

  neighborhood({ symbolUid, direction = 'both', limitEdges = 200 }) {
    return this.getJson(
      `/graph/neighborhood?tenantId=${encodeURIComponent(this.tenantId)}&repoId=${encodeURIComponent(this.repoId)}&symbolUid=${encodeURIComponent(symbolUid)}&direction=${encodeURIComponent(direction)}&limitEdges=${encodeURIComponent(String(limitEdges))}&mode=${encodeURIComponent(this.mode)}`
    );
  }

  listFlowEntrypoints() {
    return this.getJson(`/flows/entrypoints?tenantId=${encodeURIComponent(this.tenantId)}&repoId=${encodeURIComponent(this.repoId)}`);
  }

  traceFlow({ startSymbolUid, depth = 3 } = {}) {
    return this.getJson(
      `/flows/trace?tenantId=${encodeURIComponent(this.tenantId)}&repoId=${encodeURIComponent(this.repoId)}&startSymbolUid=${encodeURIComponent(
        String(startSymbolUid ?? '')
      )}&depth=${encodeURIComponent(String(depth ?? 3))}&mode=${encodeURIComponent(this.mode)}`
    );
  }

  contractsGet({ symbolUid }) {
    return this.getJson(
      `/contracts/get?tenantId=${encodeURIComponent(this.tenantId)}&repoId=${encodeURIComponent(this.repoId)}&symbolUid=${encodeURIComponent(symbolUid)}`
    );
  }

  listDocBlocks({ status = null } = {}) {
    const s = status ? `&status=${encodeURIComponent(status)}` : '';
    return this.getJson(`/docs/blocks?tenantId=${encodeURIComponent(this.tenantId)}&repoId=${encodeURIComponent(this.repoId)}${s}`);
  }

  listDocBlocksBySymbolUid({ symbolUid, limit = 200 } = {}) {
    return this.getJson(
      `/docs/blocks/by-symbol?tenantId=${encodeURIComponent(this.tenantId)}&repoId=${encodeURIComponent(this.repoId)}&symbolUid=${encodeURIComponent(
        String(symbolUid ?? '')
      )}&limit=${encodeURIComponent(String(limit ?? 200))}`
    );
  }

  listPrRuns({ status = null, limit = 50 } = {}) {
    const s = status ? `&status=${encodeURIComponent(status)}` : '';
    return this.getJson(
      `/pr-runs?tenantId=${encodeURIComponent(this.tenantId)}&repoId=${encodeURIComponent(this.repoId)}&limit=${encodeURIComponent(String(limit))}${s}`
    );
  }

  getPrRun({ prRunId }) {
    return this.getJson(
      `/pr-run?tenantId=${encodeURIComponent(this.tenantId)}&repoId=${encodeURIComponent(this.repoId)}&prRunId=${encodeURIComponent(String(prRunId ?? ''))}`
    );
  }

  listPrRunFiles({ prRunId }) {
    return this.getJson(
      `/pr-run/files?tenantId=${encodeURIComponent(this.tenantId)}&repoId=${encodeURIComponent(this.repoId)}&prRunId=${encodeURIComponent(String(prRunId ?? ''))}`
    );
  }

  getDocBlock({ blockId }) {
    return this.getJson(`/docs/block?tenantId=${encodeURIComponent(this.tenantId)}&repoId=${encodeURIComponent(this.repoId)}&blockId=${encodeURIComponent(blockId)}`);
  }

  regenerateDocBlock({ blockId }) {
    return this.sendJson('POST', '/docs/regenerate', { tenantId: this.tenantId, repoId: this.repoId, blockId });
  }

  getCurrentOrg() {
    return this.getJson(`/api/v1/orgs/current?tenantId=${encodeURIComponent(this.tenantId)}`);
  }

  updateCurrentOrg({ displayName, docsRepoFullName }) {
    return this.sendJson('PUT', '/api/v1/orgs/current', { tenantId: this.tenantId, displayName, docsRepoFullName });
  }

  verifyDocsRepo({ docsRepoFullName = null } = {}) {
    return this.sendJson('POST', '/api/v1/orgs/docs-repo/verify', { tenantId: this.tenantId, docsRepoFullName });
  }

  createDocsRepo({ fullName, visibility = 'private', defaultBranch = null } = {}) {
    return this.sendJson('POST', '/api/v1/orgs/docs-repo/create', {
      tenantId: this.tenantId,
      fullName,
      visibility,
      defaultBranch
    });
  }

  billingSummary() {
    return this.getJson(`/api/v1/billing/summary?tenantId=${encodeURIComponent(this.tenantId)}`);
  }

  billingUsage() {
    return this.getJson(`/api/v1/billing/usage?tenantId=${encodeURIComponent(this.tenantId)}`);
  }

  billingCheckout({ plan = 'pro' } = {}) {
    return this.sendJson('POST', '/api/v1/billing/checkout', { tenantId: this.tenantId, plan });
  }

  billingPortal() {
    return this.sendJson('POST', '/api/v1/billing/portal', { tenantId: this.tenantId });
  }

  listOrgMembers() {
    return this.getJson(`/api/v1/orgs/members?tenantId=${encodeURIComponent(this.tenantId)}`);
  }

  upsertOrgMember({ userId, role = 'viewer' } = {}) {
    return this.sendJson('POST', '/api/v1/orgs/members', { tenantId: this.tenantId, userId, role });
  }

  removeOrgMember({ userId }) {
    return this.sendJson('DELETE', `/api/v1/orgs/members/${encodeURIComponent(String(userId ?? ''))}?tenantId=${encodeURIComponent(this.tenantId)}`);
  }

  listOrgInvites({ status = null, limit = 200 } = {}) {
    const s = status ? `&status=${encodeURIComponent(status)}` : '';
    return this.getJson(`/api/v1/orgs/invites?tenantId=${encodeURIComponent(this.tenantId)}&limit=${encodeURIComponent(String(limit ?? 200))}${s}`);
  }

  createOrgInvite({ email, role = 'viewer', ttlDays = 7 } = {}) {
    return this.sendJson('POST', '/api/v1/orgs/invites', { tenantId: this.tenantId, email, role, ttlDays });
  }

  revokeOrgInvite({ inviteId }) {
    return this.sendJson('DELETE', `/api/v1/orgs/invites/${encodeURIComponent(String(inviteId ?? ''))}?tenantId=${encodeURIComponent(this.tenantId)}`);
  }

  acceptOrgInvite({ token }) {
    return this.sendJson('POST', '/api/v1/orgs/invites/accept', { tenantId: this.tenantId, token });
  }

  listRepos() {
    return this.getJson(`/api/v1/repos?tenantId=${encodeURIComponent(this.tenantId)}`);
  }

  docsRefs({ repoId = null } = {}) {
    const rid = repoId ?? this.repoId;
    return this.getJson(`/api/v1/repos/${encodeURIComponent(rid)}/docs/refs?tenantId=${encodeURIComponent(this.tenantId)}`);
  }

  docsTree({ repoId = null, dir = '', ref = 'default' } = {}) {
    const rid = repoId ?? this.repoId;
    const d = dir ? `&dir=${encodeURIComponent(dir)}` : '';
    return this.getJson(
      `/api/v1/repos/${encodeURIComponent(rid)}/docs/tree?tenantId=${encodeURIComponent(this.tenantId)}&ref=${encodeURIComponent(String(ref ?? 'default'))}${d}`
    );
  }

  docsFile({ repoId = null, path, ref = 'default' } = {}) {
    const rid = repoId ?? this.repoId;
    return this.getJson(
      `/api/v1/repos/${encodeURIComponent(rid)}/docs/file?tenantId=${encodeURIComponent(this.tenantId)}&ref=${encodeURIComponent(String(ref ?? 'default'))}&path=${encodeURIComponent(String(path ?? ''))}`
    );
  }

  docsDiff({ repoId = null, path, before, after } = {}) {
    const rid = repoId ?? this.repoId;
    return this.sendJson('POST', `/api/v1/repos/${encodeURIComponent(rid)}/docs/diff`, {
      tenantId: this.tenantId,
      path,
      before,
      after
    });
  }

  docsOpenPr({ repoId = null, title, body = '', files } = {}) {
    const rid = repoId ?? this.repoId;
    return this.sendJson('POST', `/api/v1/repos/${encodeURIComponent(rid)}/docs/open-pr`, {
      tenantId: this.tenantId,
      title,
      body,
      files
    });
  }

  assistantCreateThread({ repoId = null, title = null, mode = null } = {}) {
    const rid = repoId ?? this.repoId;
    const body = { tenantId: this.tenantId, repoId: rid };
    if (title) body.title = title;
    if (mode) body.mode = mode;
    return this.sendJson('POST', '/api/v1/assistant/threads', body);
  }

  assistantListThreads({ repoId = null, includeArchived = false, limit = 50 } = {}) {
    const rid = repoId ?? this.repoId;
    const arch = includeArchived ? '&includeArchived=1' : '';
    return this.getJson(
      `/api/v1/assistant/threads?tenantId=${encodeURIComponent(this.tenantId)}&repoId=${encodeURIComponent(rid)}&limit=${encodeURIComponent(
        String(limit ?? 50)
      )}${arch}`
    );
  }

  assistantGetThread({ repoId = null, threadId, limit = 50 } = {}) {
    const rid = repoId ?? this.repoId;
    return this.getJson(
      `/api/v1/assistant/thread?tenantId=${encodeURIComponent(this.tenantId)}&repoId=${encodeURIComponent(rid)}&threadId=${encodeURIComponent(
        String(threadId ?? '')
      )}&limit=${encodeURIComponent(String(limit ?? 50))}`
    );
  }

  assistantQuery({ repoId = null, threadId = null, question, mode = null } = {}) {
    const rid = repoId ?? this.repoId;
    const body = { tenantId: this.tenantId, repoId: rid, question };
    if (threadId) body.threadId = threadId;
    if (mode) body.mode = mode;
    return this.sendJson('POST', '/api/v1/assistant/query', body);
  }

  assistantDocsDraft({ repoId = null, instruction, mode = null } = {}) {
    const rid = repoId ?? this.repoId;
    const body = { tenantId: this.tenantId, repoId: rid, instruction };
    if (mode) body.mode = mode;
    return this.sendJson('POST', '/api/v1/assistant/docs/draft', body);
  }

  assistantDocsConfirm({ repoId = null, draftId } = {}) {
    const rid = repoId ?? this.repoId;
    return this.sendJson('POST', '/api/v1/assistant/docs/confirm', { tenantId: this.tenantId, repoId: rid, draftId });
  }

  assistantListDrafts({ repoId = null, status = null, limit = 50 } = {}) {
    const rid = repoId ?? this.repoId;
    const st = status ? `&status=${encodeURIComponent(String(status))}` : '';
    return this.getJson(
      `/api/v1/assistant/drafts?tenantId=${encodeURIComponent(this.tenantId)}&repoId=${encodeURIComponent(rid)}&limit=${encodeURIComponent(
        String(limit ?? 50)
      )}${st}`
    );
  }

  assistantGetDraft({ repoId = null, draftId } = {}) {
    const rid = repoId ?? this.repoId;
    return this.getJson(
      `/api/v1/assistant/draft?tenantId=${encodeURIComponent(this.tenantId)}&repoId=${encodeURIComponent(rid)}&draftId=${encodeURIComponent(String(draftId ?? ''))}`
    );
  }

  createRepo({
    fullName,
    defaultBranch = 'main',
    trackedBranch = null,
    githubRepoId = null,
    docsRepoFullName = null,
    docsDefaultBranch = null,
    repoRoot = null
  }) {
    const body = { tenantId: this.tenantId, fullName, defaultBranch, githubRepoId };
    if (trackedBranch) body.trackedBranch = trackedBranch;
    if (docsRepoFullName) body.docsRepoFullName = docsRepoFullName;
    if (docsDefaultBranch) body.docsDefaultBranch = docsDefaultBranch;
    if (repoRoot) body.repoRoot = repoRoot;
    return this.sendJson('POST', '/api/v1/repos', body);
  }

  deleteRepo({ repoId }) {
    return this.sendJson('DELETE', `/api/v1/repos/${encodeURIComponent(repoId)}?tenantId=${encodeURIComponent(this.tenantId)}`);
  }

  githubConnect({ token }) {
    return this.sendJson('POST', '/api/v1/integrations/github/connect', { tenantId: this.tenantId, token });
  }

  githubListRepos() {
    return this.getJson(`/api/v1/integrations/github/repos?tenantId=${encodeURIComponent(this.tenantId)}`);
  }

  githubListBranches({ fullName }) {
    return this.getJson(
      `/api/v1/integrations/github/branches?tenantId=${encodeURIComponent(this.tenantId)}&fullName=${encodeURIComponent(String(fullName ?? ''))}`
    );
  }

  githubOAuthStart() {
    return this.getJson(`/api/v1/integrations/github/oauth/start?tenantId=${encodeURIComponent(this.tenantId)}`);
  }

  githubOAuthCallback({ code, state }) {
    return this.sendJson('POST', '/api/v1/integrations/github/oauth/callback', { tenantId: this.tenantId, code, state });
  }

  githubReaderAppUrl() {
    return this.getJson('/api/v1/github/reader-app-url');
  }

  githubDocsAppUrl() {
    return this.getJson('/api/v1/github/docs-app-url');
  }

  githubReaderAppCallback({ installationId }) {
    return this.getJson(`/api/v1/github/reader/callback?tenantId=${encodeURIComponent(this.tenantId)}&installation_id=${encodeURIComponent(String(installationId ?? ''))}`);
  }

  githubDocsAppCallback({ installationId }) {
    return this.getJson(`/api/v1/github/docs/callback?tenantId=${encodeURIComponent(this.tenantId)}&installation_id=${encodeURIComponent(String(installationId ?? ''))}`);
  }

  orgListMembers() {
    return this.getJson(`/api/v1/orgs/members?tenantId=${encodeURIComponent(this.tenantId)}`);
  }

  orgListInvites({ status = null, limit = 200 } = {}) {
    const s = status ? `&status=${encodeURIComponent(status)}` : '';
    return this.getJson(`/api/v1/orgs/invites?tenantId=${encodeURIComponent(this.tenantId)}&limit=${encodeURIComponent(String(limit))}${s}`);
  }

  orgCreateInvite({ email, role = 'viewer' }) {
    return this.sendJson('POST', '/api/v1/orgs/invites', { tenantId: this.tenantId, email, role });
  }

  orgRevokeInvite({ inviteId }) {
    return this.sendJson('DELETE', `/api/v1/orgs/invites/${encodeURIComponent(inviteId)}?tenantId=${encodeURIComponent(this.tenantId)}`);
  }

  orgAcceptInvite({ token }) {
    return this.sendJson('POST', '/api/v1/orgs/invites/accept', { tenantId: this.tenantId, token });
  }

  adminOverview() {
    return this.getJson(`/api/v1/admin/overview?tenantId=${encodeURIComponent(this.tenantId)}`);
  }

  listJobs({ status = null, limit = 50 } = {}) {
    const s = status ? `&status=${encodeURIComponent(status)}` : '';
    return this.getJson(`/api/v1/jobs?tenantId=${encodeURIComponent(this.tenantId)}&limit=${encodeURIComponent(String(limit))}${s}`);
  }

  retryJob({ queue, jobId, resetAttempts = true } = {}) {
    return this.sendJson('POST', `/api/v1/jobs/${encodeURIComponent(String(queue ?? ''))}/${encodeURIComponent(String(jobId ?? ''))}/retry`, {
      tenantId: this.tenantId,
      resetAttempts: Boolean(resetAttempts)
    });
  }

  cancelJob({ queue, jobId, reason = 'canceled_by_admin' } = {}) {
    return this.sendJson('POST', `/api/v1/jobs/${encodeURIComponent(String(queue ?? ''))}/${encodeURIComponent(String(jobId ?? ''))}/cancel`, {
      tenantId: this.tenantId,
      reason
    });
  }

  listAudit({ limit = 50 } = {}) {
    return this.getJson(`/api/v1/audit?tenantId=${encodeURIComponent(this.tenantId)}&limit=${encodeURIComponent(String(limit))}`);
  }

  coverageSummary() {
    return this.getJson(`/coverage/summary?tenantId=${encodeURIComponent(this.tenantId)}&repoId=${encodeURIComponent(this.repoId)}`);
  }

  coverageUnresolvedImports() {
    return this.getJson(`/coverage/unresolved-imports?tenantId=${encodeURIComponent(this.tenantId)}&repoId=${encodeURIComponent(this.repoId)}`);
  }

  coverageUndocumentedEntrypoints({ limit = 50 } = {}) {
    return this.getJson(
      `/coverage/undocumented-entrypoints?tenantId=${encodeURIComponent(this.tenantId)}&repoId=${encodeURIComponent(this.repoId)}&limit=${encodeURIComponent(String(limit))}`
    );
  }

  coverageDocument({ symbolUids }) {
    return this.sendJson('POST', '/coverage/document', { tenantId: this.tenantId, repoId: this.repoId, symbolUids });
  }

  secretsRewrap() {
    return this.sendJson('POST', '/api/v1/admin/secrets/rewrap', { tenantId: this.tenantId });
  }

  async fetchMetricsText({ token = null } = {}) {
    const url = new URL('/metrics', this.apiUrl);
    const headers = {};
    const t = token ?? null;
    if (t) headers.authorization = `Bearer ${t}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }
}
