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

  async sendJson(method, path, body) {
    const url = new URL(path, this.apiUrl);
    const res = await fetch(url, {
      method,
      headers: this._headersJson(),
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async getJson(path) {
    const url = new URL(path, this.apiUrl);
    const res = await fetch(url, { headers: this._headersAccept() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
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

  contractsGet({ symbolUid }) {
    return this.getJson(
      `/contracts/get?tenantId=${encodeURIComponent(this.tenantId)}&repoId=${encodeURIComponent(this.repoId)}&symbolUid=${encodeURIComponent(symbolUid)}`
    );
  }

  listDocBlocks({ status = null } = {}) {
    const s = status ? `&status=${encodeURIComponent(status)}` : '';
    return this.getJson(`/docs/blocks?tenantId=${encodeURIComponent(this.tenantId)}&repoId=${encodeURIComponent(this.repoId)}${s}`);
  }

  getDocBlock({ blockId }) {
    return this.getJson(`/docs/block?tenantId=${encodeURIComponent(this.tenantId)}&repoId=${encodeURIComponent(this.repoId)}&blockId=${encodeURIComponent(blockId)}`);
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

  listRepos() {
    return this.getJson(`/api/v1/repos?tenantId=${encodeURIComponent(this.tenantId)}`);
  }

  createRepo({ fullName, defaultBranch = 'main', githubRepoId = null }) {
    return this.sendJson('POST', '/api/v1/repos', { tenantId: this.tenantId, fullName, defaultBranch, githubRepoId });
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
