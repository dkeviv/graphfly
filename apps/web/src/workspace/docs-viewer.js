import { ApiClient } from '../api.js';
import { el, clear } from '../render.js';
import { renderSafeMarkdown } from './safe-markdown.js';

export function renderDocsViewerCanvas({ state, rootEl, onNavigate }) {
  clear(rootEl);
  const api = new ApiClient({ apiUrl: state.apiUrl, tenantId: state.tenantId, repoId: state.repoId, mode: state.mode, authToken: state.authToken });

  const selectedRepo = (state.shell?.repos ?? []).find((r) => String(r.id) === String(state.repoId)) ?? null;
  if (!selectedRepo?.docsRepoFullName) {
    rootEl.appendChild(
      el('div', { class: 'card' }, [
        el('div', { class: 'card__title' }, ['Docs']),
        el('div', { class: 'small' }, ['Configure a docs repo for this project to view documentation.'])
      ])
    );
    return null;
  }

  const path = state.docsPath ?? null;
  if (!path) {
    rootEl.appendChild(
      el('div', { class: 'card' }, [
        el('div', { class: 'card__title' }, ['Docs viewer']),
        el('div', { class: 'small' }, ['Select a file from the file tree to view it here.'])
      ])
    );
    return null;
  }

  let draft = state.docsDraft && state.docsDraft.path === path ? state.docsDraft : null;
  if (!draft) {
    draft = { path, before: null, after: null, dirty: false, view: 'view', diff: null, isNew: false };
    state.docsDraft = draft;
  }

  const unsavedBadgeEl = el('span', { class: 'badge badge--warn md__unsaved md__unsaved--hidden' }, ['Unsaved']);
  function updateHeaderState() {
    unsavedBadgeEl.classList.toggle('md__unsaved--hidden', !draft.dirty);
  }

  const headerEl = el('div', { class: 'card' }, [
    el('div', { class: 'row' }, [
      el('div', {}, [el('div', { class: 'h' }, [path]), el('div', { class: 'small k' }, [`ref=${state.docsRef ?? 'default'}`])]),
      el('div', { class: 'row__spacer' }, []),
      unsavedBadgeEl,
      el('button', { class: draft.view === 'view' ? 'button button--primary' : 'button', type: 'button', onclick: () => { draft.view = 'view'; onNavigate?.({ kind: 'docs_view' }); } }, ['View']),
      el('button', { class: draft.view === 'edit' ? 'button button--primary' : 'button', type: 'button', onclick: () => { draft.view = 'edit'; onNavigate?.({ kind: 'docs_edit' }); } }, ['Edit']),
      el('button', { class: draft.view === 'diff' ? 'button button--primary' : 'button', type: 'button', onclick: () => { draft.view = 'diff'; onNavigate?.({ kind: 'docs_diff' }); } }, ['Diff'])
    ])
  ]);

  const inspectorEl = el('div', { class: 'card md__inspector md__inspector--hidden' }, []);
  const bodyEl = el('div', { class: 'card' }, [el('div', { class: 'small' }, ['Loading…'])]);

  rootEl.appendChild(el('div', { class: 'stack' }, [headerEl, inspectorEl, bodyEl]));

  let cancelled = false;
  let token = 0;
  let blocks = [];

  function showInspector(payload) {
    inspectorEl.className = 'card md__inspector';
    inspectorEl.innerHTML = '';
    inspectorEl.appendChild(payload);
  }

  function hideInspector() {
    inspectorEl.className = 'card md__inspector md__inspector--hidden';
    inspectorEl.innerHTML = '';
  }

  async function ensureDiff() {
    if (draft.before == null || draft.after == null) return '';
    try {
      const out = await api.docsDiff({ path: draft.path, before: draft.before, after: draft.after });
      return String(out?.diff ?? '');
    } catch (e) {
      return `diff_error: ${String(e?.message ?? e)}`;
    }
  }

  async function load() {
    const t = ++token;
    hideInspector();
    bodyEl.innerHTML = '';
    bodyEl.appendChild(el('div', { class: 'small' }, ['Loading…']));
    try {
      let fileMissing = false;
      let file = null;
      try {
        file = await api.docsFile({ path, ref: state.docsRef ?? 'default' });
      } catch (e) {
        const st = Number(e?.status ?? 0);
        const err = String(e?.data?.error ?? e?.message ?? '');
        if (st === 404 || err === 'not_found') {
          fileMissing = true;
          file = { content: '' };
        } else {
          throw e;
        }
      }
      if (cancelled || t !== token) return;
      const content = String(file?.content ?? '');

      try {
        const all = await api.listDocBlocks();
        blocks = (all?.blocks ?? []).filter((b) => String(b.docFile ?? b.doc_file ?? '') === String(path));
      } catch {
        blocks = [];
      }
      if (!draft.dirty) {
        draft.before = content;
        draft.after = content;
        draft.diff = null;
        draft.isNew = fileMissing;
      } else if (draft.before == null) {
        draft.before = content;
      }

      const byAnchor = new Map();
      for (const b of blocks) byAnchor.set(String(b.blockAnchor ?? b.block_anchor ?? ''), b);

      async function renderCurrent() {
        bodyEl.innerHTML = '';

        if (draft.view === 'edit') {
          const ta = el('textarea', { class: 'textarea', rows: '24' }, [draft.after ?? '']);
          ta.addEventListener('input', () => {
            draft.after = ta.value;
            draft.dirty = draft.after !== draft.before;
            draft.diff = null;
            updateHeaderState();
          });
          bodyEl.appendChild(
            el('div', { class: 'stack' }, [
              fileMissing
                ? el('div', { class: 'small' }, ['This file does not exist on the selected docs ref yet. Edit it, then Open PR to create it.'])
                : el('div', { class: 'small' }, ['Edit Markdown. Use View to preview, Diff to review changes, then Open PR from the top bar.']),
              ta,
              el('div', { class: 'row' }, [
                el(
                  'button',
                  {
                    class: 'button button--danger',
                    type: 'button',
                    onclick: () => {
                      draft.after = draft.before ?? '';
                      draft.dirty = false;
                      draft.diff = null;
                      updateHeaderState();
                      onNavigate?.({ kind: 'docs_discard' });
                    }
                  },
                  ['Discard changes']
                )
              ])
            ])
          );
          return;
        }

        if (draft.view === 'diff') {
          const diffText = draft.diff ?? (await ensureDiff());
          draft.diff = diffText;
          bodyEl.appendChild(
            el('div', { class: 'stack' }, [
              el('div', { class: 'small' }, ['Unified diff preview (before → after).']),
              el('pre', { class: 'md__code' }, [diffText || '(no changes)']),
              el('div', { class: 'row' }, [
                el('button', { class: 'button', type: 'button', onclick: () => { draft.diff = null; onNavigate?.({ kind: 'docs_diff_refresh' }); } }, ['Refresh diff'])
              ])
            ])
          );
          return;
        }

        if (fileMissing) {
          bodyEl.appendChild(
            el('div', { class: 'card md__callout' }, [
              el('div', { class: 'h' }, ['File not found on this ref']),
              el('div', { class: 'small' }, ['Create it by switching to Edit and then opening a PR.']),
              el('div', { class: 'row' }, [
                el('button', { class: 'button button--primary', type: 'button', onclick: () => { draft.view = 'edit'; onNavigate?.({ kind: 'docs_edit' }); } }, ['Create file'])
              ])
            ])
          );
        }

        const headingEls = new Map();
        const md = renderSafeMarkdown(draft.after ?? '', {
          onHeading: ({ text, el: headingEl }) => {
            const anchor = `## ${text}`;
            headingEls.set(anchor, headingEl);
          }
        });

        // Attach doc-block badges to matching headings.
        for (const [anchor, b] of byAnchor.entries()) {
          const headingEl = headingEls.get(anchor) ?? null;
          if (!headingEl) continue;
          const status = String(b.status ?? 'unknown');
          const kind = status === 'fresh' || status === 'ok' ? 'ok' : status === 'stale' ? 'warn' : status === 'locked' ? 'warn' : 'warn';
          const badgeClass = kind === 'ok' ? 'badge badge--ok md__badge' : 'badge badge--warn md__badge';
          const label = `${b.blockType ?? b.block_type ?? 'block'} • ${status}`;

          const badge = el('button', { class: badgeClass, type: 'button' }, [label]);
          badge.addEventListener('click', async (evt) => {
            evt?.preventDefault?.();
            evt?.stopPropagation?.();
            try {
              const out = await api.getDocBlock({ blockId: b.id });
              const evidence = Array.isArray(out?.evidence) ? out.evidence : [];
              const list = el(
                'ul',
                { class: 'list' },
                evidence.map((e) =>
                  el('li', { class: 'list__item' }, [
                    el('div', { class: 'h' }, [String(e.qualifiedName ?? e.symbolUid ?? '')]),
                    el('div', { class: 'small k' }, [
                      `${e.filePath ?? ''}:${e.lineStart ?? ''}-${e.lineEnd ?? e.lineStart ?? ''} • ${String(e.sha ?? '').slice(0, 8)}`
                    ])
                  ])
                )
              );
              showInspector(
                el('div', {}, [
                  el('div', { class: 'row' }, [
                    el('div', {}, [el('div', { class: 'h' }, ['Evidence']), el('div', { class: 'small k' }, [anchor])]),
                    el('div', { class: 'row__spacer' }, []),
                    el('button', { class: 'button', type: 'button', onclick: () => hideInspector() }, ['Close'])
                  ]),
                  el('div', { class: 'divider' }, []),
                  list
                ])
              );
            } catch (e) {
              state.toast?.toast?.({ kind: 'error', title: 'Failed', message: String(e?.message ?? e) });
            }
          });
          headingEl.appendChild(badge);
        }

        bodyEl.appendChild(md);

        const wantedAnchor = state.docsAnchor ? String(state.docsAnchor) : null;
        if (wantedAnchor && headingEls.has(wantedAnchor)) {
          const headingEl = headingEls.get(wantedAnchor);
          headingEl.classList.add('md__anchor-highlight');
          headingEl.scrollIntoView({ block: 'start', behavior: 'smooth' });
          setTimeout(() => headingEl.classList.remove('md__anchor-highlight'), 2200);
          state.docsAnchor = null;
          localStorage.removeItem('graphfly_docs_anchor');
        }
      }

      await renderCurrent();
      updateHeaderState();
    } catch (e) {
      if (cancelled || t !== token) return;
      bodyEl.innerHTML = '';
      bodyEl.appendChild(
        el('div', { class: 'small' }, [
          `Failed to load: ${String(e?.message ?? e)}`
        ])
      );
      bodyEl.appendChild(el('div', { class: 'row' }, [
        el('button', { class: 'button', type: 'button', onclick: () => onNavigate?.({ kind: 'docs_retry' }) }, ['Retry'])
      ]));
    }
  }

  load();

  return () => {
    cancelled = true;
  };
}
