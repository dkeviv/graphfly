import { el } from '../render.js';

function safeHref(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (s.startsWith('#')) return s;
  if (s.startsWith('/')) return s;
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  return null;
}

function appendText(parent, text) {
  if (!text) return;
  parent.appendChild(document.createTextNode(String(text)));
}

function appendInline(parent, text) {
  const src = String(text ?? '');
  let i = 0;
  while (i < src.length) {
    const tick = src.indexOf('`', i);
    if (tick === -1) break;
    const next = src.indexOf('`', tick + 1);
    if (next === -1) break;
    appendText(parent, src.slice(i, tick));
    parent.appendChild(el('code', { class: 'md__code-inline' }, [src.slice(tick + 1, next)]));
    i = next + 1;
  }
  const tail = src.slice(i);
  if (!tail) return;

  // Links: [text](url)
  let cursor = 0;
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(tail))) {
    const before = tail.slice(cursor, m.index);
    if (before) appendText(parent, before);
    const label = m[1];
    const href = safeHref(m[2]);
    if (href) {
      const aAttrs = { class: 'md__link', href };
      if (href.startsWith('http')) {
        aAttrs.target = '_blank';
        aAttrs.rel = 'noreferrer';
      }
      parent.appendChild(el('a', aAttrs, [label]));
    } else {
      appendText(parent, `${m[0]}`);
    }
    cursor = m.index + m[0].length;
  }
  const rest = tail.slice(cursor);
  if (rest) appendText(parent, rest);
}

export function renderSafeMarkdown(src, { onHeading } = {}) {
  const root = el('div', { class: 'md' }, []);
  const lines = String(src ?? '').replaceAll('\r\n', '\n').split('\n');

  let para = [];
  let list = null; // { kind: 'ul'|'ol', el }
  let code = null; // { fence: '```'|'~~~', buf: [] }

  function flushParagraph() {
    if (para.length === 0) return;
    const text = para.join(' ').trim();
    para = [];
    if (!text) return;
    const p = el('p', { class: 'md__p' }, []);
    appendInline(p, text);
    root.appendChild(p);
  }

  function flushList() {
    if (!list) return;
    root.appendChild(list.el);
    list = null;
  }

  function flushCode() {
    if (!code) return;
    const pre = el('pre', { class: 'md__code' }, [el('code', {}, [code.buf.join('\n')])]);
    root.appendChild(pre);
    code = null;
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');

    if (code) {
      if (line.startsWith(code.fence)) {
        flushCode();
      } else {
        code.buf.push(rawLine);
      }
      continue;
    }

    if (/^```/.test(line) || /^~~~/.test(line)) {
      flushParagraph();
      flushList();
      code = { fence: line.startsWith('```') ? '```' : '~~~', buf: [] };
      continue;
    }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushParagraph();
      flushList();
      const level = h[1].length;
      const text = h[2].trim();
      const tag = level === 1 ? 'h1' : level === 2 ? 'h2' : level === 3 ? 'h3' : 'h4';
      const heading = el(tag, { class: 'md__h' }, []);
      appendInline(heading, text);
      if (tag === 'h2') onHeading?.({ level: 2, text, el: heading });
      root.appendChild(heading);
      continue;
    }

    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ul || ol) {
      flushParagraph();
      const kind = ul ? 'ul' : 'ol';
      if (!list || list.kind !== kind) {
        flushList();
        list = { kind, el: el(kind, { class: 'md__list' }, []) };
      }
      const li = el('li', { class: 'md__li' }, []);
      appendInline(li, (ul ?? ol)[1]);
      list.el.appendChild(li);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    para.push(line.trim());
  }

  flushParagraph();
  flushList();
  flushCode();

  return root;
}

