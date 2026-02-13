import { Plans } from './limits.js';

export class InMemoryEntitlementsStore {
  constructor() {
    this._planByTenant = new Map();
  }

  setPlan(tenantId, plan) {
    this._planByTenant.set(tenantId, plan);
  }

  getPlan(tenantId) {
    return this._planByTenant.get(tenantId) ?? Plans.FREE;
  }
}

