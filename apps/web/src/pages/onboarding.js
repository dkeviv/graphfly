import { el, clear } from '../render.js';
import { ApiClient } from '../api.js';
import { parseOAuthCallbackParams, parseGitHubAppCallbackParams, stripQueryFromUrl } from './onboarding-oauth.js';

export function renderOnboardingPage({ state, pageEl }) {
  clear(pageEl);
  const api = new ApiClient({ apiUrl: state.apiUrl, tenantId: state.tenantId, repoId: state.repoId, mode: state.mode, authToken: state.authToken });
  let refreshTimer = null;
  let latestOrg = null;
  let latestOverview = null;
  let docsVerified = false;
  let selectedSourceRepo = null;
  let selectedSourceBranches = [];

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
  const docsVerifyBadgeEl = el('span', { class: 'badge badge--warn' }, ['unverified']);
  const docsCreateFullNameInput = el('input', { class: 'input', placeholder: 'owner/new-docs-repo' });
  const docsCreateVisibilitySelect = el('select', { class: 'select select--compact', 'aria-label': 'Visibility' }, [
    el('option', { value: 'private' }, ['private']),
    el('option', { value: 'public' }, ['public'])
  ]);
  const docsCreateDefaultBranchInput = el('input', { class: 'input', placeholder: 'default branch (optional)' });
  const docsCreateStatusEl = el('div', { class: 'small' }, ['']);

  const reposListEl = el('ul', { class: 'list' });
  const projectPickerHintEl = el('div', { class: 'small' }, ['Select a repo, choose a tracked branch (locked), then create the project.']);
  const selectedRepoEl = el('div', { class: 'list__item' }, [el('div', { class: 'small' }, ['No repo selected yet.'])]);
  const trackedBranchSelect = el('select', { class: 'select select--compact', disabled: '' });
  const branchesStatusEl = el('div', { class: 'small k' }, ['']);
  const createProjectBtn = el('button', { class: 'button button--primary', disabled: '' }, ['Create Project']);
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
        el('div', { class: 'row' }, [docsStatusEl, el('div', { class: 'row__spacer' }, []), docsVerifyBadgeEl]),
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
                  docsVerified = Boolean(out?.ok);
                  if (docsVerified) localStorage.setItem('graphfly_docs_verified', docsRepoInput.value.trim());
                  else localStorage.removeItem('graphfly_docs_verified');
                  setBanner({ kind: docsVerified ? 'ok' : 'warn', text: docsVerified ? 'Docs repo verified.' : 'Docs repo verification returned no result.' });
                  updateCreateProjectGate();
                } catch (e) {
                  docsVerified = false;
                  localStorage.removeItem('graphfly_docs_verified');
                  setBanner({ kind: 'error', text: `Docs repo verify failed: ${String(e?.message ?? e)}` });
                  updateCreateProjectGate();
                }
              }
            }, ['Verify'])
          ]),
          el('details', { class: 'details' }, [
            el('summary', {}, ['Create new docs repo']),
            el('div', { class: 'details__body' }, [
              el('div', { class: 'small' }, ['Create a separate docs repo in GitHub, then verify it. (GitHub Apps are optional.)']),
              docsCreateFullNameInput,
              el('div', { class: 'row' }, [docsCreateVisibilitySelect, docsCreateDefaultBranchInput]),
              docsCreateStatusEl,
              el('div', { class: 'row' }, [
                el('button', { class: 'button button--primary', type: 'button', id: 'docsCreateBtn' }, ['Create repo'])
              ])
            ])
          ])
        ]),
        el('div', { class: 'card' }, [
          el('div', { class: 'card__title' }, ['3) Projects']),
          projectPickerHintEl,
          el('div', { class: 'row' }, [repoSearchInput]),
          el('div', { class: 'small' }, ['Available source repos (read-only):']),
          githubReposEl,
          el('div', { class: 'divider' }, []),
          el('div', { class: 'card__title' }, ['Selected']),
          selectedRepoEl,
          branchesStatusEl,
          el('div', { class: 'row' }, [
            trackedBranchSelect,
            el('div', { class: 'row__spacer' }, []),
            createProjectBtn
          ]),
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

  function updateDocsVerifyBadge() {
    docsVerifyBadgeEl.className = docsVerified ? 'badge badge--ok' : 'badge badge--warn';
    docsVerifyBadgeEl.textContent = docsVerified ? 'verified' : 'unverified';
  }

  function canCreateProject() {
    if (!selectedSourceRepo?.fullName) return false;
    if (!docsRepoInput.value.trim()) return false;
    const docsMode = latestOverview?.docs?.writerMode ?? 'github';
    const cloudSyncRequired = Boolean(latestOverview?.docs?.cloudSyncRequired);
    const runtimeMode = String(latestOverview?.runtime?.mode ?? 'dev').toLowerCase();
    if (docsMode === 'local') return true;
    // OAuth mode can write docs via the user's OAuth token (FR-GH-01 Mode 1).
    // GitHub Apps are optional and preferred when configured, but should not be required for SaaS onboarding.
    if (runtimeMode === 'prod' || cloudSyncRequired) return docsVerified;
    return docsVerified;
  }

  function updateCreateProjectGate() {
    updateDocsVerifyBadge();
    if (!selectedSourceRepo) {
      createProjectBtn.setAttribute('disabled', '');
      return;
    }
    if (canCreateProject()) createProjectBtn.removeAttribute('disabled');
    else createProjectBtn.setAttribute('disabled', '');
  }

  async function selectSourceRepo(repo) {
    selectedSourceRepo = repo ?? null;
    selectedSourceBranches = [];
    trackedBranchSelect.innerHTML = '';
    branchesStatusEl.textContent = '';
    if (!selectedSourceRepo?.fullName) {
      selectedRepoEl.innerHTML = '';
      selectedRepoEl.appendChild(el('div', { class: 'small' }, ['No repo selected yet.']));
      updateCreateProjectGate();
      return;
    }
    selectedRepoEl.innerHTML = '';
    selectedRepoEl.appendChild(el('div', { class: 'h' }, [selectedSourceRepo.fullName]));
    selectedRepoEl.appendChild(el('div', { class: 'small k' }, [`default=${selectedSourceRepo.defaultBranch ?? 'main'} • id=${selectedSourceRepo.id ?? '—'}`]));
    branchesStatusEl.textContent = 'Loading branches…';
    trackedBranchSelect.setAttribute('disabled', '');
    try {
      const out = await api.githubListBranches({ fullName: selectedSourceRepo.fullName });
      const branches = Array.isArray(out?.branches) ? out.branches : [];
      selectedSourceBranches = branches;
      trackedBranchSelect.innerHTML = '';
      const names = branches.map((b) => b?.name).filter((s) => typeof s === 'string' && s.length > 0);
      const uniq = Array.from(new Set(names));
      const preferred = selectedSourceRepo.defaultBranch ?? (uniq[0] ?? 'main');
      for (const n of uniq.slice(0, 100)) trackedBranchSelect.appendChild(new Option(n, n));
      trackedBranchSelect.value = preferred;
      branchesStatusEl.textContent = uniq.length ? `Branches: ${uniq.length}` : 'No branches returned.';
      trackedBranchSelect.removeAttribute('disabled');
      updateCreateProjectGate();
    } catch (e) {
      trackedBranchSelect.innerHTML = '';
      trackedBranchSelect.appendChild(new Option(selectedSourceRepo.defaultBranch ?? 'main', selectedSourceRepo.defaultBranch ?? 'main'));
      trackedBranchSelect.value = selectedSourceRepo.defaultBranch ?? 'main';
      branchesStatusEl.textContent = `Failed to load branches (defaulting): ${String(e?.message ?? e)}`;
      trackedBranchSelect.removeAttribute('disabled');
      updateCreateProjectGate();
    }
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
      // Check auth mode (OAuth vs GitHub Apps)
      let authMode = { githubAppsMode: false, oauthMode: true, primaryAuthMode: 'oauth' };
      try {
        authMode = await api.getAuthMode();
      } catch {
        // Fallback to OAuth mode if endpoint not available
      }
      
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
      latestOrg = org;
      try {
        latestOverview = await api.adminOverview();
      } catch {
        latestOverview = null;
      }
      docsRepoInput.value = org.docsRepoFullName ?? '';
      orgNameInput.value = org.displayName ?? '';
      docsStatusEl.textContent = org.docsRepoFullName ? `Docs repo: ${org.docsRepoFullName}` : 'Docs repo: not set';
      docsVerified = localStorage.getItem('graphfly_docs_verified') === docsRepoInput.value.trim();
      updateDocsVerifyBadge();
      
      // Hide/show GitHub App install buttons based on auth mode
      if (authMode.primaryAuthMode === 'oauth') {
        readerAppBtn.style.display = 'none';
        docsAppBtn.style.display = 'none';
        steps[0].s = 'OAuth sign-in (simple path).';
        githubStatusEl.textContent = authMode.oauthConnected ? 'Status: OAuth connected ✓' : 'Status: Click "Connect GitHub" to sign in';
      } else {
        readerAppBtn.style.display = '';
        docsAppBtn.style.display = '';
        steps[0].s = 'OAuth sign-in. GitHub Apps handle read/write access.';
        const readerOk = Boolean(org?.githubReaderInstallId);
        const docsOk = Boolean(org?.githubDocsInstallId);
        githubStatusEl.textContent = `Status: Reader=${readerOk ? '✓' : '✗'} Docs=${docsOk ? '✓' : '✗'}`;
      }

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
                  onclick: async () => selectSourceRepo(r)
                }, ['Select'])
              ])
            ])
          );
        }
      } catch {
        githubConnected = false;
        githubReposEl.appendChild(el('li', { class: 'list__item' }, ['Connect GitHub and/or install the Reader App to see source repos.']));
        docsCandidatesEl.appendChild(el('li', { class: 'list__item' }, ['Connect GitHub first to see repo options.']));
      }

      const docsMode = latestOverview?.docs?.writerMode ?? 'github';
      const runtimeMode = String(latestOverview?.runtime?.mode ?? 'dev').toLowerCase();
      const cloudSyncRequired = Boolean(latestOverview?.docs?.cloudSyncRequired);

      steps[0].ok = Boolean(state.authToken) || githubConnected || Boolean(org.githubReaderInstallId);
      // Docs repo is valid once it's set and verified (or local mode). GitHub Apps are optional.
      steps[1].ok = hasDocsRepo && (docsMode === 'local' ? true : docsVerified);
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

      updateCreateProjectGate();
    } catch (e) {
      setBanner({ kind: 'error', text: `Failed to load: ${String(e?.message ?? e)}` });
    }
  }

  function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refresh(), 180);
  }

  repoSearchInput.addEventListener('input', scheduleRefresh);
  docsRepoInput.addEventListener('input', () => {
    docsVerified = false;
    localStorage.removeItem('graphfly_docs_verified');
    updateDocsVerifyBadge();
    updateCreateProjectGate();
  });
  trackedBranchSelect.addEventListener('change', () => updateCreateProjectGate());

  createProjectBtn.addEventListener('click', async () => {
    if (!selectedSourceRepo?.fullName) return;
    if (!canCreateProject()) {
      setBanner({ kind: 'warn', text: 'Complete docs repo setup (and verify if required) before creating a project.' });
      return;
    }
    createProjectBtn.setAttribute('disabled', '');
    try {
      const created = await api.createRepo({
        fullName: selectedSourceRepo.fullName,
        defaultBranch: selectedSourceRepo.defaultBranch,
        trackedBranch: trackedBranchSelect.value || selectedSourceRepo.defaultBranch,
        githubRepoId: selectedSourceRepo.id,
        docsRepoFullName: docsRepoInput.value.trim() || null
      });
      const repo = created?.repo ?? null;
      if (repo?.id) {
        state.repoId = repo.id;
        localStorage.setItem('graphfly_repo_id', repo.id);
        state.realtime?.update?.({ nextRepoId: repo.id });
        setBanner({ kind: 'info', text: 'Project created. Indexing started…' });
        // Stay on page and track indexing progress via WebSocket.
        let navTimer = setTimeout(() => { unsub?.(); window.location.hash = 'app'; }, 90_000);
        let unsub;
        unsub = state.realtime?.subscribe?.((evt) => {
          if (!evt || evt.repoId !== repo.id) return;
          const t = String(evt?.type ?? '');
          const pay = evt?.payload ?? {};
          if (t === 'index:progress') {
            const msg = pay?.message ?? pay?.phase ?? 'processing…';
            setBanner({ kind: 'info', text: `Indexing: ${msg}` });
          } else if (t === 'index:complete') {
            clearTimeout(navTimer);
            unsub?.();
            setBanner({ kind: 'ok', text: 'Indexing complete. Opening workspace…' });
            setTimeout(() => { window.location.hash = 'app'; }, 800);
          } else if (t === 'index:error') {
            clearTimeout(navTimer);
            unsub?.();
            setBanner({ kind: 'error', text: `Indexing failed: ${pay?.message ?? 'unknown error'}` });
            updateCreateProjectGate();
          }
        });
        return;
      }
      await refresh();
    } catch (e) {
      setBanner({ kind: 'error', text: `Create project failed: ${String(e?.message ?? e)}` });
    } finally {
      updateCreateProjectGate();
    }
  });

  pageEl.querySelector('#docsCreateBtn')?.addEventListener('click', async () => {
    const btn = pageEl.querySelector('#docsCreateBtn');
    if (!btn) return;
    const fullName = docsCreateFullNameInput.value.trim();
    const visibility = docsCreateVisibilitySelect.value ?? 'private';
    const defaultBranch = docsCreateDefaultBranchInput.value.trim() || null;
    if (!fullName) {
      docsCreateStatusEl.textContent = 'Enter owner/repo to create.';
      return;
    }
    btn.setAttribute('disabled', '');
    docsCreateStatusEl.textContent = 'Creating docs repo…';
    try {
      const out = await api.createDocsRepo({ fullName, visibility, defaultBranch });
      const repo = out?.repo ?? null;
      const created = repo?.fullName ?? fullName;
      docsRepoInput.value = created;
      docsVerified = false;
      localStorage.removeItem('graphfly_docs_verified');
      docsCreateStatusEl.textContent = `Created: ${created}`;
      await refresh();
    } catch (e) {
      const msg = String(e?.data?.message ?? e?.data?.error ?? e?.message ?? e);
      const createUrl = e?.data?.createUrl ?? null;
      docsCreateStatusEl.innerHTML = '';
      docsCreateStatusEl.appendChild(el('div', { class: 'small' }, [`Create failed: ${msg}`]));
      if (createUrl) {
        docsCreateStatusEl.appendChild(
          el(
            'button',
            {
              class: 'button',
              type: 'button',
              onclick: () => {
                try {
                  window.open(String(createUrl), '_blank', 'noopener');
                } catch {
                  // ignore
                }
              }
            },
            ['Open GitHub create page']
          )
        );
      }
      setBanner({ kind: 'error', text: `Docs repo create failed: ${msg}` });
    } finally {
      btn.removeAttribute('disabled');
      updateCreateProjectGate();
    }
  });

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
      const created = await api.createRepo({ fullName, defaultBranch: 'main', githubRepoId: null, repoRoot, docsRepoFullName: docsRepoInput.value.trim() || null });
      const repo = created?.repo ?? null;
      if (repo?.id) {
        state.repoId = repo.id;
        localStorage.setItem('graphfly_repo_id', repo.id);
        state.realtime?.update?.({ nextRepoId: repo.id });
        setBanner({ kind: 'info', text: 'Local project created. Indexing started…' });
        // Stay on page and track indexing progress via WebSocket.
        let navTimer = setTimeout(() => { unsub?.(); window.location.hash = 'graph'; }, 90_000);
        let unsub;
        unsub = state.realtime?.subscribe?.((evt) => {
          if (!evt || evt.repoId !== repo.id) return;
          const t = String(evt?.type ?? '');
          const pay = evt?.payload ?? {};
          if (t === 'index:progress') {
            const msg = pay?.message ?? pay?.phase ?? 'processing…';
            setBanner({ kind: 'info', text: `Indexing: ${msg}` });
          } else if (t === 'index:complete') {
            clearTimeout(navTimer);
            unsub?.();
            setBanner({ kind: 'ok', text: 'Indexing complete. Opening graph…' });
            setTimeout(() => { window.location.hash = 'graph'; }, 800);
          } else if (t === 'index:error') {
            clearTimeout(navTimer);
            unsub?.();
            setBanner({ kind: 'error', text: `Indexing failed: ${pay?.message ?? 'unknown error'}` });
            localCreateBtn.removeAttribute('disabled');
          }
        });
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
