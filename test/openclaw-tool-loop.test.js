import test from 'node:test';
import assert from 'node:assert/strict';
import { runOpenClawToolLoop } from '../packages/openclaw-client/src/openresponses.js';

test('runOpenClawToolLoop executes function_call and continues with function_call_output', async () => {
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
          id: 'resp_1',
          output: [
            {
              type: 'function_call',
              name: 'hello_tool',
              call_id: 'call_1',
              arguments: JSON.stringify({ who: 'world' })
            }
          ]
        }
      };
    }

    assert.ok(Array.isArray(body.input));
    assert.equal(body.input[0].type, 'function_call_output');

    return {
      status: 200,
      text: '',
      json: {
        id: 'resp_2',
        output_text: 'final answer'
      }
    };
  };

  const { outputText } = await runOpenClawToolLoop({
    gatewayUrl: 'http://fake-gateway.local',
    token: '',
    agentId: 'main',
    model: 'openclaw',
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

