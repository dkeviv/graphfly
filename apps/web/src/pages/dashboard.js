import { ApiClient } from '../api.js';
import { el, clear } from '../render.js';

function safe(v) {
  if (v === null || v === undefined) return '—';
  return String(v);
}

export function renderDashboardPage({ state, pageEl }) {
  clear(pageEl);
  const api = new ApiClient({ apiUrl: state.apiUrl, tenantId: state.tenantId, repoId: state.repoId, mode: state.mode, authToken: state.authToken });

  const statusEl = el('div', { class: 'small' }, ['Loading…']);
  const kpisEl = el('div', { class: 'grid4' });
  const actionsEl = el('div', { class: 'row' }, [
    el('button', { class: 'button button--primary', onclick: () => (window.location.hash = 'graph') }, ['Open Graph Explorer']),
    el('button', { class: 'button', onclick: () => (window.location.hash = 'docs') }, ['Open Docs']),
    el('button', { class: 'button', onclick: () => (window.location.hash = 'coverage') }, ['Open Coverage']),
    el('button', { class: 'button', onclick: () => (window.location.hash = 'onboarding') }, ['Setup / Projects'])
  ]);

  const summaryEl = el('div', { class: 'card' }, [el('div', { class: 'card__title' }, ['Summary']), statusEl, kpisEl, actionsEl]);

  pageEl.appendChild(
    el('div', { class: 'grid2' }, [
      summaryEl,
      el('div', { class: 'card' }, [
        el('div', { class: 'card__title' }, ['What to do next']),
        el('div', { class: 'small' }, [
          'Enterprise onboarding is designed to be quick: connect GitHub, set a docs repo, create a Project. After that, pushes keep docs updated automatically.'
        ])
      ])
    ])
  );

  async function refresh() {
    statusEl.textContent = 'Loading…';
    kpisEl.innerHTML = '';

    let org = null;
    let repos = [];
    try {
      org = await api.getCurrentOrg();
      repos = (await api.listRepos())?.repos ?? [];
    } catch (e) {
      statusEl.textContent = `Failed to load: ${String(e?.message ?? e)}`;
      return;
    }

    const docsRepo = org?.docsRepoFullName ?? null;
    const hasProject = repos.length > 0;
    const currentRepo = repos.find((r) => r.id === state.repoId) ?? repos[0] ?? null;

    statusEl.textContent = `${safe(org?.displayName ?? org?.slug ?? 'Org')} • plan=${safe(org?.plan)} • projects=${repos.length}`;

    const card = (label, value, sub) =>
      el('div', { class: 'kpi' }, [
        el('div', { class: 'kpi__label' }, [label]),
        el('div', { class: 'kpi__value' }, [value]),
        el('div', { class: 'kpi__sub' }, [sub])
      ]);

    kpisEl.appendChild(card('Docs repo', docsRepo ? 'Configured' : 'Missing', docsRepo ? docsRepo : 'Set in Setup'));
    kpisEl.appendChild(card('Projects', hasProject ? String(repos.length) : '0', hasProject ? 'Select one from Setup' : 'Create your first Project'));
    kpisEl.appendChild(
      card('Current project', currentRepo?.fullName ? 'Selected' : 'None', currentRepo?.fullName ?? 'Choose a Project')
    );

    // Best-effort job visibility (admin-only; in non-admin modes it may 401/403).
    try {
      const jobs = await api.listJobs({ limit: 50 });
      const all = [...(jobs.indexJobs ?? []), ...(jobs.graphJobs ?? []), ...(jobs.docJobs ?? [])];
      const running = all.filter((j) => j.status === 'active').length;
      const failed = all.filter((j) => j.status === 'dead' || j.status === 'failed').length;
      kpisEl.appendChild(card('Pipelines', running > 0 ? `Running (${running})` : 'Idle', failed > 0 ? `failed=${failed}` : ''));
    } catch {
      kpisEl.appendChild(card('Pipelines', '—', 'Jobs visible to admins only'));
    }

    // Best-effort docs summary (counts block statuses).
    try {
      const blocks = (await api.listDocBlocks())?.blocks ?? [];
      const stale = blocks.filter((b) => String(b.status ?? '') === 'stale').length;
      const ok = blocks.filter((b) => String(b.status ?? '') === 'ok').length;
      kpisEl.appendChild(card('Doc blocks', String(blocks.length), `ok=${ok} • stale=${stale}`));
    } catch {
      kpisEl.appendChild(card('Doc blocks', '—', 'Unavailable'));
    }
  }

  refresh();
}
