import { httpRequestJson } from './http.js';

function compactHeaders(headers) {
  const h = {};
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (v === undefined || v === null) continue;
    h[k] = String(v);
  }
  return h;
}

function toToolDefs(tools) {
  return (Array.isArray(tools) ? tools : []).map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description ?? '',
      parameters: t.parameters ?? { type: 'object', additionalProperties: true }
    }
  }));
}

function normalizeToolArgsSchema(schema) {
  if (!schema || typeof schema !== 'object') return { type: 'object', additionalProperties: true };
  return schema;
}

function validateArgsAgainstSchema(schemaRaw, argsRaw) {
  const schema = normalizeToolArgsSchema(schemaRaw);
  const args = argsRaw && typeof argsRaw === 'object' && !Array.isArray(argsRaw) ? argsRaw : null;
  if (!args) return { ok: false, reason: 'args_must_be_object' };
  const type = schema.type;
  if (type && type !== 'object') return { ok: false, reason: 'schema_type_not_object' };
  const props = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const k of required) {
    if (!(k in args)) return { ok: false, reason: `missing_required:${k}` };
  }
  const additional = schema.additionalProperties;
  if (additional === false) {
    for (const k of Object.keys(args)) {
      if (!(k in props)) return { ok: false, reason: `unknown_property:${k}` };
    }
  }
  for (const [k, def] of Object.entries(props)) {
    if (!(k in args)) continue;
    const v = args[k];
    const t = def?.type ?? null;
    const types = Array.isArray(t) ? t : t ? [t] : null;
    if (types) {
      const okType = types.some((want) => {
        if (want === 'null') return v === null;
        if (want === 'string') return typeof v === 'string';
        if (want === 'boolean') return typeof v === 'boolean';
        if (want === 'number') return typeof v === 'number' && Number.isFinite(v);
        if (want === 'integer') return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v);
        if (want === 'object') return v && typeof v === 'object' && !Array.isArray(v);
        if (want === 'array') return Array.isArray(v);
        return true;
      });
      if (!okType) return { ok: false, reason: `invalid_type:${k}` };
    }
    if (def?.enum && Array.isArray(def.enum)) {
      if (!def.enum.includes(v)) return { ok: false, reason: `invalid_enum:${k}` };
    }
    if (typeof v === 'number' && Number.isFinite(v)) {
      if (def?.minimum != null && v < def.minimum) return { ok: false, reason: `min_violation:${k}` };
      if (def?.maximum != null && v > def.maximum) return { ok: false, reason: `max_violation:${k}` };
    }
  }
  return { ok: true };
}

function extractMessageChoice(json) {
  const choice = Array.isArray(json?.choices) ? json.choices[0] : null;
  const msg = choice?.message ?? null;
  return msg && typeof msg === 'object' ? msg : null;
}

function extractOutputText(msg) {
  const c = msg?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    // Some providers return an array of parts.
    return c
      .map((p) => (typeof p?.text === 'string' ? p.text : typeof p === 'string' ? p : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function getToolCalls(msg) {
  const calls = msg?.tool_calls;
  return Array.isArray(calls) ? calls : [];
}

export async function runOpenRouterToolLoop({
  apiKey,
  baseUrl = 'https://openrouter.ai/api/v1',
  model,
  input,
  instructions,
  user = null,
  tools,
  maxTurns = 20,
  requestJson = httpRequestJson,
  appTitle = 'Graphfly',
  httpReferer = null,
  onTurn = null,
  onToolCall = null,
  onToolResult = null
} = {}) {
  const key = String(apiKey ?? '').trim();
  if (!key) throw new Error('openrouter_api_key_required');
  const m = String(model ?? '').trim();
  if (!m) throw new Error('llm_model_required');
  const toolDefs = toToolDefs(tools);
  const toolsByName = new Map((Array.isArray(tools) ? tools : []).map((t) => [t.name, t]));

  const messages = [];
  if (instructions) messages.push({ role: 'system', content: String(instructions) });
  if (input != null && String(input).trim()) messages.push({ role: 'user', content: String(input) });

  const url = new URL('/chat/completions', baseUrl).toString();

  for (let turn = 0; turn < maxTurns; turn++) {
    if (typeof onTurn === 'function') {
      try {
        onTurn({ turn, maxTurns });
      } catch {
        // ignore
      }
    }

    const { status, json, text } = await requestJson({
      url,
      method: 'POST',
      headers: compactHeaders({
        authorization: `Bearer ${key}`,
        accept: 'application/json',
        'content-type': 'application/json; charset=utf-8',
        'x-title': appTitle,
        'http-referer': httpReferer ?? undefined
      }),
      body: {
        model: m,
        messages,
        tools: toolDefs,
        tool_choice: 'auto',
        user: typeof user === 'string' ? user : undefined,
        stream: false
      }
    });

    if (status < 200 || status >= 300) {
      const msg = json?.error?.message ?? text ?? `HTTP ${status}`;
      throw new Error(`OpenRouter /chat/completions failed: ${msg}`);
    }

    const msg = extractMessageChoice(json);
    const toolCalls = getToolCalls(msg);
    if (!toolCalls.length) {
      return { response: json, outputText: extractOutputText(msg).trim() };
    }

    messages.push({
      role: 'assistant',
      content: msg?.content ?? null,
      tool_calls: toolCalls
    });

    for (const call of toolCalls) {
      const name = call?.function?.name ?? call?.name ?? null;
      const callId = call?.id ?? call?.call_id ?? null;
      const rawArgs = call?.function?.arguments ?? call?.arguments ?? '{}';
      if (!name || typeof name !== 'string') throw new Error('invalid_tool_call:name_missing');
      if (!callId || typeof callId !== 'string') throw new Error(`invalid_tool_call:missing_id:${name}`);
      const tool = toolsByName.get(name);
      if (!tool) throw new Error(`llm_requested_unknown_tool:${name}`);

      let args = {};
      try {
        args = typeof rawArgs === 'string' ? JSON.parse(rawArgs || '{}') : rawArgs;
      } catch {
        throw new Error(`invalid_tool_arguments:${name}`);
      }

      const v = validateArgsAgainstSchema(tool.parameters, args);
      if (!v.ok) throw new Error(`invalid_tool_arguments:${name}:${v.reason}`);

      if (typeof onToolCall === 'function') {
        try {
          onToolCall({ name, callId, args });
        } catch {
          // ignore
        }
      }
      const toolResult = await tool.handler(args);
      if (typeof onToolResult === 'function') {
        try {
          onToolResult({ name, callId, result: toolResult });
        } catch {
          // ignore
        }
      }
      messages.push({
        role: 'tool',
        tool_call_id: callId,
        content: JSON.stringify(toolResult ?? null)
      });
    }
  }

  throw new Error(`llm_tool_loop_exceeded_maxTurns:${maxTurns}`);
}

