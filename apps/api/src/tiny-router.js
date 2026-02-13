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
  const middlewares = [];

  function add(method, path, handler) {
    routes.set(`${method} ${path}`, handler);
  }

  async function handle(req) {
    const method = (req.method ?? 'GET').toUpperCase();
    const { pathname, searchParams } = new URL(req.url ?? '/', 'http://localhost');
    const key = `${method} ${pathname}`;
    const handler = routes.get(key);
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

    const ctx = { req, method, pathname, headers, rawBody, body, query };
    for (const mw of middlewares) {
      const maybe = await mw(ctx);
      if (maybe) return maybe;
    }
    return handler(ctx);
  }

  return {
    get: (path, handler) => add('GET', path, handler),
    post: (path, handler) => add('POST', path, handler),
    use: (mw) => middlewares.push(mw),
    handle
  };
}
