async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function parseQuery(searchParams) {
  const query = Object.create(null);
  for (const [k, v] of searchParams.entries()) query[k] = v;
  return query;
}

export function createJsonRouter() {
  const routes = new Map();
  const paramRoutes = [];
  const middlewares = [];

  function compileParamRoute(path) {
    const parts = String(path ?? '').split('/').filter((p) => p.length > 0);
    const keys = [];
    const reParts = parts.map((p) => {
      if (p.startsWith(':')) {
        keys.push(p.slice(1));
        return '([^/]+)';
      }
      return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    });
    const regex = new RegExp(`^/${reParts.join('/')}$`);
    return { regex, keys };
  }

  function add(method, path, handler) {
    const p = String(path ?? '');
    if (p.includes('/:')) {
      const { regex, keys } = compileParamRoute(p);
      paramRoutes.push({ method, path: p, regex, keys, handler });
      return;
    }
    routes.set(`${method} ${p}`, handler);
  }

  async function handle(req) {
    const method = (req.method ?? 'GET').toUpperCase();
    const { pathname, searchParams } = new URL(req.url ?? '/', 'http://localhost');
    const key = `${method} ${pathname}`;
    let handler = routes.get(key);
    let params = null;
    if (!handler) {
      for (const r of paramRoutes) {
        if (r.method !== method) continue;
        const m = pathname.match(r.regex);
        if (!m) continue;
        handler = r.handler;
        params = Object.create(null);
        for (let i = 0; i < r.keys.length; i++) params[r.keys[i]] = m[i + 1];
        break;
      }
    }
    if (!handler) return { status: 404, body: { error: 'not_found' } };

    const rawBody = method === 'POST' || method === 'PUT' || method === 'PATCH' ? await readRawBody(req) : null;
    let body = null;
    if (rawBody && rawBody.length) {
      try {
        body = JSON.parse(rawBody.toString('utf8'));
      } catch {
        body = null;
      }
    }
    const query = parseQuery(searchParams);

    const headers = Object.create(null);
    for (const [k, v] of Object.entries(req.headers ?? {})) headers[k.toLowerCase()] = v;

    const ctx = { req, method, pathname, headers, rawBody, body, query, params: params ?? Object.create(null) };
    for (const mw of middlewares) {
      const maybe = await mw(ctx);
      if (maybe) return maybe;
    }
    return handler(ctx);
  }

  return {
    get: (path, handler) => add('GET', path, handler),
    post: (path, handler) => add('POST', path, handler),
    put: (path, handler) => add('PUT', path, handler),
    delete: (path, handler) => add('DELETE', path, handler),
    use: (mw) => middlewares.push(mw),
    handle
  };
}
