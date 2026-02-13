export class TokenBucketLimiter {
  constructor({ capacity, refillPerSecond, now = () => Date.now() } = {}) {
    if (!Number.isFinite(capacity) || capacity <= 0) throw new Error('capacity must be > 0');
    if (!Number.isFinite(refillPerSecond) || refillPerSecond <= 0) throw new Error('refillPerSecond must be > 0');
    this._capacity = capacity;
    this._refillPerSecond = refillPerSecond;
    this._now = now;
    this._buckets = new Map(); // key -> { tokens, lastMs }
  }

  configure({ capacity, refillPerSecond }) {
    if (Number.isFinite(capacity) && capacity > 0) this._capacity = capacity;
    if (Number.isFinite(refillPerSecond) && refillPerSecond > 0) this._refillPerSecond = refillPerSecond;
  }

  _refill(state, nowMs) {
    const elapsedSec = Math.max(0, (nowMs - state.lastMs) / 1000);
    const refill = elapsedSec * this._refillPerSecond;
    state.tokens = Math.min(this._capacity, state.tokens + refill);
    state.lastMs = nowMs;
  }

  consume(key, amount = 1) {
    if (typeof key !== 'string' || key.length === 0) throw new Error('key required');
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('amount must be > 0');
    const nowMs = this._now();
    const state = this._buckets.get(key) ?? { tokens: this._capacity, lastMs: nowMs };
    this._refill(state, nowMs);
    if (state.tokens < amount) {
      this._buckets.set(key, state);
      const retryAfterSec = Math.ceil((amount - state.tokens) / this._refillPerSecond);
      return { ok: false, retryAfterSec };
    }
    state.tokens -= amount;
    this._buckets.set(key, state);
    return { ok: true, remaining: Math.floor(state.tokens) };
  }
}
