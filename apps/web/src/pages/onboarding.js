import { el, clear } from '../render.js';

export function renderOnboardingPage({ state, pageEl }) {
  clear(pageEl);

  const steps = [
    { k: '1', h: 'Install Reader App', s: 'Connect source repos (read-only).', ok: true },
    { k: '2', h: 'Select Docs Repo', s: 'Choose/create a docs repo (write-only).', ok: true },
    { k: '3', h: 'Index + Generate', s: 'Graph builds automatically; docs PR opens.', ok: true }
  ];

  pageEl.appendChild(
    el('div', { class: 'grid2' }, [
      el('div', { class: 'card' }, [
        el('div', { class: 'card__title' }, ['Onboarding (spec-aligned)']),
        el('ul', { class: 'list' }, steps.map((st) =>
          el('li', { class: 'list__item' }, [
            el('div', { class: 'row' }, [
              el('span', { class: 'badge badge--ok' }, ['✓']),
              el('div', {}, [el('div', { class: 'h' }, [st.h]), el('div', { class: 'small' }, [st.s])])
            ])
          ])
        ))
      ]),
      el('div', { class: 'card' }, [
        el('div', { class: 'card__title' }, ['Local settings']),
        el('div', { class: 'small' }, ['API URL (for local dev demos):']),
        el('div', { class: 'row' }, [
          el('input', { class: 'input', value: state.apiUrl, id: 'apiUrlInput' }),
          el('button', {
            class: 'button',
            onclick: () => {
              const v = document.getElementById('apiUrlInput').value;
              localStorage.setItem('graphfly_api_url', v);
              state.apiUrl = v;
            }
          }, ['Save'])
        ]),
        el('div', { class: 'small' }, ['Support-safe mode is available via the Mode switch in the sidebar.'])
      ])
    ])
  );
}

