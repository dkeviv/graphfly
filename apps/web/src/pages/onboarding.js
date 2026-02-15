import { el, clear } from '../render.js';
import { ApiClient } from '../api.js';

export function renderOnboardingPage({ state, pageEl }) {
  clear(pageEl);
  const api = new ApiClient({ apiUrl: state.apiUrl, tenantId: state.tenantId, repoId: state.repoId, mode: state.mode });

  const steps = [
    { k: '1', h: 'Connect GitHub', s: 'OAuth (dev: paste token) to list repos read-only.', ok: false },
    { k: '2', h: 'Docs Repo', s: 'Separate repo (write-only). Docs PRs go here.', ok: false },
    { k: '3', h: 'Create Project', s: 'Select a source repo; indexing + docs run automatically.', ok: false }
  ];

  const statusEl = el('div', { class: 'small' }, ['Loading onboarding status…']);
  const githubTokenInput = el('input', { class: 'input', id: 'githubTokenInput', placeholder: 'GitHub token (dev) — stored encrypted', type: 'password' });
  const githubConnectBtn = el('button', { class: 'button' }, ['Connect']);
  const githubReposEl = el('ul', { class: 'list' });
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
        el('div', { class: 'small' }, ['Dev mode: paste a token to simulate OAuth.']),
        githubTokenInput,
        el('div', { class: 'row' }, [githubConnectBtn]),
        el('div', { class: 'small' }, ['Available repos:']),
        githubReposEl
      ]),
      el('div', { class: 'card' }, [
        el('div', { class: 'card__title' }, ['2) Docs repo (write-only)']),
        el('div', { class: 'small' }, ['This must be a separate repository from the source repo.']),
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
          }, ['Save'])
        ])
      ]),
      el('div', { class: 'card' }, [
        el('div', { class: 'card__title' }, ['3) Projects']),
        repoHintEl,
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
      const token = githubTokenInput.value.trim();
      if (!token) return;
      await api.githubConnect({ token });
      githubTokenInput.value = '';
      await refresh();
    } catch (e) {
      statusEl.textContent = `GitHub connect failed: ${String(e?.message ?? e)}`;
    }
  };

  async function refresh() {
    try {
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
      try {
        const gh = await api.githubListRepos();
        githubConnected = true;
        const available = gh.repos ?? [];
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
                    try {
                      await api.createRepo({ fullName: r.fullName, defaultBranch: r.defaultBranch, githubRepoId: r.id });
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
