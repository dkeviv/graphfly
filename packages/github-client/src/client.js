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

  _splitFullName(fullName) {
    const raw = String(fullName ?? '');
    const [owner, repo] = raw.split('/', 2);
    if (!owner || !repo) throw new Error('fullName must be in owner/repo form');
    return { owner, repo };
  }

  async getCurrentUser() {
    const data = await ghRequest({
      fetchImpl: this._fetch,
      apiBaseUrl: this._base,
      token: this._token,
      method: 'GET',
      path: `/user`,
      ok: [200]
    });
    return {
      id: data?.id ?? null,
      login: data?.login ?? null
    };
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

  async listInstallationRepos({ perPage = 100 } = {}) {
    const n = Number.isFinite(perPage) ? Math.max(1, Math.min(100, Math.trunc(perPage))) : 100;
    const data = await ghRequest({
      fetchImpl: this._fetch,
      apiBaseUrl: this._base,
      token: this._token,
      method: 'GET',
      path: `/installation/repositories?per_page=${encodeURIComponent(String(n))}`,
      ok: [200]
    });
    const arr = Array.isArray(data?.repositories) ? data.repositories : [];
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
    const { owner, repo } = this._splitFullName(fullName);
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
    const { owner, repo } = this._splitFullName(fullName);
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

  async listBranches({ fullName, perPage = 100 } = {}) {
    if (!fullName) throw new Error('fullName is required');
    const { owner, repo } = this._splitFullName(fullName);
    const n = Number.isFinite(perPage) ? Math.max(1, Math.min(100, Math.trunc(perPage))) : 100;
    const data = await ghRequest({
      fetchImpl: this._fetch,
      apiBaseUrl: this._base,
      token: this._token,
      method: 'GET',
      path: `/repos/${owner}/${repo}/branches?per_page=${encodeURIComponent(String(n))}`,
      ok: [200]
    });
    const arr = Array.isArray(data) ? data : [];
    return arr
      .map((b) => ({
        name: b?.name ?? null,
        sha: b?.commit?.sha ?? null,
        protected: Boolean(b?.protected)
      }))
      .filter((b) => typeof b.name === 'string' && b.name.length > 0);
  }

  async createUserRepo({ name, private: isPrivate = true, description = null, autoInit = true } = {}) {
    if (!name) throw new Error('name is required');
    const data = await ghRequest({
      fetchImpl: this._fetch,
      apiBaseUrl: this._base,
      token: this._token,
      method: 'POST',
      path: `/user/repos`,
      ok: [201],
      body: { name: String(name), private: Boolean(isPrivate), description: description ? String(description) : undefined, auto_init: Boolean(autoInit) }
    });
    return {
      id: data?.id ?? null,
      fullName: data?.full_name ?? null,
      defaultBranch: data?.default_branch ?? 'main',
      cloneUrl: data?.clone_url ?? null,
      private: Boolean(data?.private)
    };
  }

  async createOrgRepo({ org, name, private: isPrivate = true, description = null, autoInit = true } = {}) {
    if (!org) throw new Error('org is required');
    if (!name) throw new Error('name is required');
    const data = await ghRequest({
      fetchImpl: this._fetch,
      apiBaseUrl: this._base,
      token: this._token,
      method: 'POST',
      path: `/orgs/${encodeURIComponent(String(org))}/repos`,
      ok: [201],
      body: { name: String(name), private: Boolean(isPrivate), description: description ? String(description) : undefined, auto_init: Boolean(autoInit) }
    });
    return {
      id: data?.id ?? null,
      fullName: data?.full_name ?? null,
      defaultBranch: data?.default_branch ?? 'main',
      cloneUrl: data?.clone_url ?? null,
      private: Boolean(data?.private)
    };
  }

  async setRepoDefaultBranch({ fullName, defaultBranch } = {}) {
    if (!fullName) throw new Error('fullName is required');
    if (!defaultBranch) throw new Error('defaultBranch is required');
    const { owner, repo } = this._splitFullName(fullName);
    const data = await ghRequest({
      fetchImpl: this._fetch,
      apiBaseUrl: this._base,
      token: this._token,
      method: 'PATCH',
      path: `/repos/${owner}/${repo}`,
      ok: [200],
      body: { default_branch: String(defaultBranch) }
    });
    return {
      id: data?.id ?? null,
      fullName: data?.full_name ?? fullName,
      defaultBranch: data?.default_branch ?? String(defaultBranch),
      cloneUrl: data?.clone_url ?? null
    };
  }

  async createBranchFromSha({ fullName, branch, sha } = {}) {
    if (!fullName) throw new Error('fullName is required');
    if (!branch) throw new Error('branch is required');
    if (!sha) throw new Error('sha is required');
    const { owner, repo } = this._splitFullName(fullName);
    const data = await ghRequest({
      fetchImpl: this._fetch,
      apiBaseUrl: this._base,
      token: this._token,
      method: 'POST',
      path: `/repos/${owner}/${repo}/git/refs`,
      ok: [201],
      body: { ref: `refs/heads/${String(branch)}`, sha: String(sha) }
    });
    return { ok: true, ref: data?.ref ?? null, sha: data?.object?.sha ?? null };
  }
}
