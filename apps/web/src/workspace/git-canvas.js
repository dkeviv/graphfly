import { ApiClient } from '../api.js';
import { el, clear } from '../render.js';

function fmtTs(ts) {
  const d = ts ? new Date(String(ts)) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleString();
}

function normalizeRun(r) {
  if (!r) return null;
  return {
    id: r.id ?? null,
    status: r.status ?? null,
    triggerSha: r.trigger_sha ?? r.triggerSha ?? null,
    docsBranch: r.docs_branch ?? r.docsBranch ?? null,
    docsPrUrl: r.docs_pr_url ?? r.docsPrUrl ?? null,
    docsPrNumber: r.docs_pr_number ?? r.docsPrNumber ?? null,
    blocksUpdated: r.blocks_updated ?? r.blocksUpdated ?? 0,
    blocksCreated: r.blocks_created ?? r.blocksCreated ?? 0,
    blocksUnchanged: r.blocks_unchanged ?? r.blocksUnchanged ?? 0,
    errorMessage: r.error_message ?? r.errorMessage ?? null,
    startedAt: r.started_at ?? r.startedAt ?? null,
    completedAt: r.completed_at ?? r.completedAt ?? null,
    createdAt: r.created_at ?? r.createdAt ?? null
  };
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

export function renderGitCanvas({ state, rootEl, onNavigate }) {
  clear(rootEl);
  const api = new ApiClient({ apiUrl: state.apiUrl, tenantId: state.tenantId, repoId: state.repoId, mode: state.mode, authToken: state.authToken });

  const runId = state.prRunId ?? null;
  if (!runId) {
    rootEl.appendChild(
      el('div', { class: 'card' }, [
        el('div', { class: 'card__title' }, ['Git']),
        el('div', { class: 'small' }, ['Select a PR run from the list to see details here.'])
      ])
    );
    return null;
  }

  const bodyEl = el('div', { class: 'card' }, [el('div', { class: 'small' }, ['Loading…'])]);
  rootEl.appendChild(bodyEl);

  let cancelled = false;
  let token = 0;
  let selectedPath = null;

  async function readFileContent({ ref, path }) {
    try {
      const out = await api.docsFile({ path, ref });
      return String(out?.content ?? '');
    } catch (e) {
      const st = Number(e?.status ?? 0);
      const err = String(e?.data?.error ?? '');
      if (st === 404 || err === 'not_found') return '';
      throw e;
    }
  }

  async function computeDiff({ path, beforeText, afterText }) {
    try {
      const out = await api.docsDiff({ path, before: beforeText, after: afterText });
      return String(out?.diff ?? '');
    } catch (e) {
      return `diff_error: ${String(e?.message ?? e)}`;
    }
  }

  async function load() {
    const t = ++token;
    bodyEl.innerHTML = '';
    bodyEl.appendChild(el('div', { class: 'small' }, ['Loading…']));
    try {
      const out = await api.getPrRun({ prRunId: runId });
      if (cancelled || t !== token) return;
      const prRun = normalizeRun(out?.prRun ?? null);
      if (!prRun?.id) throw new Error('not_found');
      const badge = statusBadge(prRun.status);
      const sha8 = prRun.triggerSha ? String(prRun.triggerSha).slice(0, 8) : '—';

      let files = [];
      try {
        const f = await api.listPrRunFiles({ prRunId: prRun.id });
        files = Array.isArray(f?.files) ? f.files : [];
      } catch {
        files = [];
      }
      files = files.filter((p) => typeof p === 'string' && p.length && p.endsWith('.md')).slice(0, 200);
      if (!selectedPath || !files.includes(selectedPath)) selectedPath = files[0] ?? null;

      const actions = [];
      if (prRun.docsPrUrl) {
        actions.push(el('a', { class: 'button button--primary', href: String(prRun.docsPrUrl), target: '_blank', rel: 'noreferrer' }, ['Open PR']));
      }
      if (prRun.docsBranch) {
        actions.push(
          el(
            'button',
            {
              class: 'button',
              type: 'button',
              onclick: () => {
                state.panelMode = 'docs';
                localStorage.setItem('graphfly_panel_mode', state.panelMode);
                state.docsRef = String(prRun.docsBranch);
                localStorage.setItem('graphfly_docs_ref', state.docsRef);
                onNavigate?.({ kind: 'docs_from_git', ref: state.docsRef });
              }
            },
            ['Preview docs']
          )
        );
      }

      bodyEl.innerHTML = '';
      bodyEl.appendChild(
        el('div', { class: 'row' }, [
          el('div', {}, [el('div', { class: 'h' }, [`PR run ${String(prRun.id).slice(0, 8)}`]), el('div', { class: 'small k' }, [`trigger=${sha8}`])]),
          el('div', { class: 'row__spacer' }, []),
          el('span', { class: badge.cls }, [badge.label]),
          el('button', { class: 'button', type: 'button', onclick: () => load() }, ['Refresh'])
        ])
      );

      bodyEl.appendChild(el('div', { class: 'divider' }, []));
      bodyEl.appendChild(
        el('div', { class: 'grid4' }, [
          el('div', { class: 'kpi' }, [el('div', { class: 'kpi__label' }, ['Updated']), el('div', { class: 'kpi__value' }, [String(prRun.blocksUpdated ?? 0)])]),
          el('div', { class: 'kpi' }, [el('div', { class: 'kpi__label' }, ['Created']), el('div', { class: 'kpi__value' }, [String(prRun.blocksCreated ?? 0)])]),
          el('div', { class: 'kpi' }, [el('div', { class: 'kpi__label' }, ['Unchanged']), el('div', { class: 'kpi__value' }, [String(prRun.blocksUnchanged ?? 0)])]),
          el('div', { class: 'kpi' }, [el('div', { class: 'kpi__label' }, ['Status']), el('div', { class: 'kpi__value' }, [String(prRun.status ?? '—')])])
        ])
      );

      bodyEl.appendChild(el('div', { class: 'divider' }, []));
      bodyEl.appendChild(el('div', { class: 'small k' }, [`created=${fmtTs(prRun.createdAt) || '—'}`]));
      bodyEl.appendChild(el('div', { class: 'small k' }, [`started=${fmtTs(prRun.startedAt) || '—'}`]));
      bodyEl.appendChild(el('div', { class: 'small k' }, [`completed=${fmtTs(prRun.completedAt) || '—'}`]));
      if (prRun.docsBranch) bodyEl.appendChild(el('div', { class: 'small k' }, [`branch=${prRun.docsBranch}`]));
      if (prRun.docsPrNumber) bodyEl.appendChild(el('div', { class: 'small k' }, [`pr_number=${prRun.docsPrNumber}`]));

      if (prRun.errorMessage) {
        bodyEl.appendChild(el('div', { class: 'divider' }, []));
        bodyEl.appendChild(el('div', { class: 'h' }, ['Error']));
        bodyEl.appendChild(el('pre', { class: 'pre' }, [String(prRun.errorMessage)]));
      }

      if (actions.length) {
        bodyEl.appendChild(el('div', { class: 'divider' }, []));
        bodyEl.appendChild(el('div', { class: 'row' }, actions));
      }

      if (!prRun.docsBranch) return;
      if (!files.length) {
        bodyEl.appendChild(el('div', { class: 'divider' }, []));
        bodyEl.appendChild(
          el('div', { class: 'small' }, [
            'Diff preview is best-effort. This run has no tracked doc-block-managed files (manual/assistant edits may not be attributable yet).'
          ])
        );
        return;
      }

      const selectEl = el('select', { class: 'select', 'aria-label': 'File' }, []);
      for (const p of files) selectEl.appendChild(new Option(p, p));
      selectEl.value = selectedPath ?? '';

      const diffEl = el('pre', { class: 'md__code' }, ['Select a file to view diff…']);

      async function loadDiff() {
        const p = selectEl.value;
        if (!p) return;
        selectedPath = p;
        diffEl.textContent = 'Loading diff…';
        try {
          const beforeText = await readFileContent({ ref: 'default', path: p });
          const afterText = await readFileContent({ ref: prRun.docsBranch, path: p });
          const diffText = await computeDiff({ path: p, beforeText, afterText });
          diffEl.textContent = diffText || '(no changes)';
        } catch (e) {
          diffEl.textContent = `Failed to load diff: ${String(e?.message ?? e)}`;
        }
      }

      selectEl.addEventListener('change', () => loadDiff());

      bodyEl.appendChild(el('div', { class: 'divider' }, []));
      bodyEl.appendChild(el('div', { class: 'h' }, ['Diff preview']));
      bodyEl.appendChild(el('div', { class: 'small' }, ['default branch → preview branch']));
      bodyEl.appendChild(selectEl);
      bodyEl.appendChild(diffEl);
      await loadDiff();
    } catch (e) {
      if (cancelled || t !== token) return;
      bodyEl.innerHTML = '';
      bodyEl.appendChild(el('div', { class: 'small' }, [`Failed to load: ${String(e?.message ?? e)}`]));
    }
  }

  load();

  return () => {
    cancelled = true;
  };
}
