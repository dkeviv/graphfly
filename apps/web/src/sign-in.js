/**
 * sign-in.js — GitHub OAuth sign-in flow for Graphfly
 *
 * Flows handled:
 * 1. Normal page load  → check auth mode; show GitHub button (or dev bypass)
 * 2. GitHub callback   → ?code=&state=  → exchange → store token → redirect to app
 * 3. Dev/none mode     → show "Enter as dev user" bypass button
 *
 * Spec anchor: FR-GH-01 (OAuth primary path), UF-AUTH-01
 */

const API_URL = localStorage.getItem('graphfly_api_url') ?? 'http://127.0.0.1:8787';
const APP_URL = './index.html';

// ─── DOM refs ──────────────────────────────────────────────────────────────
const githubBtn   = document.getElementById('githubBtn');
const devBypass   = document.getElementById('devBypass');
const devEnterBtn = document.getElementById('devEnterBtn');
const signinView  = document.getElementById('signinView');
const loadingView = document.getElementById('loadingView');
const loadingMsg  = document.getElementById('loadingMsg');
const statusEl    = document.getElementById('signinStatus');

// ─── Helpers ───────────────────────────────────────────────────────────────
function showLoading(msg = 'Completing sign-in…') {
  signinView.classList.add('signin-view--hidden');
  signinView.style.display = 'none';
  loadingView.classList.remove('signin-loading--hidden');
  if (loadingMsg) loadingMsg.textContent = msg;
}

function showError(msg) {
  statusEl.className = 'signin-status signin-status--error';
  statusEl.textContent = msg;
  // Ensure sign-in view is visible
  signinView.style.display = '';
  loadingView.classList.add('signin-loading--hidden');
}

function showInfo(msg) {
  statusEl.className = 'signin-status signin-status--info';
  statusEl.textContent = msg;
}

function stripOAuthParams() {
  const url = new URL(window.location.href);
  url.search = '';
  window.history.replaceState({}, '', url.toString());
}

async function apiFetch(path, opts = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { 'content-type': 'application/json', ...opts.headers },
    ...opts
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message ?? data?.error ?? `HTTP ${res.status}`);
  return data;
}

// ─── Step 1: detect auth mode ───────────────────────────────────────────────
async function detectAuthMode() {
  try {
    const data = await apiFetch('/api/v1/auth/mode');
    return data;
  } catch {
    return null;
  }
}

// ─── Step 2: start OAuth ────────────────────────────────────────────────────
async function startOAuth() {
  githubBtn.disabled = true;
  showInfo('Redirecting to GitHub…');
  try {
    const tenantId = localStorage.getItem('graphfly_tenant_id') ?? '00000000-0000-0000-0000-000000000001';
    const data = await apiFetch(`/api/v1/integrations/github/oauth/start?tenantId=${tenantId}`);
    if (!data?.authorizeUrl) throw new Error('No authorize URL returned from server');
    // Persist the state token for CSRF validation in the callback
    sessionStorage.setItem('graphfly_oauth_state', data.state ?? '');
    window.location.href = data.authorizeUrl;
  } catch (e) {
    githubBtn.disabled = false;
    showError(`Could not start GitHub sign-in: ${e.message}`);
  }
}

// ─── Step 3: handle OAuth callback ─────────────────────────────────────────
async function handleCallback(code, state) {
  showLoading('Completing GitHub sign-in…');
  stripOAuthParams();
  try {
    const tenantId = localStorage.getItem('graphfly_tenant_id') ?? '00000000-0000-0000-0000-000000000001';
    const data = await apiFetch('/api/v1/integrations/github/oauth/callback', {
      method: 'POST',
      body: JSON.stringify({ code, state, tenantId })
    });
    // In jwt mode the server returns { ok, authToken, tenantId, user }
    // In none/dev mode it returns { ok: true } — we skip JWT storage
    if (data?.authToken) {
      localStorage.setItem('graphfly_auth_token', data.authToken);
    }
    if (data?.tenantId) {
      localStorage.setItem('graphfly_tenant_id', data.tenantId);
    }
    if (data?.user?.login) {
      localStorage.setItem('graphfly_github_login', data.user.login);
    }
    loadingMsg.textContent = 'Signed in! Redirecting…';
    // Short delay so the user sees the success state
    setTimeout(() => { window.location.href = APP_URL; }, 600);
  } catch (e) {
    showError(`Sign-in failed: ${e.message}. Please try again.`);
  }
}

// ─── Dev bypass ─────────────────────────────────────────────────────────────
function enterAsDev() {
  // No token needed — auth mode is 'none', app just uses DEFAULT_TENANT_ID
  localStorage.removeItem('graphfly_auth_token');
  window.location.href = APP_URL;
}

// ─── Init ───────────────────────────────────────────────────────────────────
async function init() {
  // 1. Check if this is an OAuth callback
  const params = new URLSearchParams(window.location.search);
  const code  = params.get('code');
  const state = params.get('state');
  if (code && state) {
    await handleCallback(code, state);
    return;
  }

  // 2. Check auth mode to decide what to show
  const authInfo = await detectAuthMode();
  const authMode = authInfo == null ? 'unknown' : (authInfo.primaryAuthMode ?? 'oauth');
  const oauthMode = authInfo?.oauthMode ?? true;

  // If already connected (JWT auth + oauthConnected), go straight to app
  const existingToken = localStorage.getItem('graphfly_auth_token');
  if (existingToken && authInfo?.oauthConnected) {
    window.location.href = APP_URL;
    return;
  }

  // 3. Show dev bypass when running in none-auth mode (local dev)
  if (authMode === 'oauth' && authInfo?.oauthConnected === false && !oauthMode) {
    // OAuth not configured — show dev bypass
    devBypass.classList.remove('signin-dev--hidden');
    githubBtn.disabled = true;
    githubBtn.style.opacity = '0.3';
    showInfo('GitHub OAuth is not configured. Use dev bypass below.');
  } else if (
    authInfo === null ||
    (authInfo && String(process?.env?.GRAPHFLY_AUTH_MODE ?? '').toLowerCase() === 'none')
  ) {
    // Can't reach API or dev mode — show dev bypass
    devBypass.classList.remove('signin-dev--hidden');
  }

  // Try to detect dev mode from the API response
  // In 'none' auth mode the server always returns oauthMode:true even without real OAuth
  // We detect it by checking if OAuth start is configured
  if (authInfo && oauthMode) {
    githubBtn.disabled = false;
  }
}

// ─── Event listeners ────────────────────────────────────────────────────────
githubBtn?.addEventListener('click', startOAuth);
devEnterBtn?.addEventListener('click', enterAsDev);

// Run
init().catch((e) => {
  console.error('sign-in init error:', e);
});
