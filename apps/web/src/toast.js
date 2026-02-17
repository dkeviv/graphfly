import { el } from './render.js';

export function createToastHub({ rootEl, defaultTtlMs = 3500 } = {}) {
  if (!rootEl) throw new Error('rootEl is required');

  function toast({ kind = 'info', title = 'Notice', message = '', ttlMs = defaultTtlMs } = {}) {
    const k = String(kind ?? 'info');
    const node = el('div', { class: `toast ${k === 'ok' ? 'toast--ok' : k === 'warn' ? 'toast--warn' : k === 'error' ? 'toast--error' : ''}` }, [
      el('div', { class: 'toast__title' }, [String(title ?? 'Notice')]),
      el('div', { class: 'toast__body' }, [String(message ?? '')])
    ]);
    rootEl.appendChild(node);
    const t = setTimeout(() => {
      try {
        node.remove();
      } catch {}
    }, Number(ttlMs ?? defaultTtlMs));
    node.addEventListener('click', () => {
      clearTimeout(t);
      try {
        node.remove();
      } catch {}
    });
  }

  return { toast };
}

