import { ApiClient } from '../api.js';
import { el, clear } from '../render.js';
import { renderEvidencePanel } from '../pages/shared/evidence.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.setAttribute('class', String(v));
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function truncateLabel(s, maxLen) {
  const str = String(s ?? '');
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '…';
}

function computeDepths({ startSymbolUid, edges, maxDepth = 6 }) {
  const start = String(startSymbolUid ?? '');
  const adj = new Map();
  for (const e of edges ?? []) {
    const src = e?.sourceSymbolUid ?? null;
    const dst = e?.targetSymbolUid ?? null;
    if (!src || !dst) continue;
    const k = String(src);
    const arr = adj.get(k) ?? [];
    arr.push(String(dst));
    adj.set(k, arr);
  }

  const depths = new Map();
  const q = [];
  depths.set(start, 0);
  q.push(start);

  while (q.length) {
    const cur = q.shift();
    const d = depths.get(cur);
    if (d == null) continue;
    if (d >= maxDepth) continue;
    const next = adj.get(cur) ?? [];
    for (const n of next) {
      if (!depths.has(n)) {
        depths.set(n, d + 1);
        q.push(n);
      }
    }
  }

  return depths;
}

function renderFlowDiagram({ startSymbolUid, nodes, edges, onSelectSymbolUid }) {
  const maxDepth = 6;
  const nodeByUid = new Map();
  for (const n of nodes ?? []) {
    if (!n?.symbolUid) continue;
    nodeByUid.set(String(n.symbolUid), n);
  }

  const depths = computeDepths({ startSymbolUid, edges, maxDepth });
  let maxD = 0;
  for (const d of depths.values()) maxD = Math.max(maxD, d);

  const columns = Array.from({ length: maxD + 1 }, () => []);
  for (const [uid, n] of nodeByUid.entries()) {
    const d = depths.get(uid);
    if (d == null) continue;
    columns[d].push(n);
  }
  for (const col of columns) col.sort((a, b) => String(a?.qualifiedName ?? a?.name ?? '').localeCompare(String(b?.qualifiedName ?? b?.name ?? '')));

  const nodeW = 220;
  const nodeH = 52;
  const gapX = 90;
  const gapY = 18;
  const pad = 22;

  const colHeights = columns.map((c) => c.length);
  const maxCol = Math.max(1, ...colHeights);

  const width = pad * 2 + columns.length * nodeW + Math.max(0, columns.length - 1) * gapX;
  const height = pad * 2 + maxCol * nodeH + Math.max(0, maxCol - 1) * gapY;

  const pos = new Map();
  for (let d = 0; d < columns.length; d++) {
    const col = columns[d];
    const x = pad + d * (nodeW + gapX);
    for (let i = 0; i < col.length; i++) {
      const y = pad + i * (nodeH + gapY);
      pos.set(String(col[i].symbolUid), { x, y });
    }
  }

  const svg = svgEl('svg', { class: 'flowviz__svg', viewBox: `0 0 ${width} ${height}`, width: String(width), height: String(height), role: 'img' }, [
    svgEl('defs', {}, [
      svgEl('marker', { id: 'flowvizArrow', markerWidth: '10', markerHeight: '10', refX: '8', refY: '3', orient: 'auto', markerUnits: 'strokeWidth' }, [
        svgEl('path', { d: 'M0,0 L9,3 L0,6 z', class: 'flowviz__arrow' }, [])
      ])
    ])
  ]);

  // Edges first (under nodes).
  for (const e of edges ?? []) {
    const src = e?.sourceSymbolUid ? String(e.sourceSymbolUid) : null;
    const dst = e?.targetSymbolUid ? String(e.targetSymbolUid) : null;
    if (!src || !dst) continue;
    const a = pos.get(src);
    const b = pos.get(dst);
    if (!a || !b) continue;
    const x1 = a.x + nodeW;
    const y1 = a.y + nodeH / 2;
    const x2 = b.x;
    const y2 = b.y + nodeH / 2;
    svg.appendChild(svgEl('line', { class: 'flowviz__edge', x1: String(x1), y1: String(y1), x2: String(x2), y2: String(y2), 'marker-end': 'url(#flowvizArrow)' }, []));
  }

  // Nodes.
  for (const [uid, p] of pos.entries()) {
    const n = nodeByUid.get(uid);
    const title = truncateLabel(n?.qualifiedName ?? n?.name ?? uid, 34);
    const loc = n?.location?.filePath ? `${String(n.location.filePath).split('/').slice(-1)[0]}:${n.location.lineStart ?? ''}` : '';
    const isStart = String(uid) === String(startSymbolUid ?? '');
    const cls = isStart ? 'flowviz__node flowviz__node--start' : 'flowviz__node';
    const g = svgEl(
      'g',
      {
        class: cls,
        role: 'button',
        tabindex: '0',
        'data-symbol-uid': uid,
        onclick: () => onSelectSymbolUid?.(uid)
      },
      [
        svgEl('rect', { class: 'flowviz__node-box', x: String(p.x), y: String(p.y), width: String(nodeW), height: String(nodeH), rx: '12', ry: '12' }, []),
        svgEl('text', { class: 'flowviz__node-title', x: String(p.x + 12), y: String(p.y + 22) }, [title]),
        svgEl('text', { class: 'flowviz__node-sub', x: String(p.x + 12), y: String(p.y + 40) }, [truncateLabel(loc, 34)])
      ]
    );
    g.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter' || evt.key === ' ') {
        evt.preventDefault();
        onSelectSymbolUid?.(uid);
      }
    });
    svg.appendChild(g);
  }

  return el('div', { class: 'flowviz' }, [svg]);
}

function slugifyKey(s) {
  return String(s ?? '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 80);
}

function entrypointTitle(ep) {
  const k = ep?.entrypoint_key ?? ep?.entrypointKey ?? '';
  const method = ep?.method ?? null;
  const path = ep?.path ?? null;
  if (method && path) return `${k} (${method} ${path})`;
  return String(k || 'entrypoint');
}

export function renderFlowsCanvas({ state, rootEl, onNavigate }) {
  clear(rootEl);
  const api = new ApiClient({ apiUrl: state.apiUrl, tenantId: state.tenantId, repoId: state.repoId, mode: state.mode, authToken: state.authToken });

  const headerEl = el('div', { class: 'card' }, [
    el('div', { class: 'row' }, [
      el('div', {}, [el('div', { class: 'card__title' }, ['Flows']), el('div', { class: 'small' }, ['Derived entrypoints and bounded traces (contract-first).'])]),
      el('div', { class: 'row__spacer' }, []),
      el('button', { class: 'button', type: 'button', id: 'flowsRefreshBtn' }, ['Refresh'])
    ])
  ]);

  const searchInput = el('input', { class: 'input', placeholder: 'Search entrypoints…' });
  const entryStatusEl = el('div', { class: 'small' }, ['Loading…']);
  const entryListEl = el('ul', { class: 'list flows__list' }, []);

  const depthSelect = el('select', { class: 'select select--compact', 'aria-label': 'Depth' }, [
    el('option', { value: '1' }, ['Depth 1']),
    el('option', { value: '2' }, ['Depth 2']),
    el('option', { value: '3' }, ['Depth 3']),
    el('option', { value: '4' }, ['Depth 4'])
  ]);
  const traceStatusEl = el('div', { class: 'small' }, ['Select an entrypoint to trace.']);
  const traceBodyEl = el('div', {}, []);
  let evidenceEl = el('div', { class: 'card' }, [
    el('div', { class: 'card__title' }, ['Evidence (contract + location)']),
    el('div', { class: 'small' }, ['Select a node in the trace to inspect its contract.'])
  ]);

  const viewerEl = el('div', { class: 'stack' }, [
    el('div', { class: 'card' }, [
      el('div', { class: 'row' }, [
        el('div', { class: 'card__title' }, ['Trace']),
        el('div', { class: 'row__spacer' }, []),
        depthSelect
      ]),
      traceStatusEl,
      traceBodyEl
    ]),
    evidenceEl
  ]);

  rootEl.appendChild(
    el('div', { class: 'stack' }, [
      headerEl,
      el('div', { class: 'flows' }, [
        el('div', { class: 'card' }, [searchInput, entryStatusEl, entryListEl]),
        viewerEl
      ])
    ])
  );

  let cancelled = false;
  let token = 0;
  let entrypoints = [];
  let selectedEp = null;

  const storedDepth = Number(localStorage.getItem('graphfly_flow_depth') ?? 3);
  const depth = Number.isFinite(storedDepth) ? Math.max(1, Math.min(6, Math.trunc(storedDepth))) : 3;
  depthSelect.value = String(depth);

  function setSelectedEntrypoint(ep) {
    selectedEp = ep ?? null;
    const symbolUid = ep?.entrypoint_symbol_uid ?? ep?.symbol_uid ?? ep?.entrypointSymbolUid ?? ep?.symbolUid ?? null;
    state.flowSymbolUid = symbolUid ? String(symbolUid) : null;
    if (state.flowSymbolUid) localStorage.setItem('graphfly_flow_uid', state.flowSymbolUid);
    else localStorage.removeItem('graphfly_flow_uid');
    const key = ep?.entrypoint_key ?? ep?.entrypointKey ?? null;
    state.flowEntrypointKey = key ? String(key) : null;
    if (state.flowEntrypointKey) localStorage.setItem('graphfly_flow_key', state.flowEntrypointKey);
    else localStorage.removeItem('graphfly_flow_key');
  }

  function renderEntrypoints(filterText = '') {
    entryListEl.innerHTML = '';
    const q = String(filterText ?? '').trim().toLowerCase();
    const filtered = q
      ? entrypoints.filter((ep) => entrypointTitle(ep).toLowerCase().includes(q))
      : entrypoints;
    if (!filtered.length) {
      entryListEl.appendChild(el('li', { class: 'list__item' }, [el('div', { class: 'small' }, ['No entrypoints found.'])]));
      return;
    }
    for (const ep of filtered.slice(0, 200)) {
      const symbolUid = ep?.entrypoint_symbol_uid ?? ep?.symbol_uid ?? ep?.entrypointSymbolUid ?? ep?.symbolUid ?? null;
      const active = state.flowSymbolUid && symbolUid && String(state.flowSymbolUid) === String(symbolUid);
      entryListEl.appendChild(
        el(
          'li',
          {
            class: active ? 'list__item flows__item flows__item--active' : 'list__item flows__item',
            onclick: () => {
              setSelectedEntrypoint(ep);
              loadTrace();
            }
          },
          [
            el('div', { class: 'h' }, [entrypointTitle(ep)]),
            el('div', { class: 'small k' }, [
              `${ep?.entrypoint_type ?? ep?.entrypointType ?? 'entrypoint'} • ${symbolUid ? String(symbolUid).slice(0, 40) : ''}`
            ])
          ]
        )
      );
    }
  }

  async function loadEntrypoints() {
    const t = ++token;
    entryStatusEl.textContent = 'Loading…';
    entryListEl.innerHTML = '';
    try {
      const out = await api.listFlowEntrypoints();
      if (cancelled || t !== token) return;
      entrypoints = Array.isArray(out?.entrypoints) ? out.entrypoints : [];
      entryStatusEl.textContent = entrypoints.length ? '' : 'No entrypoints detected yet. Index the repo first.';
      renderEntrypoints(searchInput.value);

      const storedUid = localStorage.getItem('graphfly_flow_uid') ?? null;
      if (storedUid && !state.flowSymbolUid) state.flowSymbolUid = storedUid;
      if (state.flowSymbolUid && !selectedEp) {
        const match = entrypoints.find((ep) => String(ep?.entrypoint_symbol_uid ?? ep?.symbol_uid ?? ep?.entrypointSymbolUid ?? '') === String(state.flowSymbolUid));
        if (match) setSelectedEntrypoint(match);
      }
      if (state.flowSymbolUid) loadTrace();
    } catch (e) {
      if (cancelled || t !== token) return;
      entrypoints = [];
      entryStatusEl.textContent = `Failed to load: ${String(e?.message ?? e)}`;
      renderEntrypoints(searchInput.value);
    }
  }

  async function loadTrace() {
    const uid = state.flowSymbolUid ?? null;
    if (!uid) return;
    traceStatusEl.textContent = 'Tracing…';
    traceBodyEl.innerHTML = '';
    try {
      const depth = Number(depthSelect.value ?? 3);
      localStorage.setItem('graphfly_flow_depth', String(depth));
      const out = await api.traceFlow({ startSymbolUid: uid, depth: Number.isFinite(depth) ? Math.trunc(depth) : 3 });
      const nodes = Array.isArray(out?.nodes) ? out.nodes : [];
      const edges = Array.isArray(out?.edges) ? out.edges : [];

      const key = state.flowEntrypointKey ?? null;
      const docFile = key ? `flows/${slugifyKey(key)}.md` : null;

      traceStatusEl.textContent = `${nodes.length} nodes • ${edges.length} edges • depth=${out?.depth ?? depth}`;
      traceBodyEl.innerHTML = '';

      async function inspectSymbol(symbolUid) {
        try {
          const c = await api.contractsGet({ symbolUid });
          const next = renderEvidencePanel(c);
          evidenceEl.replaceWith(next);
          evidenceEl = next;
        } catch {
          // ignore
        }
      }

      const actions = [];
      if (docFile) {
        actions.push(
          el(
            'button',
            {
              class: 'button',
              type: 'button',
              onclick: () => {
                state.panelMode = 'docs';
                localStorage.setItem('graphfly_panel_mode', state.panelMode);
                state.docsPath = docFile;
                localStorage.setItem('graphfly_docs_path', state.docsPath);
                onNavigate?.({ kind: 'docs_from_flow', path: docFile });
              }
            },
            ['Open flow doc']
          )
        );
      }

      traceBodyEl.appendChild(el('div', { class: 'row' }, [el('div', { class: 'small k' }, [key ? `key=${key}` : '']), el('div', { class: 'row__spacer' }, []), ...actions]));

      traceBodyEl.appendChild(
        el('div', { class: 'stack' }, [
          el('div', { class: 'card__title' }, ['Diagram']),
          renderFlowDiagram({ startSymbolUid: uid, nodes, edges, onSelectSymbolUid: inspectSymbol })
        ])
      );

      const nodesEl = el(
        'ul',
        { class: 'list flows__nodes' },
        nodes.slice(0, 60).map((n) => {
          const title = n.qualifiedName ?? n.name ?? n.symbolUid ?? '(node)';
          const meta = `${n.nodeType ?? ''} • ${n.location?.filePath ?? ''}:${n.location?.lineStart ?? ''}`;
          return el(
            'li',
            {
              class: 'list__item flows__node',
              onclick: async () => {
                await inspectSymbol(n.symbolUid);
              }
            },
            [el('div', { class: 'h' }, [title]), el('div', { class: 'small k' }, [meta])]
          );
        })
      );

      const edgesEl = el(
        'ul',
        { class: 'list flows__edges' },
        edges.slice(0, 40).map((e) =>
          el('li', { class: 'list__item' }, [
            el('div', { class: 'h' }, [String(e.edgeType ?? '')]),
            el('div', { class: 'small k' }, [`${String(e.sourceSymbolUid ?? '').slice(0, 40)} → ${String(e.targetSymbolUid ?? '').slice(0, 40)}`])
          ])
        )
      );

      traceBodyEl.appendChild(el('div', { class: 'grid2' }, [el('div', {}, [el('div', { class: 'card__title' }, ['Nodes']), nodesEl]), el('div', {}, [el('div', { class: 'card__title' }, ['Edges']), edgesEl])]));
    } catch (e) {
      traceStatusEl.textContent = `Trace failed: ${String(e?.message ?? e)}`;
      traceBodyEl.innerHTML = '';
    }
  }

  searchInput.addEventListener('input', () => renderEntrypoints(searchInput.value));
  depthSelect.addEventListener('change', () => loadTrace());
  headerEl.querySelector('#flowsRefreshBtn')?.addEventListener('click', () => loadEntrypoints());

  loadEntrypoints();

  return () => {
    cancelled = true;
  };
}
