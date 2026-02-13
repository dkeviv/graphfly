export class DeliveryDedupe {
  constructor({ max = 10_000 } = {}) {
    this._max = max;
    this._seen = new Map(); // deliveryId -> timestamp
  }

  seen(deliveryId) {
    if (typeof deliveryId !== 'string' || deliveryId.length === 0) return false;
    return this._seen.has(deliveryId);
  }

  mark(deliveryId) {
    if (typeof deliveryId !== 'string' || deliveryId.length === 0) return;
    this._seen.set(deliveryId, Date.now());
    if (this._seen.size > this._max) {
      const firstKey = this._seen.keys().next().value;
      this._seen.delete(firstKey);
    }
  }
}

