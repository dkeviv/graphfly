import { createRouter } from './router.js';
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

const state = {
  mode: modeSelect.value,
  apiUrl: localStorage.getItem('graphfly_api_url') ?? 'http://127.0.0.1:8787',
  tenantId: localStorage.getItem('graphfly_tenant_id') ?? '00000000-0000-0000-0000-000000000001',
  repoId: localStorage.getItem('graphfly_repo_id') ?? '00000000-0000-0000-0000-000000000002',
  authToken: localStorage.getItem('graphfly_auth_token') ?? null
};

state.realtime = createRealtimeClient({ apiUrl: state.apiUrl, tenantId: state.tenantId, repoId: state.repoId, authToken: state.authToken });
state.realtime.connect();

modeSelect.addEventListener('change', () => {
  state.mode = modeSelect.value;
  router.refresh();
});

const router = createRouter({
  onRoute: (route) => {
    const ctx = { state, pageEl };
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
    titleEl.textContent = 'Onboarding';
    renderOnboardingPage(ctx);
  }
});

for (const btn of document.querySelectorAll('[data-route]')) {
  btn.addEventListener('click', () => router.go(btn.dataset.route));
}

router.start();
