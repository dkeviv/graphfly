import { httpRequestJson } from './http.js';

function parseModelsPayload(json) {
  if (!json) return [];
  const arr = Array.isArray(json?.data)
    ? json.data
    : Array.isArray(json?.models)
      ? json.models
      : Array.isArray(json)
        ? json
        : [];
  return arr
    .map((m) => {
      const id = m?.id ?? m?.model ?? null;
      const name = m?.name ?? m?.display_name ?? m?.displayName ?? null;
      const contextLength = m?.context_length ?? m?.contextLength ?? m?.context ?? null;
      if (typeof id !== 'string' || id.length === 0) return null;
      return { id, name: typeof name === 'string' && name.length ? name : id, contextLength: Number(contextLength ?? 0) || null };
    })
    .filter(Boolean);
}

export async function listOpenRouterModels({
  apiKey,
  baseUrl = 'https://openrouter.ai/api/v1',
  appTitle = 'Graphfly',
  httpReferer = null,
  requestJson = httpRequestJson
} = {}) {
  const key = String(apiKey ?? '').trim();
  if (!key) throw new Error('openrouter_api_key_required');
  const url = new URL('/models', baseUrl).toString();
  const { status, json, text } = await requestJson({
    url,
    method: 'GET',
    headers: {
      authorization: `Bearer ${key}`,
      accept: 'application/json',
      'x-title': appTitle,
      'http-referer': httpReferer ?? undefined
    }
  });
  if (status < 200 || status >= 300) {
    const msg = json?.error?.message ?? text ?? `HTTP ${status}`;
    throw new Error(`openrouter_models_failed:${msg}`);
  }
  const models = parseModelsPayload(json);
  models.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return { ok: true, models };
}

