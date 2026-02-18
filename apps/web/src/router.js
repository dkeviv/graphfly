export function createRouter({ onRoute }) {
  const routes = new Set(['app', 'accept', 'onboarding']);
  function parse() {
    const hash = window.location.hash.replace('#', '');
    const [routeRaw, queryRaw = ''] = hash.split('?', 2);
    const route = routes.has(routeRaw) ? routeRaw : 'app';
    const query = Object.create(null);
    if (queryRaw) {
      for (const [k, v] of new URLSearchParams(queryRaw).entries()) query[k] = v;
    }
    return { route, query };
  }
  function go(route) {
    window.location.hash = route;
  }
  function refresh() {
    const { route, query } = parse();
    onRoute(route, query);
  }
  function start() {
    window.addEventListener('hashchange', refresh);
    refresh();
  }
  return { go, start, refresh };
}
