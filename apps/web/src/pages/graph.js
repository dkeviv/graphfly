import { ApiClient } from '../api.js';
import { el, clear } from '../render.js';
import { renderEvidencePanel } from './shared/evidence.js';

export function renderGraphPage({ state, pageEl }) {
  clear(pageEl);
  const api = new ApiClient({ apiUrl: state.apiUrl, tenantId: state.tenantId, repoId: state.repoId, mode: state.mode });

  const resultsEl = el('ul', { class: 'list' });
  const evidenceEl = el('div', { class: 'card', 'data-testid': 'evidence-panel' }, [
    el('div', { class: 'card__title' }, ['Evidence (contract + location)']),
    el('div', { class: 'small' }, ['Select a node to view contract and location metadata.'])
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
          }
        }, [
          el('div', { class: 'h' }, [r.node.qualifiedName ?? r.node.name ?? r.node.symbolUid]),
          el('div', { class: 'small k' }, [`${r.node.nodeType} • ${r.node.filePath ?? ''}:${r.node.lineStart ?? ''}`])
        ])
      );
    }
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
      evidenceEl
    ])
  );
}

