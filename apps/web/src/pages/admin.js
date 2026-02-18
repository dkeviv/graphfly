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
  const membersEl = el('ul', { class: 'list' });
  const invitesEl = el('ul', { class: 'list' });
  const inviteEmailInput = el('input', { class: 'input', placeholder: 'Invite email', type: 'email' });
  const inviteRoleSelect = el(
    'select',
    { class: 'input' },
    ['viewer', 'member', 'admin'].map((r) => el('option', { value: r }, [r]))
  );
  const inviteOutEl = el('div', { class: 'small k' }, ['']);
  const secretsEl = el('div', { class: 'card' }, [el('div', { class: 'card__title' }, ['Secrets Rotation'])]);
  const metricsOutEl = el('pre', { class: 'card pre' }, ['']);
  const metricsTokenInput = el('input', { class: 'input', id: 'metricsToken', placeholder: 'Metrics token (optional)', type: 'password' });

  const jobStatusSelect = el('select', { class: 'select select--compact', 'aria-label': 'Job status filter' }, [
    el('option', { value: '' }, ['all']),
    el('option', { value: 'queued' }, ['queued']),
    el('option', { value: 'active' }, ['active']),
    el('option', { value: 'succeeded' }, ['succeeded']),
    el('option', { value: 'dead' }, ['dead'])
  ]);
  const jobQueueSelect = el('select', { class: 'select select--compact', 'aria-label': 'Job queue filter' }, [
    el('option', { value: '' }, ['all queues']),
    el('option', { value: 'index' }, ['index']),
    el('option', { value: 'graph' }, ['graph']),
    el('option', { value: 'doc' }, ['doc'])
  ]);
  const jobsHeaderEl = el('div', { class: 'row' }, [
    el('div', { class: 'card__title' }, ['Jobs']),
    el('div', { class: 'row__spacer' }, []),
    jobQueueSelect,
    jobStatusSelect,
    el('button', { class: 'button', type: 'button', onclick: () => refresh() }, ['Refresh'])
  ]);

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
      const status = jobStatusSelect.value || null;
      const queueFilter = jobQueueSelect.value || null;
      const j = await api.listJobs({ status, limit: 50 });
      const all = [
        ...(j.indexJobs ?? []).map((x) => ({ ...x, _queue: 'index' })),
        ...(j.graphJobs ?? []).map((x) => ({ ...x, _queue: 'graph' })),
        ...(j.docJobs ?? []).map((x) => ({ ...x, _queue: 'doc' }))
      ].sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));

      const filtered = queueFilter ? all.filter((x) => x._queue === queueFilter) : all;

      for (const job of filtered.slice(0, 50)) {
        const canRetry = job.status === 'dead' || job.status === 'failed';
        const canCancel = job.status === 'queued' || job.status === 'active';
        jobsEl.appendChild(
          el('li', { class: 'list__item' }, [
            el('div', { class: 'row' }, [
              el('div', {}, [
                el('div', { class: 'h' }, [`${job._queue}: ${job.jobName}`]),
                el('div', { class: 'small k' }, [`${job.status} • attempts=${fmt(job.attempts)}/${fmt(job.maxAttempts)}`]),
                job.lastError ? el('div', { class: 'small' }, [String(job.lastError).slice(0, 180)]) : null
              ]),
              el('div', { class: 'row__spacer' }, []),
              canRetry
                ? el(
                    'button',
                    {
                      class: 'button',
                      type: 'button',
                      onclick: async () => {
                        try {
                          await api.retryJob({ queue: job._queue, jobId: job.id, resetAttempts: true });
                          state.toast?.toast?.({ kind: 'ok', title: 'Retried', message: `${job._queue}:${job.jobName}` });
                          await refresh();
                        } catch (e) {
                          state.toast?.toast?.({ kind: 'error', title: 'Retry failed', message: String(e?.message ?? e) });
                        }
                      }
                    },
                    ['Retry']
                  )
                : null,
              canCancel
                ? el(
                    'button',
                    {
                      class: 'button button--danger',
                      type: 'button',
                      onclick: async () => {
                        try {
                          await api.cancelJob({ queue: job._queue, jobId: job.id, reason: 'canceled_by_admin' });
                          state.toast?.toast?.({ kind: 'ok', title: 'Canceled', message: `${job._queue}:${job.jobName}` });
                          await refresh();
                        } catch (e) {
                          state.toast?.toast?.({ kind: 'error', title: 'Cancel failed', message: String(e?.message ?? e) });
                        }
                      }
                    },
                    ['Cancel']
                  )
                : null
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

    // Team (members + invites)
    membersEl.innerHTML = '';
    invitesEl.innerHTML = '';
    inviteOutEl.textContent = '';
    try {
      const m = await api.orgListMembers();
      for (const mem of m.members ?? []) {
        membersEl.appendChild(
          el('li', { class: 'list__item' }, [el('div', { class: 'h' }, [fmt(mem.userId)]), el('div', { class: 'small k' }, [fmt(mem.role)])])
        );
      }
    } catch (e) {
      membersEl.appendChild(el('li', { class: 'list__item' }, [`Members unavailable: ${String(e?.message ?? e)}`]));
    }
    try {
      const inv = await api.orgListInvites({ limit: 50 });
      const list = inv.invites ?? [];
      if (list.length === 0) {
        invitesEl.appendChild(el('li', { class: 'list__item' }, ['No pending invites.']));
      } else {
        for (const it of list) {
          invitesEl.appendChild(
            el('li', { class: 'list__item' }, [
              el('div', { class: 'row' }, [
                el('div', {}, [
                  el('div', { class: 'h' }, [fmt(it.email)]),
                  el('div', { class: 'small k' }, [`${fmt(it.role)} • ${fmt(it.status)} • expires ${fmt(it.expiresAt)}`])
                ]),
                it.status === 'pending'
                  ? el('button', {
                      class: 'button button--danger',
                      onclick: async () => {
                        try {
                          await api.orgRevokeInvite({ inviteId: it.id });
                          await refresh();
                        } catch (e) {
                          statusEl.textContent = `Revoke failed: ${String(e?.message ?? e)}`;
                        }
                      }
                    }, ['Revoke'])
                  : null
              ])
            ])
          );
        }
      }
    } catch (e) {
      invitesEl.appendChild(el('li', { class: 'list__item' }, [`Invites unavailable: ${String(e?.message ?? e)}`]));
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
        el('div', { class: 'card' }, [jobsHeaderEl, jobsEl]),
        el('div', { class: 'card' }, [el('div', { class: 'card__title' }, ['Audit']), auditEl])
      ]),
      el('div', { class: 'stack' }, [
        el('div', { class: 'card' }, [
          el('div', { class: 'card__title' }, ['Team']),
          el('div', { class: 'small' }, ['Invite by email. Delivery is out-of-band; copy the accept URL below.']),
          el('div', { class: 'row' }, [
            inviteEmailInput,
            inviteRoleSelect,
            el('button', {
              class: 'button',
              onclick: async () => {
                const email = inviteEmailInput.value.trim();
                const role = inviteRoleSelect.value;
                if (!email) return;
                try {
                  const out = await api.orgCreateInvite({ email, role });
                  inviteEmailInput.value = '';
                  inviteOutEl.textContent = `Accept URL: ${fmt(out.acceptUrl)}`;
                  await refresh();
                } catch (e) {
                  inviteOutEl.textContent = `Invite failed: ${String(e?.message ?? e)}`;
                }
              }
            }, ['Create Invite'])
          ]),
          inviteOutEl,
          el('div', { class: 'card__title' }, ['Members']),
          membersEl,
          el('div', { class: 'card__title' }, ['Invites']),
          invitesEl
        ]),
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
