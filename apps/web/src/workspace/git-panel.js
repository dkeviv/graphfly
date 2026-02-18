import { ApiClient } from '../api.js';
import { el, clear } from '../render.js';

function fmtTs(ts) {
  const d = ts ? new Date(String(ts)) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleString();
}

function statusBadge(status) {
  const s = String(status ?? '');
  if (s === 'success') return { label: 'success', cls: 'badge badge--ok' };
  if (s === 'failure') return { label: 'failure', cls: 'badge badge--warn' };
  if (s === 'running') return { label: 'running', cls: 'badge badge--warn' };
  if (s === 'pending') return { label: 'pending', cls: 'badge badge--warn' };
  if (s === 'skipped') return { label: 'skipped', cls: 'badge badge--warn' };
  return { label: s || 'unknown', cls: 'badge badge--warn' };
}

function normalizeRun(r) {
  if (!r) return null;
  return {
    id: r.id ?? null,
    status: r.status ?? null,
    triggerSha: r.trigger_sha ?? r.triggerSha ?? null,
    docsBranch: r.docs_branch ?? r.docsBranch ?? null,
    docsPrUrl: r.docs_pr_url ?? r.docsPrUrl ?? null,
    createdAt: r.created_at ?? r.createdAt ?? r.startedAt ?? r.started_at ?? null
  };
}

export function renderGitPanel({ state, rootEl, onNavigate }) {
  clear(rootEl);
  const api = new ApiClient({ apiUrl: state.apiUrl, tenantId: state.tenantId, repoId: state.repoId, mode: state.mode, authToken: state.authToken });

  const headerEl = el('div', { class: 'card' }, [
    el('div', { class: 'row' }, [
      el('div', {}, [el('div', { class: 'card__title' }, ['Git']), el('div', { class: 'small' }, ['Docs PR runs (agent, assistant, manual).'])]),
      el('div', { class: 'row__spacer' }, []),
      el('button', { class: 'button', type: 'button', id: 'gitRefreshBtn' }, ['Refresh'])
    ])
  ]);

  const statusEl = el('div', { class: 'small' }, ['Loading…']);
  const listEl = el('ul', { class: 'list git__runs' }, []);
  rootEl.appendChild(el('div', { class: 'stack' }, [headerEl, el('div', { class: 'card' }, [statusEl, listEl])]));

  let cancelled = false;
  let token = 0;
  let runs = [];

  function setSelectedRunId(id) {
    state.prRunId = id ? String(id) : null;
    if (state.prRunId) localStorage.setItem('graphfly_pr_run_id', state.prRunId);
    else localStorage.removeItem('graphfly_pr_run_id');
  }

  function renderList() {
    listEl.innerHTML = '';
    if (!runs.length) {
      listEl.appendChild(el('li', { class: 'list__item' }, [el('div', { class: 'small' }, ['No PR runs yet.'])]));
      return;
    }
    for (const raw of runs) {
      const r = normalizeRun(raw);
      if (!r?.id) continue;
      const active = state.prRunId && String(state.prRunId) === String(r.id);
      const badge = statusBadge(r.status);
      const sha8 = r.triggerSha ? String(r.triggerSha).slice(0, 8) : null;
      const title = sha8 ? `trigger ${sha8}` : 'run';
      listEl.appendChild(
        el(
          'li',
          {
            class: active ? 'list__item git__run git__run--active' : 'list__item git__run',
            onclick: () => {
              setSelectedRunId(r.id);
              onNavigate?.({ kind: 'git_run', prRunId: r.id });
            }
          },
          [
            el('div', { class: 'row' }, [
              el('div', { class: 'git__run-title' }, [title]),
              el('div', { class: 'row__spacer' }, []),
              r.createdAt ? el('div', { class: 'k git__run-meta' }, [fmtTs(r.createdAt)]) : null,
              el('span', { class: badge.cls }, [badge.label])
            ]),
            r.docsBranch ? el('div', { class: 'small k' }, [`branch=${r.docsBranch}`]) : null
          ]
        )
      );
    }
  }

  async function load() {
    const t = ++token;
    statusEl.textContent = 'Loading…';
    listEl.innerHTML = '';
    try {
      const out = await api.listPrRuns({ limit: 60 });
      if (cancelled || t !== token) return;
      runs = Array.isArray(out?.runs) ? out.runs : [];
      statusEl.textContent = '';
      renderList();
    } catch (e) {
      if (cancelled || t !== token) return;
      runs = [];
      statusEl.textContent = `Failed to load: ${String(e?.message ?? e)}`;
      renderList();
    }
  }

  headerEl.querySelector('#gitRefreshBtn')?.addEventListener('click', () => load());

  load();

  return () => {
    cancelled = true;
  };
}

