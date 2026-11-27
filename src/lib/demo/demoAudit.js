import { getDemoCurrentUserId } from './demoStore.js';

/**
 * @param {import('../../types/kord.d.ts').DemoState} draft
 * @param {{
 *   actorId?: string | null;
 *   action: string;
 *   targetTable: string;
 *   targetId?: string;
 *   beforeData?: unknown;
 *   afterData?: unknown;
 * }} entry
 */
export function appendDemoAuditLog(
  draft,
  {
    actorId = null,
    action,
    targetTable,
    targetId = '',
    beforeData = null,
    afterData = null,
  }
) {
  if (!draft || !action || !targetTable) return;
  const resolvedActorId = actorId || getDemoCurrentUserId() || null;
  const actor = resolvedActorId
    ? (draft.users || []).find((u) => u.id === resolvedActorId) || null
    : null;

  draft.adminAuditLogs = draft.adminAuditLogs || [];
  draft.adminAuditLogs.unshift({
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    actorId: resolvedActorId,
    actorRole: actor?.role || null,
    actorEmail: actor?.email || null,
    action,
    targetTable,
    targetId: String(targetId || ''),
    beforeData,
    afterData,
    createdAt: new Date().toISOString(),
  });
  if (draft.adminAuditLogs.length > 500) {
    draft.adminAuditLogs.length = 500;
  }
}
