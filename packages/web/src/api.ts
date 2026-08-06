// Replaces app/index.html's callOnce/call/api JSONP bridge (~lines 414-575) with a plain
// fetch()-based client hitting the new REST API — see plan §"Frontend (Cloudflare Pages)". A
// normal Cloudflare Pages page calling a normal REST API needs none of the JSONP/postMessage
// workarounds the old Apps Script transport required.
import { notifyCallStart, notifyCallEnd } from './loadingStore';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787';

export interface ApiOk<T> {
  ok: true;
  data: T;
  message: string;
  meta: { generatedAt: string; cached: boolean; [key: string]: unknown };
}
export interface ApiFail {
  ok: false;
  message: string;
  code: string;
}
export type ApiResponse<T> = ApiOk<T> | ApiFail;

export class ApiRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

async function request<T>(path: string, options: RequestInit = {}, token?: string | null): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(options.headers as Record<string, string> | undefined) };
  if (token) headers.Authorization = `Bearer ${token}`;

  notifyCallStart();
  try {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}${path}`, { ...options, headers });
    } catch (err) {
      // Real network failure (offline, DNS, CORS misconfiguration) — distinct from an application-
      // level ok:false response, which the server always returns with a real HTTP status instead.
      throw new ApiRequestError(err instanceof Error ? err.message : 'Network request failed.');
    }
    return (await res.json()) as ApiResponse<T>;
  } finally {
    notifyCallEnd();
  }
}

export interface LoginUser {
  userId: string;
  username: string;
  fullName: string | null;
  email: string | null;
  roleId: string;
  roleName: string;
  mustChangePassword: boolean;
  permissions: Record<string, boolean>;
}

export function login(username: string, password: string) {
  return request<{ token: string; user: LoginUser }>('/api/auth/login', {
    method: 'POST', body: JSON.stringify({ username, password }),
  });
}

export function logout(token: string) {
  return request<boolean>('/api/auth/logout', { method: 'POST' }, token);
}

export function changePassword(token: string, currentPassword: string | undefined, newPassword: string) {
  return request<boolean>('/api/auth/change-password', {
    method: 'POST', body: JSON.stringify({ currentPassword, newPassword }),
  }, token);
}

export function me(token: string) {
  return request<LoginUser>('/api/auth/me', {}, token);
}

export function updateMyAccount(token: string, payload: { fullName?: string; email?: string }) {
  return request<boolean>('/api/auth/me', { method: 'PATCH', body: JSON.stringify(payload) }, token);
}

export function requestPasswordReset(username: string) {
  return request<boolean>('/api/auth/request-password-reset', {
    method: 'POST', body: JSON.stringify({ username }),
  });
}

export interface FmsConfig {
  fmsId: string;
  fmsName: string;
  shortName: string | null;
  spreadsheetId: string;
  statusCacheSheetName: string | null;
  category: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  notes: string | null;
  lastSuccessfulSync: string | null;
  lastSyncStatus: string | null;
  active: boolean;
}

export function getFmsList(token: string) {
  return request<FmsConfig[]>('/api/fms', {}, token);
}

export interface SaveFmsPayload {
  fmsId?: string;
  fmsName: string;
  shortName?: string;
  spreadsheetId: string;
  statusCacheSheetName?: string;
  category?: string;
  ownerName?: string;
  ownerEmail?: string;
  notes?: string;
}

export function saveFmsConfig(token: string, payload: SaveFmsPayload) {
  return request<{ fmsId: string }>('/api/fms', { method: 'POST', body: JSON.stringify(payload) }, token);
}

export function setFmsActive(token: string, fmsId: string, active: boolean) {
  return request<boolean>(`/api/fms/${fmsId}/status`, { method: 'PATCH', body: JSON.stringify({ active }) }, token);
}

export interface RecordDelay {
  minutes: number;
  hours: number;
  days: number;
  human: string | null;
}

export interface RecordRow {
  fmsId: string;
  recordId: string;
  displayName: string | null;
  currentStage: string | null;
  doer: string | null;
  doerEmail: string | null;
  planTime: string | null;
  recordStatus: string;
  delay: RecordDelay | null;
  completedSteps: number | null;
  totalSteps: number | null;
  lastUpdate: string | null;
  freshness: string | null;
  sequenceException?: boolean | null;
  // Free-text business columns from the source sheet (order ID, customer name, amount, etc.) —
  // null/empty for an FMS still running an older FMS_Status_Publisher.gs that doesn't publish
  // these yet. Header-keyed, same shape the source sheet's own columns use.
  details?: Record<string, unknown> | null;
}

export interface RecordsQuery {
  fmsId?: string;
  status?: string;
  stage?: string;
  freshness?: string;
  doer?: string;
  search?: string;
  start?: number;
  length?: number;
}

export function getRecords(token: string, query: RecordsQuery) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  });
  return request<{ records: RecordRow[]; total: number; start: number; length: number }>(
    `/api/records?${params.toString()}`, {}, token,
  );
}

export interface StageEvent {
  fmsId: string;
  recordId: string;
  stageIndex: number;
  stageName: string;
  doerName: string | null;
  doerEmail: string | null;
  status: string;
  planTime: string | null;
  actualTime: string | null;
  varianceMinutes: number | null;
}

export function getRecordDetail(token: string, fmsId: string, recordId: string) {
  return request<{ record: RecordRow; stages: StageEvent[]; actions: ActionItem[] }>(
    `/api/records/${encodeURIComponent(fmsId)}/${encodeURIComponent(recordId)}`, {}, token,
  );
}

export interface DashboardKpi {
  totalActiveFms: number;
  totalActiveRecords: number;
  runningOnTime: number;
  atRisk: number;
  overdue: number;
  stalled: number;
  completedOnTime: number;
  completedLate: number;
  dataExceptions: number;
  staleRecords: number;
}

export interface FmsHealth {
  fmsId: string;
  fmsName: string;
  error: string | null;
  overallScore?: number | null;
  activeRecords?: number;
  overdueRecords?: number;
  atRiskRecords?: number;
  stalledRecords?: number;
  healthBadge: 'green' | 'amber' | 'red' | 'grey';
}

export interface DashboardFreshness {
  fresh: number;
  warning: number;
  stale: number;
  critical: number;
  never: number;
}

export interface NeedsAttentionEntry {
  fmsId: string;
  fmsName: string;
  recordId: string;
  displayName: string | null;
  currentStage: string | null;
  doer: string | null;
  planTime: string | null;
  delay: RecordDelay | null;
  lastUpdate: string | null;
  freshness: string;
  recordStatus: string;
}

export function getDashboard(token: string, fmsId?: string) {
  const params = fmsId ? `?fmsId=${encodeURIComponent(fmsId)}` : '';
  return request<{ kpi: DashboardKpi; fmsHealth: FmsHealth[]; freshness: DashboardFreshness; needsAttention: NeedsAttentionEntry[] }>(
    `/api/dashboard${params}`, {}, token,
  );
}

export function triggerSync(token: string) {
  return request<boolean>('/api/sync/trigger', { method: 'POST' }, token);
}

export interface UpdateHealthRow {
  fmsId: string;
  recordId: string;
  displayName: string | null;
  currentStage: string | null;
  doer: string | null;
  planTime: string | null;
  delay: RecordDelay | null;
  lastUpdate: string | null;
  freshness: string | null;
  openActions: number;
}

export interface UpdateHealthCards {
  updatedToday: number;
  warning: number;
  stale: number;
  critical: number;
  neverUpdated: number;
}

export interface UpdateHealthQuery {
  fmsId?: string;
  freshness?: string;
  todayOnly?: boolean;
  start?: number;
  length?: number;
}

export function getUpdateHealth(token: string, query: UpdateHealthQuery) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  });
  return request<{ rows: UpdateHealthRow[]; cards: UpdateHealthCards; rowsTotal: number; start: number; length: number }>(
    `/api/update-health?${params.toString()}`, {}, token,
  );
}

export interface BottleneckBucket {
  fmsId: string;
  fmsName: string;
  key: string;
  doerName: string;
  doerEmail: string;
  assigned: number;
  completed: number;
  onTime: number;
  late: number;
  pending: number;
  overdue: number;
  stalled: number;
  avgDelayMinutes: number | null;
  avgDelayHuman: string | null;
  maxDelayMinutes: number;
  maxDelayHuman: string | null;
  onTimePercent: number | null;
  dataExceptions: number;
  criticalStale: number;
  totalDelayDays: number;
  bottleneckScore: number;
  reason: string;
}

export interface BottleneckQuery {
  fmsId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export function getBottlenecks(token: string, query: BottleneckQuery) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  });
  return request<{ byStage: BottleneckBucket[]; byDoer: BottleneckBucket[]; formula: string }>(
    `/api/bottlenecks?${params.toString()}`, {}, token,
  );
}

export interface BottleneckDetailRow {
  fmsId: string;
  recordId: string;
  displayName: string | null;
  stageName: string;
  doerName: string | null;
  doerEmail: string | null;
  status: string;
  planTime: string | null;
  actualTime: string | null;
  varianceMinutes: number | null;
}

// Drill-down for a bucket's count cells (e.g. "4 overdue") — queries stage_events directly
// rather than Live Records, since a bucket's counts are per-stage-event, not the same thing as a
// record's overall status (see bottlenecks.ts's /detail route comment).
export function getBottleneckDetail(token: string, params: { fmsId?: string; scope: 'stage' | 'doer'; key: string; status?: string; dateFrom?: string; dateTo?: string }) {
  const usp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) usp.set(k, String(v)); });
  return request<BottleneckDetailRow[]>(`/api/bottlenecks/detail?${usp.toString()}`, {}, token);
}

export interface MisFmsBreakdown {
  fmsId: string;
  fmsName: string;
  newRecords: number;
  completed: number;
  onTime: number;
  late: number;
  pending: number;
  overdue: number;
  onTimePercent: number | null;
}
export interface MisStageBreakdown { key: string; completed: number; onTime: number; late: number; onTimePercent: number | null }
export interface MisReport {
  reportType: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  metrics: {
    newRecords: number; completed: number; completedOnTime: number; completedLate: number;
    closingPending: number; overdueAtEnd: number; delayCarriedMinutes: number;
    avgVarianceMinutes: number | null; openedActions: number; resolvedActions: number;
  };
  fmsBreakdown: MisFmsBreakdown[];
  stageBreakdown: MisStageBreakdown[];
  doerBreakdown: MisStageBreakdown[];
  bestStage: MisStageBreakdown | null;
  worstStage: MisStageBreakdown | null;
  bestDoer: MisStageBreakdown | null;
  worstDoer: MisStageBreakdown | null;
}

export function getMisReport(token: string, reportType: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY', query: { fmsId?: string; date?: string; month?: string; year?: string }) {
  const params = new URLSearchParams({ reportType });
  Object.entries(query).forEach(([k, v]) => { if (v) params.set(k, v); });
  return request<MisReport>(`/api/reports/mis?${params.toString()}`, {}, token);
}

export interface DoerPerformanceRow {
  doerName: string;
  email: string;
  fmsCount: number;
  assignedStages: number;
  completed: number;
  onTime: number;
  late: number;
  pending: number;
  overdue: number;
  stalled: number;
  avgDelayMinutes: number | null;
  staleRecords: number;
  openActions: number;
  performanceScore: number | null;
}

export function getDoerPerformance(token: string, fmsId?: string) {
  const params = new URLSearchParams();
  if (fmsId) params.set('fmsId', fmsId);
  return request<DoerPerformanceRow[]>(`/api/reports/doer-performance?${params.toString()}`, {}, token);
}

export interface ActionItem {
  actionId: string;
  fmsId: string;
  recordId: string;
  recordDisplay: string | null;
  stageName: string | null;
  actionType: string;
  priority: string;
  title: string;
  description: string | null;
  assignedTo: string | null;
  assignedEmail: string | null;
  createdBy: string | null;
  createdAt: string;
  dueAt: string | null;
  status: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolution: string | null;
  lastCommentAt: string | null;
}

export interface ActionComment {
  commentId: string;
  actionId: string;
  comment: string;
  createdBy: string | null;
  createdAt: string;
}

export interface ActionQuery {
  fmsId?: string;
  status?: string;
  priority?: string;
  assignedTo?: string;
  search?: string;
}

export function getActionItems(token: string, query: ActionQuery) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => { if (v) params.set(k, v); });
  return request<ActionItem[]>(`/api/actions?${params.toString()}`, {}, token);
}

export interface SaveActionPayload {
  actionId?: string;
  fmsId?: string;
  recordId?: string;
  recordDisplay?: string;
  stageName?: string;
  actionType: string;
  priority: string;
  title: string;
  description?: string;
  assignedTo?: string;
  assignedEmail?: string;
  dueAt?: string;
}

export function saveActionItem(token: string, payload: SaveActionPayload) {
  return request<{ actionId: string } | boolean>('/api/actions', { method: 'POST', body: JSON.stringify(payload) }, token);
}

export function updateActionStatus(token: string, actionId: string, status: string, resolution?: string) {
  return request<boolean>(`/api/actions/${actionId}/status`, { method: 'PATCH', body: JSON.stringify({ status, resolution }) }, token);
}

export function deleteActionItem(token: string, actionId: string) {
  return request<boolean>(`/api/actions/${actionId}`, { method: 'DELETE' }, token);
}

export interface SendReminderPayload {
  email: string;
  fmsName?: string;
  recordDisplay?: string;
  stageName?: string;
  planTime?: string;
  delayHuman?: string;
}

export function sendActionReminder(token: string, actionId: string, payload: SendReminderPayload) {
  return request<boolean>(`/api/actions/${actionId}/remind`, { method: 'POST', body: JSON.stringify(payload) }, token);
}

export function getActionComments(token: string, actionId: string) {
  return request<ActionComment[]>(`/api/actions/${actionId}/comments`, {}, token);
}

export function saveActionComment(token: string, actionId: string, comment: string) {
  return request<boolean>(`/api/actions/${actionId}/comments`, { method: 'POST', body: JSON.stringify({ comment }) }, token);
}

export interface AdminUser {
  userId: string;
  username: string;
  fullName: string | null;
  email: string | null;
  roleId: string;
  roleName: string | null;
  status: string;
  profileImageUrl: string | null;
  lastLogin: string | null;
  mustChangePassword: boolean;
  createdAt: string;
}

export function getUsers(token: string) {
  return request<AdminUser[]>('/api/users', {}, token);
}
export function saveUser(token: string, payload: { userId?: string; username?: string; fullName?: string; email?: string; roleId?: string }) {
  return request<{ userId: string; tempPassword: string } | boolean>('/api/users', { method: 'POST', body: JSON.stringify(payload) }, token);
}
export function setUserStatus(token: string, userId: string, active: boolean) {
  return request<boolean>(`/api/users/${userId}/status`, { method: 'PATCH', body: JSON.stringify({ active }) }, token);
}
export function unlockUser(token: string, userId: string) {
  return request<boolean>(`/api/users/${userId}/unlock`, { method: 'POST' }, token);
}
export function resetUserPassword(token: string, userId: string) {
  return request<{ tempPassword: string }>(`/api/users/${userId}/reset-password`, { method: 'POST' }, token);
}

export interface RoleRow {
  roleId: string;
  roleName: string;
  permissions: Record<string, boolean>;
  status: string;
}

export function getRoles(token: string) {
  return request<RoleRow[]>('/api/roles', {}, token);
}
export function saveRolePermissions(token: string, roleId: string, permissions: Record<string, boolean>) {
  return request<boolean>(`/api/roles/${roleId}`, { method: 'PATCH', body: JSON.stringify({ permissions }) }, token);
}

export interface AppSettingRow {
  key: string;
  value: string | null;
  description: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export function getAppSettings(token: string) {
  return request<AppSettingRow[]>('/api/settings', {}, token);
}
export function saveAppSettings(token: string, values: Record<string, string>) {
  return request<AppSettingRow[]>('/api/settings', { method: 'PATCH', body: JSON.stringify(values) }, token);
}

export interface AuditLogRow {
  logId: number;
  timestamp: string;
  username: string | null;
  role: string | null;
  action: string | null;
  module: string | null;
  recordId: string | null;
  success: boolean;
  errorMessage: string | null;
}

export function getAuditLog(token: string, query: { username?: string; module?: string; action?: string; limit?: number }) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => { if (v) params.set(k, String(v)); });
  return request<AuditLogRow[]>(`/api/audit-log?${params.toString()}`, {}, token);
}

export interface SyncLogRow {
  syncId: number;
  fmsId: string;
  startedAt: string;
  completedAt: string | null;
  status: string;
  rowsRead: number;
  durationMs: number | null;
  errorMessage: string | null;
  triggeredBy: string | null;
}

export function getSyncLog(token: string, query: { fmsId?: string; limit?: number }) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => { if (v) params.set(k, String(v)); });
  return request<SyncLogRow[]>(`/api/sync-log?${params.toString()}`, {}, token);
}

export interface DataHealthIssue {
  fmsId: string;
  fmsName: string;
  type: string;
  detail: string;
}

export function getDataHealth(token: string) {
  return request<{ checkedAt: string | null; issues: DataHealthIssue[]; issueCount: number }>('/api/data-health', {}, token);
}

export interface AiChatTurn { role: 'user' | 'model'; text: string }

export function aiChat(token: string, message: string, history: AiChatTurn[]) {
  return request<{ text: string }>('/api/ai/chat', {
    method: 'POST', body: JSON.stringify({ message, history }),
  }, token);
}
