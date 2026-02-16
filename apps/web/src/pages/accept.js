import { ApiClient } from '../api.js';
import { el, clear } from '../render.js';
import { parseOAuthCallbackParams, stripQueryFromUrl } from './onboarding-oauth.js';

function parseHashQuery() {
  const raw = window.location.hash.replace(/^#/, '');
  const idx = raw.indexOf('?');
  if (idx === -1) return {};
  const qs = raw.slice(idx + 1);
  const p = new URLSearchParams(qs);
  return {
    tenantId: p.get('tenantId') ?? p.get('tenant_id') ?? null,
    token: p.get('token') ?? null
  };
}

export function renderAcceptInvitePage({ state, pageEl }) {
  clear(pageEl);

  const statusEl = el('div', { class: 'small' }, ['Loading invite…']);
  const connectBtn = el('button', { class: 'button' }, ['Connect GitHub']);

  pageEl.appendChild(
    el('div', { class: 'card' }, [
      el('div', { class: 'card__title' }, ['Accept Invitation']),
      el('div', { class: 'small' }, [
        'Invites require GitHub sign-in. The invite token is never stored server-side in plaintext.'
      ]),
      statusEl,
      el('div', { class: 'row' }, [connectBtn])
    ])
  );

  async function ensureAuth(api) {
    if (state.authToken) return true;

    const cb = parseOAuthCallbackParams({ search: window.location.search });
    if (cb) {
      statusEl.textContent = 'Completing GitHub sign-in…';
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
      return Boolean(state.authToken);
    }
    return false;
  }

  async function accept() {
    const { tenantId, token } = parseHashQuery();
    if (tenantId && tenantId !== state.tenantId) {
      state.tenantId = tenantId;
      localStorage.setItem('graphfly_tenant_id', tenantId);
      state.realtime?.update?.({ nextTenantId: tenantId });
    }
    const api = new ApiClient({ apiUrl: state.apiUrl, tenantId: state.tenantId, repoId: state.repoId, mode: state.mode, authToken: state.authToken });

    const authed = await ensureAuth(api);
    if (!authed) {
      statusEl.textContent = 'Sign in required to accept the invite.';
      connectBtn.disabled = false;
      connectBtn.onclick = async () => {
        connectBtn.disabled = true;
        try {
          const start = await api.githubOAuthStart();
          const authorizeUrl = start?.authorizeUrl ?? null;
          if (!authorizeUrl) throw new Error('oauth_not_configured');
          statusEl.textContent = 'Redirecting to GitHub…';
          window.location.assign(authorizeUrl);
        } catch (e) {
          statusEl.textContent = `OAuth start failed: ${String(e?.message ?? e)}`;
          connectBtn.disabled = false;
        }
      };
      return;
    }

    if (!token) {
      statusEl.textContent = 'Missing invite token.';
      connectBtn.disabled = true;
      return;
    }

    statusEl.textContent = 'Accepting invite…';
    connectBtn.disabled = true;
    try {
      await api.orgAcceptInvite({ token });
      statusEl.textContent = 'Invite accepted. Redirecting to onboarding…';
      setTimeout(() => {
        window.location.hash = 'onboarding';
      }, 500);
    } catch (e) {
      statusEl.textContent = `Accept failed: ${String(e?.message ?? e)}`;
      connectBtn.disabled = false;
    }
  }

  accept();
}

