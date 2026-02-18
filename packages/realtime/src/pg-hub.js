import crypto from 'node:crypto';
import { InMemoryRealtimeHub } from './hub.js';

function clampInt(value, { min, max, fallback }) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const v = Math.trunc(n);
  return Math.max(min, Math.min(max, v));
}

function safeJsonPayload(obj, { maxBytes = 7600 } = {}) {
  try {
    const raw = JSON.stringify(obj ?? null);
    if (Buffer.byteLength(raw, 'utf8') <= maxBytes) return raw;
    const minimal = {
      instanceId: obj?.instanceId ?? null,
      event: {
        tenantId: obj?.event?.tenantId ?? null,
        repoId: obj?.event?.repoId ?? null,
        type: obj?.event?.type ?? null,
        payload: { truncated: true }
      }
    };
    const minRaw = JSON.stringify(minimal);
    if (Buffer.byteLength(minRaw, 'utf8') <= maxBytes) return minRaw;
    return JSON.stringify({ instanceId: obj?.instanceId ?? null, event: { type: obj?.event?.type ?? null, payload: { truncated: true } } });
  } catch {
    return JSON.stringify({ instanceId: null, event: { type: 'rt:error', payload: { truncated: true } } });
  }
}

export class PgRealtimeHub {
  constructor({ pool, channel = 'graphfly_rt', instanceId = null } = {}) {
    if (!pool || typeof pool.connect !== 'function') throw new Error('pool.connect is required');
    this._pool = pool;
    this._channel = String(channel);
    this._instanceId = instanceId ?? crypto.randomUUID();
    this._local = new InMemoryRealtimeHub();
    this._client = null;
    this._started = false;
    this._reconnectTimer = null;
  }

  subscribe({ tenantId, repoId, onEvent }) {
    return this._local.subscribe({ tenantId, repoId, onEvent });
  }

  publish({ tenantId, repoId, type, payload }) {
    const evt = { type, payload: payload ?? null, tenantId, repoId, ts: Date.now() };
    this._local.publish(evt);
    void this._notify(evt);
  }

  async _notify(evt) {
    if (!this._started || !this._client) return;
    const payload = safeJsonPayload({ instanceId: this._instanceId, event: evt }, { maxBytes: 7600 });
    try {
      await this._client.query('SELECT pg_notify($1, $2)', [this._channel, payload]);
    } catch {
      // best-effort; delivery to local subscribers already happened
    }
  }

  async start() {
    if (this._started) return;
    this._started = true;
    await this._connectAndListen();
  }

  async _connectAndListen() {
    if (!this._started) return;
    try {
      const client = await this._pool.connect();
      this._client = client;
      await client.query(`LISTEN ${this._channel}`);
      client.on('notification', (msg) => {
        if (msg?.channel !== this._channel) return;
        const raw = String(msg?.payload ?? '');
        let decoded = null;
        try {
          decoded = raw ? JSON.parse(raw) : null;
        } catch {
          decoded = null;
        }
        const instanceId = decoded?.instanceId ?? null;
        if (instanceId && instanceId === this._instanceId) return;
        const event = decoded?.event ?? null;
        if (!event || typeof event !== 'object') return;
        const tenantId = event.tenantId ?? null;
        const repoId = event.repoId ?? null;
        const type = event.type ?? null;
        if (!tenantId || !repoId || !type) return;
        this._local.publish({ tenantId, repoId, type, payload: event.payload ?? null });
      });
      client.on('error', () => this._scheduleReconnect());
      client.on('end', () => this._scheduleReconnect());
    } catch {
      this._scheduleReconnect();
    }
  }

  _scheduleReconnect() {
    if (!this._started) return;
    if (this._reconnectTimer) return;
    const delayMs = clampInt(process.env.GRAPHFLY_RT_PG_RECONNECT_MS ?? 2000, { min: 250, max: 30_000, fallback: 2000 });
    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      try {
        await this._cleanupClient();
      } catch {}
      await this._connectAndListen();
    }, delayMs);
    if (typeof this._reconnectTimer.unref === 'function') this._reconnectTimer.unref();
  }

  async _cleanupClient() {
    const client = this._client;
    this._client = null;
    if (!client) return;
    try {
      await client.query(`UNLISTEN ${this._channel}`);
    } catch {}
    try {
      client.release();
    } catch {}
  }

  async close() {
    this._started = false;
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null;
    await this._cleanupClient();
  }
}

