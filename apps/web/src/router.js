export function createRouter({ onRoute }) {
  const routes = new Set(['onboarding', 'graph', 'docs']);
  function current() {
    const hash = window.location.hash.replace('#', '');
    return routes.has(hash) ? hash : 'onboarding';
  }
  function go(route) {
    window.location.hash = route;
  }
  function refresh() {
    onRoute(current());
  }
  function start() {
    window.addEventListener('hashchange', refresh);
    refresh();
  }
  return { go, start, refresh };
}

