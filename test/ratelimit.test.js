import test from 'node:test';
import assert from 'node:assert/strict';
import { TokenBucketLimiter } from '../packages/ratelimit/src/token-bucket.js';

test('TokenBucketLimiter enforces capacity and refills over time', () => {
  let now = 0;
  const limiter = new TokenBucketLimiter({ capacity: 2, refillPerSecond: 1, now: () => now });
  assert.equal(limiter.consume('k').ok, true);
  assert.equal(limiter.consume('k').ok, true);
  assert.equal(limiter.consume('k').ok, false);
  now += 1000;
  assert.equal(limiter.consume('k').ok, true);
});

