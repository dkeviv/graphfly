export function createRouter({ onRoute }) {
  const routes = new Set(['dashboard', 'onboarding', 'graph', 'docs', 'coverage', 'admin', 'accept']);
  function current() {
    const hash = window.location.hash.replace('#', '');
    const route = hash.split('?', 1)[0];
    return routes.has(route) ? route : 'dashboard';
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
