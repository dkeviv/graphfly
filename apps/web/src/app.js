import { createRouter } from './router.js';
import { ApiClient } from './api.js';
import { createToastHub } from './toast.js';
import { renderDashboardPage } from './pages/dashboard.js';
import { renderOnboardingPage } from './pages/onboarding.js';
import { renderGraphPage } from './pages/graph.js';
import { renderDocsPage } from './pages/docs.js';
import { renderCoveragePage } from './pages/coverage.js';
import { renderAdminPage } from './pages/admin.js';
import { renderAcceptInvitePage } from './pages/accept.js';
import { createRealtimeClient } from './realtime.js';

const pageEl = document.getElementById('page');
const titleEl = document.getElementById('pageTitle');
const modeSelect = document.getElementById('modeSelect');
const orgDisplayEl = document.getElementById('orgDisplay');
const repoSelectEl = document.getElementById('repoSelect');
const toastsEl = document.getElementById('toasts');

const state = {
  mode: modeSelect.value,
  apiUrl: localStorage.getItem('graphfly_api_url') ?? 'http://127.0.0.1:8787',
  tenantId: localStorage.getItem('graphfly_tenant_id') ?? '00000000-0000-0000-0000-000000000001',
  repoId: localStorage.getItem('graphfly_repo_id') ?? '00000000-0000-0000-0000-000000000002',
  authToken: localStorage.getItem('graphfly_auth_token') ?? null,
  shell: { org: null, repos: [] },
  shellLoaded: false,
  shellLoading: null
};

state.toast = createToastHub({ rootEl: toastsEl });
state.realtime = createRealtimeClient({ apiUrl: state.apiUrl, tenantId: state.tenantId, repoId: state.repoId, authToken: state.authToken });
state.realtime.connect();

modeSelect.addEventListener('change', () => {
  state.mode = modeSelect.value;
  router.refresh();
});

repoSelectEl.addEventListener('change', () => {
  const nextRepoId = repoSelectEl.value;
  if (!nextRepoId) return;
  state.repoId = nextRepoId;
  localStorage.setItem('graphfly_repo_id', nextRepoId);
  state.realtime?.update?.({ nextRepoId });
  router.refresh();
});

async function refreshShell() {
  if (state.shellLoading) return state.shellLoading;
  state.shellLoading = (async () => {
  const api = new ApiClient({ apiUrl: state.apiUrl, tenantId: state.tenantId, repoId: state.repoId, mode: state.mode, authToken: state.authToken });

  try {
    const org = await api.getCurrentOrg();
    const repos = (await api.listRepos())?.repos ?? [];
    state.shell.org = org ?? null;
    state.shell.repos = repos;
  } catch (e) {
    // Best-effort; shell can still render in local/dev.
    state.shell.org = null;
    state.shell.repos = [];
  }
  state.shellLoaded = true;

  const orgName = state.shell.org?.displayName ?? state.shell.org?.slug ?? state.tenantId;
  orgDisplayEl.textContent = String(orgName ?? '—');

  repoSelectEl.innerHTML = '';
  const repos = state.shell.repos ?? [];
  if (!Array.isArray(repos) || repos.length === 0) {
    repoSelectEl.setAttribute('disabled', '');
    repoSelectEl.appendChild(new Option('No projects yet', ''));
  } else {
    repoSelectEl.removeAttribute('disabled');
    for (const r of repos) {
      repoSelectEl.appendChild(new Option(String(r.fullName ?? r.id), String(r.id)));
    }
    const existing = repos.some((r) => r.id === state.repoId);
    if (!existing) {
      state.repoId = String(repos[0].id);
      localStorage.setItem('graphfly_repo_id', state.repoId);
      state.realtime?.update?.({ nextRepoId: state.repoId });
    }
    repoSelectEl.value = state.repoId;
  }

  const hasProject = repos.length > 0;
  const hasDocsRepo = Boolean(state.shell.org?.docsRepoFullName);
  const navGate = [
    { route: 'graph', enabled: hasProject },
    { route: 'docs', enabled: hasProject && hasDocsRepo },
    { route: 'coverage', enabled: hasProject },
    { route: 'admin', enabled: true }
  ];
  for (const it of navGate) {
    const btn = document.querySelector(`[data-route="${it.route}"]`);
    if (!btn) continue;
    if (it.enabled) btn.removeAttribute('disabled');
    else btn.setAttribute('disabled', '');
  }
  })();
  try {
    return await state.shellLoading;
  } finally {
    state.shellLoading = null;
  }
}

const router = createRouter({
  onRoute: (route) => {
    const ctx = { state, pageEl };
    refreshShell();

    for (const btn of document.querySelectorAll('[data-route]')) {
      btn.classList.toggle('nav__item--active', btn.dataset.route === route);
      btn.setAttribute('aria-current', btn.dataset.route === route ? 'page' : 'false');
    }

    if (state.shellLoaded && route !== 'onboarding' && route !== 'accept' && (state.shell?.repos?.length ?? 0) === 0) {
      titleEl.textContent = 'Setup';
      renderOnboardingPage(ctx);
      state.toast?.toast?.({ kind: 'warn', title: 'Setup required', message: 'Create your first Project to unlock the app.' });
      return;
    }

    if (route === 'graph') {
      titleEl.textContent = 'Graph Explorer';
      renderGraphPage(ctx);
      return;
    }
    if (route === 'docs') {
      titleEl.textContent = 'Docs';
      renderDocsPage(ctx);
      return;
    }
    if (route === 'coverage') {
      titleEl.textContent = 'Coverage';
      renderCoveragePage(ctx);
      return;
    }
    if (route === 'admin') {
      titleEl.textContent = 'Admin';
      renderAdminPage(ctx);
      return;
    }
    if (route === 'accept') {
      titleEl.textContent = 'Accept Invite';
      renderAcceptInvitePage(ctx);
      return;
    }
    if (route === 'onboarding') {
      titleEl.textContent = 'Setup';
      renderOnboardingPage(ctx);
      return;
    }
    titleEl.textContent = 'Dashboard';
    renderDashboardPage(ctx);
  }
});

for (const btn of document.querySelectorAll('[data-route]')) {
  btn.addEventListener('click', () => router.go(btn.dataset.route));
}

router.start();
