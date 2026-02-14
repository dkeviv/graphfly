function dayKey(nowMs) {
  const d = new Date(nowMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function monthKey(nowMs) {
  const d = new Date(nowMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthRange(nowMs) {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1));
  const end = new Date(Date.UTC(y, m + 1, 0));
  const fmt = (dt) =>
    `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
  return { periodStart: fmt(start), periodEnd: fmt(end) };
}

export class InMemoryUsageCounters {
  constructor({ nowMs = () => Date.now() } = {}) {
    this._nowMs = nowMs;
    this._counters = new Map(); // tenant::key::window -> number
  }

  _ck({ tenantId, key, window }) {
    return `${tenantId}::${key}::${window}`;
  }

  get({ tenantId, key, window }) {
    const v = this._counters.get(this._ck({ tenantId, key, window })) ?? 0;
    return Number(v) || 0;
  }

  increment({ tenantId, key, window, by = 1 }) {
    const k = this._ck({ tenantId, key, window });
    const prev = this._counters.get(k) ?? 0;
    const next = prev + (Number(by) || 0);
    this._counters.set(k, next);
    return next;
  }

  consumeOrDeny({ tenantId, key, window, amount, limit }) {
    const used = this.get({ tenantId, key, window });
    const n = Number(amount) || 0;
    const lim = Number(limit);
    if (!Number.isFinite(lim) || lim < 0) return { ok: true, used, limit: lim };
    if (used + n > lim) {
      return { ok: false, used, limit: lim, remaining: Math.max(0, lim - used) };
    }
    const after = this.increment({ tenantId, key, window, by: n });
    return { ok: true, used: after, limit: lim, remaining: Math.max(0, lim - after) };
  }

  consumeIndexJobOrDeny({ tenantId, limitPerDay, amount = 1 }) {
    const window = dayKey(this._nowMs());
    return this.consumeOrDeny({ tenantId, key: 'index_jobs_daily', window, amount, limit: limitPerDay });
  }

  consumeDocBlocksOrDeny({ tenantId, limitPerMonth, amount }) {
    const window = monthKey(this._nowMs());
    return this.consumeOrDeny({ tenantId, key: 'doc_blocks_monthly', window, amount, limit: limitPerMonth });
  }

  getIndexJobsToday({ tenantId }) {
    const window = dayKey(this._nowMs());
    return { used: this.get({ tenantId, key: 'index_jobs_daily', window }), periodStart: window, periodEnd: window };
  }

  getDocBlocksThisMonth({ tenantId }) {
    const window = monthKey(this._nowMs());
    const { periodStart, periodEnd } = monthRange(this._nowMs());
    return { used: this.get({ tenantId, key: 'doc_blocks_monthly', window }), periodStart, periodEnd };
  }
}
