import { ApiClient } from '../api.js';
import { el, clear } from '../render.js';

export function renderDocsPage({ state, pageEl }) {
  clear(pageEl);
  const api = new ApiClient({ apiUrl: state.apiUrl, tenantId: state.tenantId, repoId: state.repoId, mode: state.mode });

  const listEl = el('ul', { class: 'list' });
  const detailEl = el('div', { class: 'card' }, [
    el('div', { class: 'card__title' }, ['Doc Block Detail']),
    el('div', { class: 'small' }, ['Select a block to view evidence (contracts + locations only).'])
  ]);

  async function load() {
    listEl.innerHTML = '';
    let data;
    try {
      data = await api.listDocBlocks();
    } catch (e) {
      listEl.appendChild(el('li', { class: 'list__item' }, [`Failed to load blocks: ${String(e?.message ?? e)}`]));
      return;
    }
    for (const b of data.blocks ?? []) {
      listEl.appendChild(
        el('li', {
          class: 'list__item',
          onclick: async () => {
            const d = await api.getDocBlock({ blockId: b.id });
            detailEl.replaceWith(
              el('div', { class: 'card' }, [
                el('div', { class: 'card__title' }, ['Doc Block Detail']),
                el('div', { class: 'h' }, [b.docFile]),
                el('div', { class: 'small k' }, [`${b.blockType} • ${b.status}`]),
                el('div', { class: 'card__title' }, ['Evidence']),
                el('ul', { class: 'list' }, (d.evidence ?? []).map((ev) =>
                  el('li', { class: 'list__item' }, [
                    el('div', { class: 'h' }, [ev.symbolUid]),
                    el('div', { class: 'small k' }, [`${ev.filePath ?? ''}:${ev.lineStart ?? ''}`])
                  ])
                ))
              ])
            );
          }
        }, [
          el('div', { class: 'h' }, [b.docFile]),
          el('div', { class: 'small k' }, [`${b.blockType} • ${b.status}`])
        ])
      );
    }
  }

  pageEl.appendChild(
    el('div', { class: 'grid2' }, [
      el('div', { class: 'card' }, [
        el('div', { class: 'card__title' }, ['Doc Blocks (docs-repo-only output)']),
        el('div', { class: 'small' }, [
          'Doc blocks are contract-first and never embed source code bodies/snippets. This view lists generated blocks and their evidence.'
        ]),
        el('button', { class: 'button', onclick: load }, ['Refresh']),
        listEl
      ]),
      detailEl
    ])
  );

  load();
}
