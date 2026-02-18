import { assertDocsRepoOnlyWrite } from './docs-repo-guard.js';
import { createInstallationToken } from '../../github-app-auth/src/app-auth.js';

function parseRepo(fullName) {
  const s = String(fullName ?? '');
  const i = s.indexOf('/');
  if (i <= 0 || i === s.length - 1) throw new Error('invalid_repo_full_name');
  return { owner: s.slice(0, i), repo: s.slice(i + 1) };
}

function encodePath(p) {
  return String(p ?? '')
    .split('/')
    .filter((seg) => seg.length > 0)
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

async function readJson(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function ghRequest({ fetchImpl, apiBaseUrl, token, method, path, body = null, okStatuses = [200] }) {
  const url = new URL(path, apiBaseUrl);
  const res = await fetchImpl(url, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      'content-type': 'application/json; charset=utf-8',
      authorization: `Bearer ${token}`,
      'user-agent': 'graphfly-docs-reader'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!okStatuses.includes(res.status)) {
    const data = await readJson(res);
    const msg = data?.message ?? `HTTP ${res.status}`;
    const err = new Error(`github_api_error: ${msg}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return readJson(res);
}

function decodeGitHubContent({ content, encoding }) {
  if (typeof content !== 'string' || content.length === 0) return '';
  if (encoding === 'base64') return Buffer.from(content, 'base64').toString('utf8');
  return content;
}

export class GitHubDocsReader {
  constructor({
    configuredDocsRepoFullName,
    token = process.env.GITHUB_DOCS_TOKEN ?? '',
    appId = process.env.GITHUB_APP_ID ?? '',
    privateKeyPem = null,
    installationId = process.env.GITHUB_DOCS_INSTALLATION_ID ?? '',
    fetchImpl = globalThis.fetch,
    apiBaseUrl = 'https://api.github.com'
  } = {}) {
    this._docsRepo = configuredDocsRepoFullName;
    this._token = token;
    this._appId = appId || '';
    this._privateKeyPem = privateKeyPem;
    this._installationId = installationId || '';
    this._fetch = fetchImpl;
    this._apiBaseUrl = apiBaseUrl;
  }

  async _resolveTokenFromInstallation() {
    const appId = this._appId;
    const installationId = this._installationId;
    const privateKeyPem = this._privateKeyPem;
    if (!appId || !installationId || !privateKeyPem) return null;
    const out = await createInstallationToken({
      appId,
      privateKeyPem,
      installationId,
      fetchImpl: this._fetch,
      apiBaseUrl: this._apiBaseUrl
    });
    return out.token;
  }

  async _resolveToken() {
    return this._token || (await this._resolveTokenFromInstallation());
  }

  async getDefaultBranch({ targetRepoFullName }) {
    assertDocsRepoOnlyWrite({ configuredDocsRepoFullName: this._docsRepo, targetRepoFullName });
    const token = await this._resolveToken();
    if (!token) return null;
    const { owner, repo } = parseRepo(targetRepoFullName);
    try {
      const repoInfo = await ghRequest({
        fetchImpl: this._fetch,
        apiBaseUrl: this._apiBaseUrl,
        token,
        method: 'GET',
        path: `/repos/${owner}/${repo}`,
        okStatuses: [200]
      });
      return repoInfo?.default_branch ?? 'main';
    } catch {
      return null;
    }
  }

  async listDir({ targetRepoFullName, dirPath = '', ref = null, maxEntries = 200 } = {}) {
    assertDocsRepoOnlyWrite({ configuredDocsRepoFullName: this._docsRepo, targetRepoFullName });
    const token = await this._resolveToken();
    if (!token) return { ok: false, error: 'docs_auth_not_configured', entries: [] };
    const { owner, repo } = parseRepo(targetRepoFullName);
    const safePath = encodePath(dirPath);
    const refQ = ref ? `?ref=${encodeURIComponent(String(ref))}` : '';
    const pathPart = safePath ? `/contents/${safePath}${refQ}` : `/contents${refQ}`;
    let data = null;
    try {
      data = await ghRequest({
        fetchImpl: this._fetch,
        apiBaseUrl: this._apiBaseUrl,
        token,
        method: 'GET',
        path: `/repos/${owner}/${repo}${pathPart}`,
        okStatuses: [200]
      });
    } catch (e) {
      const st = Number(e?.status ?? 0);
      if (st === 404) return { ok: false, error: 'not_found', entries: [] };
      if (st === 401) return { ok: false, error: 'unauthorized', entries: [] };
      if (st === 403) return { ok: false, error: 'forbidden', entries: [] };
      return { ok: false, error: 'github_api_error', entries: [] };
    }
    const arr = Array.isArray(data) ? data : [];
    const n = Number.isFinite(maxEntries) ? Math.max(1, Math.min(1000, Math.trunc(maxEntries))) : 200;
    const entries = arr.slice(0, n).map((e) => ({
      path: e?.path ?? null,
      name: e?.name ?? null,
      type: e?.type ?? null,
      size: e?.size ?? null,
      sha: e?.sha ?? null
    }));
    return { ok: true, entries };
  }

  async readFile({ targetRepoFullName, filePath, ref = null, maxBytes = 250_000 } = {}) {
    assertDocsRepoOnlyWrite({ configuredDocsRepoFullName: this._docsRepo, targetRepoFullName });
    if (!filePath) throw new Error('filePath is required');
    const token = await this._resolveToken();
    if (!token) return { ok: false, error: 'docs_auth_not_configured', content: null, sha: null };
    const { owner, repo } = parseRepo(targetRepoFullName);
    const safePath = encodePath(filePath);
    const refQ = ref ? `?ref=${encodeURIComponent(String(ref))}` : '';
    let data = null;
    try {
      data = await ghRequest({
        fetchImpl: this._fetch,
        apiBaseUrl: this._apiBaseUrl,
        token,
        method: 'GET',
        path: `/repos/${owner}/${repo}/contents/${safePath}${refQ}`,
        okStatuses: [200]
      });
    } catch (e) {
      const st = Number(e?.status ?? 0);
      if (st === 404) return { ok: false, error: 'not_found', content: null, sha: null };
      if (st === 401) return { ok: false, error: 'unauthorized', content: null, sha: null };
      if (st === 403) return { ok: false, error: 'forbidden', content: null, sha: null };
      return { ok: false, error: 'github_api_error', content: null, sha: null };
    }
    if (Array.isArray(data)) return { ok: false, error: 'is_directory', content: null, sha: null };
    const size = Number(data?.size ?? 0);
    if (Number.isFinite(size) && size > maxBytes) return { ok: false, error: 'file_too_large', content: null, sha: data?.sha ?? null };
    const content = decodeGitHubContent({ content: data?.content ?? '', encoding: data?.encoding ?? 'base64' });
    return { ok: true, content, sha: data?.sha ?? null, path: data?.path ?? filePath };
  }
}
