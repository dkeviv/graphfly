import { el, clear } from '../render.js';
import { ApiClient } from '../api.js';

export function renderOnboardingPage({ state, pageEl }) {
  clear(pageEl);
  const api = new ApiClient({ apiUrl: state.apiUrl, tenantId: state.tenantId, repoId: state.repoId, mode: state.mode });

  const steps = [
    { k: '1', h: 'Install Reader App', s: 'Connect source repos (read-only).', ok: false },
    { k: '2', h: 'Select Docs Repo', s: 'Choose/create a docs repo (write-only).', ok: false },
    { k: '3', h: 'Index + Generate', s: 'Graph builds automatically; docs PR opens.', ok: false }
  ];

  const statusEl = el('div', { class: 'small' }, ['Loading onboarding status…']);
  const docsRepoInput = el('input', { class: 'input', id: 'docsRepoInput', placeholder: 'org/docs (GitHub full name)' });
  const orgNameInput = el('input', { class: 'input', id: 'orgNameInput', placeholder: 'Display name (optional)' });

  const reposListEl = el('ul', { class: 'list' });
  const repoAddInput = el('input', { class: 'input', id: 'repoAddInput', placeholder: 'org/source (GitHub full name)' });
  const repoAddBtn = el('button', { class: 'button' }, ['Add repo']);

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
        el('div', { class: 'card__title' }, ['Docs repo (write-only)']),
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
        el('div', { class: 'card__title' }, ['Source repos (read-only)']),
        el('div', { class: 'small' }, ['Add the source repository full name(s) you want indexed.']),
        el('div', { class: 'row' }, [repoAddInput, repoAddBtn]),
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

  repoAddBtn.onclick = async () => {
    const fullName = repoAddInput.value.trim();
    if (!fullName) return;
    try {
      await api.createRepo({ fullName });
      repoAddInput.value = '';
      await refresh();
    } catch (e) {
      statusEl.textContent = `Add repo failed: ${String(e?.message ?? e)}`;
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
      steps[0].ok = hasRepo;
      steps[1].ok = hasDocsRepo;
      steps[2].ok = hasRepo && hasDocsRepo;

      for (let i = 0; i < steps.length; i++) {
        const b = stepBadgeEls[i];
        if (!b) continue;
        b.className = steps[i].ok ? 'badge badge--ok' : 'badge';
        b.textContent = steps[i].ok ? '✓' : '•';
      }

      statusEl.textContent = steps[2].ok
        ? 'Ready: pushes will trigger indexing and a docs PR (docs repo only).'
        : 'Configure a source repo and docs repo to enable automatic indexing + docs PRs.';
    } catch (e) {
      statusEl.textContent = `Failed to load: ${String(e?.message ?? e)}`;
    }
  }

  // Kick off async status load.
  refresh();
}
