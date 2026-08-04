import {
  pgTable, text, integer, boolean, timestamp, jsonb, primaryKey, index, uniqueIndex, bigserial, serial, date,
} from 'drizzle-orm/pg-core';

/* =========================================================================
 * REFERENCE / ADMIN TABLES — direct ports of Code.gs's HEADERS.* sheets.
 * Column names match the original snake_case sheet headers so the meaning
 * of every field can be cross-checked against app/Code.gs during migration.
 * ========================================================================= */

export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value'),
  description: text('description'),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  updatedBy: text('updated_by'),
});

export const fmsMaster = pgTable('fms_master', {
  fmsId: text('fms_id').primaryKey(),
  fmsName: text('fms_name').notNull(),
  shortName: text('short_name'),
  spreadsheetId: text('spreadsheet_id').notNull(),
  spreadsheetUrl: text('spreadsheet_url'),
  dataSheetName: text('data_sheet_name'),
  stepDirectorySheetName: text('step_directory_sheet_name'),
  headerRow: integer('header_row').default(1),
  dataStartRow: integer('data_start_row').default(2),
  uniqueIdHeader: text('unique_id_header'),
  displayNameHeader: text('display_name_header'),
  timestampHeader: text('timestamp_header'),
  active: boolean('active').default(true),
  sortOrder: integer('sort_order').default(0),
  category: text('category'),
  ownerName: text('owner_name'),
  ownerEmail: text('owner_email'),
  // Every currently-connected FMS runs FMS_Status_Publisher.gs (app/FMS_Status_Publisher.gs,
  // unchanged by this migration) — statusCacheSheetName is where the sync job reads from.
  // A non-distributed FMS (none connected today, but the schema stays generic per REBUILD_PLAN
  // principle #1) has statusCacheSheetName null and is out of scope for the sync job until one
  // exists — see packages/sync.
  statusCacheSheetName: text('status_cache_sheet_name').default('Status_Cache'),
  lastSuccessfulSync: timestamp('last_successful_sync', { withTimezone: true }),
  lastSyncStatus: text('last_sync_status'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  createdBy: text('created_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  updatedBy: text('updated_by'),
  isDeleted: boolean('is_deleted').default(false),
});

export const roles = pgTable('roles', {
  roleId: text('role_id').primaryKey(),
  roleName: text('role_name').notNull(),
  // Matches Code.gs's permissions_json shape: { 'dashboard.view': true, ... } — one boolean per
  // entry in the PERMISSIONS array (see packages/core/src/permissions.ts).
  permissions: jsonb('permissions').notNull(),
  status: text('status').default('ACTIVE'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  isDeleted: boolean('is_deleted').default(false),
});

export const users = pgTable('users', {
  userId: text('user_id').primaryKey(),
  username: text('username').notNull(),
  passwordHash: text('password_hash').notNull(),
  passwordSalt: text('password_salt').notNull(),
  fullName: text('full_name'),
  email: text('email'),
  roleId: text('role_id').notNull().references(() => roles.roleId),
  status: text('status').default('ACTIVE'),
  profileImageUrl: text('profile_image_url'),
  lastLogin: timestamp('last_login', { withTimezone: true }),
  failedAttempts: integer('failed_attempts').default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  mustChangePassword: boolean('must_change_password').default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  createdBy: text('created_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  updatedBy: text('updated_by'),
  isDeleted: boolean('is_deleted').default(false),
}, (t) => ({
  usernameUnique: uniqueIndex('idx_users_username').on(t.username),
}));

export const sessions = pgTable('sessions', {
  sessionId: text('session_id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.userId),
  username: text('username').notNull(),
  roleId: text('role_id').notNull(),
  // sha256 of the opaque bearer token, exactly like Code.gs's sha256Hex_(token) — the raw token
  // itself is never stored, only ever returned once to the client at login (see plan: DB-backed
  // opaque token, not JWT, so a role/permission edit or logout takes effect on the very next
  // request instead of waiting out a JWT's expiry).
  tokenHash: text('token_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  lastSeen: timestamp('last_seen', { withTimezone: true }).defaultNow(),
  ipHint: text('ip_hint'),
  userAgent: text('user_agent'),
  revoked: boolean('revoked').default(false),
}, (t) => ({
  tokenHashUnique: uniqueIndex('idx_sessions_token_hash').on(t.tokenHash),
  userRevokedIdx: index('idx_sessions_user_revoked').on(t.userId, t.revoked),
}));

/* =========================================================================
 * HOT-PATH TABLES — the actual fix for slow filtering (see plan §"Database schema").
 * Populated by packages/sync from each FMS's own Status_Cache sheet; never written to by the
 * API layer directly.
 * ========================================================================= */

export const records = pgTable('records', {
  fmsId: text('fms_id').notNull(),
  recordId: text('record_id').notNull(),
  rawRow: integer('raw_row'),
  displayName: text('display_name'),
  currentStage: text('current_stage'),
  doer: text('doer'),
  doerEmail: text('doer_email'),
  planTime: timestamp('plan_time', { withTimezone: true }),
  recordStatus: text('record_status').notNull(),
  delay: jsonb('delay'),
  completedSteps: integer('completed_steps').default(0),
  totalSteps: integer('total_steps').default(0),
  lastUpdate: timestamp('last_update', { withTimezone: true }),
  freshness: text('freshness'),
  sequenceException: boolean('sequence_exception').default(false),
  isClosed: boolean('is_closed').default(false),
  isArchived: boolean('is_archived').default(false),
  syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.fmsId, t.recordId] }),
  statusIdx: index('idx_records_fms_status').on(t.fmsId, t.recordStatus),
  freshnessIdx: index('idx_records_fms_freshness').on(t.fmsId, t.freshness),
  doerIdx: index('idx_records_fms_doer').on(t.fmsId, t.doer),
  stageIdx: index('idx_records_fms_stage').on(t.fmsId, t.currentStage),
  planTimeIdx: index('idx_records_plan_time').on(t.fmsId, t.planTime),
  // Trigram search index (pg_trgm extension — see packages/db/src/migrations) replacing the JS
  // substring search across displayName/recordId/doer in Code.gs's getLiveRecords. Created via
  // raw SQL in the migration (Drizzle doesn't have first-class gin_trgm_ops syntax) — see
  // 0001_extensions_and_trgm.sql.
}));

export const stageEvents = pgTable('stage_events', {
  fmsId: text('fms_id').notNull(),
  recordId: text('record_id').notNull(),
  stageIndex: integer('stage_index').notNull(),
  stageName: text('stage_name').notNull(),
  doerName: text('doer_name'),
  doerEmail: text('doer_email'),
  status: text('status').notNull(),
  planTime: timestamp('plan_time', { withTimezone: true }),
  actualTime: timestamp('actual_time', { withTimezone: true }),
  varianceMinutes: integer('variance_minutes'),
}, (t) => ({
  pk: primaryKey({ columns: [t.fmsId, t.recordId, t.stageIndex] }),
  stageIdx: index('idx_stage_events_stage').on(t.fmsId, t.stageName, t.actualTime),
  doerIdx: index('idx_stage_events_doer').on(t.fmsId, t.doerName, t.actualTime),
  statusIdx: index('idx_stage_events_status').on(t.status),
}));

/* =========================================================================
 * MATERIALIZED ROLLUPS — refreshed by packages/sync every run, mirrors today's FMS_Eval_Cache.
 * ========================================================================= */

export const fmsEvalCache = pgTable('fms_eval_cache', {
  fmsId: text('fms_id').primaryKey(),
  computedAt: timestamp('computed_at', { withTimezone: true }),
  totals: jsonb('totals'),
  scores: jsonb('scores'),
  stageBottlenecks: jsonb('stage_bottlenecks'),
  doerBottlenecks: jsonb('doer_bottlenecks'),
  criticalSample: jsonb('critical_sample'),
  completedToday: integer('completed_today').default(0),
});

export const dashboardKpis = pgTable('dashboard_kpis', {
  id: integer('id').primaryKey().default(1),
  computedAt: timestamp('computed_at', { withTimezone: true }),
  totals: jsonb('totals'),
  fmsSummaries: jsonb('fms_summaries'),
});

/* =========================================================================
 * OPERATIONAL TABLES — direct ports, built out in M4/M5 but declared now so the schema is whole.
 * ========================================================================= */

export const actionItems = pgTable('action_items', {
  actionId: text('action_id').primaryKey(),
  fmsId: text('fms_id'),
  recordId: text('record_id'),
  recordDisplay: text('record_display'),
  stageName: text('stage_name'),
  actionType: text('action_type').notNull(),
  priority: text('priority').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  assignedTo: text('assigned_to'),
  assignedEmail: text('assigned_email'),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  dueAt: timestamp('due_at', { withTimezone: true }),
  status: text('status').default('Open'),
  resolvedBy: text('resolved_by'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolution: text('resolution'),
  lastCommentAt: timestamp('last_comment_at', { withTimezone: true }),
  isDeleted: boolean('is_deleted').default(false),
}, (t) => ({
  statusIdx: index('idx_action_items_status').on(t.status),
  assignedIdx: index('idx_action_items_assigned').on(t.assignedTo),
  recordIdx: index('idx_action_items_record').on(t.fmsId, t.recordId),
  dueIdx: index('idx_action_items_due').on(t.dueAt),
}));

export const actionComments = pgTable('action_comments', {
  commentId: text('comment_id').primaryKey(),
  actionId: text('action_id').notNull().references(() => actionItems.actionId),
  comment: text('comment').notNull(),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  isDeleted: boolean('is_deleted').default(false),
});

export const escalationRules = pgTable('escalation_rules', {
  ruleId: text('rule_id').primaryKey(),
  ruleName: text('rule_name'),
  fmsId: text('fms_id'),
  stageName: text('stage_name'),
  delayMinutes: integer('delay_minutes'),
  priority: text('priority'),
  escalateTo: text('escalate_to'),
  escalateEmail: text('escalate_email'),
  active: boolean('active').default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  isDeleted: boolean('is_deleted').default(false),
});

export const auditLog = pgTable('audit_log', {
  logId: bigserial('log_id', { mode: 'number' }).primaryKey(),
  timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow(),
  username: text('username'),
  role: text('role'),
  action: text('action'),
  module: text('module'),
  recordId: text('record_id'),
  details: jsonb('details'),
  success: boolean('success').default(true),
  errorMessage: text('error_message'),
}, (t) => ({
  tsIdx: index('idx_audit_log_timestamp').on(t.timestamp),
  usernameIdx: index('idx_audit_log_username').on(t.username),
}));

export const reportSnapshots = pgTable('report_snapshots', {
  snapshotId: text('snapshot_id').primaryKey(),
  snapshotDate: date('snapshot_date').notNull(),
  snapshotType: text('snapshot_type').notNull(),
  fmsId: text('fms_id').notNull(),
  metrics: jsonb('metrics'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  createdBy: text('created_by'),
}, (t) => ({
  uniq: uniqueIndex('idx_report_snapshots_unique').on(t.snapshotDate, t.snapshotType, t.fmsId),
}));

export const userPreferences = pgTable('user_preferences', {
  userId: text('user_id').primaryKey().references(() => users.userId),
  theme: text('theme').default('light'),
  accent: text('accent').default('ocean'),
  sidebarCollapsed: boolean('sidebar_collapsed').default(false),
  defaultFmsId: text('default_fms_id'),
  defaultDateRange: text('default_date_range'),
  tourCompleted: boolean('tour_completed').default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const syncLog = pgTable('sync_log', {
  syncId: bigserial('sync_id', { mode: 'number' }).primaryKey(),
  fmsId: text('fms_id').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  status: text('status').notNull(),
  rowsRead: integer('rows_read').default(0),
  durationMs: integer('duration_ms'),
  errorMessage: text('error_message'),
  triggeredBy: text('triggered_by').default('sync-job'),
}, (t) => ({
  fmsIdx: index('idx_sync_log_fms').on(t.fmsId, t.startedAt),
}));

export const dataHealthCache = pgTable('data_health_cache', {
  id: integer('id').primaryKey().default(1),
  checkedAt: timestamp('checked_at', { withTimezone: true }),
  issueCount: integer('issue_count').default(0),
  issues: jsonb('issues'),
});
