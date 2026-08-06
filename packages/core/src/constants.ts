// Ported 1:1 from app/Code.gs (STATUS, SCORING, PERMISSIONS, ROLE_SEED) — see REBUILD_PLAN.md
// principle #2 (one source of truth per concern): these values must never drift from what
// FMS_Status_Publisher.gs writes into each FMS's own Status_Cache sheet.

export const STATUS = {
  STAGE: {
    NOT_STARTED: 'NOT_STARTED', PLANNED: 'PLANNED', OVERDUE: 'OVERDUE', COMPLETED_EARLY: 'COMPLETED_EARLY',
    COMPLETED_ON_TIME: 'COMPLETED_ON_TIME', COMPLETED_LATE: 'COMPLETED_LATE',
    UNPLANNED_COMPLETED: 'UNPLANNED_COMPLETED', DATA_EXCEPTION: 'DATA_EXCEPTION',
    SEQUENCE_EXCEPTION: 'SEQUENCE_EXCEPTION', SKIPPED: 'SKIPPED', STALLED: 'STALLED',
  },
  RECORD: {
    NOT_STARTED: 'NOT_STARTED', RUNNING_ON_TIME: 'RUNNING_ON_TIME', AT_RISK: 'AT_RISK', OVERDUE: 'OVERDUE',
    COMPLETED_ON_TIME: 'COMPLETED_ON_TIME', COMPLETED_LATE: 'COMPLETED_LATE', DATA_EXCEPTION: 'DATA_EXCEPTION',
    STALLED: 'STALLED',
  },
  FRESHNESS: { FRESH: 'Fresh', WARNING: 'Warning', STALE: 'Stale', CRITICAL: 'Critical', NEVER: 'Never' },
} as const;

export const SCORING = {
  FMS_WEIGHTS: { timeliness: 0.50, pendingHealth: 0.25, dataQuality: 0.15, freshness: 0.10 },
  DOER_WEIGHTS: { timeliness: 0.60, pendingHealth: 0.25, freshness: 0.15 },
} as const;

// Pending statuses that count toward totalPending/pendingNotOverdue in computeAggregates — STALLED
// is weighted the same as OVERDUE everywhere (same real urgency: a record with no deadline that's
// sat untouched too long is just as urgent as one that missed an existing deadline).
export const PENDING_RECORD_STATUSES: readonly string[] = [
  STATUS.RECORD.NOT_STARTED, STATUS.RECORD.RUNNING_ON_TIME, STATUS.RECORD.AT_RISK,
  STATUS.RECORD.OVERDUE, STATUS.RECORD.STALLED,
];

export const ACTION_TYPES = ['Follow-up', 'Correction', 'Escalation', 'Review', 'Data Update', 'Management Decision', 'Other'] as const;
export const ACTION_STATUSES = ['Open', 'In Progress', 'Waiting', 'Resolved', 'Cancelled'] as const;
export const ACTION_PRIORITIES = ['Low', 'Medium', 'High', 'Critical'] as const;

export const PERMISSIONS = [
  'dashboard.view', 'fms.view', 'fms.manage', 'records.view', 'actions.view', 'actions.add', 'actions.edit',
  'actions.close', 'actions.delete', 'reports.view', 'reports.export', 'users.view', 'users.add',
  'users.edit', 'users.delete', 'roles.view', 'roles.edit', 'settings.view', 'settings.edit', 'audit.view',
  'sync.run', 'ai.chat',
] as const;

export type Permission = typeof PERMISSIONS[number];
export type PermissionMap = Partial<Record<Permission, boolean>>;

function allTrue(): PermissionMap {
  return Object.fromEntries(PERMISSIONS.map((p) => [p, true])) as PermissionMap;
}

export const ROLE_SEED: Record<string, PermissionMap> = {
  SUPER_ADMIN: allTrue(),
  MANAGEMENT: {
    'dashboard.view': true, 'fms.view': true, 'fms.manage': false, 'records.view': true, 'actions.view': true,
    'actions.add': true, 'actions.edit': true, 'actions.close': true, 'actions.delete': false,
    'reports.view': true, 'reports.export': true, 'users.view': false, 'users.add': false, 'users.edit': false,
    'users.delete': false, 'roles.view': false, 'roles.edit': false, 'settings.view': true,
    'settings.edit': false, 'audit.view': true, 'sync.run': true,
  },
  HOD: {
    'dashboard.view': true, 'fms.view': true, 'fms.manage': false, 'records.view': true, 'actions.view': true,
    'actions.add': true, 'actions.edit': true, 'actions.close': true, 'actions.delete': false,
    'reports.view': true, 'reports.export': true, 'users.view': false, 'users.add': false, 'users.edit': false,
    'users.delete': false, 'roles.view': false, 'roles.edit': false, 'settings.view': false,
    'settings.edit': false, 'audit.view': false, 'sync.run': false,
  },
  VIEWER: {
    'dashboard.view': true, 'fms.view': true, 'fms.manage': false, 'records.view': true, 'actions.view': true,
    'actions.add': false, 'actions.edit': false, 'actions.close': false, 'actions.delete': false,
    'reports.view': true, 'reports.export': false, 'users.view': false, 'users.add': false, 'users.edit': false,
    'users.delete': false, 'roles.view': false, 'roles.edit': false, 'settings.view': false,
    'settings.edit': false, 'audit.view': false, 'sync.run': false,
  },
};
