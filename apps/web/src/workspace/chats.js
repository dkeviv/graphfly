import { ApiClient } from '../api.js';
import { el, clear } from '../render.js';
import { renderSafeMarkdown } from './safe-markdown.js';

function formatTimestamp(ts) {
  const d = ts ? new Date(String(ts)) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleString();
}

function formatCitation(c) {
  const type = String(c?.type ?? '');
  if (type === 'symbol') return `symbol: ${String(c?.qualifiedName ?? c?.symbolUid ?? '').slice(0, 80)}`;
  if (type === 'flow') return `flow: ${String(c?.entrypointKey ?? '').slice(0, 80)}`;
  if (type === 'docs_file') return `doc: ${String(c?.path ?? '').slice(0, 80)}`;
  if (type === 'doc_block') return `block: ${String(c?.docFile ?? '').slice(0, 60)}`;
  return type ? `evidence: ${type}` : 'evidence';
}

function normalizeThreadTitle(t) {
  const s = String(t ?? '').trim();
  if (!s) return null;
  return s.slice(0, 120);
}

function formatDraftStatus(s) {
  const st = String(s ?? '');
  if (st === 'applied') return { label: 'applied', kind: 'ok' };
  if (st === 'draft') return { label: 'draft', kind: 'warn' };
  if (st === 'expired') return { label: 'expired', kind: 'warn' };
  if (st === 'rejected') return { label: 'rejected', kind: 'warn' };
  if (st === 'error') return { label: 'error', kind: 'warn' };
  return { label: st || 'unknown', kind: 'warn' };
}

export function renderChatsPanel({ state, rootEl, onNavigate }) {
  clear(rootEl);
  const api = new ApiClient({ apiUrl: state.apiUrl, tenantId: state.tenantId, repoId: state.repoId, mode: state.mode, authToken: state.authToken });

  const repos = state.shell?.repos ?? [];
  if ((repos?.length ?? 0) === 0) {
    rootEl.appendChild(el('div', { class: 'card' }, [el('div', { class: 'card__title' }, ['Chats']), el('div', { class: 'small' }, ['Create a project first.'])]));
    return null;
  }

  const headerTitleEl = el('div', { class: 'card__title' }, ['Chats']);
  const newThreadBtn = el('button', { class: 'button button--primary', type: 'button' }, ['New thread']);
  const headerEl = el('div', { class: 'card' }, [
    el('div', { class: 'row' }, [headerTitleEl, el('div', { class: 'row__spacer' }, []), newThreadBtn])
  ]);

  const threadsStatusEl = el('div', { class: 'small' }, ['Loading threads…']);
  const threadsListEl = el('ul', { class: 'list chat__threads' }, []);

  const draftsStatusEl = el('div', { class: 'small' }, ['Loading drafts…']);
  const draftsListEl = el('ul', { class: 'list chat__drafts' }, []);

  const draftPreviewEl = el('div', { class: 'card chat__draft-preview chat__draft-preview--hidden' }, []);

  const messagesStatusEl = el('div', { class: 'small' }, ['Select a thread to start.']);
  const messagesEl = el('div', { class: 'chat__messages' }, []);
  const inputEl = el('textarea', { class: 'input chat__input', rows: '3', placeholder: 'Ask about the system…' });
  const sendBtn = el('button', { class: 'button button--primary', type: 'button' }, ['Send']);
  const draftBtn = el('button', { class: 'button', type: 'button' }, ['Draft PR']);

  const composerEl = el('div', { class: 'row chat__composer' }, [inputEl, sendBtn, draftBtn]);
  const convoEl = el('div', { class: 'card chat__convo' }, [messagesStatusEl, messagesEl, composerEl]);

  rootEl.appendChild(
    el('div', { class: 'stack chat' }, [
      headerEl,
      el('div', { class: 'card' }, [threadsStatusEl, threadsListEl]),
      el('div', { class: 'card' }, [el('div', { class: 'card__title' }, ['Drafts']), draftsStatusEl, draftsListEl]),
      draftPreviewEl,
      convoEl
    ])
  );

  let cancelled = false;
  let token = 0;
  let threads = [];
  let loadingThreadId = null;
  let drafts = [];
  let loadingDraftId = null;
  let selectedDraft = null;

  function setSelectedThreadId(id) {
    state.threadId = id ? String(id) : null;
    if (state.threadId) localStorage.setItem('graphfly_thread_id', state.threadId);
    else localStorage.removeItem('graphfly_thread_id');
  }

  function setSelectedDraftId(id) {
    state.draftId = id ? String(id) : null;
    if (state.draftId) localStorage.setItem('graphfly_draft_id', state.draftId);
    else localStorage.removeItem('graphfly_draft_id');
  }

  function renderThreads() {
    threadsListEl.innerHTML = '';
    if (!threads.length) {
      threadsListEl.appendChild(el('li', { class: 'list__item' }, [el('div', { class: 'small' }, ['No threads yet.'])]));
      return;
    }
    for (const t of threads) {
      const id = String(t.id ?? '');
      const title = String(t.title ?? 'Untitled');
      const active = state.threadId && String(state.threadId) === id;
      threadsListEl.appendChild(
        el(
          'li',
          {
            class: active ? 'list__item chat__thread chat__thread--active' : 'list__item chat__thread',
            onclick: () => {
              setSelectedThreadId(id);
              onNavigate?.({ kind: 'chat_thread', threadId: id });
              loadThread({ threadId: id });
            }
          },
          [
            el('div', { class: 'row' }, [
              el('div', { class: 'chat__thread-title' }, [title]),
              el('div', { class: 'row__spacer' }, []),
              el('div', { class: 'k chat__thread-meta' }, [formatTimestamp(t.updatedAt ?? t.updated_at ?? t.createdAt ?? t.created_at)])
            ])
          ]
        )
      );
    }
  }

  function renderDrafts() {
    draftsListEl.innerHTML = '';
    if (!drafts.length) {
      draftsListEl.appendChild(el('li', { class: 'list__item' }, [el('div', { class: 'small' }, ['No drafts yet.'])]));
      return;
    }
    for (const d of drafts) {
      const id = String(d.id ?? '');
      const prompt = String(d.prompt ?? d.instruction ?? '').trim();
      const title = prompt ? prompt.slice(0, 80) : String(d.draft_type ?? d.draftType ?? 'docs_edit');
      const active = state.draftId && String(state.draftId) === id;
      const st = formatDraftStatus(d.status ?? null);
      const badgeClass = st.kind === 'ok' ? 'badge badge--ok' : 'badge badge--warn';
      draftsListEl.appendChild(
        el(
          'li',
          {
            class: active ? 'list__item chat__draft chat__draft--active' : 'list__item chat__draft',
            onclick: () => {
              setSelectedDraftId(id);
              onNavigate?.({ kind: 'draft_select', draftId: id });
              loadDraft({ draftId: id });
            }
          },
          [
            el('div', { class: 'row' }, [
              el('div', { class: 'chat__draft-title' }, [title || 'Draft']),
              el('div', { class: 'row__spacer' }, []),
              el('span', { class: badgeClass }, [st.label])
            ])
          ]
        )
      );
    }
  }

  function renderMessage({ role, content, citations = [] } = {}) {
    const r = String(role ?? 'assistant');
    const bubbleClass = r === 'user' ? 'chat__msg chat__msg--user' : 'chat__msg chat__msg--assistant';
    const citeArr = Array.isArray(citations) ? citations : [];
    const citeEl =
      citeArr.length > 0
        ? el(
            'div',
            { class: 'chat__cites' },
            citeArr.slice(0, 8).map((c) =>
              el(
                'button',
                {
                  class: 'badge chat__cite',
                  type: 'button',
                  onclick: () => {
                    if (c?.type === 'docs_file' && c?.path) {
                      state.panelMode = 'docs';
                      localStorage.setItem('graphfly_panel_mode', state.panelMode);
                      state.docsPath = String(c.path);
                      localStorage.setItem('graphfly_docs_path', state.docsPath);
                      onNavigate?.({ kind: 'docs_from_citation', path: state.docsPath });
                    }
                  }
                },
                [formatCitation(c)]
              )
            )
          )
        : null;

    const md = renderSafeMarkdown(String(content ?? ''), {});
    return el('div', { class: bubbleClass }, [md, citeEl]);
  }

  function scrollMessagesToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  async function loadThreads({ selectFirst = false } = {}) {
    const t = ++token;
    threadsStatusEl.textContent = 'Loading threads…';
    try {
      const out = await api.assistantListThreads({ limit: 50 });
      if (cancelled || t !== token) return;
      threads = Array.isArray(out?.threads) ? out.threads : [];
      threadsStatusEl.textContent = '';
      renderThreads();
      if (selectFirst && !state.threadId && threads.length) {
        const id = threads[0].id;
        setSelectedThreadId(id);
        onNavigate?.({ kind: 'chat_thread', threadId: id });
        await loadThread({ threadId: id });
      }
    } catch (e) {
      if (cancelled || t !== token) return;
      threads = [];
      threadsStatusEl.textContent = `Failed to load threads: ${String(e?.message ?? e)}`;
      renderThreads();
    }
  }

  async function loadDrafts() {
    draftsStatusEl.textContent = 'Loading drafts…';
    try {
      const out = await api.assistantListDrafts({ limit: 30 });
      drafts = Array.isArray(out?.drafts) ? out.drafts : [];
      draftsStatusEl.textContent = '';
      renderDrafts();
    } catch (e) {
      drafts = [];
      draftsStatusEl.textContent = `Failed to load drafts: ${String(e?.message ?? e)}`;
      renderDrafts();
    }
  }

  function hideDraftPreview() {
    draftPreviewEl.classList.add('chat__draft-preview--hidden');
    draftPreviewEl.innerHTML = '';
    selectedDraft = null;
  }

  function showDraftPreview(draft) {
    selectedDraft = draft ?? null;
    if (!selectedDraft) {
      hideDraftPreview();
      return;
    }

    const st = formatDraftStatus(selectedDraft.status ?? null);
    const badgeClass = st.kind === 'ok' ? 'badge badge--ok' : 'badge badge--warn';
    const title = String(selectedDraft.prompt ?? '').trim().slice(0, 120) || 'Docs draft';
    const summary = selectedDraft.answerMarkdown ?? selectedDraft.answer_markdown ?? selectedDraft.summary ?? null;
    const diff = String(selectedDraft.diff ?? '');
    const expiresAt = selectedDraft.expiresAt ?? selectedDraft.expires_at ?? null;
    const files = Array.isArray(selectedDraft.files ?? selectedDraft.files_json ?? selectedDraft.filesJson) ? (selectedDraft.files ?? selectedDraft.files_json ?? selectedDraft.filesJson) : [];
    const firstPath = files?.[0]?.path ?? files?.[0]?.docFile ?? null;
    const prUrl = selectedDraft.prUrl ?? selectedDraft.pr_url ?? null;
    const prBranch = selectedDraft.prBranch ?? selectedDraft.pr_branch ?? null;

    const actions = [];
    if (String(selectedDraft.status ?? '') === 'draft') {
      actions.push(el('button', { class: 'button button--primary', type: 'button', id: 'draftConfirmBtn' }, ['Confirm → Open PR']));
    }
    if (prBranch) {
      actions.push(
        el(
          'button',
          {
            class: 'button',
            type: 'button',
            onclick: () => {
              state.panelMode = 'docs';
              localStorage.setItem('graphfly_panel_mode', state.panelMode);
              state.docsRef = String(prBranch);
              localStorage.setItem('graphfly_docs_ref', state.docsRef);
              if (firstPath) {
                state.docsPath = String(firstPath);
                localStorage.setItem('graphfly_docs_path', state.docsPath);
              }
              onNavigate?.({ kind: 'docs_from_draft', ref: state.docsRef, path: state.docsPath ?? null });
            }
          },
          ['View preview']
        )
      );
    }

    draftPreviewEl.innerHTML = '';
    draftPreviewEl.classList.remove('chat__draft-preview--hidden');
    draftPreviewEl.appendChild(
      el('div', { class: 'row' }, [
        el('div', {}, [el('div', { class: 'h' }, ['Docs draft']), el('div', { class: 'small k' }, [title])]),
        el('div', { class: 'row__spacer' }, []),
        expiresAt ? el('div', { class: 'k' }, [`expires ${formatTimestamp(expiresAt)}`]) : null,
        el('span', { class: badgeClass }, [st.label]),
        el('button', { class: 'button', type: 'button', onclick: () => hideDraftPreview() }, ['Close'])
      ])
    );
    if (summary) {
      draftPreviewEl.appendChild(el('div', { class: 'divider' }, []));
      draftPreviewEl.appendChild(renderSafeMarkdown(String(summary), {}));
    }

    if (diff) {
      draftPreviewEl.appendChild(el('div', { class: 'divider' }, []));
      draftPreviewEl.appendChild(el('div', { class: 'small' }, ['Preview diff:']));
      draftPreviewEl.appendChild(el('pre', { class: 'md__code' }, [diff]));
    }

    if (prUrl) {
      draftPreviewEl.appendChild(el('div', { class: 'divider' }, []));
      draftPreviewEl.appendChild(
        el('div', { class: 'small' }, [
          'PR: ',
          el('a', { class: 'md__link', href: String(prUrl), target: '_blank', rel: 'noreferrer' }, [String(prUrl)])
        ])
      );
    }

    if (actions.length) {
      draftPreviewEl.appendChild(el('div', { class: 'divider' }, []));
      draftPreviewEl.appendChild(el('div', { class: 'row' }, actions));
    }

    const confirmBtn = draftPreviewEl.querySelector('#draftConfirmBtn');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', async () => {
        const did = selectedDraft?.id ?? null;
        if (!did) return;
        confirmBtn.setAttribute('disabled', '');
        try {
          const out = await api.assistantDocsConfirm({ draftId: did });
          const pr = out?.pr ?? null;
          state.toast?.toast?.({
            kind: 'ok',
            title: 'PR opened',
            message: pr?.prUrl ? String(pr.prUrl) : `Branch: ${String(pr?.branchName ?? '—')}`
          });
          await loadDrafts();
          await loadDraft({ draftId: did });
          onNavigate?.({ kind: 'draft_confirmed', prRunId: out?.prRunId ?? null });
        } catch (e) {
          state.toast?.toast?.({ kind: 'error', title: 'Confirm failed', message: String(e?.message ?? e) });
        } finally {
          confirmBtn.removeAttribute('disabled');
        }
      });
    }
  }

  async function loadDraft({ draftId }) {
    const did = String(draftId ?? '');
    if (!did) return;
    loadingDraftId = did;
    draftPreviewEl.innerHTML = '';
    draftPreviewEl.classList.remove('chat__draft-preview--hidden');
    draftPreviewEl.appendChild(el('div', { class: 'small' }, ['Loading draft…']));
    try {
      const out = await api.assistantGetDraft({ draftId: did });
      if (cancelled || loadingDraftId !== did) return;
      const draft = out?.draft ?? null;
      showDraftPreview(draft);
    } catch (e) {
      if (cancelled || loadingDraftId !== did) return;
      draftPreviewEl.innerHTML = '';
      draftPreviewEl.appendChild(el('div', { class: 'small' }, [`Failed to load draft: ${String(e?.message ?? e)}`]));
    }
  }

  async function loadThread({ threadId }) {
    const tid = String(threadId ?? '');
    if (!tid) return;
    loadingThreadId = tid;
    messagesStatusEl.textContent = 'Loading…';
    messagesEl.innerHTML = '';
    try {
      const out = await api.assistantGetThread({ threadId: tid, limit: 60 });
      if (cancelled || loadingThreadId !== tid) return;
      const msgs = Array.isArray(out?.messages) ? out.messages : [];
      messagesStatusEl.textContent = '';
      for (const m of msgs) {
        messagesEl.appendChild(renderMessage({ role: m.role, content: m.content, citations: m.citations ?? [] }));
      }
      scrollMessagesToBottom();
    } catch (e) {
      if (cancelled || loadingThreadId !== tid) return;
      messagesStatusEl.textContent = `Failed to load: ${String(e?.message ?? e)}`;
    }
  }

  newThreadBtn.addEventListener('click', async () => {
    const title = normalizeThreadTitle(window.prompt('Thread title (optional):') ?? '');
    newThreadBtn.setAttribute('disabled', '');
    try {
      const out = await api.assistantCreateThread({ title, mode: state.mode });
      const thread = out?.thread ?? null;
      if (!thread?.id) throw new Error('thread_create_failed');
      await loadThreads();
      setSelectedThreadId(thread.id);
      onNavigate?.({ kind: 'chat_thread', threadId: thread.id });
      await loadThread({ threadId: thread.id });
    } catch (e) {
      state.toast?.toast?.({ kind: 'error', title: 'Failed', message: String(e?.message ?? e) });
    } finally {
      newThreadBtn.removeAttribute('disabled');
    }
  });

  async function submit() {
    const text = String(inputEl.value ?? '').trim();
    if (!text) return;
    const tid = state.threadId ? String(state.threadId) : null;
    if (!tid) {
      state.toast?.toast?.({ kind: 'warn', title: 'No thread selected', message: 'Create or select a thread first.' });
      return;
    }
    inputEl.value = '';
    inputEl.setAttribute('disabled', '');
    sendBtn.setAttribute('disabled', '');

    messagesStatusEl.textContent = '';
    const userMsg = renderMessage({ role: 'user', content: text });
    const pending = renderMessage({ role: 'assistant', content: 'Thinking…' });
    messagesEl.appendChild(userMsg);
    messagesEl.appendChild(pending);
    scrollMessagesToBottom();

    try {
      const out = await api.assistantQuery({ threadId: tid, question: text, mode: state.mode });
      const answer = out?.answerMarkdown ?? out?.answer ?? '';
      const citations = Array.isArray(out?.citations) ? out.citations : [];
      pending.replaceWith(renderMessage({ role: 'assistant', content: answer, citations }));
      scrollMessagesToBottom();
      await loadThreads();
    } catch (e) {
      pending.replaceWith(renderMessage({ role: 'assistant', content: `Error: ${String(e?.message ?? e)}` }));
    } finally {
      inputEl.removeAttribute('disabled');
      sendBtn.removeAttribute('disabled');
      inputEl.focus();
    }
  }

  sendBtn.addEventListener('click', () => submit());
  inputEl.addEventListener('keydown', (evt) => {
    if (evt.key === 'Enter' && (evt.metaKey || evt.ctrlKey)) {
      evt.preventDefault();
      submit();
    }
  });

  async function draftDocs() {
    const text = String(inputEl.value ?? '').trim();
    if (!text) return;
    inputEl.value = '';
    inputEl.setAttribute('disabled', '');
    sendBtn.setAttribute('disabled', '');
    draftBtn.setAttribute('disabled', '');
    try {
      const out = await api.assistantDocsDraft({ instruction: text, mode: state.mode });
      const draftId = out?.draftId ?? null;
      if (draftId) {
        setSelectedDraftId(draftId);
        await loadDrafts();
        await loadDraft({ draftId });
      } else {
        await loadDrafts();
      }
      state.toast?.toast?.({ kind: 'ok', title: 'Draft created', message: draftId ? `Draft: ${draftId}` : 'Ready to confirm.' });
      onNavigate?.({ kind: 'draft_created', draftId: draftId ?? null });
    } catch (e) {
      state.toast?.toast?.({ kind: 'error', title: 'Draft failed', message: String(e?.message ?? e) });
    } finally {
      inputEl.removeAttribute('disabled');
      sendBtn.removeAttribute('disabled');
      draftBtn.removeAttribute('disabled');
      inputEl.focus();
    }
  }

  draftBtn.addEventListener('click', () => draftDocs());

  loadThreads();
  if (state.threadId) loadThread({ threadId: state.threadId });
  loadDrafts();
  if (state.draftId) loadDraft({ draftId: state.draftId });

  return () => {
    cancelled = true;
  };
}
