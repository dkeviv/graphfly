import { el, clear } from '../render.js';
import { ApiClient } from '../api.js';
import { parseOAuthCallbackParams, parseGitHubAppCallbackParams, stripQueryFromUrl } from './onboarding-oauth.js';

export function renderOnboardingPage({ state, pageEl }) {
  clear(pageEl);
  const api = new ApiClient({ apiUrl: state.apiUrl, tenantId: state.tenantId, repoId: state.repoId, mode: state.mode, authToken: state.authToken });
  let refreshTimer = null;

  const steps = [
    { k: '1', h: 'Connect GitHub', s: 'OAuth sign-in. GitHub Apps handle read/write access.', ok: false },
    { k: '2', h: 'Docs Repo', s: 'Separate repo (write-only). Docs PRs go here.', ok: false },
    { k: '3', h: 'Create Project', s: 'Pick a source repo; indexing + docs run automatically.', ok: false }
  ];

  const bannerEl = el('div', { class: 'banner', role: 'status', 'aria-live': 'polite' }, ['Loading onboarding status…']);
  const githubTokenInput = el('input', { class: 'input', id: 'githubTokenInput', placeholder: 'GitHub token (dev only)', type: 'password' });
  const githubConnectBtn = el('button', { class: 'button button--primary' }, ['Connect GitHub']);
  const readerAppBtn = el('button', { class: 'button' }, ['Install Reader App']);
  const docsAppBtn = el('button', { class: 'button' }, ['Install Docs App']);
  const githubStatusEl = el('div', { class: 'small' }, ['Status: unknown']);
  const githubReposEl = el('ul', { class: 'list' });
  const repoSearchInput = el('input', { class: 'input', id: 'repoSearchInput', placeholder: 'Filter repos…' });
  const docsCandidatesEl = el('ul', { class: 'list' });
  const docsRepoInput = el('input', { class: 'input', id: 'docsRepoInput', placeholder: 'org/docs (GitHub full name)' });
  const orgNameInput = el('input', { class: 'input', id: 'orgNameInput', placeholder: 'Display name (optional)' });
  const docsStatusEl = el('div', { class: 'small' }, ['Docs repo: not set']);

  const reposListEl = el('ul', { class: 'list' });
  const repoHintEl = el('div', { class: 'small' }, ['Pick a source repo to create a Project. The first index runs automatically.']);
  const localRepoRootInput = el('input', { class: 'input', id: 'localRepoRootInput', placeholder: 'Local repo path (dev only): /abs/path/to/repo' });
  const localCreateBtn = el('button', { class: 'button' }, ['Create Local Project']);

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
        el('div', { class: 'card__title' }, ['Onboarding']),
        bannerEl,
        el('div', { class: 'small' }, ['Complete these steps once per org. Indexing stays up-to-date via GitHub push webhooks.']),
        stepListEl
      ]),
      el('div', { class: 'stack' }, [
        el('div', { class: 'card' }, [
        el('div', { class: 'card__title' }, ['1) Connect GitHub']),
        el('div', { class: 'small' }, ['Primary path: OAuth sign-in. GitHub Apps handle installation-based access.']),
        el('div', { class: 'row' }, [githubConnectBtn, readerAppBtn, docsAppBtn]),
        githubStatusEl,
        el('details', { class: 'details' }, [
          el('summary', {}, ['Advanced (dev only)']),
          el('div', { class: 'details__body' }, [
            el('div', { class: 'small' }, ['Fallback for local/dev: paste a token (stored encrypted). Not recommended for production.']),
              githubTokenInput
            ])
          ])
        ]),
        el('div', { class: 'card' }, [
        el('div', { class: 'card__title' }, ['2) Docs repo (write-only)']),
        el('div', { class: 'small' }, ['Docs must go to a separate repo. Graphfly never writes to the source repo.']),
        el('div', { class: 'small' }, ['Recommended: pick a repo from your GitHub list, then verify.']),
        docsCandidatesEl,
        el('div', { class: 'divider' }),
        docsRepoInput,
        orgNameInput,
        docsStatusEl,
        el('div', { class: 'row' }, [
          el('button', {
            class: 'button button--primary',
            onclick: async () => {
                const docsRepoFullName = docsRepoInput.value.trim();
                const displayName = orgNameInput.value.trim() || null;
                try {
                  await api.updateCurrentOrg({ displayName, docsRepoFullName: docsRepoFullName || null });
                  await refresh();
                } catch (e) {
                  setBanner({ kind: 'error', text: `Save failed: ${String(e?.message ?? e)}` });
                }
              }
            }, ['Save']),
            el('button', {
              class: 'button',
              onclick: async () => {
                try {
                  const out = await api.verifyDocsRepo({ docsRepoFullName: docsRepoInput.value.trim() || null });
                  setBanner({ kind: out?.ok ? 'ok' : 'warn', text: out?.ok ? 'Docs repo verified.' : 'Docs repo verification returned no result.' });
                } catch (e) {
                  setBanner({ kind: 'error', text: `Docs repo verify failed: ${String(e?.message ?? e)}` });
                }
              }
            }, ['Verify'])
          ])
        ]),
        el('div', { class: 'card' }, [
          el('div', { class: 'card__title' }, ['3) Projects']),
          repoHintEl,
          el('div', { class: 'row' }, [repoSearchInput]),
          el('div', { class: 'small' }, ['Available source repos (read-only):']),
          githubReposEl,
          el('div', { class: 'small' }, ['Existing projects:']),
          reposListEl,
          el('details', { class: 'details' }, [
            el('summary', {}, ['Local dev (optional)']),
            el('div', { class: 'details__body' }, [
              el('div', { class: 'small' }, ['Index a local git repo when `GRAPHFLY_ALLOW_LOCAL_REPO_ROOT=1`.']),
              el('div', { class: 'row' }, [localRepoRootInput, localCreateBtn])
            ])
          ])
        ]),
        el('details', { class: 'details' }, [
          el('summary', {}, ['Environment (advanced)']),
          el('div', { class: 'details__body' }, [
            el('div', { class: 'small' }, ['API URL (local dev):']),
            el('div', { class: 'row' }, [
              el('input', { class: 'input', value: state.apiUrl, id: 'apiUrlInput' }),
              el('button', {
                class: 'button',
                onclick: () => {
                  const v = document.getElementById('apiUrlInput').value;
                  localStorage.setItem('graphfly_api_url', v);
                  state.apiUrl = v;
                  state.realtime?.update?.({ nextApiUrl: v });
                  setBanner({ kind: 'ok', text: 'Saved API URL.' });
                }
              }, ['Save'])
            ]),
            el('div', { class: 'small' }, ['Tip: use Support-safe mode from the sidebar when assisting customers.'])
          ])
        ])
      ])
    ])
  );

  function setBanner({ kind = 'info', text }) {
    const k = String(kind ?? 'info');
    bannerEl.className = k === 'ok' ? 'banner banner--ok' : k === 'warn' ? 'banner banner--warn' : k === 'error' ? 'banner banner--error' : 'banner';
    bannerEl.textContent = String(text ?? '');
  }

  githubConnectBtn.onclick = async () => {
    githubConnectBtn.setAttribute('disabled', '');
    try {
      // Prefer real OAuth when configured.
      const start = await api.githubOAuthStart();
      const authorizeUrl = start?.authorizeUrl ?? null;
      if (authorizeUrl) {
        setBanner({ kind: 'info', text: 'Redirecting to GitHub…' });
        window.location.assign(authorizeUrl);
        return;
      }
      // Fallback: dev token connect.
      const token = githubTokenInput.value.trim();
      if (!token) {
        setBanner({ kind: 'warn', text: 'OAuth is not configured for this environment. Use “Advanced (dev only)” to paste a token.' });
        return;
      }
      await api.githubConnect({ token });
      githubTokenInput.value = '';
      await refresh();
    } catch (e) {
      setBanner({ kind: 'error', text: `GitHub connect failed: ${String(e?.message ?? e)}` });
    } finally {
      githubConnectBtn.removeAttribute('disabled');
    }
  };

  readerAppBtn.onclick = async () => {
    try {
      const out = await api.githubReaderAppUrl();
      const installUrl = out?.installUrl ?? null;
      if (!installUrl) throw new Error('reader_app_not_configured');
      setBanner({ kind: 'info', text: 'Redirecting to GitHub App install…' });
      window.location.assign(installUrl);
    } catch (e) {
      setBanner({ kind: 'error', text: `Reader App install failed: ${String(e?.message ?? e)}` });
    }
  };

  docsAppBtn.onclick = async () => {
    try {
      const out = await api.githubDocsAppUrl();
      const installUrl = out?.installUrl ?? null;
      if (!installUrl) throw new Error('docs_app_not_configured');
      setBanner({ kind: 'info', text: 'Redirecting to GitHub App install…' });
      window.location.assign(installUrl);
    } catch (e) {
      setBanner({ kind: 'error', text: `Docs App install failed: ${String(e?.message ?? e)}` });
    }
  };

  async function refresh() {
    try {
      // Handle GitHub App return: ?app=reader|docs&installation_id=...
      const appCb = parseGitHubAppCallbackParams({ search: window.location.search });
      if (appCb) {
        setBanner({ kind: 'info', text: `Saving GitHub ${appCb.app} installation…` });
        try {
          if (appCb.app === 'reader') await api.githubReaderAppCallback({ installationId: appCb.installationId });
          if (appCb.app === 'docs') await api.githubDocsAppCallback({ installationId: appCb.installationId });
          stripQueryFromUrl();
        } catch (e) {
          setBanner({ kind: 'error', text: `App callback failed: ${String(e?.message ?? e)}` });
        }
      }

      // Handle OAuth return: code+state in query string.
      const cb = parseOAuthCallbackParams({ search: window.location.search });
      if (cb) {
        setBanner({ kind: 'info', text: 'Completing GitHub connection…' });
        try {
          const out = await api.githubOAuthCallback(cb);
          if (out?.authToken) {
            state.authToken = out.authToken;
            localStorage.setItem('graphfly_auth_token', out.authToken);
            api.authToken = out.authToken;
            state.realtime?.update?.({ nextAuthToken: out.authToken });
          }
          if (out?.tenantId) {
            state.tenantId = out.tenantId;
            localStorage.setItem('graphfly_tenant_id', out.tenantId);
            api.tenantId = out.tenantId;
            state.realtime?.update?.({ nextTenantId: out.tenantId });
          }
          stripQueryFromUrl();
        } catch (e) {
          setBanner({ kind: 'error', text: `OAuth callback failed: ${String(e?.message ?? e)}` });
        }
      }

      const orgRes = await api.getCurrentOrg();
      const org = orgRes ?? {};
      docsRepoInput.value = org.docsRepoFullName ?? '';
      orgNameInput.value = org.displayName ?? '';
      docsStatusEl.textContent = org.docsRepoFullName ? `Docs repo: ${org.docsRepoFullName}` : 'Docs repo: not set';

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
                  state.realtime?.update?.({ nextRepoId: r.id });
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
                    setBanner({ kind: 'error', text: `Delete failed: ${String(e?.message ?? e)}` });
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
      githubStatusEl.textContent = `Status: ${state.authToken ? 'OAuth session active' : 'not signed in'} • Reader App: ${
        org.githubReaderInstallId ? 'installed' : 'not installed'
      } • Docs App: ${org.githubDocsInstallId ? 'installed' : 'not installed'}`;
      githubReposEl.innerHTML = '';
      docsCandidatesEl.innerHTML = '';
      try {
        const gh = await api.githubListRepos();
        githubConnected = true;
        const available = gh.repos ?? [];
        const q = repoSearchInput.value.trim().toLowerCase();
        const filtered = q
          ? available.filter((r) => String(r?.fullName ?? '').toLowerCase().includes(q))
          : available;

        for (const r of filtered.slice(0, 15)) {
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
                      setBanner({ kind: 'error', text: `Docs repo save failed: ${String(e?.message ?? e)}` });
                    }
                  }
                }, ['Use for Docs'])
              ])
            ])
          );
        }

        for (const r of filtered.slice(0, 50)) {
          githubReposEl.appendChild(
            el('li', { class: 'list__item' }, [
              el('div', { class: 'row' }, [
                el('div', {}, [
                  el('div', { class: 'h' }, [r.fullName ?? 'unknown']),
                  el('div', { class: 'small k' }, [`${r.private ? 'private' : 'public'} • ${r.defaultBranch ?? 'main'}`])
                ]),
                el('button', {
                  class: 'button',
                  ...(hasDocsRepo ? {} : { disabled: '' }),
                  onclick: async (ev) => {
                    if (!hasDocsRepo) {
                      setBanner({ kind: 'warn', text: 'Set a docs repo first (step 2).' });
                      return;
                    }
                    try {
                      const btn = ev?.currentTarget;
                      try {
                        if (btn?.setAttribute) btn.setAttribute('disabled', '');
                      } catch {}
                      const created = await api.createRepo({ fullName: r.fullName, defaultBranch: r.defaultBranch, githubRepoId: r.id });
                      const repo = created?.repo ?? null;
                      if (repo?.id) {
                        state.repoId = repo.id;
                        localStorage.setItem('graphfly_repo_id', repo.id);
                        state.realtime?.update?.({ nextRepoId: repo.id });
                        setBanner({ kind: 'ok', text: 'Project created. Indexing started…' });
                        window.location.hash = 'graph';
                        return;
                      }
                      await refresh();
                    } catch (e) {
                      setBanner({ kind: 'error', text: `Create project failed: ${String(e?.message ?? e)}` });
                    } finally {
                      const btn = ev?.currentTarget;
                      try {
                        if (btn?.removeAttribute) btn.removeAttribute('disabled');
                      } catch {}
                    }
                  }
                }, ['Create Project'])
              ])
            ])
          );
        }
      } catch {
        githubConnected = false;
        githubReposEl.appendChild(el('li', { class: 'list__item' }, ['Connect GitHub and/or install the Reader App to see source repos.']));
        docsCandidatesEl.appendChild(el('li', { class: 'list__item' }, ['Connect GitHub first to see repo options.']));
      }

      steps[0].ok = Boolean(state.authToken) || githubConnected;
      steps[1].ok = hasDocsRepo;
      steps[2].ok = hasRepo;

      for (let i = 0; i < steps.length; i++) {
        const b = stepBadgeEls[i];
        if (!b) continue;
        b.className = steps[i].ok ? 'badge badge--ok' : 'badge';
        b.textContent = steps[i].ok ? '✓' : '•';
      }

      setBanner({
        kind: steps[2].ok ? 'ok' : steps[1].ok && steps[0].ok ? 'info' : 'warn',
        text: steps[2].ok
          ? 'Ready. New commits trigger incremental indexing and docs PRs automatically.'
          : steps[0].ok && steps[1].ok
            ? 'Next: create your first Project.'
            : 'Next: connect GitHub, set a docs repo, then create a Project.'
      });
    } catch (e) {
      setBanner({ kind: 'error', text: `Failed to load: ${String(e?.message ?? e)}` });
    }
  }

  function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refresh(), 180);
  }

  repoSearchInput.addEventListener('input', scheduleRefresh);

  localCreateBtn.onclick = async () => {
    const repoRoot = localRepoRootInput.value.trim();
    if (!repoRoot) return;
    localCreateBtn.setAttribute('disabled', '');
    try {
      const org = await api.getCurrentOrg();
      const hasDocsRepo = Boolean(org?.docsRepoFullName);
      if (!hasDocsRepo) {
        setBanner({ kind: 'warn', text: 'Set a docs repo first (step 2).' });
        return;
      }
      const base = repoRoot.replaceAll('\\', '/').split('/').filter(Boolean).pop() ?? 'repo';
      const fullName = `local/${base}`;
      const created = await api.createRepo({ fullName, defaultBranch: 'main', githubRepoId: null, repoRoot });
      const repo = created?.repo ?? null;
      if (repo?.id) {
        state.repoId = repo.id;
        localStorage.setItem('graphfly_repo_id', repo.id);
        state.realtime?.update?.({ nextRepoId: repo.id });
        setBanner({ kind: 'ok', text: 'Local project created. Indexing started…' });
        window.location.hash = 'graph';
        return;
      }
      await refresh();
    } catch (e) {
      setBanner({ kind: 'error', text: `Create local project failed: ${String(e?.message ?? e)}` });
    } finally {
      localCreateBtn.removeAttribute('disabled');
    }
  };

  // Kick off async status load.
  refresh();
}
