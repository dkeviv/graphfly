import { ApiClient } from '../api.js';
import { el, clear } from '../render.js';

function fmtTs(ts) {
  const d = ts ? new Date(String(ts)) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleString();
}

async function copyToClipboard(text) {
  const s = String(text ?? '');
  if (!s) return false;
  try {
    await navigator.clipboard.writeText(s);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = s;
      ta.setAttribute('readonly', '');
      ta.className = 'copy__shim';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return Boolean(ok);
    } catch {
      return false;
    }
  }
}

function renderProjectCard({ state, onVerifyDocsRepo }) {
  const selectedRepo = (state.shell?.repos ?? []).find((r) => String(r.id) === String(state.repoId)) ?? null;
  if (!selectedRepo) {
    return el('div', { class: 'card' }, [el('div', { class: 'card__title' }, ['Project']), el('div', { class: 'small' }, ['No project selected.'])]);
  }

  const trackedBranch = selectedRepo.trackedBranch ?? selectedRepo.defaultBranch ?? null;
  const docsRepo = selectedRepo.docsRepoFullName ?? null;
  const docsDefaultBranch = selectedRepo.docsDefaultBranch ?? null;

  return el('div', { class: 'card' }, [
    el('div', { class: 'card__title' }, ['Project']),
    el('div', { class: 'row' }, [
      el('div', {}, [
        el('div', { class: 'h' }, [String(selectedRepo.fullName ?? selectedRepo.id ?? 'project')]),
        el('div', { class: 'small k' }, [
          trackedBranch ? `code branch=${trackedBranch} (locked)` : 'code branch=—',
          docsRepo ? ` • docs repo=${docsRepo}` : ' • docs repo=—'
        ])
      ]),
      el('div', { class: 'row__spacer' }, []),
      el(
        'button',
        {
          class: 'button',
          type: 'button',
          onclick: () => onVerifyDocsRepo?.(docsRepo)
        },
        ['Verify docs repo']
      )
    ]),
    docsDefaultBranch ? el('div', { class: 'small k' }, [`docs default=${docsDefaultBranch}`]) : null,
    el('div', { class: 'small' }, ['To change code repo/branch or docs repo, create a new project.'])
  ]);
}

function renderBillingCard({ summary, usage, onCheckout, onPortal, statusText }) {
  const plan = summary?.plan ?? usage?.plan ?? null;
  const periodStart = summary?.currentPeriodStart ?? usage?.periodStart ?? null;
  const periodEnd = summary?.currentPeriodEnd ?? usage?.periodEnd ?? null;

  function meterRow({ label, meter }) {
    if (!meter) return null;
    const lim = meter.unlimited ? null : meter.limit;
    const v = meter.unlimited ? null : Math.min(Math.max(0, Number(meter.used) || 0), lim ?? 0);
    return el('div', { class: 'stack' }, [
      el('div', { class: 'row' }, [
        el('div', { class: 'h' }, [label]),
        el('div', { class: 'row__spacer' }, []),
        el('div', { class: 'k' }, [
          meter.unlimited ? `${meter.used} / unlimited` : `${meter.used} / ${meter.limit} (remaining ${meter.remaining})`
        ])
      ]),
      meter.unlimited ? null : el('progress', { class: 'meter', value: String(v ?? 0), max: String(lim ?? 1) }, [])
    ]);
  }

  return el('div', { class: 'card' }, [
    el('div', { class: 'row' }, [
      el('div', {}, [
        el('div', { class: 'card__title' }, ['Billing']),
        el('div', { class: 'small' }, [plan ? `Plan: ${plan}` : 'Plan: —'])
      ]),
      el('div', { class: 'row__spacer' }, []),
      el('button', { class: 'button', type: 'button', onclick: () => onPortal?.() }, ['Manage']),
      el('button', { class: 'button button--primary', type: 'button', onclick: () => onCheckout?.('pro') }, ['Upgrade'])
    ]),
    statusText ? el('div', { class: 'small k' }, [statusText]) : null,
    periodStart || periodEnd ? el('div', { class: 'small k' }, [`period=${String(periodStart ?? '—')} → ${String(periodEnd ?? '—')}`]) : null,
    el('div', { class: 'divider' }, []),
    usage?.usage?.indexJobsPerDay ? meterRow({ label: 'Index jobs (today)', meter: usage.usage.indexJobsPerDay }) : null,
    usage?.usage?.docBlocksPerMonth ? meterRow({ label: 'Doc blocks (month)', meter: usage.usage.docBlocksPerMonth }) : null
  ]);
}

function renderTeamCard({ members, invites, membersStatus, invitesStatus, onInviteCreate, onInviteRevoke }) {
  const inviteEmailInput = el('input', { class: 'input', placeholder: 'email@company.com' });
  const inviteRoleSelect = el('select', { class: 'select select--compact', 'aria-label': 'Role' }, [
    el('option', { value: 'viewer' }, ['viewer']),
    el('option', { value: 'admin' }, ['admin']),
    el('option', { value: 'owner' }, ['owner'])
  ]);

  const membersList = el(
    'ul',
    { class: 'list' },
    (members ?? []).slice(0, 100).map((m) => {
      const userId = m?.userId ?? m?.user_id ?? '—';
      const role = m?.role ?? 'viewer';
      return el('li', { class: 'list__item' }, [
        el('div', { class: 'row' }, [
          el('div', {}, [el('div', { class: 'h' }, [String(userId)]), el('div', { class: 'small k' }, [`role=${role}`])]),
          el('div', { class: 'row__spacer' }, [])
        ])
      ]);
    })
  );

  const invitesList = el(
    'ul',
    { class: 'list' },
    (invites ?? []).slice(0, 100).map((inv) => {
      const id = inv?.id ?? inv?.inviteId ?? inv?.invite_id ?? null;
      const email = inv?.email ?? '—';
      const role = inv?.role ?? 'viewer';
      const status = inv?.status ?? 'pending';
      const expiresAt = inv?.expiresAt ?? inv?.expires_at ?? null;
      const createdAt = inv?.createdAt ?? inv?.created_at ?? null;
      return el('li', { class: 'list__item' }, [
        el('div', { class: 'row' }, [
          el('div', {}, [
            el('div', { class: 'h' }, [String(email)]),
            el('div', { class: 'small k' }, [
              `role=${role} • ${status}`,
              createdAt ? ` • created=${fmtTs(createdAt)}` : '',
              expiresAt ? ` • expires=${fmtTs(expiresAt)}` : ''
            ])
          ]),
          el('div', { class: 'row__spacer' }, []),
          id
            ? el(
                'button',
                {
                  class: 'button button--danger',
                  type: 'button',
                  onclick: () => onInviteRevoke?.(id)
                },
                ['Revoke']
              )
            : null
        ])
      ]);
    })
  );

  return el('div', { class: 'card' }, [
    el('div', { class: 'card__title' }, ['Team']),
    el('div', { class: 'small' }, ['Invite teammates and manage roles.']),
    el('div', { class: 'divider' }, []),
    el('div', { class: 'row' }, [
      inviteEmailInput,
      inviteRoleSelect,
      el(
        'button',
        {
          class: 'button button--primary',
          type: 'button',
          onclick: () => onInviteCreate?.({ email: inviteEmailInput.value.trim(), role: inviteRoleSelect.value })
        },
        ['Invite']
      )
    ]),
    membersStatus ? el('div', { class: 'small k' }, [membersStatus]) : null,
    membersList,
    el('div', { class: 'divider' }, []),
    invitesStatus ? el('div', { class: 'small k' }, [invitesStatus]) : null,
    invitesList
  ]);
}

export function renderSettingsPanel({ state, rootEl, onNavigate }) {
  clear(rootEl);
  const api = new ApiClient({ apiUrl: state.apiUrl, tenantId: state.tenantId, repoId: state.repoId, mode: state.mode, authToken: state.authToken });

  const headerEl = el('div', { class: 'card' }, [
    el('div', { class: 'row' }, [
      el('div', {}, [el('div', { class: 'card__title' }, ['Settings']), el('div', { class: 'small' }, ['Billing, integrations, and team management.'])]),
      el('div', { class: 'row__spacer' }, []),
      el('button', { class: 'button', type: 'button', id: 'settingsRefreshBtn' }, ['Refresh'])
    ])
  ]);

  const orgNameInput = el('input', { class: 'input', placeholder: 'Org display name' });
  const orgDocsRepoInput = el('input', { class: 'input', placeholder: 'Default docs repo (org/docs)' });
  const orgStatusEl = el('div', { class: 'small' }, ['Loading…']);

  const orgCardEl = el('div', { class: 'card' }, [
    el('div', { class: 'card__title' }, ['Organization']),
    orgStatusEl,
    el('div', { class: 'divider' }, []),
    el('div', { class: 'small k' }, ['Display name']),
    orgNameInput,
    el('div', { class: 'small k' }, ['Default docs repo (applies to new projects)']),
    orgDocsRepoInput,
    el('div', { class: 'row' }, [
      el(
        'button',
        {
          class: 'button button--primary',
          type: 'button',
          id: 'orgSaveBtn'
        },
        ['Save']
      )
    ])
  ]);

  let latestBillingSummary = null;
  let latestBillingUsage = null;
  const billingMountEl = el('div', {}, [renderBillingCard({ summary: null, usage: null, statusText: 'Loading…' })]);

  let members = [];
  let invites = [];
  let membersStatus = 'Loading…';
  let invitesStatus = 'Loading…';
  const teamMountEl = el('div', {}, [renderTeamCard({ members: [], invites: [], membersStatus, invitesStatus })]);

  const mountEl = el('div', { class: 'stack' }, [
    headerEl,
    renderProjectCard({
      state,
      onVerifyDocsRepo: async (docsRepoFullName) => {
        try {
          const out = await api.verifyDocsRepo({ docsRepoFullName: docsRepoFullName ?? null });
          const ok = Boolean(out?.ok);
          state.toast?.toast?.({
            kind: ok ? 'ok' : 'warn',
            title: ok ? 'Verified' : 'Not verified',
            message: ok ? `Docs repo: ${out?.repo?.fullName ?? docsRepoFullName ?? '—'}` : String(out?.message ?? out?.error ?? 'verify failed')
          });
        } catch (e) {
          state.toast?.toast?.({ kind: 'error', title: 'Verify failed', message: String(e?.message ?? e) });
        }
      }
    }),
    orgCardEl,
    billingMountEl,
    teamMountEl
  ]);

  rootEl.appendChild(mountEl);

  let cancelled = false;
  let token = 0;

  function renderBilling() {
    billingMountEl.innerHTML = '';
    const statusText =
      latestBillingSummary?.status || latestBillingUsage?.plan
        ? `status=${latestBillingSummary?.status ?? '—'}`
        : 'Billing info unavailable in this environment.';
    billingMountEl.appendChild(
      renderBillingCard({
        summary: latestBillingSummary,
        usage: latestBillingUsage,
        statusText,
        onCheckout: async (plan) => {
          try {
            const out = await api.billingCheckout({ plan });
            const url = out?.url ?? out?.checkoutUrl ?? null;
            if (!url) throw new Error('missing_checkout_url');
            window.open(String(url), '_blank', 'noopener,noreferrer');
          } catch (e) {
            state.toast?.toast?.({ kind: 'error', title: 'Upgrade failed', message: String(e?.message ?? e) });
          }
        },
        onPortal: async () => {
          try {
            const out = await api.billingPortal();
            const url = out?.url ?? out?.portalUrl ?? null;
            if (!url) throw new Error('missing_portal_url');
            window.open(String(url), '_blank', 'noopener,noreferrer');
          } catch (e) {
            state.toast?.toast?.({ kind: 'error', title: 'Portal failed', message: String(e?.message ?? e) });
          }
        }
      })
    );
  }

  function renderTeam() {
    teamMountEl.innerHTML = '';
    teamMountEl.appendChild(
      renderTeamCard({
        members,
        invites,
        membersStatus,
        invitesStatus,
        onInviteCreate: async ({ email, role }) => {
          if (!email) {
            state.toast?.toast?.({ kind: 'warn', title: 'Missing email', message: 'Enter an email to invite.' });
            return;
          }
          try {
            const out = await api.createOrgInvite({ email, role });
            const acceptUrl = out?.acceptUrl ?? null;
            if (acceptUrl) {
              const copied = await copyToClipboard(acceptUrl);
              state.toast?.toast?.({
                kind: 'ok',
                title: 'Invite created',
                message: copied ? 'Accept link copied to clipboard.' : acceptUrl
              });
            } else {
              state.toast?.toast?.({ kind: 'ok', title: 'Invite created', message: 'Invite created.' });
            }
            await loadTeam();
          } catch (e) {
            state.toast?.toast?.({ kind: 'error', title: 'Invite failed', message: String(e?.message ?? e) });
          }
        },
        onInviteRevoke: async (inviteId) => {
          try {
            await api.revokeOrgInvite({ inviteId });
            state.toast?.toast?.({ kind: 'ok', title: 'Invite revoked', message: String(inviteId).slice(0, 8) });
            await loadTeam();
          } catch (e) {
            state.toast?.toast?.({ kind: 'error', title: 'Revoke failed', message: String(e?.message ?? e) });
          }
        }
      })
    );
  }

  async function loadOrg() {
    const out = await api.getCurrentOrg();
    state.shell.org = out ?? null;
    const name = out?.displayName ?? '';
    orgNameInput.value = name;
    orgDocsRepoInput.value = out?.docsRepoFullName ?? '';
    orgStatusEl.textContent = `tenant=${out?.id ?? state.tenantId} • plan=${out?.plan ?? '—'} • reader=${out?.githubReaderInstallId ?? '—'} • docs=${out?.githubDocsInstallId ?? '—'}`;
  }

  async function loadBilling() {
    latestBillingSummary = await api.billingSummary();
    latestBillingUsage = await api.billingUsage();
    renderBilling();
  }

  async function loadTeam() {
    try {
      const out = await api.listOrgMembers();
      members = Array.isArray(out?.members) ? out.members : [];
      membersStatus = members.length ? '' : 'No members (or you may not have access).';
    } catch (e) {
      members = [];
      membersStatus = `Members unavailable: ${String(e?.message ?? e)}`;
    }
    try {
      const out = await api.listOrgInvites();
      invites = Array.isArray(out?.invites) ? out.invites : [];
      invitesStatus = invites.length ? '' : 'No invites.';
    } catch (e) {
      invites = [];
      invitesStatus = `Invites unavailable: ${String(e?.message ?? e)}`;
    }
    renderTeam();
  }

  async function loadAll() {
    const t = ++token;
    orgStatusEl.textContent = 'Loading…';
    latestBillingSummary = null;
    latestBillingUsage = null;
    members = [];
    invites = [];
    membersStatus = 'Loading…';
    invitesStatus = 'Loading…';
    renderBilling();
    renderTeam();
    try {
      await loadOrg();
      if (cancelled || t !== token) return;
    } catch (e) {
      if (cancelled || t !== token) return;
      orgStatusEl.textContent = `Org unavailable: ${String(e?.message ?? e)}`;
    }
    try {
      await loadBilling();
    } catch (e) {
      latestBillingSummary = null;
      latestBillingUsage = null;
      renderBilling();
    }
    await loadTeam();
  }

  orgCardEl.querySelector('#orgSaveBtn')?.addEventListener('click', async () => {
    try {
      await api.updateCurrentOrg({
        displayName: orgNameInput.value.trim() || null,
        docsRepoFullName: orgDocsRepoInput.value.trim() || null
      });
      await loadAll();
      onNavigate?.({ kind: 'settings_saved' });
      state.toast?.toast?.({ kind: 'ok', title: 'Saved', message: 'Organization settings updated.' });
    } catch (e) {
      state.toast?.toast?.({ kind: 'error', title: 'Save failed', message: String(e?.message ?? e) });
    }
  });

  headerEl.querySelector('#settingsRefreshBtn')?.addEventListener('click', () => loadAll());

  loadAll();

  return () => {
    cancelled = true;
  };
}
