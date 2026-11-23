import {
  adminListUsers,
  adminSetAccountStatus,
  adminListAuditLogs,
} from '../../lib/repositories/authRepository.js';
import { escapeHtml, formatDateTime } from '../../lib/formatters.js';
import { registerSessionCleanup } from '../../lib/sessionLifecycle.js';
import { renderAdminLayout } from '../../components/AdminLayout.js';
import { renderStatusBadge, renderEmptyState } from '../../components/Common.js';
import { showToast } from '../../components/Toast.js';

let activeGovTab = 'users'; // 'users' | 'audit'
let userStatusFilter = 'all';
let userSearchQuery = '';
let auditTableFilter = 'all';
let auditReasonNote = '';

registerSessionCleanup(() => {
  activeGovTab = 'users';
  userStatusFilter = 'all';
  userSearchQuery = '';
  auditTableFilter = 'all';
  auditReasonNote = '';
});

function formatAuditDiff(obj) {
  if (!obj || typeof obj !== 'object') return '—';
  const entries = Object.entries(obj);
  if (entries.length === 0) return '—';
  return entries
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ');
}

export async function renderAdminGovernancePage({ currentPath, session, rerender }) {
  const [users, auditLogs] = await Promise.all([
    adminListUsers(),
    adminListAuditLogs({ limit: 120 }),
  ]);

  const cleanSearch = userSearchQuery.trim().toLowerCase();
  const filteredUsers = users.filter((u) => {
    if (userStatusFilter !== 'all' && u.accountStatus !== userStatusFilter) return false;
    if (
      cleanSearch &&
      !u.email.toLowerCase().includes(cleanSearch) &&
      !String(u.fullName || '').toLowerCase().includes(cleanSearch)
    ) {
      return false;
    }
    return true;
  });

  const auditTables = Array.from(new Set(auditLogs.map((l) => l.targetTable).filter(Boolean))).sort();
  const filteredLogs = auditLogs.filter((l) =>
    auditTableFilter === 'all' ? true : l.targetTable === auditTableFilter
  );

  const suspendedCount = users.filter((u) => u.accountStatus === 'suspended').length;
  const adminCount = users.filter((u) => u.role === 'admin').length;

  const innerHtml = `
    <div class="page-header">
      <div>
        <h1 class="page-title">User Governance &amp; Audit History</h1>
        <p class="page-subtitle">Manage account access status and inspect immutable administrative audit records.</p>
      </div>

      <div class="segmented" role="tablist">
        <button type="button" class="segmented-btn ${activeGovTab === 'users' ? 'is-active' : ''}" data-gov-tab="users">
          Accounts (${users.length})
        </button>
        <button type="button" class="segmented-btn ${activeGovTab === 'audit' ? 'is-active' : ''}" data-gov-tab="audit">
          Audit Logs (${auditLogs.length})
        </button>
      </div>
    </div>

    <div class="kpi-strip" style="margin-bottom:20px;">
      <div class="kpi-box">
        <div class="kpi-label">Registered accounts</div>
        <div class="kpi-value mono-num">${users.length}</div>
        <div class="kpi-meta">${adminCount} administrators · ${users.length - adminCount} learners</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">Suspended accounts</div>
        <div class="kpi-value mono-num">${suspendedCount}</div>
        <div class="kpi-meta">Blocked from sign-in and learner mutations</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">Audit events captured</div>
        <div class="kpi-value mono-num">${auditLogs.length}</div>
        <div class="kpi-meta">Immutable append-only operational history</div>
      </div>
    </div>

    ${
      activeGovTab === 'users'
        ? `
      <div class="card" style="margin-bottom:18px;">
        <div class="lab-grid-3">
          <div class="field">
            <label class="field-label" for="gov-user-search">Search accounts</label>
            <input class="input" id="gov-user-search" type="search" value="${escapeHtml(userSearchQuery)}" placeholder="Filter by name or email…" />
          </div>
          <div class="field">
            <label class="field-label" for="gov-status-filter">Account status</label>
            <select class="select" id="gov-status-filter">
              <option value="all" ${userStatusFilter === 'all' ? 'selected' : ''}>All statuses (${users.length})</option>
              <option value="active" ${userStatusFilter === 'active' ? 'selected' : ''}>Active (${users.length - suspendedCount})</option>
              <option value="suspended" ${userStatusFilter === 'suspended' ? 'selected' : ''}>Suspended (${suspendedCount})</option>
            </select>
          </div>
          <div class="field">
            <label class="field-label" for="gov-reason-note">Audit reason note (optional)</label>
            <input class="input" id="gov-reason-note" value="${escapeHtml(auditReasonNote)}" placeholder="e.g. Policy review hold or reinstated" />
          </div>
        </div>
      </div>

      ${
        filteredUsers.length === 0
          ? renderEmptyState({
              title: 'No matching accounts',
              message: 'Adjust your search query or account status filter.',
            })
          : `
        <section class="card">
          <div class="divider-list">
            ${filteredUsers
              .map((u) => {
                const isSelf = u.id === session?.user?.id;
                const isAdminAccount = u.role === 'admin';
                const nextStatus = u.accountStatus === 'suspended' ? 'active' : 'suspended';
                const locked = isSelf || isAdminAccount;
                return `
                  <div class="divider-row" style="align-items:center; flex-wrap:wrap; gap:12px;">
                    <div style="flex:1; min-width:220px;">
                      <div style="font-weight:700; color:var(--color-navy);">${escapeHtml(u.fullName || u.email)}</div>
                      <div class="meta-line" style="margin-top:2px;">
                        <span>${escapeHtml(u.email)}</span>
                        <span class="meta-sep">·</span>
                        <span>Role: ${escapeHtml(u.role)}</span>
                        ${u.createdAt ? `<span class="meta-sep">·</span><span>Joined ${formatDateTime(u.createdAt)}</span>` : ''}
                      </div>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                      ${renderStatusBadge(u.accountStatus === 'suspended' ? 'suspended' : 'active')}
                      ${
                        locked
                          ? `<span style="font-size:12px; color:var(--color-text-muted);">${isSelf ? 'Current session (protected)' : 'Admin role (service-role managed)'}</span>`
                          : `<button type="button" class="btn ${nextStatus === 'suspended' ? 'btn-danger' : 'btn-primary'} btn-sm" data-set-user-status="${escapeHtml(u.id)}" data-next-status="${nextStatus}">
                              ${nextStatus === 'suspended' ? 'Suspend account' : 'Reactivate account'}
                            </button>`
                      }
                    </div>
                  </div>
                `;
              })
              .join('')}
          </div>
        </section>
      `
      }
    `
        : `
      <div class="card" style="margin-bottom:18px;">
        <div class="lab-grid-2">
          <div class="field">
            <label class="field-label" for="audit-table-filter">Filter by target table</label>
            <select class="select" id="audit-table-filter">
              <option value="all" ${auditTableFilter === 'all' ? 'selected' : ''}>All tables (${auditLogs.length})</option>
              ${auditTables
                .map(
                  (tbl) => `<option value="${escapeHtml(tbl)}" ${auditTableFilter === tbl ? 'selected' : ''}>${escapeHtml(tbl)}</option>`
                )
                .join('')}
            </select>
          </div>
          <div style="display:flex; align-items:flex-end; font-size:13px; color:var(--color-text-secondary);">
            Audit rows cannot be modified or deleted via authenticated sessions.
          </div>
        </div>
      </div>

      ${
        filteredLogs.length === 0
          ? renderEmptyState({
              title: 'No audit events recorded yet',
              message: 'Administrative actions on accounts, courses, assessments, and submissions appear here automatically.',
            })
          : `
        <section class="card">
          <div class="divider-list">
            ${filteredLogs
              .map(
                (log) => `
              <div class="divider-row" style="flex-direction:column; align-items:stretch; gap:6px;">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
                  <div style="font-weight:700; color:var(--color-navy);">
                    ${escapeHtml(log.action)} <span style="font-weight:500; color:var(--color-text-secondary);">on ${escapeHtml(log.targetTable)} (${escapeHtml(log.targetId || '—')})</span>
                  </div>
                  <span style="font-size:12px; color:var(--color-text-muted);">${formatDateTime(log.createdAt)}</span>
                </div>
                <div class="meta-line" style="font-size:12.5px;">
                  <span>Actor role: ${escapeHtml(log.actorRole || 'service_role')}</span>
                  ${log.actorId ? `<span class="meta-sep">·</span><span class="mono-num">Actor ID: ${escapeHtml(log.actorId)}</span>` : ''}
                </div>
                ${
                  log.beforeData || log.afterData
                    ? `<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:8px; font-size:12px; padding:8px 10px; background:var(--color-bg); border:1px solid var(--color-border); border-radius:6px;">
                        <div><strong>Before:</strong> ${escapeHtml(formatAuditDiff(log.beforeData))}</div>
                        <div><strong>After:</strong> ${escapeHtml(formatAuditDiff(log.afterData))}</div>
                      </div>`
                    : ''
                }
              </div>
            `
              )
              .join('')}
          </div>
        </section>
      `
      }
    `
    }
  `;

  return {
    html: renderAdminLayout({ currentPath, innerHtml }),
    bind(root) {
      root.querySelectorAll('[data-gov-tab]').forEach((btn) => {
        btn.addEventListener('click', () => {
          activeGovTab = btn.dataset.govTab;
          rerender({ silent: true });
        });
      });

      root.querySelector('#gov-user-search')?.addEventListener('input', (e) => {
        userSearchQuery = e.target.value;
        rerender({ silent: true });
      });

      root.querySelector('#gov-status-filter')?.addEventListener('change', (e) => {
        userStatusFilter = e.target.value;
        rerender({ silent: true });
      });

      root.querySelector('#gov-reason-note')?.addEventListener('input', (e) => {
        auditReasonNote = e.target.value;
      });

      root.querySelector('#audit-table-filter')?.addEventListener('change', (e) => {
        auditTableFilter = e.target.value;
        rerender({ silent: true });
      });

      root.querySelectorAll('[data-set-user-status]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (btn.disabled) return;
          const targetUserId = btn.dataset.setUserStatus;
          const newStatus = btn.dataset.nextStatus;
          btn.disabled = true;
          try {
            await adminSetAccountStatus({
              targetUserId,
              newStatus,
              reason: auditReasonNote,
              actorId: session?.user?.id || null,
            });
            auditReasonNote = '';
            showToast(
              newStatus === 'suspended' ? 'Account suspended and logged.' : 'Account reactivated and logged.',
              'success'
            );
            rerender({ silent: true });
          } catch (err) {
            btn.disabled = false;
            showToast(err?.message || 'Unable to update account status.', 'error');
          }
        });
      });
    },
  };
}
