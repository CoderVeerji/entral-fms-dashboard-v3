// Trimmed port of app/index.html's NAV_GROUPS/PAGE_TITLES — only pages that actually exist in v3
// so far. Grow this list as each later phase's page gets built; don't pre-list pages that don't
// exist yet (REBUILD_PLAN principle: don't build ahead of need).
export interface NavItem {
  key: string;
  label: string;
  icon: string;
  perm: string;
}
export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  { label: 'Overview', items: [
    { key: 'dashboard', label: 'Management Dashboard', icon: 'fa-gauge-high', perm: 'dashboard.view' },
    { key: 'aiAssistant', label: 'AI Assistant', icon: 'fa-robot', perm: 'ai.chat' },
  ] },
  { label: 'Tracking', items: [
    { key: 'liveRecords', label: 'Live Records', icon: 'fa-table-list', perm: 'records.view' },
    { key: 'updateHealth', label: 'Update Health', icon: 'fa-heart-pulse', perm: 'records.view' },
  ] },
  { label: 'Operations', items: [
    { key: 'actionCenter', label: 'Action Center', icon: 'fa-list-check', perm: 'actions.view' },
  ] },
  { label: 'Analysis', items: [
    { key: 'bottlenecks', label: 'Bottleneck Analysis', icon: 'fa-chart-column', perm: 'records.view' },
    { key: 'misReport', label: 'MIS Report', icon: 'fa-file-lines', perm: 'reports.view' },
    { key: 'doerPerformance', label: 'Doer Performance', icon: 'fa-users', perm: 'reports.view' },
  ] },
  { label: 'Administration', items: [
    { key: 'fmsSources', label: 'FMS Sources', icon: 'fa-plug', perm: 'fms.manage' },
    { key: 'dataHealth', label: 'Data Health', icon: 'fa-stethoscope', perm: 'settings.view' },
    { key: 'users', label: 'Users', icon: 'fa-user-gear', perm: 'users.view' },
    { key: 'roles', label: 'Roles & Permissions', icon: 'fa-shield-halved', perm: 'roles.view' },
    { key: 'settings', label: 'Settings', icon: 'fa-sliders', perm: 'settings.view' },
    { key: 'logs', label: 'Audit & Sync Log', icon: 'fa-clipboard-list', perm: 'audit.view' },
    { key: 'about', label: 'About / Methodology', icon: 'fa-circle-info', perm: 'dashboard.view' },
  ] },
];

export const PAGE_TITLES: Record<string, [string, string]> = {
  dashboard: ['Management Dashboard', 'Live overview across every connected FMS'],
  aiAssistant: ['AI Assistant', 'Ask anything about your connected FMS, in plain language'],
  liveRecords: ['Live Records', 'Universal record tracking across all FMS'],
  updateHealth: ['Update Health', 'Which records have gone quiet, and for how long'],
  bottlenecks: ['Bottleneck Analysis', 'Which stages and doers are driving delays'],
  misReport: ['MIS Report', 'Daily / weekly / monthly performance summary'],
  doerPerformance: ['Doer Performance', 'Per-person timeliness and workload across all FMS'],
  actionCenter: ['Action Center', 'Track follow-ups, escalations and corrections to resolution'],
  dataHealth: ['Data Health', 'Automatic data-quality checks across every connected FMS'],
  users: ['Users', 'Manage accounts, roles, and access'],
  roles: ['Roles & Permissions', 'What each role can see and do'],
  settings: ['Settings', 'Application-wide configuration'],
  logs: ['Audit & Sync Log', 'Who did what, and how each background sync went'],
  fmsSources: ['FMS Sources', 'Connect and manage every tracked FMS spreadsheet'],
  about: ['About / Methodology', 'How statuses, scores, and freshness are calculated'],
};
