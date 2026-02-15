async function readJson(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function ghRequest({ fetchImpl, apiBaseUrl, token, method, path, body = null, ok = [200] }) {
  const url = new URL(path, apiBaseUrl);
  const res = await fetchImpl(url, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      'content-type': 'application/json; charset=utf-8',
      authorization: `Bearer ${token}`,
      'user-agent': 'graphfly-github-client'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!ok.includes(res.status)) {
    const data = await readJson(res);
    const msg = data?.message ?? `HTTP ${res.status}`;
    const err = new Error(`github_api_error: ${msg}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return readJson(res);
}

export class GitHubClient {
  constructor({ token, fetchImpl = globalThis.fetch, apiBaseUrl = 'https://api.github.com' } = {}) {
    if (!token) throw new Error('token is required');
    this._token = token;
    this._fetch = fetchImpl;
    this._base = apiBaseUrl;
  }

  async listUserRepos({ perPage = 100 } = {}) {
    const n = Number.isFinite(perPage) ? Math.max(1, Math.min(100, Math.trunc(perPage))) : 100;
    const data = await ghRequest({
      fetchImpl: this._fetch,
      apiBaseUrl: this._base,
      token: this._token,
      method: 'GET',
      path: `/user/repos?per_page=${encodeURIComponent(String(n))}&sort=updated`,
      ok: [200]
    });
    const arr = Array.isArray(data) ? data : [];
    return arr.map((r) => ({
      id: r.id ?? null,
      fullName: r.full_name ?? null,
      defaultBranch: r.default_branch ?? 'main',
      cloneUrl: r.clone_url ?? null,
      private: Boolean(r.private)
    }));
  }

  async getRepo({ fullName }) {
    if (!fullName) throw new Error('fullName is required');
    const [owner, repo] = String(fullName).split('/', 2);
    const data = await ghRequest({
      fetchImpl: this._fetch,
      apiBaseUrl: this._base,
      token: this._token,
      method: 'GET',
      path: `/repos/${owner}/${repo}`,
      ok: [200]
    });
    return {
      id: data?.id ?? null,
      fullName: data?.full_name ?? fullName,
      defaultBranch: data?.default_branch ?? 'main',
      cloneUrl: data?.clone_url ?? null
    };
  }

  async getBranchHeadSha({ fullName, branch }) {
    if (!fullName) throw new Error('fullName is required');
    if (!branch) throw new Error('branch is required');
    const [owner, repo] = String(fullName).split('/', 2);
    const ref = await ghRequest({
      fetchImpl: this._fetch,
      apiBaseUrl: this._base,
      token: this._token,
      method: 'GET',
      path: `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
      ok: [200]
    });
    return ref?.object?.sha ?? null;
  }
}

