import { ApiClient } from '../api.js';
import { el, clear } from '../render.js';
import { renderEvidencePanel } from './shared/evidence.js';

export function renderGraphPage({ state, pageEl }) {
  clear(pageEl);
  const api = new ApiClient({ apiUrl: state.apiUrl, tenantId: state.tenantId, repoId: state.repoId, mode: state.mode, authToken: state.authToken });

  const bannerEl = el('div', { class: 'banner banner--hidden' }, ['']);

  const resultsEl = el('ul', { class: 'list' });
  const evidenceEl = el('div', { class: 'card', 'data-testid': 'evidence-panel' }, [
    el('div', { class: 'card__title' }, ['Evidence (contract + location)']),
    el('div', { class: 'small' }, ['Select a node to view contract and location metadata.'])
  ]);

  const focusEl = el('div', { class: 'card' }, [
    el('div', { class: 'card__title' }, ['Focus Subgraph (lazy-loaded)']),
    el('div', { class: 'small' }, ['Select a node to load its neighborhood without rendering the full repo graph.'])
  ]);

  async function runSearch() {
    const q = document.getElementById('searchInput').value;
    const mode = document.getElementById('searchMode').value;
    resultsEl.innerHTML = '';
    if (!q.trim()) return;
    let data;
    try {
      data = await api.search({ q, mode });
    } catch (e) {
      resultsEl.appendChild(el('li', { class: 'list__item' }, [`Search failed: ${String(e?.message ?? e)}`]));
      return;
    }
    for (const r of data.results ?? []) {
      resultsEl.appendChild(
        el('li', {
          class: 'list__item',
          onclick: async () => {
            const symbolUid = r.node.symbolUid;
            const contract = await api.contractsGet({ symbolUid });
            evidenceEl.replaceWith(renderEvidencePanel(contract));

            const nb = await api.neighborhood({ symbolUid, direction: 'both', limitEdges: 50 });
            focusEl.replaceWith(
              el('div', { class: 'card' }, [
                el('div', { class: 'card__title' }, ['Focus Subgraph (lazy-loaded)']),
                el('div', { class: 'small' }, [`Nodes: ${nb.nodes?.length ?? 0} • Edges: ${nb.edges?.length ?? 0}`]),
                el(
                  'ul',
                  { class: 'list' },
                  (nb.edges ?? []).slice(0, 20).map((e) =>
                    el('li', { class: 'list__item' }, [
                      el('div', { class: 'h' }, [`${e.edgeType}`]),
                      el('div', { class: 'small k' }, [`${e.sourceSymbolUid} → ${e.targetSymbolUid}`])
                    ])
                  )
                )
              ])
            );
          }
        }, [
          el('div', { class: 'h' }, [r.node.qualifiedName ?? r.node.name ?? r.node.symbolUid]),
          el('div', { class: 'small k' }, [
            `${r.node.nodeType} • ${r.node.location?.filePath ?? ''}:${r.node.location?.lineStart ?? ''}`
          ])
        ])
      );
    }
  }

  // Live indexing banner (best-effort): subscribes to realtime events for this repo.
  try {
    state.realtime?.subscribe?.((evt) => {
      if (!evt || evt.repoId !== state.repoId) return;
      if (!pageEl.contains(bannerEl)) return;
      if (evt.type === 'index:start') {
        bannerEl.className = 'banner';
        bannerEl.textContent = `Indexing… (${evt.payload?.mode ?? ''} ${String(evt.payload?.sha ?? '').slice(0, 8)})`;
      }
      if (evt.type === 'index:progress') {
        const p = evt.payload ?? {};
        const pct = p.pct != null ? `${p.pct}%` : '';
        const file = p.filePath ? ` • ${p.filePath}` : '';
        const counts = ` • ${p.nodes ?? 0} nodes • ${p.edges ?? 0} edges`;
        bannerEl.className = 'banner';
        bannerEl.textContent = `Indexing ${pct}${file}${counts}`;
      }
      if (evt.type === 'index:complete') {
        const p = evt.payload ?? {};
        bannerEl.className = 'banner banner--ok';
        bannerEl.textContent = `Graph ready • ${p.nodes ?? '?'} nodes • ${p.edges ?? '?'} edges`;
        setTimeout(() => {
          if (!pageEl.contains(bannerEl)) return;
          bannerEl.className = 'banner banner--hidden';
        }, 2500);
      }
    });
  } catch {
    // ignore
  }

  pageEl.appendChild(
    el('div', { class: 'grid2' }, [
      el('div', { class: 'card' }, [
        el('div', { class: 'card__title' }, ['Search + Focus Mode']),
        el('div', { class: 'row' }, [
          el('input', { class: 'input', id: 'searchInput', placeholder: 'Search nodes (text or semantic)…' }),
          el('select', { class: 'select', id: 'searchMode' }, [
            el('option', { value: 'text' }, ['Text']),
            el('option', { value: 'semantic' }, ['Semantic'])
          ]),
          el('button', { class: 'button', onclick: runSearch }, ['Search'])
        ]),
        el('div', { class: 'small' }, ['Results load on demand. Full-repo graph rendering is avoided by default.']),
        resultsEl
      ]),
      el('div', { class: 'stack' }, [evidenceEl, focusEl])
    ])
  );

  pageEl.prepend(bannerEl);
}
