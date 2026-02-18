import { ApiClient } from '../api.js';
import { el, clear } from '../render.js';

function parentDir(dir) {
  const s = String(dir ?? '').replaceAll('\\', '/').replaceAll(/\/+/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!s) return '';
  const parts = s.split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

function crumbParts(dir) {
  const s = String(dir ?? '').replaceAll('\\', '/').replaceAll(/\/+/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!s) return [];
  return s.split('/').filter(Boolean);
}

export function renderDocsTreePanel({ state, rootEl, onNavigate }) {
  clear(rootEl);
  const api = new ApiClient({ apiUrl: state.apiUrl, tenantId: state.tenantId, repoId: state.repoId, mode: state.mode, authToken: state.authToken });

  const selectedRepo = (state.shell?.repos ?? []).find((r) => String(r.id) === String(state.repoId)) ?? null;
  const docsRepo = selectedRepo?.docsRepoFullName ?? null;
  if (!docsRepo) {
    rootEl.appendChild(
      el('div', { class: 'card' }, [
        el('div', { class: 'card__title' }, ['Docs']),
        el('div', { class: 'small' }, ['No docs repo configured for this project yet.']),
        el('button', { class: 'button button--primary', onclick: () => onNavigate?.({ kind: 'onboarding' }) }, ['Configure docs repo'])
      ])
    );
    return null;
  }

  const newFileBtn = el('button', { class: 'button', type: 'button' }, ['New file']);
  const headerEl = el('div', { class: 'card' }, [
    el('div', { class: 'row' }, [
      el('div', {}, [el('div', { class: 'card__title' }, ['Documentation']), el('div', { class: 'small k' }, [docsRepo])]),
      el('div', { class: 'row__spacer' }, []),
      newFileBtn
    ])
  ]);

  const crumbsEl = el('div', { class: 'crumbs' }, []);
  const newFileRow = el('div', { class: 'row tree__new tree__new--hidden' }, []);
  const newFileInput = el('input', { class: 'input', placeholder: 'new-file.md' });
  const newFileCreateBtn = el('button', { class: 'button button--primary', type: 'button' }, ['Create']);
  const newFileCancelBtn = el('button', { class: 'button', type: 'button' }, ['Cancel']);
  newFileRow.appendChild(newFileInput);
  newFileRow.appendChild(newFileCreateBtn);
  newFileRow.appendChild(newFileCancelBtn);
  const searchInput = el('input', { class: 'input', placeholder: 'Search in folder…' });
  const listEl = el('ul', { class: 'list tree' }, []);
  const statusEl = el('div', { class: 'small' }, ['Loading…']);

  rootEl.appendChild(
    el('div', { class: 'stack' }, [
      headerEl,
      el('div', { class: 'card' }, [crumbsEl, newFileRow, el('div', { class: 'divider' }), searchInput, statusEl, listEl])
    ])
  );

  let cancelled = false;
  let token = 0;
  let entries = [];
  let newFileOpen = false;

  function setNewFileOpen(open) {
    newFileOpen = Boolean(open);
    newFileRow.classList.toggle('tree__new--hidden', !newFileOpen);
    if (newFileOpen) {
      newFileInput.value = '';
      newFileInput.focus();
    }
  }

  function normalizeNewFilePath(input) {
    const raw = String(input ?? '').trim().replaceAll('\\', '/').replaceAll(/\/+/g, '/').replace(/^\/+/, '');
    if (!raw) throw new Error('path_required');
    if (raw.includes('\0')) throw new Error('invalid_path');
    if (raw.split('/').some((seg) => seg === '..')) throw new Error('invalid_path');
    const withExt = raw.endsWith('.md') ? raw : `${raw}.md`;
    const prefix = state.docsDir ? String(state.docsDir).replaceAll('\\', '/').replaceAll(/\/+/g, '/').replace(/^\/+/, '').replace(/\/+$/, '') : '';
    const full = prefix ? `${prefix}/${withExt}` : withExt;
    if (full.length > 500) throw new Error('path_too_long');
    return full;
  }

  function renderCrumbs() {
    clear(crumbsEl);
    const parts = crumbParts(state.docsDir);
    const items = [{ label: 'docs', dir: '' }];
    let acc = '';
    for (const p of parts) {
      acc = acc ? `${acc}/${p}` : p;
      items.push({ label: p, dir: acc });
    }
    const row = el('div', { class: 'row' }, []);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      row.appendChild(
        el(
          'button',
          {
            class: 'linkbtn',
            type: 'button',
            onclick: () => {
              state.docsDir = it.dir;
              localStorage.setItem('graphfly_docs_dir', state.docsDir);
              onNavigate?.({ kind: 'docs_dir', dir: state.docsDir });
            }
          },
          [it.label]
        )
      );
      if (i !== items.length - 1) row.appendChild(el('span', { class: 'k' }, [' / ']));
    }
    row.appendChild(el('div', { class: 'row__spacer' }, []));
    if (state.docsDir) {
      row.appendChild(
        el(
          'button',
          {
            class: 'button',
            type: 'button',
            onclick: () => {
              state.docsDir = parentDir(state.docsDir);
              localStorage.setItem('graphfly_docs_dir', state.docsDir);
              onNavigate?.({ kind: 'docs_dir', dir: state.docsDir });
            }
          },
          ['Up']
        )
      );
    }
    crumbsEl.appendChild(row);
  }

  newFileBtn.addEventListener('click', () => setNewFileOpen(!newFileOpen));
  newFileCancelBtn.addEventListener('click', () => setNewFileOpen(false));
  newFileInput.addEventListener('keydown', (evt) => {
    if (evt.key === 'Enter') {
      evt.preventDefault();
      newFileCreateBtn.click();
    }
    if (evt.key === 'Escape') {
      evt.preventDefault();
      setNewFileOpen(false);
    }
  });

  newFileCreateBtn.addEventListener('click', () => {
    try {
      const fullPath = normalizeNewFilePath(newFileInput.value);
      state.docsPath = fullPath;
      localStorage.setItem('graphfly_docs_path', state.docsPath);
      state.docsDraft = { path: fullPath, before: '', after: '', dirty: false, view: 'edit', diff: null, isNew: true };
      setNewFileOpen(false);
      onNavigate?.({ kind: 'docs_file', path: state.docsPath });
    } catch (e) {
      state.toast?.toast?.({ kind: 'warn', title: 'Invalid path', message: String(e?.message ?? e) });
    }
  });

  function renderList(filterText = '') {
    listEl.innerHTML = '';
    const q = String(filterText ?? '').trim().toLowerCase();
    const filtered = q
      ? entries.filter((e) => String(e.name ?? e.path ?? '').toLowerCase().includes(q))
      : entries;

    if (filtered.length === 0) {
      listEl.appendChild(el('li', { class: 'list__item' }, [el('div', { class: 'small' }, ['No files found.'])]));
      return;
    }

    for (const e of filtered) {
      const isDir = e.type === 'dir';
      const isSelected = !isDir && state.docsPath && String(state.docsPath) === String(e.path);
      const icon = isDir ? '📁' : '📝';
      listEl.appendChild(
        el(
          'li',
          {
            class: isSelected ? 'list__item tree__item tree__item--selected' : 'list__item tree__item',
            onclick: () => {
              if (isDir) {
                state.docsDir = String(e.path ?? '');
                localStorage.setItem('graphfly_docs_dir', state.docsDir);
                onNavigate?.({ kind: 'docs_dir', dir: state.docsDir });
                return;
              }
              state.docsPath = String(e.path ?? '');
              localStorage.setItem('graphfly_docs_path', state.docsPath);
              onNavigate?.({ kind: 'docs_file', path: state.docsPath });
            }
          },
          [
            el('div', { class: 'row' }, [
              el('div', { class: 'tree__icon' }, [icon]),
              el('div', { class: 'tree__name' }, [String(e.name ?? e.path ?? '')]),
              isDir ? el('div', { class: 'k tree__meta' }, ['dir']) : null,
              !isDir && e.size != null ? el('div', { class: 'k tree__meta' }, [`${e.size}b`]) : null
            ])
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
      const out = await api.docsTree({ dir: state.docsDir ?? '', ref: state.docsRef ?? 'default' });
      if (cancelled || t !== token) return;
      entries = Array.isArray(out?.entries) ? out.entries : [];
      statusEl.textContent = '';
      renderCrumbs();
      renderList(searchInput.value);
    } catch (e) {
      if (cancelled || t !== token) return;
      statusEl.textContent = `Failed to load: ${String(e?.message ?? e)}`;
      entries = [];
      renderCrumbs();
      renderList(searchInput.value);
    }
  }

  searchInput.addEventListener('input', () => renderList(searchInput.value));

  renderCrumbs();
  load();

  return () => {
    cancelled = true;
  };
}
