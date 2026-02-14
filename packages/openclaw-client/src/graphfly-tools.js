import http from 'node:http';

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      { method: 'GET', hostname: u.hostname, port: u.port, path: u.pathname + u.search },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode ?? 0, json: text ? JSON.parse(text) : null });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

export function makeGraphflyTools({ apiUrl, tenantId, repoId }) {
  return [
    {
      name: 'contracts_get',
      description: 'Fetches Public Contract Graph data for a symbol (no code bodies).',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { symbolUid: { type: 'string' } },
        required: ['symbolUid']
      },
      handler: async ({ symbolUid }) => {
        const { status, json } = await httpGetJson(
          new URL(`/contracts/get?tenantId=${encodeURIComponent(tenantId)}&repoId=${encodeURIComponent(repoId)}&symbolUid=${encodeURIComponent(symbolUid)}`, apiUrl).toString()
        );
        if (status !== 200) throw new Error(`contracts_get failed: HTTP ${status}`);
        return json;
      }
    },
    {
      name: 'graph_blast_radius',
      description: 'Returns impacted nodes (blast radius) for a symbol in the Code Intelligence Graph.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          symbolUid: { type: 'string' },
          depth: { type: 'integer', minimum: 0, maximum: 5 },
          direction: { type: 'string', enum: ['in', 'out', 'both'] }
        },
        required: ['symbolUid']
      },
      handler: async ({ symbolUid, depth = 1, direction = 'both' }) => {
        const { status, json } = await httpGetJson(
          new URL(
            `/graph/blast-radius?tenantId=${encodeURIComponent(tenantId)}&repoId=${encodeURIComponent(repoId)}&symbolUid=${encodeURIComponent(symbolUid)}&depth=${encodeURIComponent(String(depth))}&direction=${encodeURIComponent(direction)}`,
            apiUrl
          ).toString()
        );
        if (status !== 200) throw new Error(`graph_blast_radius failed: HTTP ${status}`);
        return json;
      }
    },
    {
      name: 'graph_semantic_search',
      description: 'Semantic search over Code Intelligence Graph nodes (contract-first, no code bodies).',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 } },
        required: ['query']
      },
      handler: async ({ query, limit = 10 }) => {
        const { status, json } = await httpGetJson(
          new URL(
            `/graph/search?tenantId=${encodeURIComponent(tenantId)}&repoId=${encodeURIComponent(repoId)}&q=${encodeURIComponent(query)}&mode=semantic&limit=${encodeURIComponent(String(limit))}`,
            apiUrl
          ).toString()
        );
        if (status !== 200) throw new Error(`graph_semantic_search failed: HTTP ${status}`);
        return json;
      }
    }
  ];
}
