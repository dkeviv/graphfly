import { createRouter } from './router.js';
import { ApiClient } from './api.js';
import { createToastHub } from './toast.js';
import { renderOnboardingPage } from './pages/onboarding.js';
import { renderAcceptInvitePage } from './pages/accept.js';
import { createRealtimeClient } from './realtime.js';
import { renderGraphPage } from './pages/graph.js';
import { el, clear } from './render.js';
import { renderDocsTreePanel } from './workspace/docs-tree.js';
import { renderDocsViewerCanvas } from './workspace/docs-viewer.js';
import { renderChatsPanel } from './workspace/chats.js';
import { renderGitPanel } from './workspace/git-panel.js';
import { renderGitCanvas } from './workspace/git-canvas.js';
import { renderFlowsCanvas } from './workspace/flows-canvas.js';
import { renderSettingsPanel } from './workspace/settings-panel.js';
import { renderSettingsCanvas } from './workspace/settings-canvas.js';

const panelEl = document.getElementById('panel');
const canvasEl = document.getElementById('canvas');
const modeSelect = document.getElementById('modeSelect');
const projectSelectEl = document.getElementById('projectSelect');
const codeBranchPillEl = document.getElementById('codeBranchPill');
const docsBranchSelectEl = document.getElementById('docsBranchSelect');
const llmModelSelectEl = document.getElementById('llmModelSelect');
const openPrBtn = document.getElementById('openPrBtn');
const userBtn = document.getElementById('userBtn');
const toastsEl = document.getElementById('toasts');

const storedMode = String(localStorage.getItem('graphfly_mode') ?? '').trim();
if (storedMode === 'default' || storedMode === 'support_safe') modeSelect.value = storedMode;

const PANEL_MODES = new Set(['chats', 'docs', 'git', 'settings', 'feedback']);
const CANVAS_MODES = new Set(['flows', 'docs', 'git', 'settings', 'graph']);

function normalizePanelMode(v) {
  const s = String(v ?? '').toLowerCase();
  return PANEL_MODES.has(s) ? s : 'chats';
}

function normalizeCanvasMode(v) {
  const s = String(v ?? '').toLowerCase();
  return CANVAS_MODES.has(s) ? s : 'flows';
}

const state = {
  mode: modeSelect.value,
  apiUrl: localStorage.getItem('graphfly_api_url') ?? 'http://127.0.0.1:8787',
  tenantId: localStorage.getItem('graphfly_tenant_id') ?? '00000000-0000-0000-0000-000000000001',
  repoId: localStorage.getItem('graphfly_repo_id') ?? '00000000-0000-0000-0000-000000000002',
  docsRef: localStorage.getItem('graphfly_docs_ref') ?? 'default',
  docsDir: localStorage.getItem('graphfly_docs_dir') ?? '',
  docsPath: localStorage.getItem('graphfly_docs_path') || null,
  docsAnchor: localStorage.getItem('graphfly_docs_anchor') || null,
  docsDraft: null,
  llmModel: String(localStorage.getItem('graphfly_llm_model') ?? '').trim() || null,
  llmModels: null,
  llmModelsLoadedAtMs: 0,
  llmModelsLoading: null,
  threadId: localStorage.getItem('graphfly_thread_id') || null,
  draftId: localStorage.getItem('graphfly_draft_id') || null,
  prRunId: localStorage.getItem('graphfly_pr_run_id') || null,
  authToken: localStorage.getItem('graphfly_auth_token') ?? null,
  panelMode: normalizePanelMode(localStorage.getItem('graphfly_panel_mode')),
  graphOn: localStorage.getItem('graphfly_canvas_graph') === '1',
  graphFocusSymbolUid: localStorage.getItem('graphfly_graph_focus') || null,
  lastCanvasMode: normalizeCanvasMode(localStorage.getItem('graphfly_last_canvas_mode')),
  shell: { org: null, repos: [] },
  shellLoaded: false,
  shellLoading: null,
  disposePanel: null,
  disposeCanvas: null
};

state.toast = createToastHub({ rootEl: toastsEl });
state.realtime = createRealtimeClient({ apiUrl: state.apiUrl, tenantId: state.tenantId, repoId: state.repoId, authToken: state.authToken });
state.realtime.connect();

// ─── Auth gate ─────────────────────────────────────────────────────────────
// In dev/none mode: no gate (GRAPHFLY_AUTH_MODE=none, oauthConnected may be false).
// In jwt mode: if no valid token in localStorage → redirect to sign-in.
(async () => {
  try {
    const api = new ApiClient({ apiUrl: state.apiUrl, tenantId: state.tenantId, repoId: state.repoId, mode: state.mode, authToken: state.authToken });
    const authInfo = await api.getAuthMode().catch(() => null);
    if (!authInfo) return; // Can't reach API — stay in app (offline/dev graceful degradation)

    // If server is in oauth mode AND we have no token AND not already connected:
    // check if a protected endpoint returns 401 → gate to sign-in.
    if (!authInfo.oauthConnected && !state.authToken) {
      try {
        await api.getCurrentOrg();
      } catch (e) {
        if (e?.status === 401) {
          window.location.href = './sign-in.html';
        }
      }
    }
  } catch {
    // Network error or API down — allow app to load (dev/offline graceful degradation)
  }
})();
// ────────────────────────────────────────────────────────────────────────────

// ─── Global indexing banner + agent-complete notifications ──────────────────
const indexingBannerEl = document.getElementById('indexingBanner');
const indexingBannerTextEl = document.getElementById('indexingBannerText');
const indexingBannerBarEl = document.getElementById('indexingBannerBar');
const indexingBannerMetaEl = document.getElementById('indexingBannerMeta');
const indexingBannerSpinEl = document.getElementById('indexingBannerSpin');

let indexingBannerTimer = null;

function showIndexingBanner({ text, meta = '', pct = null }) {
  if (!indexingBannerEl) return;
  indexingBannerEl.classList.remove('ws__banner--hidden');
  if (indexingBannerTextEl) indexingBannerTextEl.textContent = text;
  if (indexingBannerMetaEl) indexingBannerMetaEl.textContent = meta;
  if (indexingBannerBarEl) {
    if (pct != null) {
      indexingBannerBarEl.value = Math.min(100, Math.max(0, Number(pct) || 0));
      indexingBannerBarEl.style.display = '';
    } else {
      indexingBannerBarEl.style.display = 'none';
    }
  }
  if (indexingBannerSpinEl) indexingBannerSpinEl.textContent = '↻';
}

function hideIndexingBanner(delay = 0) {
  clearTimeout(indexingBannerTimer);
  if (delay > 0) {
    indexingBannerTimer = setTimeout(() => {
      indexingBannerEl?.classList.add('ws__banner--hidden');
    }, delay);
  } else {
    indexingBannerEl?.classList.add('ws__banner--hidden');
  }
}

state.realtime.subscribe((evt) => {
  if (!evt) return;
  const t = String(evt?.type ?? '');
  const pay = evt?.payload ?? {};
  // Only show for the active project (or any project if repoId matches)
  const evtRepo = evt?.repoId ?? null;
  if (evtRepo && evtRepo !== state.repoId) return;

  if (t === 'index:progress') {
    clearTimeout(indexingBannerTimer);
    const phase = pay?.phase ?? pay?.message ?? 'Processing…';
    const file = pay?.currentFile ? ` · ${String(pay.currentFile).split('/').slice(-1)[0]}` : '';
    const nodes = pay?.nodes != null ? ` · ${pay.nodes} nodes` : '';
    const edges = pay?.edges != null ? ` · ${pay.edges} edges` : '';
    const pct = pay?.pct ?? pay?.percent ?? null;
    showIndexingBanner({
      text: `Indexing: ${phase}`,
      meta: `${file}${nodes}${edges}`.replace(/^ · /, ''),
      pct
    });
  } else if (t === 'index:complete') {
    const nodes = pay?.nodes != null ? `${pay.nodes} nodes` : '';
    const edges = pay?.edges != null ? ` · ${pay.edges} edges` : '';
    if (indexingBannerSpinEl) indexingBannerSpinEl.textContent = '✓';
    showIndexingBanner({ text: 'Indexing complete', meta: `${nodes}${edges}`.replace(/^ · /, ''), pct: 100 });
    state.toast?.toast?.({ kind: 'ok', title: 'Indexing complete', message: `${nodes}${edges}`.replace(/^ · /, '') || 'Graph updated.' });
    hideIndexingBanner(3000);
  } else if (t === 'index:error') {
    if (indexingBannerSpinEl) indexingBannerSpinEl.textContent = '✗';
    showIndexingBanner({ text: `Indexing failed: ${pay?.message ?? 'unknown error'}`, meta: '', pct: null });
    state.toast?.toast?.({ kind: 'error', title: 'Indexing failed', message: pay?.message ?? 'Check Git panel for details.' });
    hideIndexingBanner(6000);
  } else if (t === 'agent:complete') {
    const prUrl = pay?.prUrl ?? null;
    const prNum = pay?.prNumber ?? null;
    state.toast?.toast?.({
      kind: 'ok',
      title: 'Docs PR opened',
      message: prUrl ? prUrl : prNum ? `PR #${prNum}` : 'A docs PR was opened. Check the Git panel.'
    });
  }
});
// ────────────────────────────────────────────────────────────────────────────

function normalizeLlmModel(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  return s.length > 200 ? s.slice(0, 200) : s;
}

function persistLlmModel(v) {
  const m = normalizeLlmModel(v);
  state.llmModel = m;
  if (m) localStorage.setItem('graphfly_llm_model', m);
  else localStorage.removeItem('graphfly_llm_model');
}

async function refreshLlmModels({ api, force = false } = {}) {
  if (!llmModelSelectEl) return null;
  if (state.llmModelsLoading) return state.llmModelsLoading;
  const ttlMs = 10 * 60 * 1000;
  const now = Date.now();
  if (!force && Array.isArray(state.llmModels) && now - state.llmModelsLoadedAtMs < ttlMs) return state.llmModels;

  state.llmModelsLoading = (async () => {
    try {
      const out = await api.llmModels();
      const models = Array.isArray(out?.models) ? out.models : [];
      state.llmModels = models;
      state.llmModelsLoadedAtMs = now;
      return models;
    } catch {
      state.llmModels = null;
      state.llmModelsLoadedAtMs = now;
      return null;
    }
  })();

  try {
    return await state.llmModelsLoading;
  } finally {
    state.llmModelsLoading = null;
  }
}

async function refreshLlmModelSelect({ api, silent = false } = {}) {
  if (!llmModelSelectEl) return;

  const models = await refreshLlmModels({ api });
  llmModelSelectEl.innerHTML = '';

  if (!Array.isArray(models)) {
    llmModelSelectEl.setAttribute('disabled', '');
    const label = state.llmModel ? `Model: ${state.llmModel}` : 'Model: default';
    llmModelSelectEl.appendChild(new Option(label, state.llmModel ?? ''));
    llmModelSelectEl.value = state.llmModel ?? '';
    return;
  }

  llmModelSelectEl.removeAttribute('disabled');
  llmModelSelectEl.appendChild(new Option('Model: default', ''));
  for (const m of models) {
    const id = typeof m?.id === 'string' ? m.id : null;
    if (!id) continue;
    llmModelSelectEl.appendChild(new Option(`Model: ${id}`, id));
  }
  const desired = state.llmModel ?? '';
  llmModelSelectEl.value = [...llmModelSelectEl.options].some((o) => o.value === desired) ? desired : '';

  if (!silent && state.llmModel && llmModelSelectEl.value !== state.llmModel) {
    state.toast?.toast?.({ kind: 'warn', title: 'Model not found', message: 'Your saved model is not in the current OpenRouter model list.' });
  }
}

modeSelect.addEventListener('change', () => {
  state.mode = modeSelect.value;
  localStorage.setItem('graphfly_mode', state.mode);
  router.refresh();
});

projectSelectEl.addEventListener('change', async () => {
  const next = projectSelectEl.value;
  if (!next) return;
  if (next === '__new__') {
    router.go('onboarding');
    return;
  }
  state.repoId = next;
  localStorage.setItem('graphfly_repo_id', next);
  state.threadId = null;
  localStorage.removeItem('graphfly_thread_id');
  state.draftId = null;
  localStorage.removeItem('graphfly_draft_id');
  state.prRunId = null;
  localStorage.removeItem('graphfly_pr_run_id');
  state.realtime?.update?.({ nextRepoId: next });
  await refreshShell();
  router.refresh();
});

docsBranchSelectEl.addEventListener('change', () => {
  state.docsRef = docsBranchSelectEl.value || 'default';
  localStorage.setItem('graphfly_docs_ref', state.docsRef);
  const cur = currentHashQuery();
  if ((cur.nav ?? null) === 'docs' && currentHashRoute() === 'app') {
    goAppWithQuery({ ref: state.docsRef });
    return;
  }
  router.refresh();
});

llmModelSelectEl?.addEventListener('change', () => {
  const next = llmModelSelectEl.value || null;
  const prev = state.llmModel;
  persistLlmModel(next);
  const api = new ApiClient({ apiUrl: state.apiUrl, tenantId: state.tenantId, repoId: state.repoId, mode: state.mode, authToken: state.authToken });
  llmModelSelectEl.setAttribute('disabled', '');
  (async () => {
    try {
      const org = await api.updateCurrentOrg({ llmModel: state.llmModel });
      state.shell.org = org ?? state.shell.org;
      if (org && Object.prototype.hasOwnProperty.call(org, 'llmModel')) persistLlmModel(org.llmModel ?? null);
      await refreshLlmModelSelect({ api, silent: true });
      state.toast?.toast?.({ kind: 'ok', title: 'Model updated', message: state.llmModel ? state.llmModel : 'default' });
    } catch (e) {
      persistLlmModel(prev);
      await refreshLlmModelSelect({ api, silent: true });
      state.toast?.toast?.({ kind: 'error', title: 'Model update failed', message: String(e?.message ?? e) });
    } finally {
      llmModelSelectEl.removeAttribute('disabled');
    }
  })();
});

openPrBtn.addEventListener('click', () => {
  const draft = state.docsDraft;
  if (!draft || !draft.dirty || !draft.path) {
    state.toast?.toast?.({ kind: 'warn', title: 'Nothing to publish', message: 'Edit a docs file first, then click Open PR.' });
    return;
  }
  const api = new ApiClient({ apiUrl: state.apiUrl, tenantId: state.tenantId, repoId: state.repoId, mode: state.mode, authToken: state.authToken });
  openPrBtn.setAttribute('disabled', '');
  (async () => {
    try {
      const title = `docs: update ${String(draft.path).split('/').slice(-1)[0]}`.slice(0, 120);
      const out = await api.docsOpenPr({
        title,
        body: `Manual edit from Graphfly.\n\nFile: ${draft.path}\n`,
        files: [{ path: draft.path, content: draft.after }]
      });
      const pr = out?.pr ?? null;
      state.toast?.toast?.({
        kind: 'ok',
        title: 'PR opened',
        message: pr?.prUrl ? pr.prUrl : `Branch: ${pr?.branchName ?? '—'}`
      });
      draft.before = draft.after;
      draft.dirty = false;
      draft.diff = null;
      if (pr?.branchName) {
        state.docsRef = String(pr.branchName);
        localStorage.setItem('graphfly_docs_ref', state.docsRef);
        if (currentHashRoute() === 'app') {
          goAppWithQuery({ nav: 'docs', ref: state.docsRef, thread: null, draft: null, run: null });
          return;
        }
      }
      router.refresh();
    } catch (e) {
      state.toast?.toast?.({ kind: 'error', title: 'Open PR failed', message: String(e?.message ?? e) });
    } finally {
      openPrBtn.removeAttribute('disabled');
    }
  })();
});

userBtn.addEventListener('click', () => {
  state.panelMode = 'settings';
  localStorage.setItem('graphfly_panel_mode', state.panelMode);
  state.lastCanvasMode = baseCanvasModeForPanel();
  localStorage.setItem('graphfly_last_canvas_mode', state.lastCanvasMode);
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
      if (org && Object.prototype.hasOwnProperty.call(org, 'llmModel')) persistLlmModel(org.llmModel ?? null);
    } catch (e) {
      // Best-effort; shell can still render in local/dev.
      state.shell.org = null;
      state.shell.repos = [];
    }
    state.shellLoaded = true;

    const repos = state.shell.repos ?? [];
    projectSelectEl.innerHTML = '';
    if (!Array.isArray(repos) || repos.length === 0) {
      projectSelectEl.setAttribute('disabled', '');
      projectSelectEl.appendChild(new Option('No projects yet', ''));
    } else {
      projectSelectEl.removeAttribute('disabled');
      for (const r of repos) {
        projectSelectEl.appendChild(new Option(String(r.fullName ?? r.id), String(r.id)));
      }
      projectSelectEl.appendChild(new Option('New project…', '__new__'));
      const existing = repos.some((r) => String(r.id) === String(state.repoId));
      if (!existing) {
        state.repoId = String(repos[0].id);
        localStorage.setItem('graphfly_repo_id', state.repoId);
        state.realtime?.update?.({ nextRepoId: state.repoId });
      }
      projectSelectEl.value = state.repoId;
    }

    const selectedRepo = Array.isArray(repos) ? repos.find((r) => String(r.id) === String(state.repoId)) : null;
    const trackedBranch = selectedRepo?.trackedBranch ?? selectedRepo?.defaultBranch ?? null;
    codeBranchPillEl.textContent = trackedBranch ? `Code: ${trackedBranch} (locked)` : 'Code: —';

    docsBranchSelectEl.innerHTML = '';
    if (!selectedRepo?.docsRepoFullName) {
      docsBranchSelectEl.setAttribute('disabled', '');
      docsBranchSelectEl.appendChild(new Option('Docs: —', 'default'));
    } else {
      docsBranchSelectEl.removeAttribute('disabled');
      let defaultRef = selectedRepo?.docsDefaultBranch ?? 'main';
      let previews = [];
      try {
        const refs = await api.docsRefs({ repoId: state.repoId });
        defaultRef = refs?.default?.ref ?? defaultRef;
        previews = Array.isArray(refs?.previews) ? refs.previews : [];
      } catch {
        // ignore
      }
      docsBranchSelectEl.appendChild(new Option(`Docs: ${defaultRef}`, 'default'));
      for (const p of previews) {
        const b = p?.ref ?? null;
        if (!b) continue;
        docsBranchSelectEl.appendChild(new Option(`Preview: ${b}`, String(b)));
      }
      docsBranchSelectEl.value = state.docsRef || 'default';
      // If the stored ref is no longer available, fall back to default.
      if (![...docsBranchSelectEl.options].some((o) => o.value === docsBranchSelectEl.value)) {
        state.docsRef = 'default';
        localStorage.setItem('graphfly_docs_ref', 'default');
        docsBranchSelectEl.value = 'default';
      }
    }

    await refreshLlmModelSelect({ api, silent: true });
  })();
  try {
    return await state.shellLoading;
  } finally {
    state.shellLoading = null;
  }
}

const router = createRouter({
  onRoute: (route, query = null) => {
    const ctx = { state };
    applyDeepLinkQuery(query);
    refreshShell().then(() => {
      if (route === 'app') renderWorkspace();
    });
    if (route === 'accept') {
      clear(panelEl);
      clear(canvasEl);
      renderAcceptInvitePage({ ...ctx, pageEl: canvasEl });
      return;
    }
    if (route === 'onboarding') {
      clear(panelEl);
      clear(canvasEl);
      renderOnboardingPage({ ...ctx, pageEl: canvasEl });
      return;
    }
    renderWorkspace();
  }
});

function setRailActive() {
  for (const btn of document.querySelectorAll('.rail__item[data-nav]')) {
    const nav = btn.dataset.nav;
    const active = nav === 'graph' ? state.graphOn : nav === state.panelMode;
    btn.classList.toggle('rail__item--active', Boolean(active));
    btn.setAttribute('aria-current', active ? 'page' : 'false');
  }
}

function baseCanvasModeForPanel() {
  if (state.panelMode === 'docs') return 'docs';
  if (state.panelMode === 'git') return 'git';
  if (state.panelMode === 'settings') return 'settings';
  return 'flows';
}

function desiredCanvasMode() {
  if (state.graphOn) return 'graph';
  if (state.panelMode === 'feedback') return state.lastCanvasMode;
  return baseCanvasModeForPanel();
}

function renderPanel() {
  if (typeof state.disposePanel === 'function') state.disposePanel();
  state.disposePanel = null;
  clear(panelEl);

  if (!state.shellLoaded) {
    panelEl.appendChild(el('div', { class: 'card' }, [el('div', { class: 'card__title' }, ['Loading…']), el('div', { class: 'small' }, ['Fetching projects…'])]));
    return;
  }

  const repos = state.shell?.repos ?? [];
  if ((repos?.length ?? 0) === 0) {
    panelEl.appendChild(
      el('div', { class: 'card' }, [
        el('div', { class: 'card__title' }, ['Setup required']),
        el('div', { class: 'small' }, ['Create your first project to start indexing and generating docs.']),
        el('button', { class: 'button button--primary', onclick: () => router.go('onboarding') }, ['Create project'])
      ])
    );
    return;
  }

  if (state.panelMode === 'chats') {
    state.disposePanel =
      renderChatsPanel({
        state,
        rootEl: panelEl,
        onNavigate: (evt) => {
          if ((evt?.kind ?? null) === 'docs_from_citation' && currentHashRoute() === 'app') {
            goAppWithQuery({
              nav: 'docs',
              path: state.docsPath ?? null,
              ref: state.docsRef ?? 'default',
              anchor: state.docsAnchor ?? null,
              thread: null,
              draft: null,
              run: null
            });
            return;
          }
          if ((evt?.kind ?? null) === 'docs_from_draft' && currentHashRoute() === 'app') {
            goAppWithQuery({ nav: 'docs', path: state.docsPath ?? null, ref: state.docsRef ?? 'default', thread: null, draft: null, run: null });
            return;
          }
          if ((evt?.kind ?? null) === 'graph_from_citation' && currentHashRoute() === 'app') {
            goAppWithQuery({
              canvas: 'graph',
              focus: state.graphFocusSymbolUid ?? evt?.symbolUid ?? null
            });
            return;
          }
          if ((evt?.kind ?? null) === 'flow_from_citation' && currentHashRoute() === 'app') {
            goAppWithQuery({
              canvas: null,
              focus: null
            });
            return;
          }
          if ((evt?.kind ?? null) === 'git_from_citation' && currentHashRoute() === 'app') {
            goAppWithQuery({ nav: 'git', run: state.prRunId ?? evt?.prRunId ?? null, thread: null, draft: null });
            return;
          }
          if ((evt?.kind ?? null) === 'chat_thread' && currentHashRoute() === 'app') {
            goAppWithQuery({ nav: 'chats', thread: state.threadId ?? null, draft: state.draftId ?? null, run: null });
            return;
          }
          router.refresh();
        }
      }) ?? null;
    return;
  }

  if (state.panelMode === 'docs') {
    state.disposePanel =
      renderDocsTreePanel({
        state,
        rootEl: panelEl,
        onNavigate: (evt) => {
          if (evt?.kind === 'onboarding') {
            router.go('onboarding');
            return;
          }
          if (currentHashRoute() === 'app') {
            const patch =
              evt?.kind === 'docs_file'
                ? {
                    nav: 'docs',
                    dir: state.docsDir ?? '',
                    path: state.docsPath ?? '',
                    ref: state.docsRef ?? 'default',
                    anchor: state.docsAnchor ?? null,
                    thread: null,
                    draft: null,
                    run: null
                  }
                : evt?.kind === 'docs_dir'
                  ? {
                      nav: 'docs',
                      dir: state.docsDir ?? '',
                      ref: state.docsRef ?? 'default',
                      anchor: null,
                      thread: null,
                      draft: null,
                      run: null
                    }
                  : null;
            if (patch) {
              goAppWithQuery(patch);
              return;
            }
          }
          router.refresh();
        }
      }) ?? null;
    return;
  }

  if (state.panelMode === 'git') {
    state.disposePanel =
      renderGitPanel({
        state,
        rootEl: panelEl,
        onNavigate: (evt) => {
          if ((evt?.kind ?? null) === 'git_run' && currentHashRoute() === 'app') {
            goAppWithQuery({ nav: 'git', run: state.prRunId ?? null, thread: null, draft: null });
            return;
          }
          router.refresh();
        }
      }) ?? null;
    return;
  }

  if (state.panelMode === 'settings') {
    state.disposePanel =
      renderSettingsPanel({
        state,
        rootEl: panelEl,
        onNavigate: () => router.refresh()
      }) ?? null;
    return;
  }

  if (state.panelMode === 'feedback') {
    const api = new ApiClient({ apiUrl: state.apiUrl, tenantId: state.tenantId, repoId: state.repoId, mode: state.mode, authToken: state.authToken });
    const categorySelect = el('select', { class: 'select select--compact', 'aria-label': 'Category' }, [
      el('option', { value: 'general' }, ['General']),
      el('option', { value: 'bug' }, ['Bug']),
      el('option', { value: 'ux' }, ['UX']),
      el('option', { value: 'docs' }, ['Docs']),
      el('option', { value: 'billing' }, ['Billing'])
    ]);
    const messageInput = el('textarea', { class: 'input', rows: '6', placeholder: 'What can we improve?' });
    const sendBtn = el('button', { class: 'button button--primary', type: 'button' }, ['Send']);
    panelEl.appendChild(
      el('div', { class: 'card' }, [
        el('div', { class: 'card__title' }, ['Feedback']),
        el('div', { class: 'small k' }, ['Category']),
        categorySelect,
        el('div', { class: 'small k' }, ['Message']),
        messageInput,
        el('div', { class: 'row' }, [
          sendBtn
        ])
      ])
    );

    sendBtn.addEventListener('click', () => {
      const message = String(messageInput.value ?? '').trim();
      if (!message) {
        state.toast?.toast?.({ kind: 'warn', title: 'Missing message', message: 'Write a short note, then send.' });
        return;
      }
      sendBtn.setAttribute('disabled', '');
      (async () => {
        try {
          await api.submitFeedback({ category: categorySelect.value ?? 'general', message });
          messageInput.value = '';
          state.toast?.toast?.({ kind: 'ok', title: 'Thanks', message: 'Feedback submitted.' });
        } catch (e) {
          state.toast?.toast?.({ kind: 'error', title: 'Send failed', message: String(e?.message ?? e) });
        } finally {
          sendBtn.removeAttribute('disabled');
        }
      })();
    });
  }
}

function renderCanvas() {
  if (typeof state.disposeCanvas === 'function') state.disposeCanvas();
  state.disposeCanvas = null;
  clear(canvasEl);

  const canvasMode = desiredCanvasMode();
  if (canvasMode === 'graph') {
    state.disposeCanvas = renderGraphPage({ state, pageEl: canvasEl }) ?? null;
    return;
  }
  if (canvasMode === 'docs') {
    state.disposeCanvas =
      renderDocsViewerCanvas({
        state,
        rootEl: canvasEl,
        onNavigate: () => router.refresh()
      }) ?? null;
    return;
  }
  if (canvasMode === 'git') {
    state.disposeCanvas =
      renderGitCanvas({
        state,
        rootEl: canvasEl,
        onNavigate: (evt) => {
          if ((evt?.kind ?? null) === 'docs_from_git' && currentHashRoute() === 'app') {
            goAppWithQuery({ nav: 'docs', ref: state.docsRef ?? 'default', path: state.docsPath ?? null, thread: null, draft: null, run: null });
            return;
          }
          router.refresh();
        }
      }) ?? null;
    return;
  }
  if (canvasMode === 'settings') {
    state.disposeCanvas =
      renderSettingsCanvas({
        state,
        rootEl: canvasEl,
        onNavigate: () => router.refresh()
      }) ?? null;
    return;
  }

  // Default canvas: flows
  state.disposeCanvas =
    renderFlowsCanvas({
      state,
      rootEl: canvasEl,
      onNavigate: (evt) => {
        if ((evt?.kind ?? null) === 'docs_from_flow' && currentHashRoute() === 'app') {
          goAppWithQuery({ nav: 'docs', path: state.docsPath ?? null, ref: state.docsRef ?? 'default', thread: null, draft: null, run: null });
          return;
        }
        router.refresh();
      }
    }) ?? null;
}

function renderWorkspace() {
  setRailActive();
  renderPanel();
  renderCanvas();
}

for (const btn of document.querySelectorAll('.rail__item[data-nav]')) {
  btn.addEventListener('click', () => {
    const nav = btn.dataset.nav;
    if (nav === 'graph') {
      state.graphOn = !state.graphOn;
      localStorage.setItem('graphfly_canvas_graph', state.graphOn ? '1' : '0');
      if (currentHashRoute() === 'app') {
        goAppWithQuery(state.graphOn ? { canvas: 'graph' } : { canvas: null, focus: null });
        return;
      }
      router.refresh();
      return;
    }
    state.panelMode = normalizePanelMode(nav);
    localStorage.setItem('graphfly_panel_mode', state.panelMode);
    if (state.panelMode !== 'feedback') {
      state.lastCanvasMode = baseCanvasModeForPanel();
      localStorage.setItem('graphfly_last_canvas_mode', state.lastCanvasMode);
    }
    if (currentHashRoute() === 'app') {
      const patch =
        state.panelMode === 'docs'
          ? { nav: 'docs', dir: state.docsDir ?? '', path: state.docsPath ?? null, ref: state.docsRef ?? 'default', thread: null, draft: null, run: null }
          : state.panelMode === 'chats'
            ? { nav: 'chats', thread: state.threadId ?? null, draft: state.draftId ?? null, dir: null, path: null, ref: null, run: null }
            : state.panelMode === 'git'
              ? { nav: 'git', run: state.prRunId ?? null, dir: null, path: null, ref: null, thread: null, draft: null }
              : { nav: state.panelMode, dir: null, path: null, ref: null, thread: null, draft: null, run: null };
      goAppWithQuery(patch);
      return;
    }
    router.refresh();
  });
}

router.start();

function currentHashRoute() {
  const raw = window.location.hash.replace('#', '');
  const route = raw.split('?', 1)[0] || 'app';
  return route;
}

function currentHashQuery() {
  const raw = window.location.hash.replace('#', '');
  const queryRaw = raw.includes('?') ? raw.split('?', 2)[1] ?? '' : '';
  const out = Object.create(null);
  if (!queryRaw) return out;
  for (const [k, v] of new URLSearchParams(queryRaw).entries()) out[k] = v;
  return out;
}

function goAppWithQuery(patch) {
  const cur = currentHashQuery();
  const next = { ...cur };
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (v === null) delete next[k];
    else next[k] = String(v);
  }
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(next)) {
    if (!v) continue;
    sp.set(k, v);
  }
  const qs = sp.toString();
  router.go(qs ? `app?${qs}` : 'app');
}

function applyDeepLinkQuery(query) {
  const q = query && typeof query === 'object' ? query : null;
  if (!q) return;

  const canvas = q.canvas ?? null;
  if (canvas != null) {
    const c = String(canvas);
    state.graphOn = c === 'graph';
    localStorage.setItem('graphfly_canvas_graph', state.graphOn ? '1' : '0');
  }

  const nav = q.nav ?? null;
  if (nav && PANEL_MODES.has(String(nav))) {
    state.panelMode = normalizePanelMode(nav);
    localStorage.setItem('graphfly_panel_mode', state.panelMode);
  }

  const thread = q.thread ?? null;
  if (thread != null) {
    const tid = String(thread);
    state.threadId = tid ? tid : null;
    if (state.threadId) localStorage.setItem('graphfly_thread_id', state.threadId);
    else localStorage.removeItem('graphfly_thread_id');
  }

  const run = q.run ?? null;
  if (run != null) {
    const rid = String(run);
    state.prRunId = rid ? rid : null;
    if (state.prRunId) localStorage.setItem('graphfly_pr_run_id', state.prRunId);
    else localStorage.removeItem('graphfly_pr_run_id');
  }

  const draft = q.draft ?? null;
  if (draft != null) {
    const did = String(draft);
    state.draftId = did ? did : null;
    if (state.draftId) localStorage.setItem('graphfly_draft_id', state.draftId);
    else localStorage.removeItem('graphfly_draft_id');
  }

  const ref = q.ref ?? null;
  if (ref && typeof ref === 'string') {
    state.docsRef = ref;
    localStorage.setItem('graphfly_docs_ref', ref);
  }

  const dir = q.dir ?? null;
  if (dir != null) {
    state.docsDir = String(dir);
    localStorage.setItem('graphfly_docs_dir', state.docsDir);
  }

  const path = q.path ?? null;
  if (path != null) {
    const p = String(path);
    state.docsPath = p || null;
    if (p) localStorage.setItem('graphfly_docs_path', p);
    else localStorage.removeItem('graphfly_docs_path');
  }

  const anchor = q.anchor ?? null;
  if (anchor != null) {
    const a = String(anchor);
    state.docsAnchor = a || null;
    if (state.docsAnchor) localStorage.setItem('graphfly_docs_anchor', state.docsAnchor);
    else localStorage.removeItem('graphfly_docs_anchor');
  }

  const focus = q.focus ?? null;
  if (focus != null) {
    const f = String(focus);
    state.graphFocusSymbolUid = f || null;
    if (state.graphFocusSymbolUid) localStorage.setItem('graphfly_graph_focus', state.graphFocusSymbolUid);
    else localStorage.removeItem('graphfly_graph_focus');
  }
}
