import { ApiClient } from '../api.js';
import { el, clear } from '../render.js';

function fmtDate(ts) {
  const d = ts ? new Date(String(ts)) : null;
  if (!d || Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString();
}

function meterCard({ title, meter }) {
  if (!meter) return null;
  const lim = meter.unlimited ? null : meter.limit;
  const v = meter.unlimited ? null : Math.min(Math.max(0, Number(meter.used) || 0), lim ?? 0);
  return el('div', { class: 'kpi' }, [
    el('div', { class: 'kpi__label' }, [title]),
    el('div', { class: 'kpi__value' }, [meter.unlimited ? String(meter.used ?? 0) : `${meter.used ?? 0}`]),
    el('div', { class: 'kpi__sub' }, [meter.unlimited ? 'unlimited' : `limit=${meter.limit} remaining=${meter.remaining}`]),
    meter.unlimited ? null : el('progress', { class: 'meter', value: String(v ?? 0), max: String(lim ?? 1) }, [])
  ]);
}

export function renderSettingsCanvas({ state, rootEl }) {
  clear(rootEl);
  const api = new ApiClient({ apiUrl: state.apiUrl, tenantId: state.tenantId, repoId: state.repoId, mode: state.mode, authToken: state.authToken });

  const headerEl = el('div', { class: 'card' }, [
    el('div', { class: 'row' }, [
      el('div', {}, [el('div', { class: 'card__title' }, ['Settings']), el('div', { class: 'small' }, ['Overview + usage.'])]),
      el('div', { class: 'row__spacer' }, []),
      el('button', { class: 'button', type: 'button', id: 'settingsCanvasRefresh' }, ['Refresh'])
    ])
  ]);

  const statusEl = el('div', { class: 'small' }, ['Loading…']);
  const overviewEl = el('div', { class: 'card' }, [statusEl]);
  const usageEl = el('div', { class: 'card' }, [el('div', { class: 'card__title' }, ['Usage']), el('div', { class: 'small' }, ['Loading…'])]);

  rootEl.appendChild(el('div', { class: 'stack' }, [headerEl, overviewEl, usageEl]));

  let cancelled = false;
  let token = 0;

  async function load() {
    const t = ++token;
    statusEl.textContent = 'Loading…';
    usageEl.innerHTML = '';
    usageEl.appendChild(el('div', { class: 'card__title' }, ['Usage']));
    usageEl.appendChild(el('div', { class: 'small' }, ['Loading…']));
    try {
      const [org, usage] = await Promise.all([api.getCurrentOrg(), api.billingUsage()]);
      if (cancelled || t !== token) return;
      const selectedRepo = (state.shell?.repos ?? []).find((r) => String(r.id) === String(state.repoId)) ?? null;
      const trackedBranch = selectedRepo?.trackedBranch ?? selectedRepo?.defaultBranch ?? null;
      const docsRepo = selectedRepo?.docsRepoFullName ?? null;

      overviewEl.innerHTML = '';
      overviewEl.appendChild(el('div', { class: 'card__title' }, ['Overview']));
      overviewEl.appendChild(
        el('div', { class: 'small' }, [
          `tenant=${org?.id ?? state.tenantId} • plan=${org?.plan ?? usage?.plan ?? '—'}`
        ])
      );
      overviewEl.appendChild(el('div', { class: 'small k' }, [`github reader=${org?.githubReaderInstallId ?? '—'} • docs=${org?.githubDocsInstallId ?? '—'}`]));
      if (selectedRepo) {
        overviewEl.appendChild(el('div', { class: 'divider' }, []));
        overviewEl.appendChild(el('div', { class: 'h' }, [String(selectedRepo.fullName ?? 'project')]));
        overviewEl.appendChild(el('div', { class: 'small k' }, [
          trackedBranch ? `code branch=${trackedBranch} (locked)` : 'code branch=—',
          docsRepo ? ` • docs repo=${docsRepo}` : ' • docs repo=—'
        ]));
      }

      usageEl.innerHTML = '';
      usageEl.appendChild(el('div', { class: 'row' }, [
        el('div', {}, [el('div', { class: 'card__title' }, ['Usage']), el('div', { class: 'small k' }, [`period=${fmtDate(usage?.periodStart)} → ${fmtDate(usage?.periodEnd)}`])])
      ]));
      usageEl.appendChild(
        el('div', { class: 'grid2' }, [
          meterCard({ title: 'Index jobs today', meter: usage?.usage?.indexJobsPerDay ?? null }),
          meterCard({ title: 'Doc blocks this month', meter: usage?.usage?.docBlocksPerMonth ?? null })
        ])
      );
    } catch (e) {
      if (cancelled || t !== token) return;
      statusEl.textContent = `Failed to load: ${String(e?.message ?? e)}`;
      usageEl.innerHTML = '';
      usageEl.appendChild(el('div', { class: 'card__title' }, ['Usage']));
      usageEl.appendChild(el('div', { class: 'small' }, ['Usage unavailable.']));
    }
  }

  headerEl.querySelector('#settingsCanvasRefresh')?.addEventListener('click', () => load());

  load();

  return () => {
    cancelled = true;
  };
}

