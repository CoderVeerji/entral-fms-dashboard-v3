// Trimmed port of app/index.html's NAV_GROUPS/PAGE_TITLES — only pages that actually exist in v3
// so far (Dashboard, Live Records). Grow this list as each later phase's page gets built; don't
// pre-list pages that don't exist yet (REBUILD_PLAN principle: don't build ahead of need).
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
  ] },
  { label: 'Tracking', items: [
    { key: 'liveRecords', label: 'Live Records', icon: 'fa-table-list', perm: 'records.view' },
  ] },
];

export const PAGE_TITLES: Record<string, [string, string]> = {
  dashboard: ['Management Dashboard', 'Live overview across every connected FMS'],
  liveRecords: ['Live Records', 'Universal record tracking across all FMS'],
};
