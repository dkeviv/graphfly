import crypto from 'node:crypto';

function repoKey({ tenantId, repoId }) {
  return `${tenantId}::${repoId}`;
}

function threadKey({ tenantId, repoId, threadId }) {
  return `${tenantId}::${repoId}::${threadId}`;
}

function nowIso() {
  return new Date().toISOString();
}

function clampLimit(limit, fallback = 50) {
  const n = Number(limit);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(200, Math.trunc(n)));
}

function stripFencedCodeBlocks(markdown) {
  const s = String(markdown ?? '');
  const re = /(^|\n)\s{0,3}(```|~~~)[^\n]*\n[\s\S]*?\n\s{0,3}\2[^\n]*(?=\n|$)/g;
  return s.replace(re, '\n[REDACTED_CODE_BLOCK]\n');
}

function stripIndentedCodeLines(markdown) {
  const lines = String(markdown ?? '').split('\n');
  const out = [];
  for (const line of lines) {
    if (/^\t/.test(line)) {
      out.push('[REDACTED_INDENTED_CODE]');
      continue;
    }
    if (/^ {4,}/.test(line)) {
      out.push('[REDACTED_INDENTED_CODE]');
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

function sanitizeMessageContent(text, { maxChars = 50_000 } = {}) {
  let s = String(text ?? '');
  s = stripFencedCodeBlocks(s);
  s = stripIndentedCodeLines(s);
  if (s.length > maxChars) s = s.slice(0, maxChars) + '…';
  return s;
}

export class InMemoryAssistantStore {
  constructor() {
    this._drafts = new Map(); // repoKey -> Map(draftId -> draft)
    this._threads = new Map(); // repoKey -> Map(threadId -> thread)
    this._messages = new Map(); // threadKey -> Array(messages)
  }

  async createDraft({ tenantId, repoId, draftType, status = 'draft', mode = 'support_safe', prompt = null, answerMarkdown = null, citations = [], files = [], diff = null, expiresAt = null } = {}) {
    const rk = repoKey({ tenantId, repoId });
    if (!this._drafts.has(rk)) this._drafts.set(rk, new Map());
    const id = crypto.randomUUID();
    const createdAt = nowIso();
    const d = {
      id,
      tenantId,
      repoId,
      draftType,
      status,
      mode,
      prompt,
      answerMarkdown,
      citations,
      files,
      diff,
      pr: null,
      createdAt,
      updatedAt: createdAt,
      expiresAt
    };
    this._drafts.get(rk).set(id, d);
    return d;
  }

  async getDraft({ tenantId, repoId, draftId }) {
    const rk = repoKey({ tenantId, repoId });
    return this._drafts.get(rk)?.get(draftId) ?? null;
  }

  async listDrafts({ tenantId, repoId, status = null, limit = 50 } = {}) {
    const rk = repoKey({ tenantId, repoId });
    const all = Array.from(this._drafts.get(rk)?.values() ?? []);
    const filtered = status ? all.filter((d) => d.status === status) : all;
    const n = clampLimit(limit, 50);
    return filtered.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''))).slice(0, n);
  }

  async updateDraft({ tenantId, repoId, draftId, patch } = {}) {
    const rk = repoKey({ tenantId, repoId });
    const cur = this._drafts.get(rk)?.get(draftId) ?? null;
    if (!cur) return null;
    const p = patch ?? {};
    for (const [k, v] of Object.entries(p)) cur[k] = v;
    cur.updatedAt = nowIso();
    return cur;
  }

  async createThread({ tenantId, repoId, title = null, mode = 'support_safe' } = {}) {
    const rk = repoKey({ tenantId, repoId });
    if (!this._threads.has(rk)) this._threads.set(rk, new Map());
    const id = crypto.randomUUID();
    const createdAt = nowIso();
    const t = {
      id,
      tenantId,
      repoId,
      title: String(title ?? 'New thread').slice(0, 200) || 'New thread',
      mode: mode === 'default' ? 'default' : 'support_safe',
      archivedAt: null,
      createdAt,
      updatedAt: createdAt,
      lastMessageAt: createdAt
    };
    this._threads.get(rk).set(id, t);
    this._messages.set(threadKey({ tenantId, repoId, threadId: id }), []);
    return t;
  }

  async listThreads({ tenantId, repoId, includeArchived = false, limit = 50 } = {}) {
    const rk = repoKey({ tenantId, repoId });
    const all = Array.from(this._threads.get(rk)?.values() ?? []);
    const filtered = includeArchived ? all : all.filter((t) => !t.archivedAt);
    const n = clampLimit(limit, 50);
    return filtered.sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? ''))).slice(0, n);
  }

  async getThread({ tenantId, repoId, threadId }) {
    const rk = repoKey({ tenantId, repoId });
    return this._threads.get(rk)?.get(threadId) ?? null;
  }

  async addMessage({ tenantId, repoId, threadId, role, content, citations = [] } = {}) {
    const rk = repoKey({ tenantId, repoId });
    const thread = this._threads.get(rk)?.get(threadId) ?? null;
    if (!thread) return null;
    const tk = threadKey({ tenantId, repoId, threadId });
    if (!this._messages.has(tk)) this._messages.set(tk, []);
    const id = crypto.randomUUID();
    const createdAt = nowIso();
    const msg = {
      id,
      tenantId,
      repoId,
      threadId,
      role: role === 'assistant' || role === 'system' ? role : 'user',
      content: sanitizeMessageContent(content, { maxChars: 50_000 }),
      citations: Array.isArray(citations) ? citations : [],
      createdAt
    };
    this._messages.get(tk).push(msg);
    thread.updatedAt = createdAt;
    thread.lastMessageAt = createdAt;
    return msg;
  }

  async listMessages({ tenantId, repoId, threadId, limit = 50 } = {}) {
    const tk = threadKey({ tenantId, repoId, threadId });
    const all = Array.from(this._messages.get(tk) ?? []);
    const n = clampLimit(limit, 50);
    return all.slice(-n);
  }
}
