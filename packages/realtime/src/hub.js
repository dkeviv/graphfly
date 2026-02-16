function key({ tenantId, repoId }) {
  return `${tenantId}::${repoId}`;
}

export class InMemoryRealtimeHub {
  constructor() {
    this._subsByKey = new Map(); // key -> Set(fn)
  }

  subscribe({ tenantId, repoId, onEvent }) {
    const k = key({ tenantId, repoId });
    if (!this._subsByKey.has(k)) this._subsByKey.set(k, new Set());
    this._subsByKey.get(k).add(onEvent);
    return () => {
      const set = this._subsByKey.get(k);
      if (!set) return;
      set.delete(onEvent);
      if (set.size === 0) this._subsByKey.delete(k);
    };
  }

  publish({ tenantId, repoId, type, payload }) {
    const k = key({ tenantId, repoId });
    const subs = this._subsByKey.get(k);
    if (!subs) return;
    const evt = { type, payload: payload ?? null, tenantId, repoId, ts: Date.now() };
    for (const fn of subs) {
      try {
        fn(evt);
      } catch {
        // ignore subscriber errors
      }
    }
  }
}

