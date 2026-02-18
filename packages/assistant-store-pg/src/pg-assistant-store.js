import { redactSecrets } from '../../security/src/redact.js';

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
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
  s = redactSecrets(s);
  if (s.length > maxChars) s = s.slice(0, maxChars) + '…';
  return s;
}

export class PgAssistantStore {
  constructor({ client, repoFullName = 'local/unknown' } = {}) {
    if (!client || typeof client.query !== 'function') throw new Error('client.query is required');
    this._c = client;
    this._repoFullName = repoFullName;
    this._ensured = new Set(); // tenant::repo
  }

  _rk({ tenantId, repoId }) {
    return `${tenantId}::${repoId}`;
  }

  async _ensureOrgRepo({ tenantId, repoId }) {
    const k = this._rk({ tenantId, repoId });
    if (this._ensured.has(k)) return;
    await this._c.query(`INSERT INTO orgs (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [tenantId, 'graphfly']);
    await this._c.query(
      `INSERT INTO repos (id, tenant_id, full_name, default_branch)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [repoId, tenantId, this._repoFullName, 'main']
    );
    this._ensured.add(k);
  }

  async createDraft({
    tenantId,
    repoId,
    draftType,
    status = 'draft',
    mode = 'support_safe',
    prompt = null,
    answerMarkdown = null,
    citations = [],
    files = [],
    diff = null,
    expiresAt = null
  } = {}) {
    await this._ensureOrgRepo({ tenantId, repoId });
    if (!isNonEmptyString(draftType)) throw new Error('draftType required');
    const safePrompt = typeof prompt === 'string' ? redactSecrets(prompt).slice(0, 20_000) : null;
    const safeAnswer = typeof answerMarkdown === 'string' ? redactSecrets(answerMarkdown).slice(0, 200_000) : null;
    const citationsJson = citations ?? [];
    const filesJson = files ?? [];
    const safeDiff = typeof diff === 'string' ? redactSecrets(diff).slice(0, 400_000) : null;
    const res = await this._c.query(
      `INSERT INTO assistant_drafts (
         tenant_id, repo_id, draft_type, status, mode, prompt, answer_markdown,
         citations, files, diff, expires_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11)
       RETURNING *`,
      [tenantId, repoId, draftType, status, mode, safePrompt, safeAnswer, JSON.stringify(citationsJson), JSON.stringify(filesJson), safeDiff, expiresAt]
    );
    return res.rows?.[0] ?? null;
  }

  async getDraft({ tenantId, repoId, draftId }) {
    await this._ensureOrgRepo({ tenantId, repoId });
    if (!isNonEmptyString(draftId)) throw new Error('draftId required');
    const res = await this._c.query(`SELECT * FROM assistant_drafts WHERE tenant_id=$1 AND repo_id=$2 AND id=$3 LIMIT 1`, [
      tenantId,
      repoId,
      draftId
    ]);
    return res.rows?.[0] ?? null;
  }

  async listDrafts({ tenantId, repoId, status = null, limit = 50 } = {}) {
    await this._ensureOrgRepo({ tenantId, repoId });
    const n = clampLimit(limit, 50);
    if (status) {
      const res = await this._c.query(
        `SELECT * FROM assistant_drafts
         WHERE tenant_id=$1 AND repo_id=$2 AND status=$3
         ORDER BY created_at DESC
         LIMIT $4`,
        [tenantId, repoId, status, n]
      );
      return Array.isArray(res.rows) ? res.rows : [];
    }
    const res = await this._c.query(
      `SELECT * FROM assistant_drafts
       WHERE tenant_id=$1 AND repo_id=$2
       ORDER BY created_at DESC
       LIMIT $3`,
      [tenantId, repoId, n]
    );
    return Array.isArray(res.rows) ? res.rows : [];
  }

  async updateDraft({ tenantId, repoId, draftId, patch } = {}) {
    await this._ensureOrgRepo({ tenantId, repoId });
    if (!isNonEmptyString(draftId)) throw new Error('draftId required');
    const allowed = {
      status: 'status',
      answerMarkdown: 'answer_markdown',
      citations: 'citations',
      files: 'files',
      diff: 'diff',
      prBranch: 'pr_branch',
      prNumber: 'pr_number',
      prUrl: 'pr_url',
      expiresAt: 'expires_at'
    };
    const sets = [];
    const params = [tenantId, repoId, draftId];
    for (const [k, col] of Object.entries(allowed)) {
      if (patch?.[k] === undefined) continue;
      let v = patch[k];
      if (k === 'answerMarkdown' && typeof v === 'string') v = redactSecrets(v).slice(0, 200_000);
      if (k === 'diff' && typeof v === 'string') v = redactSecrets(v).slice(0, 400_000);
      if (k === 'citations' || k === 'files') v = JSON.stringify(v ?? []);
      params.push(v);
      sets.push(`${col} = $${params.length}${k === 'citations' || k === 'files' ? '::jsonb' : ''}`);
    }
    if (sets.length === 0) return null;
    const res = await this._c.query(
      `UPDATE assistant_drafts
       SET ${sets.join(', ')}, updated_at=now()
       WHERE tenant_id=$1 AND repo_id=$2 AND id=$3
       RETURNING *`,
      params
    );
    return res.rows?.[0] ?? null;
  }

  async createThread({ tenantId, repoId, title = null, mode = 'support_safe' } = {}) {
    await this._ensureOrgRepo({ tenantId, repoId });
    const safeTitle = redactSecrets(String(title ?? 'New thread')).slice(0, 200) || 'New thread';
    const safeMode = mode === 'default' ? 'default' : 'support_safe';
    const res = await this._c.query(
      `INSERT INTO assistant_threads (tenant_id, repo_id, title, mode)
       VALUES ($1,$2,$3,$4)
       RETURNING *`,
      [tenantId, repoId, safeTitle, safeMode]
    );
    return res.rows?.[0] ?? null;
  }

  async listThreads({ tenantId, repoId, includeArchived = false, limit = 50 } = {}) {
    await this._ensureOrgRepo({ tenantId, repoId });
    const n = clampLimit(limit, 50);
    if (includeArchived) {
      const res = await this._c.query(
        `SELECT * FROM assistant_threads
         WHERE tenant_id=$1 AND repo_id=$2
         ORDER BY updated_at DESC
         LIMIT $3`,
        [tenantId, repoId, n]
      );
      return Array.isArray(res.rows) ? res.rows : [];
    }
    const res = await this._c.query(
      `SELECT * FROM assistant_threads
       WHERE tenant_id=$1 AND repo_id=$2 AND archived_at IS NULL
       ORDER BY updated_at DESC
       LIMIT $3`,
      [tenantId, repoId, n]
    );
    return Array.isArray(res.rows) ? res.rows : [];
  }

  async getThread({ tenantId, repoId, threadId } = {}) {
    await this._ensureOrgRepo({ tenantId, repoId });
    if (!isNonEmptyString(threadId)) throw new Error('threadId required');
    const res = await this._c.query(`SELECT * FROM assistant_threads WHERE tenant_id=$1 AND repo_id=$2 AND id=$3 LIMIT 1`, [
      tenantId,
      repoId,
      threadId
    ]);
    return res.rows?.[0] ?? null;
  }

  async addMessage({ tenantId, repoId, threadId, role = 'user', content, citations = [] } = {}) {
    await this._ensureOrgRepo({ tenantId, repoId });
    if (!isNonEmptyString(threadId)) throw new Error('threadId required');
    const safeRole = role === 'assistant' || role === 'system' ? role : 'user';
    const safeContent = sanitizeMessageContent(content, { maxChars: 50_000 });
    const citationsJson = citations ?? [];
    const res = await this._c.query(
      `INSERT INTO assistant_messages (tenant_id, repo_id, thread_id, role, content, citations)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)
       RETURNING *`,
      [tenantId, repoId, threadId, safeRole, safeContent, JSON.stringify(citationsJson)]
    );
    await this._c.query(
      `UPDATE assistant_threads
       SET updated_at=now(), last_message_at=now()
       WHERE tenant_id=$1 AND repo_id=$2 AND id=$3`,
      [tenantId, repoId, threadId]
    );
    return res.rows?.[0] ?? null;
  }

  async listMessages({ tenantId, repoId, threadId, limit = 50 } = {}) {
    await this._ensureOrgRepo({ tenantId, repoId });
    if (!isNonEmptyString(threadId)) throw new Error('threadId required');
    const n = clampLimit(limit, 50);
    const res = await this._c.query(
      `SELECT * FROM assistant_messages
       WHERE tenant_id=$1 AND repo_id=$2 AND thread_id=$3
       ORDER BY created_at ASC
       LIMIT $4`,
      [tenantId, repoId, threadId, n]
    );
    return Array.isArray(res.rows) ? res.rows : [];
  }
}
