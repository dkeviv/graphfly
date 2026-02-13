import http from 'node:http';
import https from 'node:https';

function httpRequestJson({ url, method, headers, body }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        method,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        headers
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            // ignore
          }
          resolve({ status: res.statusCode ?? 0, json, text });
        });
      }
    );
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

function extractOutputText(responseJson) {
  if (!responseJson || typeof responseJson !== 'object') return '';
  if (typeof responseJson.output_text === 'string') return responseJson.output_text;
  const output = Array.isArray(responseJson.output) ? responseJson.output : [];
  const texts = [];
  for (const item of output) {
    if (item?.type === 'message' && Array.isArray(item?.content)) {
      for (const c of item.content) {
        if (c?.type === 'output_text' && typeof c?.text === 'string') texts.push(c.text);
      }
    }
  }
  return texts.join('\n').trim();
}

function getFunctionCalls(responseJson) {
  const output = Array.isArray(responseJson?.output) ? responseJson.output : [];
  return output.filter((item) => item?.type === 'function_call');
}

function toToolDefs(tools) {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description ?? '',
      parameters: t.parameters ?? { type: 'object', additionalProperties: true }
    }
  }));
}

export async function runOpenClawToolLoop({
  gatewayUrl,
  token,
  agentId = 'main',
  model = 'openclaw',
  input,
  instructions,
  user,
  tools,
  maxTurns = 20,
  requestJson = httpRequestJson
}) {
  const toolsByName = new Map(tools.map((t) => [t.name, t]));
  const toolsPayload = toToolDefs(tools);

  let currentInput = input;

  for (let turn = 0; turn < maxTurns; turn++) {
    const { status, json, text } = await requestJson({
      url: new URL('/v1/responses', gatewayUrl).toString(),
      method: 'POST',
      headers: {
        authorization: token ? `Bearer ${token}` : undefined,
        'content-type': 'application/json; charset=utf-8',
        'x-openclaw-agent-id': agentId
      },
      body: {
        model,
        input: currentInput,
        instructions,
        tools: toolsPayload,
        stream: false,
        user
      }
    });

    if (status < 200 || status >= 300) {
      const message = json?.error?.message ?? text ?? `HTTP ${status}`;
      throw new Error(`OpenClaw /v1/responses failed: ${message}`);
    }

    const calls = getFunctionCalls(json);
    if (calls.length === 0) {
      return { response: json, outputText: extractOutputText(json) };
    }

    const outputs = [];
    for (const call of calls) {
      const name = call?.name ?? call?.function?.name;
      const callId = call?.call_id ?? call?.id ?? call?.callId;
      const rawArgs = call?.arguments ?? call?.function?.arguments ?? '{}';
      const tool = toolsByName.get(name);
      if (!tool) throw new Error(`OpenClaw requested unknown tool: ${name}`);
      if (!callId) throw new Error(`OpenClaw tool call missing call_id for tool: ${name}`);

      let args = {};
      try {
        args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
      } catch {
        throw new Error(`Invalid tool arguments for ${name}: ${String(rawArgs).slice(0, 200)}`);
      }
      const toolResult = await tool.handler(args);
      outputs.push({
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify(toolResult ?? null)
      });
    }

    currentInput = outputs;
  }

  throw new Error(`OpenClaw tool loop exceeded maxTurns=${maxTurns}`);
}
