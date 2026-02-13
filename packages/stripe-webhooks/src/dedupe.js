export class StripeEventDedupe {
  constructor({ max = 50_000 } = {}) {
    this._max = max;
    this._seen = new Map(); // eventId -> timestamp
  }

  has(eventId) {
    if (typeof eventId !== 'string' || eventId.length === 0) return false;
    return this._seen.has(eventId);
  }

  add(eventId) {
    if (typeof eventId !== 'string' || eventId.length === 0) return;
    this._seen.set(eventId, Date.now());
    if (this._seen.size > this._max) {
      const firstKey = this._seen.keys().next().value;
      this._seen.delete(firstKey);
    }
  }
}

