import { ApiClient } from '../api.js';
import { el, clear } from '../render.js';

function fmt(v) {
  if (v === null || v === undefined) return '—';
  return String(v);
}

export function renderAdminPage({ state, pageEl }) {
  clear(pageEl);
  const api = new ApiClient({ apiUrl: state.apiUrl, tenantId: state.tenantId, repoId: state.repoId, mode: state.mode, authToken: state.authToken });

  const statusEl = el('div', { class: 'small' }, ['Loading…']);
  const overviewEl = el('div', { class: 'card' }, [el('div', { class: 'card__title' }, ['Overview']), statusEl]);
  const jobsEl = el('ul', { class: 'list' });
  const auditEl = el('ul', { class: 'list' });
  const secretsEl = el('div', { class: 'card' }, [el('div', { class: 'card__title' }, ['Secrets Rotation'])]);
  const metricsOutEl = el('pre', { class: 'card pre' }, ['']);
  const metricsTokenInput = el('input', { class: 'input', id: 'metricsToken', placeholder: 'Metrics token (optional)', type: 'password' });

  async function refresh() {
    statusEl.textContent = 'Loading…';
    jobsEl.innerHTML = '';
    auditEl.innerHTML = '';
    metricsOutEl.textContent = '';

    let overview = null;
    try {
      overview = await api.adminOverview();
    } catch (e) {
      statusEl.textContent = `Failed to load admin overview: ${String(e?.message ?? e)}`;
      return;
    }

    statusEl.textContent = `Tenant: ${fmt(overview?.tenantId)} • Queue: ${fmt(overview?.queue?.mode)} • Indexer: ${fmt(overview?.indexer?.mode)}`;

    // Overview body
    overviewEl.replaceWith(
      el('div', { class: 'card' }, [
        el('div', { class: 'card__title' }, ['Overview']),
        el('div', { class: 'row' }, [
          el('div', {}, [
            el('div', { class: 'h' }, [fmt(overview?.org?.displayName ?? overview?.org?.name ?? 'Org')]),
            el('div', { class: 'small k' }, [`tenantId=${fmt(overview?.tenantId)} • plan=${fmt(overview?.org?.plan)}`])
          ])
        ]),
        el('div', { class: 'small' }, [
          `Repos: ${fmt(overview?.reposCount)} • Docs repo: ${fmt(overview?.org?.docsRepoFullName)}`
        ]),
        el('div', { class: 'small' }, [
          `GitHub installs: reader=${fmt(overview?.org?.githubReaderInstallId)} docs=${fmt(overview?.org?.githubDocsInstallId)}`
        ]),
        el('div', { class: 'small' }, [
          `Metrics: ${overview?.observability?.metricsEnabled ? 'enabled' : 'disabled'} • /metrics ${overview?.observability?.metricsAuth}`
        ])
      ])
    );

    // Jobs
    try {
      const j = await api.listJobs({ limit: 25 });
      const all = [
        ...(j.indexJobs ?? []).map((x) => ({ ...x, _queue: 'index' })),
        ...(j.docJobs ?? []).map((x) => ({ ...x, _queue: 'doc' }))
      ].sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));

      for (const job of all.slice(0, 25)) {
        jobsEl.appendChild(
          el('li', { class: 'list__item' }, [
            el('div', { class: 'row' }, [
              el('div', {}, [
                el('div', { class: 'h' }, [`${job._queue}: ${job.jobName}`]),
                el('div', { class: 'small k' }, [`${job.status} • attempts=${fmt(job.attempts)}/${fmt(job.maxAttempts)}`]),
                job.lastError ? el('div', { class: 'small' }, [String(job.lastError).slice(0, 180)]) : null
              ])
            ])
          ])
        );
      }
    } catch (e) {
      jobsEl.appendChild(el('li', { class: 'list__item' }, [`Failed to load jobs: ${String(e?.message ?? e)}`]));
    }

    // Audit
    try {
      const a = await api.listAudit({ limit: 25 });
      for (const ev of a.events ?? []) {
        auditEl.appendChild(
          el('li', { class: 'list__item' }, [
            el('div', { class: 'h' }, [fmt(ev.action)]),
            el('div', { class: 'small k' }, [`${fmt(ev.created_at ?? ev.createdAt)} • actor=${fmt(ev.actor_user_id ?? ev.actorUserId)}`])
          ])
        );
      }
    } catch (e) {
      auditEl.appendChild(el('li', { class: 'list__item' }, [`Audit unavailable: ${String(e?.message ?? e)}`]));
    }

    // Secrets
    secretsEl.replaceWith(
      el('div', { class: 'card' }, [
        el('div', { class: 'card__title' }, ['Secrets Rotation']),
        el('div', { class: 'small' }, [`Primary key id: ${fmt(overview?.secrets?.primaryKeyId)} • Keys: ${(overview?.secrets?.keyIds ?? []).join(', ') || '—'}`]),
        el('div', { class: 'row' }, [
          el('button', {
            class: 'button',
            onclick: async () => {
              try {
                const out = await api.secretsRewrap();
                statusEl.textContent = `Rewrap complete: scanned=${fmt(out.scanned)} updated=${fmt(out.updated)}`;
              } catch (e) {
                statusEl.textContent = `Rewrap failed: ${String(e?.message ?? e)}`;
              }
            }
          }, ['Rewrap Secrets'])
        ]),
        el('div', { class: 'small' }, ['Use after rotating `GRAPHFLY_SECRET_KEYS` to migrate ciphertexts to the new primary key.'])
      ])
    );

    // Metrics (best-effort)
    try {
      const token = localStorage.getItem('graphfly_metrics_token') ?? '';
      metricsTokenInput.value = token;
      const text = await api.fetchMetricsText({ token: token || null });
      metricsOutEl.textContent = text.slice(0, 6000);
    } catch {
      metricsOutEl.textContent = 'Metrics not available (configure GRAPHFLY_METRICS_TOKEN or set GRAPHFLY_METRICS_PUBLIC=1).';
    }
  }

  pageEl.appendChild(
    el('div', { class: 'grid2' }, [
      el('div', { class: 'stack' }, [
        overviewEl,
        el('div', { class: 'card' }, [el('div', { class: 'card__title' }, ['Jobs']), jobsEl]),
        el('div', { class: 'card' }, [el('div', { class: 'card__title' }, ['Audit']), auditEl])
      ]),
      el('div', { class: 'stack' }, [
        secretsEl,
        el('div', { class: 'card' }, [
          el('div', { class: 'card__title' }, ['Metrics Preview']),
          el('div', { class: 'small' }, ['Token (stored locally) is used to fetch `/metrics` from the API.']),
          el('div', { class: 'row' }, [
            metricsTokenInput,
            el('button', {
              class: 'button',
              onclick: () => {
                const v = metricsTokenInput.value.trim();
                localStorage.setItem('graphfly_metrics_token', v);
                refresh();
              }
            }, ['Save'])
          ])
        ]),
        metricsOutEl
      ])
    ])
  );

  refresh();
}
