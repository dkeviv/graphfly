import { el } from '../../render.js';

function kvTable(obj) {
  if (!obj || typeof obj !== 'object') return el('div', { class: 'small' }, ['(none)']);
  const keys = Object.keys(obj);
  if (!keys.length) return el('div', { class: 'small' }, ['(none)']);
  return el('ul', { class: 'list' }, keys.sort().slice(0, 20).map((k) =>
    el('li', { class: 'list__item' }, [
      el('div', { class: 'h' }, [k]),
      el('div', { class: 'small k' }, [JSON.stringify(obj[k])])
    ])
  ));
}

export function renderEvidencePanel(contractGetResult) {
  const r = contractGetResult ?? {};
  const loc = r.location ?? {};
  return el('div', { class: 'card', 'data-testid': 'evidence-panel' }, [
    el('div', { class: 'card__title' }, ['Evidence (contract + location)']),
    el('div', { class: 'small' }, ['This panel intentionally does not fetch or render source code bodies/snippets.']),
    el('div', { class: 'list__item' }, [
      el('div', { class: 'h' }, [r.qualifiedName ?? r.symbolUid ?? '(unknown)']),
      el('div', { class: 'small k' }, [
        `Symbol: ${r.symbolUid ?? ''}`,
        ' • ',
        `File: ${loc.filePath ?? ''}:${loc.lineStart ?? ''}`
      ])
    ]),
    el('div', { class: 'card__title' }, ['Contract']),
    kvTable(r.contract),
    el('div', { class: 'card__title' }, ['Constraints']),
    kvTable(r.constraints),
    el('div', { class: 'card__title' }, ['Allowable Values']),
    kvTable(r.allowableValues)
  ]);
}

