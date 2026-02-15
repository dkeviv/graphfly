import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptString, decryptString } from '../packages/secrets/src/crypto.js';
import { InMemorySecretsStore } from '../packages/secrets/src/store.js';

test('encryptString/decryptString roundtrip with base64 key', () => {
  const env = { GRAPHFLY_SECRET_KEY: Buffer.alloc(32, 7).toString('base64') };
  const ct = encryptString({ plaintext: 'hello', env });
  assert.ok(ct.startsWith('v1.'));
  const pt = decryptString({ ciphertext: ct, env });
  assert.equal(pt, 'hello');
});

test('InMemorySecretsStore stores encrypted values and returns plaintext', async () => {
  const env = { GRAPHFLY_SECRET_KEY: Buffer.alloc(32, 9).toString('base64') };
  const store = new InMemorySecretsStore({ env });
  await store.setSecret({ tenantId: 't-1', key: 'k', value: 'v' });
  const got = await store.getSecret({ tenantId: 't-1', key: 'k' });
  assert.equal(got, 'v');
});

