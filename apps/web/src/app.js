import { createRouter } from './router.js';
import { renderOnboardingPage } from './pages/onboarding.js';
import { renderGraphPage } from './pages/graph.js';
import { renderDocsPage } from './pages/docs.js';

const pageEl = document.getElementById('page');
const titleEl = document.getElementById('pageTitle');
const modeSelect = document.getElementById('modeSelect');

const state = {
  mode: modeSelect.value,
  apiUrl: localStorage.getItem('graphfly_api_url') ?? 'http://127.0.0.1:8787',
  tenantId: 't-1',
  repoId: 'r-1'
};

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
    titleEl.textContent = 'Onboarding';
    renderOnboardingPage(ctx);
  }
});

for (const btn of document.querySelectorAll('[data-route]')) {
  btn.addEventListener('click', () => router.go(btn.dataset.route));
}

router.start();

