import { assertDocsRepoOnlyWrite } from './docs-repo-guard.js';

function parseRepo(fullName) {
  const s = String(fullName ?? '');
  const i = s.indexOf('/');
  if (i <= 0 || i === s.length - 1) throw new Error('invalid_repo_full_name');
  return { owner: s.slice(0, i), repo: s.slice(i + 1) };
}

function encodePath(p) {
  return String(p ?? '')
    .split('/')
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

async function ghRequest({ fetchImpl, apiBaseUrl, token, method, path, body = null, okStatuses = [200, 201, 204] }) {
  const url = new URL(path, apiBaseUrl);
  const res = await fetchImpl(url, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      'content-type': 'application/json; charset=utf-8',
      authorization: `Bearer ${token}`,
      'user-agent': 'graphfly-docs-writer'
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

export class GitHubDocsWriter {
  constructor({ configuredDocsRepoFullName, token = process.env.GITHUB_DOCS_TOKEN ?? '', fetchImpl = globalThis.fetch, apiBaseUrl = 'https://api.github.com' }) {
    this._docsRepo = configuredDocsRepoFullName;
    this._token = token;
    this._fetch = fetchImpl;
    this._apiBaseUrl = apiBaseUrl;
  }

  async openPullRequest({ targetRepoFullName, title, body, branchName, files }) {
    assertDocsRepoOnlyWrite({ configuredDocsRepoFullName: this._docsRepo, targetRepoFullName });
    if (!title || !branchName) throw new Error('missing_title_or_branch');
    if (!Array.isArray(files)) throw new Error('files must be array');

    if (!this._token) {
      // Keep the repo self-contained: allow local/demo runs without network dependencies.
      // When a token is configured, we exercise the real GitHub REST flow.
      return {
        ok: true,
        stub: true,
        targetRepoFullName,
        title,
        body: body ?? '',
        branchName,
        filesCount: files.length
      };
    }

    const { owner, repo } = parseRepo(targetRepoFullName);
    const repoInfo = await ghRequest({
      fetchImpl: this._fetch,
      apiBaseUrl: this._apiBaseUrl,
      token: this._token,
      method: 'GET',
      path: `/repos/${owner}/${repo}`
    });
    const baseBranch = repoInfo?.default_branch ?? 'main';
    const baseRef = await ghRequest({
      fetchImpl: this._fetch,
      apiBaseUrl: this._apiBaseUrl,
      token: this._token,
      method: 'GET',
      path: `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(baseBranch)}`
    });
    const baseSha = baseRef?.object?.sha ?? null;
    if (!baseSha) throw new Error('missing_base_sha');

    // Create branch (idempotent-ish: if it already exists, GitHub returns 422).
    try {
      await ghRequest({
        fetchImpl: this._fetch,
        apiBaseUrl: this._apiBaseUrl,
        token: this._token,
        method: 'POST',
        path: `/repos/${owner}/${repo}/git/refs`,
        body: { ref: `refs/heads/${branchName}`, sha: baseSha },
        okStatuses: [201]
      });
    } catch (e) {
      if (e?.status !== 422) throw e;
    }

    for (const f of files) {
      if (!f?.path) throw new Error('file.path required');
      const content = Buffer.from(String(f.content ?? ''), 'utf8').toString('base64');
      const filePath = encodePath(f.path);

      let existingSha = null;
      try {
        const existing = await ghRequest({
          fetchImpl: this._fetch,
          apiBaseUrl: this._apiBaseUrl,
          token: this._token,
          method: 'GET',
          path: `/repos/${owner}/${repo}/contents/${filePath}?ref=${encodeURIComponent(branchName)}`
        });
        existingSha = existing?.sha ?? null;
      } catch (e) {
        if (e?.status !== 404) throw e;
      }

      await ghRequest({
        fetchImpl: this._fetch,
        apiBaseUrl: this._apiBaseUrl,
        token: this._token,
        method: 'PUT',
        path: `/repos/${owner}/${repo}/contents/${filePath}`,
        body: { message: title, content, branch: branchName, sha: existingSha ?? undefined },
        okStatuses: [200, 201]
      });
    }

    const pr = await ghRequest({
      fetchImpl: this._fetch,
      apiBaseUrl: this._apiBaseUrl,
      token: this._token,
      method: 'POST',
      path: `/repos/${owner}/${repo}/pulls`,
      body: { title, body: body ?? '', head: branchName, base: baseBranch },
      okStatuses: [201]
    });

    return {
      ok: true,
      targetRepoFullName,
      title,
      body: body ?? '',
      branchName,
      filesCount: files.length,
      prNumber: pr?.number ?? null,
      prUrl: pr?.html_url ?? null
    };
  }
}
