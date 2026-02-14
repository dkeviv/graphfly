function assertUuid(v, name) {
  if (typeof v !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
    throw new Error(`${name} must be a UUID string`);
  }
}

function dayWindow(nowMs) {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const iso = `${y}-${m}-${day}`;
  return { periodStart: iso, periodEnd: iso };
}

function monthWindow(nowMs) {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth(); // 0-11
  const start = new Date(Date.UTC(y, m, 1));
  const end = new Date(Date.UTC(y, m + 1, 0)); // last day of month
  const fmt = (dt) =>
    `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
  return { periodStart: fmt(start), periodEnd: fmt(end) };
}

export class PgUsageCounters {
  constructor({ client, nowMs = () => Date.now() } = {}) {
    if (!client || typeof client.query !== 'function') throw new Error('client.query is required');
    this._c = client;
    this._nowMs = nowMs;
  }

  async consumeOrDeny({ tenantId, key, periodStart, periodEnd, amount, limit }) {
    assertUuid(tenantId, 'tenantId');
    if (typeof key !== 'string' || key.length === 0) throw new Error('key is required');
    if (typeof periodStart !== 'string' || periodStart.length === 0) throw new Error('periodStart is required');
    if (typeof periodEnd !== 'string' || periodEnd.length === 0) throw new Error('periodEnd is required');

    const n = Number(amount) || 0;
    const lim = Number(limit);

    await this._c.query('BEGIN');
    try {
      const res = await this._c.query(
        `SELECT value
         FROM usage_counters
         WHERE org_id=$1 AND key=$2 AND period_start=$3
         FOR UPDATE`,
        [tenantId, key, periodStart]
      );
      const usedBefore = Number(res.rows?.[0]?.value ?? 0) || 0;

      if (Number.isFinite(lim) && lim >= 0 && usedBefore + n > lim) {
        await this._c.query('ROLLBACK');
        return { ok: false, used: usedBefore, limit: lim, remaining: Math.max(0, lim - usedBefore) };
      }

      const up = await this._c.query(
        `INSERT INTO usage_counters (org_id, key, period_start, period_end, value)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (org_id, key, period_start)
         DO UPDATE SET
           period_end=EXCLUDED.period_end,
           value=usage_counters.value + EXCLUDED.value,
           updated_at=now()
         RETURNING value`,
        [tenantId, key, periodStart, periodEnd, n]
      );
      const usedAfter = Number(up.rows?.[0]?.value ?? usedBefore + n) || usedBefore + n;

      await this._c.query('COMMIT');
      return {
        ok: true,
        used: usedAfter,
        limit: Number.isFinite(lim) ? lim : lim,
        remaining: Number.isFinite(lim) && lim >= 0 ? Math.max(0, lim - usedAfter) : undefined
      };
    } catch (err) {
      try {
        await this._c.query('ROLLBACK');
      } catch {
        // ignore
      }
      throw err;
    }
  }

  async consumeIndexJobOrDeny({ tenantId, limitPerDay, amount = 1 }) {
    const { periodStart, periodEnd } = dayWindow(this._nowMs());
    return this.consumeOrDeny({ tenantId, key: 'index_jobs_daily', periodStart, periodEnd, amount, limit: limitPerDay });
  }

  async consumeDocBlocksOrDeny({ tenantId, limitPerMonth, amount }) {
    const { periodStart, periodEnd } = monthWindow(this._nowMs());
    return this.consumeOrDeny({
      tenantId,
      key: 'doc_blocks_monthly',
      periodStart,
      periodEnd,
      amount,
      limit: limitPerMonth
    });
  }
}

