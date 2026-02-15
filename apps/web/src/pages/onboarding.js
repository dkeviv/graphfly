import { el, clear } from '../render.js';
import { ApiClient } from '../api.js';
import { parseOAuthCallbackParams, parseGitHubAppCallbackParams, stripQueryFromUrl } from './onboarding-oauth.js';

export function renderOnboardingPage({ state, pageEl }) {
  clear(pageEl);
  const api = new ApiClient({ apiUrl: state.apiUrl, tenantId: state.tenantId, repoId: state.repoId, mode: state.mode, authToken: state.authToken });

  const steps = [
    { k: '1', h: 'Connect GitHub', s: 'OAuth (dev: paste token) to list repos read-only.', ok: false },
    { k: '2', h: 'Docs Repo', s: 'Separate repo (write-only). Docs PRs go here.', ok: false },
    { k: '3', h: 'Create Project', s: 'Select a source repo; indexing + docs run automatically.', ok: false }
  ];

  const statusEl = el('div', { class: 'small' }, ['Loading onboarding status…']);
  const githubTokenInput = el('input', { class: 'input', id: 'githubTokenInput', placeholder: 'GitHub token (dev) — stored encrypted', type: 'password' });
  const githubConnectBtn = el('button', { class: 'button' }, ['Connect GitHub']);
  const readerAppBtn = el('button', { class: 'button' }, ['Install Reader App']);
  const docsAppBtn = el('button', { class: 'button' }, ['Install Docs App']);
  const githubReposEl = el('ul', { class: 'list' });
  const docsCandidatesEl = el('ul', { class: 'list' });
  const docsRepoInput = el('input', { class: 'input', id: 'docsRepoInput', placeholder: 'org/docs (GitHub full name)' });
  const orgNameInput = el('input', { class: 'input', id: 'orgNameInput', placeholder: 'Display name (optional)' });

  const reposListEl = el('ul', { class: 'list' });
  const repoHintEl = el('div', { class: 'small' }, ['Pick a source repo from the GitHub list to create a Project.']);

  const stepBadgeEls = [];
  const stepListEl = el(
    'ul',
    { class: 'list' },
    steps.map((st) => {
      const badgeEl = el('span', { class: st.ok ? 'badge badge--ok' : 'badge' }, [st.ok ? '✓' : '•']);
      stepBadgeEls.push(badgeEl);
      return el('li', { class: 'list__item' }, [
        el('div', { class: 'row' }, [
          badgeEl,
          el('div', {}, [el('div', { class: 'h' }, [st.h]), el('div', { class: 'small' }, [st.s])])
        ])
      ]);
    })
  );

  pageEl.appendChild(
    el('div', { class: 'grid2' }, [
      el('div', { class: 'card' }, [
        el('div', { class: 'card__title' }, ['Onboarding (spec-aligned)']),
        statusEl,
        stepListEl
      ]),
      el('div', { class: 'card' }, [
        el('div', { class: 'card__title' }, ['1) Connect GitHub (OAuth)']),
        el('div', { class: 'small' }, ['One click: redirects to GitHub OAuth, then returns here.']),
        githubTokenInput,
        el('div', { class: 'row' }, [githubConnectBtn, readerAppBtn, docsAppBtn])
      ]),
      el('div', { class: 'card' }, [
        el('div', { class: 'card__title' }, ['2) Docs repo (write-only)']),
        el('div', { class: 'small' }, ['This must be a separate repository from the source repo.']),
        el('div', { class: 'small' }, ['Pick a docs repo (recommended) or enter one manually:']),
        docsCandidatesEl,
        docsRepoInput,
        orgNameInput,
        el('div', { class: 'row' }, [
          el('button', {
            class: 'button',
            onclick: async () => {
              const docsRepoFullName = docsRepoInput.value.trim();
              const displayName = orgNameInput.value.trim() || null;
              try {
                await api.updateCurrentOrg({ displayName, docsRepoFullName: docsRepoFullName || null });
                await refresh();
              } catch (e) {
                statusEl.textContent = `Save failed: ${String(e?.message ?? e)}`;
              }
            }
          }, ['Save']),
          el('button', {
            class: 'button',
            onclick: async () => {
              try {
                const out = await api.verifyDocsRepo({ docsRepoFullName: docsRepoInput.value.trim() || null });
                statusEl.textContent = out?.ok ? 'Docs repo verified.' : 'Docs repo verification returned no result.';
              } catch (e) {
                statusEl.textContent = `Docs repo verify failed: ${String(e?.message ?? e)}`;
              }
            }
          }, ['Verify'])
        ])
      ]),
      el('div', { class: 'card' }, [
        el('div', { class: 'card__title' }, ['3) Projects']),
        repoHintEl,
        el('div', { class: 'small' }, ['Available source repos (read-only):']),
        githubReposEl,
        el('div', { class: 'small' }, ['Existing projects:']),
        reposListEl
      ]),
      el('div', { class: 'card' }, [
        el('div', { class: 'card__title' }, ['Local settings']),
        el('div', { class: 'small' }, ['API URL (for local dev demos):']),
        el('div', { class: 'row' }, [
          el('input', { class: 'input', value: state.apiUrl, id: 'apiUrlInput' }),
          el('button', {
            class: 'button',
            onclick: () => {
              const v = document.getElementById('apiUrlInput').value;
              localStorage.setItem('graphfly_api_url', v);
              state.apiUrl = v;
            }
          }, ['Save'])
        ]),
        el('div', { class: 'small' }, ['Support-safe mode is available via the Mode switch in the sidebar.'])
      ])
    ])
  );

  githubConnectBtn.onclick = async () => {
    try {
      // Prefer real OAuth when configured.
      const start = await api.githubOAuthStart();
      const authorizeUrl = start?.authorizeUrl ?? null;
      if (authorizeUrl) {
        statusEl.textContent = 'Redirecting to GitHub…';
        window.location.assign(authorizeUrl);
        return;
      }
      // Fallback: dev token connect.
      const token = githubTokenInput.value.trim();
      if (!token) return;
      await api.githubConnect({ token });
      githubTokenInput.value = '';
      await refresh();
    } catch (e) {
      statusEl.textContent = `GitHub connect failed: ${String(e?.message ?? e)}`;
    }
  };

  readerAppBtn.onclick = async () => {
    try {
      const out = await api.githubReaderAppUrl();
      const installUrl = out?.installUrl ?? null;
      if (!installUrl) throw new Error('reader_app_not_configured');
      statusEl.textContent = 'Redirecting to GitHub App install…';
      window.location.assign(installUrl);
    } catch (e) {
      statusEl.textContent = `Reader App install failed: ${String(e?.message ?? e)}`;
    }
  };

  docsAppBtn.onclick = async () => {
    try {
      const out = await api.githubDocsAppUrl();
      const installUrl = out?.installUrl ?? null;
      if (!installUrl) throw new Error('docs_app_not_configured');
      statusEl.textContent = 'Redirecting to GitHub App install…';
      window.location.assign(installUrl);
    } catch (e) {
      statusEl.textContent = `Docs App install failed: ${String(e?.message ?? e)}`;
    }
  };

  async function refresh() {
    try {
      // Handle GitHub App return: ?app=reader|docs&installation_id=...
      const appCb = parseGitHubAppCallbackParams({ search: window.location.search });
      if (appCb) {
        statusEl.textContent = `Saving GitHub ${appCb.app} installation…`;
        try {
          if (appCb.app === 'reader') await api.githubReaderAppCallback({ installationId: appCb.installationId });
          if (appCb.app === 'docs') await api.githubDocsAppCallback({ installationId: appCb.installationId });
          stripQueryFromUrl();
        } catch (e) {
          statusEl.textContent = `App callback failed: ${String(e?.message ?? e)}`;
        }
      }

      // Handle OAuth return: code+state in query string.
      const cb = parseOAuthCallbackParams({ search: window.location.search });
      if (cb) {
        statusEl.textContent = 'Completing GitHub connection…';
        try {
          const out = await api.githubOAuthCallback(cb);
          if (out?.authToken) {
            state.authToken = out.authToken;
            localStorage.setItem('graphfly_auth_token', out.authToken);
            api.authToken = out.authToken;
          }
          if (out?.tenantId) {
            state.tenantId = out.tenantId;
            localStorage.setItem('graphfly_tenant_id', out.tenantId);
            api.tenantId = out.tenantId;
          }
          stripQueryFromUrl();
        } catch (e) {
          statusEl.textContent = `OAuth callback failed: ${String(e?.message ?? e)}`;
        }
      }

      const orgRes = await api.getCurrentOrg();
      const org = orgRes ?? {};
      docsRepoInput.value = org.docsRepoFullName ?? '';
      orgNameInput.value = org.displayName ?? '';

      const reposRes = await api.listRepos();
      const list = reposRes.repos ?? [];
      reposListEl.innerHTML = '';
      for (const r of list) {
        reposListEl.appendChild(
          el('li', { class: 'list__item' }, [
            el('div', { class: 'row' }, [
              el('div', {}, [el('div', { class: 'h' }, [r.fullName]), el('div', { class: 'small k' }, [r.id])]),
              el('button', {
                class: 'button',
                onclick: () => {
                  state.repoId = r.id;
                  localStorage.setItem('graphfly_repo_id', r.id);
                  window.location.hash = 'graph';
                }
              }, ['Open']),
              el('button', {
                class: 'button button--danger',
                onclick: async () => {
                  try {
                    await api.deleteRepo({ repoId: r.id });
                    await refresh();
                  } catch (e) {
                    statusEl.textContent = `Delete failed: ${String(e?.message ?? e)}`;
                  }
                }
              }, ['Remove'])
            ])
          ])
        );
      }

      const hasRepo = list.length > 0;
      const hasDocsRepo = Boolean(org.docsRepoFullName);
      let githubConnected = false;
      githubReposEl.innerHTML = '';
      docsCandidatesEl.innerHTML = '';
      try {
        const gh = await api.githubListRepos();
        githubConnected = true;
        const available = gh.repos ?? [];

        for (const r of available.slice(0, 15)) {
          docsCandidatesEl.appendChild(
            el('li', { class: 'list__item' }, [
              el('div', { class: 'row' }, [
                el('div', {}, [el('div', { class: 'h' }, [r.fullName ?? 'unknown']), el('div', { class: 'small k' }, ['Docs repo candidate'])]),
                el('button', {
                  class: 'button',
                  onclick: async () => {
                    try {
                      await api.updateCurrentOrg({ displayName: orgNameInput.value.trim() || null, docsRepoFullName: r.fullName });
                      await refresh();
                    } catch (e) {
                      statusEl.textContent = `Docs repo save failed: ${String(e?.message ?? e)}`;
                    }
                  }
                }, ['Use for Docs'])
              ])
            ])
          );
        }

        for (const r of available.slice(0, 30)) {
          githubReposEl.appendChild(
            el('li', { class: 'list__item' }, [
              el('div', { class: 'row' }, [
                el('div', {}, [
                  el('div', { class: 'h' }, [r.fullName ?? 'unknown']),
                  el('div', { class: 'small k' }, [`${r.private ? 'private' : 'public'} • ${r.defaultBranch ?? 'main'}`])
                ]),
                el('button', {
                  class: 'button',
                  onclick: async () => {
                    if (!hasDocsRepo) {
                      statusEl.textContent = 'Set a docs repo first (step 2).';
                      return;
                    }
                    try {
                      const created = await api.createRepo({ fullName: r.fullName, defaultBranch: r.defaultBranch, githubRepoId: r.id });
                      const repo = created?.repo ?? null;
                      if (repo?.id) {
                        state.repoId = repo.id;
                        localStorage.setItem('graphfly_repo_id', repo.id);
                        window.location.hash = 'graph';
                        return;
                      }
                      await refresh();
                    } catch (e) {
                      statusEl.textContent = `Create project failed: ${String(e?.message ?? e)}`;
                    }
                  }
                }, ['Create Project'])
              ])
            ])
          );
        }
      } catch {
        githubConnected = false;
        githubReposEl.appendChild(el('li', { class: 'list__item' }, ['Not connected yet.']));
        docsCandidatesEl.appendChild(el('li', { class: 'list__item' }, ['Connect GitHub first to see repo options.']));
      }

      steps[0].ok = githubConnected;
      steps[1].ok = hasDocsRepo;
      steps[2].ok = hasRepo;

      for (let i = 0; i < steps.length; i++) {
        const b = stepBadgeEls[i];
        if (!b) continue;
        b.className = steps[i].ok ? 'badge badge--ok' : 'badge';
        b.textContent = steps[i].ok ? '✓' : '•';
      }

      statusEl.textContent = steps[2].ok
        ? 'Ready: pushes will trigger indexing and a docs PR (docs repo only).'
        : 'Connect GitHub, set a docs repo, and create at least one project.';
    } catch (e) {
      statusEl.textContent = `Failed to load: ${String(e?.message ?? e)}`;
    }
  }

  // Kick off async status load.
  refresh();
}
