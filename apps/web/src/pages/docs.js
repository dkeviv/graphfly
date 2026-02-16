import { ApiClient } from '../api.js';
import { el, clear } from '../render.js';

export function renderDocsPage({ state, pageEl }) {
  clear(pageEl);
  const api = new ApiClient({ apiUrl: state.apiUrl, tenantId: state.tenantId, repoId: state.repoId, mode: state.mode, authToken: state.authToken });

  const listEl = el('ul', { class: 'list' });
  const detailEl = el('div', { class: 'card' }, [
    el('div', { class: 'card__title' }, ['Doc Block Detail']),
    el('div', { class: 'small' }, ['Select a block to view evidence (contracts + locations only).'])
  ]);
  const activityListEl = el('ul', { class: 'list' });
  const activityStatusEl = el('div', { class: 'small' }, ['Waiting for agent events…']);
  const activityCardEl = el('div', { class: 'card' }, [
    el('div', { class: 'card__title' }, ['Live Agent Activity']),
    activityStatusEl,
    activityListEl
  ]);

  const recent = [];
  state.realtime?.subscribe?.((evt) => {
    const t = String(evt?.type ?? '');
    if (!t.startsWith('agent:')) return;
    recent.unshift({ ts: new Date().toISOString(), type: t, payload: evt?.payload ?? null });
    if (recent.length > 30) recent.length = 30;
    activityStatusEl.textContent = `Last: ${t}`;
    activityListEl.innerHTML = '';
    for (const item of recent) {
      const type = String(item.type ?? '');
      const p = item.payload ?? {};
      const label =
        type === 'agent:tool_call'
          ? `tool_call ${String(p?.name ?? '')}`
          : type === 'agent:tool_result'
            ? `tool_result ${String(p?.name ?? '')}`
            : type;
      const meta = [];
      if (p?.summary) meta.push(String(p.summary));
      if (p?.error) meta.push(String(p.error));
      activityListEl.appendChild(
        el('li', { class: 'list__item' }, [
          el('div', { class: 'h' }, [label]),
          el('div', { class: 'small k' }, [meta.join(' • ') || item.ts])
        ])
      );
    }
  });

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
      el('div', { class: 'stack' }, [detailEl, activityCardEl])
    ])
  );

  load();
}
