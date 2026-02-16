import { el, clear } from '../render.js';
import { ApiClient } from '../api.js';

function pctText(v) {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return '0%';
  return `${n}%`;
}

export function renderCoveragePage({ state, pageEl }) {
  clear(pageEl);
  const api = new ApiClient({ apiUrl: state.apiUrl, tenantId: state.tenantId, repoId: state.repoId, mode: state.mode, authToken: state.authToken });

  const statusEl = el('div', { class: 'small' }, ['Loading coverage…']);
  const cardsEl = el('div', { class: 'grid4' });
  const entrypointsEl = el('ul', { class: 'list' });
  const unresolvedEl = el('ul', { class: 'list' });

  const selected = new Set();
  const documentBtn = el('button', { class: 'button' }, ['Document Selected']);
  documentBtn.disabled = true;

  documentBtn.onclick = async () => {
    const symbolUids = Array.from(selected);
    if (symbolUids.length === 0) return;
    documentBtn.disabled = true;
    statusEl.textContent = `Enqueuing ${symbolUids.length} doc targets…`;
    try {
      await api.coverageDocument({ symbolUids });
      statusEl.textContent = 'Doc generation enqueued. Check Docs → PR Runs.';
      selected.clear();
      await refresh();
    } catch (e) {
      statusEl.textContent = `Document failed: ${String(e?.message ?? e)}`;
    }
  };

  pageEl.appendChild(
    el('div', { class: 'grid2' }, [
      el('div', { class: 'card' }, [
        el('div', { class: 'card__title' }, ['Documentation Coverage']),
        statusEl,
        cardsEl
      ]),
      el('div', { class: 'card' }, [
        el('div', { class: 'card__title' }, ['Undocumented Entry Points']),
        el('div', { class: 'row' }, [documentBtn]),
        entrypointsEl
      ]),
      el('div', { class: 'card' }, [
        el('div', { class: 'card__title' }, ['Unresolved Imports']),
        el('div', { class: 'small' }, ['Internal/alias imports that could not be resolved to a known file.']),
        unresolvedEl
      ])
    ])
  );

  async function refresh() {
    try {
      const [summary, eps, unresolved] = await Promise.all([
        api.coverageSummary(),
        api.coverageUndocumentedEntrypoints({ limit: 50 }),
        api.coverageUnresolvedImports()
      ]);

      cardsEl.innerHTML = '';
      const overall = summary?.overall ?? { documented: 0, total: 0, pct: 0 };
      const byType = summary?.byType ?? {};

      const card = (label, value, sub) =>
        el('div', { class: 'kpi' }, [
          el('div', { class: 'kpi__label' }, [label]),
          el('div', { class: 'kpi__value' }, [value]),
          el('div', { class: 'kpi__sub' }, [sub])
        ]);

      cardsEl.appendChild(card('Overall', pctText(overall.pct), `${overall.documented} / ${overall.total}`));
      for (const [k, v] of Object.entries(byType)) {
        cardsEl.appendChild(card(k, pctText(v?.pct ?? 0), `${v?.documented ?? 0} / ${v?.total ?? 0}`));
      }

      entrypointsEl.innerHTML = '';
      const list = eps?.entrypoints ?? [];
      if (list.length === 0) {
        entrypointsEl.appendChild(el('li', { class: 'list__item' }, ['No undocumented entry points found.']));
      } else {
        for (const it of list) {
          const uid = it.symbol_uid;
          const cb = el('input', {
            type: 'checkbox',
            checked: selected.has(uid) ? 'checked' : null,
            onchange: () => {
              if (cb.checked) selected.add(uid);
              else selected.delete(uid);
              documentBtn.disabled = selected.size === 0;
            }
          });
          entrypointsEl.appendChild(
            el('li', { class: 'list__item' }, [
              el('div', { class: 'row' }, [
                cb,
                el('div', {}, [
                  el('div', { class: 'h' }, [it.qualified_name ?? uid]),
                  el('div', { class: 'small k' }, [
                    `${it.node_type ?? 'Node'} • ${it.file_path ?? 'unknown'}:${it.line_start ?? '?'} • callers ${it.callers ?? 0} • blast ${it.blast_radius ?? 0}`
                  ])
                ])
              ])
            ])
          );
        }
      }

      unresolvedEl.innerHTML = '';
      const impList = unresolved?.imports ?? [];
      if (impList.length === 0) {
        unresolvedEl.appendChild(el('li', { class: 'list__item' }, ['None']));
      } else {
        for (const it of impList.slice(0, 50)) {
          unresolvedEl.appendChild(
            el('li', { class: 'list__item' }, [
              el('div', { class: 'row' }, [
                el('div', {}, [
                  el('div', { class: 'h' }, [it.spec]),
                  el('div', { class: 'small k' }, [`${it.count} occurrences • ${it.category ?? it.kind ?? ''}`])
                ])
              ])
            ])
          );
        }
      }

      statusEl.textContent = 'Coverage computed from current graph + doc evidence.';
    } catch (e) {
      statusEl.textContent = `Failed to load coverage: ${String(e?.message ?? e)}`;
    }
  }

  refresh();
}
