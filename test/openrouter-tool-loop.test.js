import test from 'node:test';
import assert from 'node:assert/strict';
import { runOpenRouterToolLoop } from '../packages/llm-openrouter/src/tool-loop.js';

test('runOpenRouterToolLoop executes tool_calls and continues with tool results', async () => {
  const requests = [];
  let callCount = 0;

  const requestJson = async ({ url, method, headers, body }) => {
    requests.push({ url, method, headers, body });
    callCount++;

    if (callCount === 1) {
      return {
        status: 200,
        text: '',
        json: {
          id: 'chatcmpl_1',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'hello_tool', arguments: JSON.stringify({ who: 'world' }) } }]
              }
            }
          ]
        }
      };
    }

    assert.ok(url.includes('/chat/completions'));
    assert.equal(method, 'POST');
    assert.ok(Array.isArray(body?.messages));
    assert.ok(body.messages.some((m) => m?.role === 'tool' && m?.tool_call_id === 'call_1'));

    return {
      status: 200,
      text: '',
      json: {
        id: 'chatcmpl_2',
        choices: [{ index: 0, message: { role: 'assistant', content: 'final answer' } }]
      }
    };
  };

  const { outputText } = await runOpenRouterToolLoop({
    apiKey: 'test',
    baseUrl: 'http://fake-openrouter.local',
    model: 'openai/gpt-4o-mini',
    input: 'hi',
    instructions: 'system',
    user: 'u',
    tools: [
      {
        name: 'hello_tool',
        parameters: { type: 'object', properties: { who: { type: 'string' } }, required: ['who'] },
        handler: async ({ who }) => ({ greeting: `hello ${who}` })
      }
    ],
    requestJson
  });

  assert.equal(outputText, 'final answer');
  assert.equal(requests.length, 2);
});
