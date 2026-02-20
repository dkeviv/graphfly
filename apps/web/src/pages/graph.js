import { ApiClient } from '../api.js';
import { el, clear } from '../render.js';
import { renderEvidencePanel } from './shared/evidence.js';

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

function slugify(s) {
  return String(s ?? '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 60);
}

function parentDir(p) {
  const s = String(p ?? '').replaceAll('\\', '/').replaceAll(/\/+/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!s) return '';
  const parts = s.split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

function truncateLabel(s, maxLen) {
  const str = String(s ?? '');
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '…';
}

function computeUndirectedDepths({ centerSymbolUid, edges, maxDepth = 2, maxNodes = 60 }) {
  const center = String(centerSymbolUid ?? '');
  const adj = new Map();
  for (const e of edges ?? []) {
    const src = e?.sourceSymbolUid ?? null;
    const dst = e?.targetSymbolUid ?? null;
    if (!src || !dst) continue;
    const a = String(src);
    const b = String(dst);
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b);
    adj.get(b).push(a);
  }

  const depths = new Map();
  const q = [];
  depths.set(center, 0);
  q.push(center);

  while (q.length && depths.size < maxNodes) {
    const cur = q.shift();
    const d = depths.get(cur);
    if (d == null) continue;
    if (d >= maxDepth) continue;
    for (const n of adj.get(cur) ?? []) {
      if (!depths.has(n)) {
        depths.set(n, d + 1);
        q.push(n);
      }
    }
  }

  return depths;
}

function renderNeighborhoodGraph({ centerSymbolUid, nodes, edges, highlightedSymbolUids = null, onSelectSymbolUid }) {
  const center = String(centerSymbolUid ?? '');
  const nodeByUid = new Map();
  for (const n of nodes ?? []) {
    const uid = n?.symbolUid ?? null;
    if (!uid) continue;
    nodeByUid.set(String(uid), n);
  }

  const depths = computeUndirectedDepths({ centerSymbolUid: center, edges, maxDepth: 2, maxNodes: 60 });
  const depth0 = [center].filter((uid) => nodeByUid.has(uid));
  const depth1 = [];
  const depth2 = [];
  for (const [uid, d] of depths.entries()) {
    if (!nodeByUid.has(uid)) continue;
    if (uid === center) continue;
    if (d === 1) depth1.push(uid);
    else if (d === 2) depth2.push(uid);
  }

  function sortUids(arr) {
    arr.sort((a, b) => {
      const na = nodeByUid.get(a);
      const nb = nodeByUid.get(b);
      const sa = String(na?.qualifiedName ?? na?.name ?? a);
      const sb = String(nb?.qualifiedName ?? nb?.name ?? b);
      return sa.localeCompare(sb);
    });
    return arr;
  }

  sortUids(depth1);
  sortUids(depth2);

  const cx = 0;
  const cy = 0;
  const r1 = 220;
  const r2 = 360;
  const pos = new Map();
  pos.set(center, { x: cx, y: cy });

  const n1 = Math.max(1, depth1.length);
  for (let i = 0; i < depth1.length; i++) {
    const a = (2 * Math.PI * i) / n1;
    pos.set(depth1[i], { x: cx + r1 * Math.cos(a), y: cy + r1 * Math.sin(a) });
  }
  const n2 = Math.max(1, depth2.length);
  for (let i = 0; i < depth2.length; i++) {
    const a = (2 * Math.PI * i) / n2 + Math.PI / 12;
    pos.set(depth2[i], { x: cx + r2 * Math.cos(a), y: cy + r2 * Math.sin(a) });
  }

  const shown = new Set([...depth0, ...depth1, ...depth2]);
  const ring = highlightedSymbolUids ? new Set([...highlightedSymbolUids].map(String)) : null;

  const nodeR = 26;
  const pad = 70;
  let minX = -pad;
  let maxX = pad;
  let minY = -pad;
  let maxY = pad;
  for (const p of pos.values()) {
    minX = Math.min(minX, p.x - nodeR - pad);
    maxX = Math.max(maxX, p.x + nodeR + pad);
    minY = Math.min(minY, p.y - nodeR - pad);
    maxY = Math.max(maxY, p.y + nodeR + pad);
  }
  const width = maxX - minX;
  const height = maxY - minY;

  const svg = svgEl('svg', { class: 'graphviz__svg', viewBox: `${minX} ${minY} ${width} ${height}`, width: String(Math.max(520, Math.floor(width))), height: String(Math.max(420, Math.floor(height))), role: 'img' }, [
    svgEl('defs', {}, [
      svgEl('marker', { id: 'graphvizArrow', markerWidth: '10', markerHeight: '10', refX: '8', refY: '3', orient: 'auto', markerUnits: 'strokeWidth' }, [
        svgEl('path', { d: 'M0,0 L9,3 L0,6 z', class: 'graphviz__arrow' }, [])
      ])
    ])
  ]);

  for (const e of edges ?? []) {
    const src = e?.sourceSymbolUid ? String(e.sourceSymbolUid) : null;
    const dst = e?.targetSymbolUid ? String(e.targetSymbolUid) : null;
    if (!src || !dst) continue;
    if (!shown.has(src) || !shown.has(dst)) continue;
    const a = pos.get(src);
    const b = pos.get(dst);
    if (!a || !b) continue;
    const et = slugify(e?.edgeType ?? 'edge');
    svg.appendChild(
      svgEl('line', {
        class: `graphviz__edge graphviz__edge--${et}`,
        x1: String(a.x),
        y1: String(a.y),
        x2: String(b.x),
        y2: String(b.y),
        'marker-end': 'url(#graphvizArrow)'
      })
    );
  }

  for (const uid of shown) {
    const n = nodeByUid.get(uid);
    const p = pos.get(uid);
    if (!n || !p) continue;
    const nodeType = String(n.nodeType ?? 'Node');
    const typeSlug = slugify(nodeType);
    const title = truncateLabel(n.qualifiedName ?? n.name ?? uid, 18);
    const isCenter = uid === center;
    const cls = isCenter ? `graphviz__node graphviz__node--center graphviz__node--${typeSlug}` : `graphviz__node graphviz__node--${typeSlug}`;
    const g = svgEl(
      'g',
      { class: cls, role: 'button', tabindex: '0', 'data-symbol-uid': uid, onclick: () => onSelectSymbolUid?.(uid) },
      [
        ring && ring.has(uid) ? svgEl('circle', { class: 'graphviz__ring', cx: String(p.x), cy: String(p.y), r: String(nodeR + 8) }) : null,
        svgEl('circle', { class: 'graphviz__dot', cx: String(p.x), cy: String(p.y), r: String(isCenter ? nodeR + 4 : nodeR) }),
        svgEl('text', { class: 'graphviz__label', x: String(p.x), y: String(p.y + nodeR + 18), 'text-anchor': 'middle' }, [title])
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

  return el('div', { class: 'graphviz' }, [svg]);
}

export function renderGraphPage({ state, pageEl }) {
  clear(pageEl);
  const api = new ApiClient({ apiUrl: state.apiUrl, tenantId: state.tenantId, repoId: state.repoId, mode: state.mode, authToken: state.authToken });
  let unsubscribe = null;
  let cancelled = false;
  let token = 0;
  let focusSymbolUid = null;
  let highlightedBlast = null;
  let highlightedTrace = null;
  let traceForUid = null;
  let traceResult = null;

  const bannerEl = el('div', { class: 'banner banner--hidden' }, ['']);

  const resultsEl = el('ul', { class: 'list' });
  let evidenceEl = el('div', { class: 'card', 'data-testid': 'evidence-panel' }, [
    el('div', { class: 'card__title' }, ['Evidence (contract + location)']),
    el('div', { class: 'small' }, ['Select a node to view contract and location metadata.'])
  ]);

  let focusEl = el('div', { class: 'card' }, [
    el('div', { class: 'card__title' }, ['Focus Subgraph (lazy-loaded)']),
    el('div', { class: 'small' }, ['Select a node to load its neighborhood without rendering the full repo graph.'])
  ]);

  const blastDepthSelect = el('select', { class: 'select select--compact', id: 'blastDepth' }, [
    el('option', { value: '1' }, ['Depth 1']),
    el('option', { value: '2' }, ['Depth 2'])
  ]);
  const blastDirSelect = el('select', { class: 'select select--compact', id: 'blastDir' }, [
    el('option', { value: 'both' }, ['Both']),
    el('option', { value: 'out' }, ['Out']),
    el('option', { value: 'in' }, ['In'])
  ]);

  const traceDepthSelect = el('select', { class: 'select select--compact', id: 'traceDepth' }, [
    el('option', { value: '2' }, ['Trace 2']),
    el('option', { value: '3' }, ['Trace 3']),
    el('option', { value: '4' }, ['Trace 4']),
    el('option', { value: '5' }, ['Trace 5'])
  ]);

  function currentHashQuery() {
    const raw = window.location.hash.replace('#', '');
    const queryRaw = raw.includes('?') ? raw.split('?', 2)[1] ?? '' : '';
    const out = Object.create(null);
    if (!queryRaw) return out;
    for (const [k, v] of new URLSearchParams(queryRaw).entries()) out[k] = v;
    return out;
  }

  function goAppWithQuery(patch) {
    const cur = currentHashQuery();
    const next = { ...cur };
    for (const [k, v] of Object.entries(patch ?? {})) {
      if (v === null) delete next[k];
      else next[k] = String(v);
    }
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) {
      if (!v) continue;
      sp.set(k, v);
    }
    const qs = sp.toString();
    window.location.hash = qs ? `app?${qs}` : 'app';
  }

  function openDocsFile(path) {
    const p = String(path ?? '').trim();
    if (!p) return;
    state.graphOn = false;
    localStorage.setItem('graphfly_canvas_graph', '0');
    state.panelMode = 'docs';
    localStorage.setItem('graphfly_panel_mode', 'docs');
    state.lastCanvasMode = 'docs';
    localStorage.setItem('graphfly_last_canvas_mode', 'docs');
    state.docsPath = p;
    localStorage.setItem('graphfly_docs_path', p);
    state.docsDir = parentDir(p);
    localStorage.setItem('graphfly_docs_dir', state.docsDir);
    goAppWithQuery({ nav: 'docs', path: p, dir: state.docsDir ?? '', ref: state.docsRef ?? 'default', thread: null, draft: null, run: null });
  }

  async function setFocus(symbolUid) {
    const uid = String(symbolUid ?? '').trim();
    if (!uid) return;
    const prev = focusSymbolUid;
    focusSymbolUid = uid;
    state.graphFocusSymbolUid = uid;
    localStorage.setItem('graphfly_graph_focus', uid);
    const t = ++token;

    if (prev && prev !== uid) {
      highlightedBlast = null;
      highlightedTrace = null;
      traceForUid = null;
      traceResult = null;
    }

    try {
      let contract = null;
      try {
        contract = await api.contractsGet({ symbolUid: uid });
      } catch {
        contract = null;
      }
      if (cancelled || t !== token) return;
      if (contract) {
        const nextEv = renderEvidencePanel(contract);
        evidenceEl.replaceWith(nextEv);
        evidenceEl = nextEv;
      }

      const nb = await api.neighborhood({ symbolUid: uid, direction: 'both', limitEdges: 120 });
      if (cancelled || t !== token) return;
      const nodes = Array.isArray(nb?.nodes) ? nb.nodes : [];
      const edges = Array.isArray(nb?.edges) ? nb.edges : [];
      const nodeByUid = new Map(nodes.map((n) => [String(n?.symbolUid ?? ''), n]).filter((x) => x[0]));

      let linkedBlocks = [];
      try {
        const out = await api.listDocBlocksBySymbolUid({ symbolUid: uid, limit: 200 });
        linkedBlocks = Array.isArray(out?.blocks) ? out.blocks : [];
      } catch {
        linkedBlocks = [];
      }

      const depEdgeTypes = new Set(['Imports', 'UsesPackage', 'DependsOn']);
      const callers = new Set();
      const callees = new Set();
      const dependencies = new Set();
      const dependents = new Set();
      for (const e of edges) {
        const src = e?.sourceSymbolUid ? String(e.sourceSymbolUid) : null;
        const dst = e?.targetSymbolUid ? String(e.targetSymbolUid) : null;
        const ty = String(e?.edgeType ?? '');
        if (!src || !dst) continue;
        if (ty === 'Calls') {
          if (dst === uid) callers.add(src);
          if (src === uid) callees.add(dst);
        }
        if (depEdgeTypes.has(ty)) {
          if (src === uid) dependencies.add(dst);
          if (dst === uid) dependents.add(src);
        }
      }

      function sortUids(set) {
        const arr = Array.from(set ?? []);
        arr.sort((a, b) => {
          const na = nodeByUid.get(String(a));
          const nb = nodeByUid.get(String(b));
          const la = String(na?.qualifiedName ?? na?.name ?? a);
          const lb = String(nb?.qualifiedName ?? nb?.name ?? b);
          return la.localeCompare(lb);
        });
        return arr;
      }

      const callersArr = sortUids(callers);
      const calleesArr = sortUids(callees);
      const depsArr = sortUids(dependencies);
      const dependentsArr = sortUids(dependents);

      const union = new Set();
      for (const x of highlightedBlast ?? []) union.add(String(x));
      for (const x of highlightedTrace ?? []) union.add(String(x));
      const highlightedUnion = union.size > 0 ? union : null;

      function renderUidLinks(uids, { emptyText, onClick }) {
        const arr = Array.isArray(uids) ? uids : [];
        if (arr.length === 0) return el('div', { class: 'small' }, [emptyText]);
        const cap = 14;
        const shown = arr.slice(0, cap);
        const list = el(
          'ul',
          { class: 'list' },
          shown.map((x) =>
            el(
              'li',
              {
                class: 'list__item',
                onclick: () => onClick?.(x)
              },
              [
                el('div', { class: 'h' }, [nodeByUid.get(String(x))?.qualifiedName ?? String(x).slice(0, 48)]),
                el('div', { class: 'small k' }, [String(nodeByUid.get(String(x))?.nodeType ?? '')])
              ]
            )
          )
        );
        if (arr.length > cap) list.appendChild(el('li', { class: 'list__item' }, [el('div', { class: 'small k' }, [`… +${arr.length - cap} more`])]));
        return list;
      }

      const blocksListEl =
        linkedBlocks.length === 0
          ? el('div', { class: 'small' }, ['No linked doc blocks found for this symbol yet.'])
          : el(
              'ul',
              { class: 'list' },
              linkedBlocks.slice(0, 20).map((b) => {
                const docFile = b?.docFile ?? b?.doc_file ?? null;
                const anchor = b?.blockAnchor ?? b?.block_anchor ?? null;
                const status = String(b?.status ?? 'unknown');
                const badgeClass = status === 'fresh' || status === 'ok' ? 'badge badge--ok' : 'badge badge--warn';
                return el('li', { class: 'list__item' }, [
                  el('div', { class: 'row' }, [
                    el('div', {}, [
                      el('div', { class: 'h' }, [String(docFile ?? '')]),
                      el('div', { class: 'small k' }, [`${String(anchor ?? '')} • ${String(b?.blockType ?? b?.block_type ?? '')}`])
                    ]),
                    el('div', { class: 'row__spacer' }, []),
                    el('span', { class: badgeClass }, [status]),
                    docFile
                      ? el(
                          'button',
                          {
                            class: 'button',
                            type: 'button',
                            onclick: (evt) => {
                              evt?.preventDefault?.();
                              evt?.stopPropagation?.();
                              openDocsFile(docFile);
                            }
                          },
                          ['Open']
                        )
                      : null
                  ])
                ]);
              })
            );

      const traceControls = el('div', { class: 'row' }, [
        traceDepthSelect,
        el(
          'button',
          {
            class: 'button',
            type: 'button',
            onclick: async () => {
              if (!focusSymbolUid) return;
              try {
                const depth = Number(traceDepthSelect.value ?? 3);
                const out = await api.traceFlow({ startSymbolUid: focusSymbolUid, depth: Number.isFinite(depth) ? Math.trunc(depth) : 3 });
                traceForUid = focusSymbolUid;
                traceResult = out ?? null;
                const arr = Array.isArray(out?.nodes) ? out.nodes : [];
                highlightedTrace = new Set(arr.map((n) => String(n?.symbolUid ?? '')).filter(Boolean));
                await setFocus(focusSymbolUid);
              } catch (e) {
                state.toast?.toast?.({ kind: 'error', title: 'Trace failed', message: String(e?.message ?? e) });
              }
            }
          },
          ['Trace flow']
        ),
        traceForUid === uid
          ? el(
              'button',
              {
                class: 'button',
                type: 'button',
                onclick: async () => {
                  highlightedTrace = null;
                  traceForUid = null;
                  traceResult = null;
                  await setFocus(uid);
                }
              },
              ['Clear']
            )
          : null
      ]);

      const traceSection =
        traceForUid === uid && traceResult
          ? el('div', { class: 'stack' }, [
              el('div', { class: 'card__title' }, ['Flow trace']),
              el('div', { class: 'small k' }, [
                `Depth: ${traceResult?.depth ?? '—'} • Nodes: ${(traceResult?.nodes ?? []).length ?? 0} • Edges: ${(traceResult?.edges ?? []).length ?? 0}`
              ]),
              el(
                'ul',
                { class: 'list' },
                (traceResult?.edges ?? [])
                  .slice(0, 20)
                  .map((e) =>
                    el(
                      'li',
                      {
                        class: 'list__item',
                        onclick: () => {
                          const dst = e?.targetSymbolUid ?? null;
                          if (dst) setFocus(dst);
                        }
                      },
                      [
                        el('div', { class: 'h' }, [`${String(e?.edgeType ?? '')}`]),
                        el('div', { class: 'small k' }, [
                          `${String(e?.sourceSymbolUid ?? '').slice(0, 40)} → ${String(e?.targetSymbolUid ?? '').slice(0, 40)}`
                        ])
                      ]
                    )
                  )
              )
            ])
          : null;

      const next = el('div', { class: 'card' }, [
        el('div', { class: 'row' }, [
          el('div', {}, [
            el('div', { class: 'card__title' }, ['Focus Subgraph (lazy-loaded)']),
            el('div', { class: 'small' }, [`Nodes: ${nodes.length} • Edges: ${edges.length}`])
          ]),
          el('div', { class: 'row__spacer' }, []),
          blastDepthSelect,
          blastDirSelect,
          el(
            'button',
            {
              class: 'button',
              type: 'button',
              onclick: async () => {
                if (!focusSymbolUid) return;
                try {
                  const depth = Number(blastDepthSelect.value ?? 1);
                  const direction = blastDirSelect.value ?? 'both';
                  const out = await api.blastRadius({ symbolUid: focusSymbolUid, depth, direction });
                  const arr = Array.isArray(out?.nodes) ? out.nodes : [];
                  highlightedBlast = new Set(arr.map((n) => String(n?.symbolUid ?? '')).filter(Boolean));
                  await setFocus(focusSymbolUid);
                } catch (e) {
                  // ignore
                }
              }
            },
            ['Blast radius']
          )
        ]),
        el('div', { class: 'divider' }, []),
        renderNeighborhoodGraph({
          centerSymbolUid: uid,
          nodes,
          edges,
          highlightedSymbolUids: highlightedUnion,
          onSelectSymbolUid: (nextUid) => setFocus(nextUid)
        }),
        el('div', { class: 'divider' }, []),
        el('div', { class: 'row' }, [el('div', { class: 'h' }, ['Node detail']), el('div', { class: 'row__spacer' }, []), traceControls]),
        el('div', { class: 'divider' }, []),
        el('div', { class: 'grid2' }, [
          el('div', { class: 'stack' }, [
            el('div', { class: 'card__title' }, [`Callers (${callersArr.length})`]),
            renderUidLinks(callersArr, { emptyText: 'No callers in neighborhood.', onClick: (x) => setFocus(x) }),
            el('div', { class: 'card__title' }, [`Callees (${calleesArr.length})`]),
            renderUidLinks(calleesArr, { emptyText: 'No callees in neighborhood.', onClick: (x) => setFocus(x) })
          ]),
          el('div', { class: 'stack' }, [
            el('div', { class: 'card__title' }, [`Dependencies (${depsArr.length})`]),
            renderUidLinks(depsArr, { emptyText: 'No dependencies in neighborhood.', onClick: (x) => setFocus(x) }),
            el('div', { class: 'card__title' }, [`Dependents (${dependentsArr.length})`]),
            renderUidLinks(dependentsArr, { emptyText: 'No dependents in neighborhood.', onClick: (x) => setFocus(x) })
          ])
        ]),
        el('div', { class: 'divider' }, []),
        el('div', { class: 'card__title' }, [`Linked doc blocks (${linkedBlocks.length})`]),
        blocksListEl,
        traceSection ? el('div', { class: 'divider' }, []) : null,
        traceSection
      ]);
      focusEl.replaceWith(next);
      focusEl = next;
    } catch {
      // ignore
    }
  }

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
            await setFocus(symbolUid);
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
    unsubscribe = state.realtime?.subscribe?.((evt) => {
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

  const initialFocus = state.graphFocusSymbolUid ? String(state.graphFocusSymbolUid).trim() : '';
  if (initialFocus) {
    setTimeout(() => {
      if (!pageEl.isConnected || cancelled) return;
      setFocus(initialFocus).catch(() => {});
    }, 0);
  }

  return () => {
    cancelled = true;
    try {
      unsubscribe?.();
    } catch {
      // ignore
    }
  };
}
