export function parseOAuthCallbackParams({ search } = {}) {
  const s = String(search ?? '');
  if (!s || s === '?') return null;
  const params = new URLSearchParams(s.startsWith('?') ? s.slice(1) : s);
  const code = params.get('code');
  const state = params.get('state');
  if (!code || !state) return null;
  return { code, state };
}

export function parseGitHubAppCallbackParams({ search } = {}) {
  const s = String(search ?? '');
  if (!s || s === '?') return null;
  const params = new URLSearchParams(s.startsWith('?') ? s.slice(1) : s);
  const app = params.get('app'); // reader|docs
  const installationId = params.get('installation_id') ?? params.get('installationId');
  if (!app || !installationId) return null;
  if (app !== 'reader' && app !== 'docs') return null;
  return { app, installationId };
}

export function stripQueryFromUrl() {
  const url = new URL(window.location.href);
  url.search = '';
  window.history.replaceState({}, '', url.toString());
}
