import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigation } from '../context/NavigationContext';
import * as api from '../api';
import type { FmsConfig, RecordRow } from '../api';
import { StatusBadge } from '../components/StatusBadge';
import { RecordDrawer } from '../components/RecordDrawer';
import { EmptyState } from '../components/EmptyState';
import { SkeletonBlock } from '../components/SkeletonBlock';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { exportCsv } from '../utils/csv';
import { formatDateTime } from '../utils/date';
import { HelpHotspot } from '../components/HelpHotspot';

const PAGE_SIZE = 25;

const STATUS_OPTIONS = [
  'NOT_STARTED', 'RUNNING_ON_TIME', 'AT_RISK', 'OVERDUE', 'STALLED',
  'COMPLETED_ON_TIME', 'COMPLETED_LATE', 'DATA_EXCEPTION',
];
const FRESHNESS_OPTIONS = ['Fresh', 'Warning', 'Stale', 'Critical', 'Never'];
const WORKLOAD_LABELS: Record<string, string> = {
  dueToday: 'Due Today', overdueBeforeToday: 'Overdue (Before Today)', upcoming: 'Upcoming',
};

// Port of app/index.html's row-class logic — tints the whole row by status so a scan down the
// table shows trouble at a glance, not just in the Status column's badge.
function rowClass(status: string): string {
  if (status === 'DATA_EXCEPTION') return 'row-exception';
  if (status === 'OVERDUE' || status === 'STALLED') return 'row-overdue';
  if (status === 'AT_RISK') return 'row-atrisk';
  if (status === 'COMPLETED_ON_TIME') return 'row-ontime';
  if (status === 'COMPLETED_LATE') return 'row-late';
  return '';
}

export function LiveRecordsPage() {
  const { token } = useAuth();
  // Seeds filters from a cross-page jump (e.g. Dashboard's "Overdue" KPI card, an FMS Health
  // card, or Bottleneck Analysis's "4 overdue" drill-down carries fmsId/status/stage/doer here
  // via useNavigation().params) — read once on mount only, so the user's own subsequent filter
  // changes on this page are never silently overwritten.
  const { params: navParams } = useNavigation();
  const [fmsList, setFmsList] = useState<FmsConfig[]>([]);
  const [fmsId, setFmsId] = useState(navParams.fmsId ?? '');
  const [status, setStatus] = useState(navParams.status ?? '');
  const [freshness, setFreshness] = useState(navParams.freshness ?? '');
  const [stage, setStage] = useState(navParams.stage ?? '');
  const [doer, setDoer] = useState(navParams.doer ?? '');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  // 'dueToday' | 'overdueBeforeToday' | 'upcoming' — from Dashboard's Today's Workload cards.
  // Cleared the moment the user touches the manual date inputs above (mutually exclusive with
  // them on the API side), same "seed once, never fight the user's own filter changes" pattern.
  const [workload, setWorkload] = useState(navParams.workload ?? '');
  const [stageOptions, setStageOptions] = useState<string[]>([]);
  const [doerOptions, setDoerOptions] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ fmsId: string; recordId: string } | null>(null);

  useEffect(() => {
    if (!token) return;
    api.getFmsList(token).then((res) => { if (res.ok) setFmsList(res.data); });
  }, [token]);

  // Re-scoped to the selected FMS — a stage/doer picked for one FMS rarely means anything for
  // another, and a global list across every connected FMS would get long and mostly irrelevant.
  useEffect(() => {
    if (!token) return;
    api.getRecordFilterOptions(token, fmsId || undefined).then((res) => {
      if (res.ok) { setStageOptions(res.data.stages); setDoerOptions(res.data.doers); }
    });
  }, [token, fmsId]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    const res = await api.getRecords(token, {
      fmsId: fmsId || undefined, status: status || undefined, freshness: freshness || undefined,
      stage: stage || undefined, doer: doer || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined,
      workload: workload || undefined, search: debouncedSearch || undefined, start: page * PAGE_SIZE, length: PAGE_SIZE,
    });
    setLoading(false);
    if (!res.ok) { setError(res.message); return; }
    setRows(res.data.records);
    setTotal(res.data.total);
  }, [token, fmsId, status, freshness, stage, doer, dateFrom, dateTo, workload, debouncedSearch, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [fmsId, status, freshness, stage, doer, dateFrom, dateTo, workload, debouncedSearch]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function exportRows() {
    exportCsv('live-records',
      ['Record', 'FMS', 'Stage', 'Doer', 'Status', 'Freshness', 'Plan Time', 'Delay'],
      rows.map((r) => [
        r.displayName || r.recordId, fmsList.find((f) => f.fmsId === r.fmsId)?.fmsName || r.fmsId,
        r.currentStage || '', r.doer || '', r.recordStatus, r.freshness || '',
        r.planTime ? formatDateTime(r.planTime) : '', r.delay?.human || '',
      ]));
  }

  return (
    <div className="live-records-page">
      <div className="filter-bar">
        <input
          type="text" placeholder="Search name, ID, doer..." value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <HelpHotspot inline title="Live Records"
          en="Every record from every connected FMS, in one searchable list — filter by FMS, status, freshness, stage, doer, or a date range. Click any row to see that record's full history and details."
          hi="Saari connected FMS ke saare records, ek hi jagah — FMS, status, freshness, stage, doer, ya date range se filter kar sakte ho. Kisi bhi row pe click karke poori history aur details dekh sakte ho." />
        <select value={fmsId} onChange={(e) => setFmsId(e.target.value)}>
          <option value="">All FMS</option>
          {fmsList.map((f) => <option key={f.fmsId} value={f.fmsId}>{f.fmsName}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any Status</option>
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        <select value={freshness} onChange={(e) => setFreshness(e.target.value)}>
          <option value="">Any Freshness</option>
          {FRESHNESS_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <select value={stage} onChange={(e) => setStage(e.target.value)}>
          <option value="">Any Stage</option>
          {stageOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={doer} onChange={(e) => setDoer(e.target.value)}>
          <option value="">Any Doer</option>
          {doerOptions.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <label className="filter-date-label">
          From
          <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setWorkload(''); }} />
        </label>
        <label className="filter-date-label">
          To
          <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setWorkload(''); }} />
        </label>
        <button className="btn btn-outline btn-sm no-print" disabled={rows.length === 0} onClick={exportRows}>
          <i className="fas fa-file-csv" /> Export Page CSV
        </button>
      </div>

      {/* Active from a Dashboard "Today's Workload" card click-through — a real filter (same
          date_trunc('day', now()) bucketing as the card's own count), not just a label, so it's
          shown as a dismissible chip rather than silently baked into the date inputs above. */}
      {workload && WORKLOAD_LABELS[workload] && (
        <div className="filter-chip-bar">
          <span className="filter-chip">
            {WORKLOAD_LABELS[workload]}
            <i className="fas fa-xmark" onClick={() => setWorkload('')} />
          </span>
        </div>
      )}

      {error && <div className="login-error">{error}</div>}

      {loading && rows.length === 0 ? (
        <div className="card"><SkeletonBlock rows={6} /></div>
      ) : (
        /* Wide data table: own horizontal-scroll container on narrow screens, per the shared
           mobile breakpoint convention in styles.css — never shrinks columns illegibly. */
        <div className="table-scroll">
          <table className="records-table">
            <thead>
              <tr>
                <th>Record</th><th>FMS</th><th>Stage</th><th>Doer</th>
                <th>Status
                  <HelpHotspot inline title="Status"
                    en="Where this record's CURRENT step stands — Running On Time, At Risk, Overdue, Stalled, or fully Completed."
                    hi="Is record ke CURRENT step ka status — Running On Time, At Risk, Overdue, Stalled, ya poora Completed." />
                </th>
                <th>Freshness
                  <HelpHotspot inline title="Freshness"
                    en="How recently this record was last touched — separate from Status. A record can be on-time but still 'Stale' if nobody has updated it in a few days."
                    hi="Ye record last kab touch hua tha — Status se alag hai. Record on-time ho sakta hai par phir bhi 'Stale' dikh sakta hai agar kai dinon se update nahi aaya." />
                </th>
                <th>Plan Time</th>
                <th>Delay
                  <HelpHotspot inline title="Delay"
                    en="How far past the deadline this record's current step is — only shown for Overdue records."
                    hi="Is record ke current step ki deadline kitni nikal chuki hai — sirf Overdue records ke liye dikhta hai." />
                </th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={`${r.fmsId}:${r.recordId}`} className={`row-clickable ${rowClass(r.recordStatus)}`}
                  onClick={() => setSelected({ fmsId: r.fmsId, recordId: r.recordId })}
                >
                  <td>{r.displayName || r.recordId}</td>
                  <td>{fmsList.find((f) => f.fmsId === r.fmsId)?.fmsName || r.fmsId}</td>
                  <td>{r.currentStage || '—'}</td>
                  <td>{r.doer || '—'}</td>
                  <td><StatusBadge status={r.recordStatus} /></td>
                  <td><StatusBadge status={r.freshness} /></td>
                  <td>{r.planTime ? formatDateTime(r.planTime) : '—'}</td>
                  <td>{r.delay?.human || '—'}</td>
                  <td className="row-view-cell" title="View details"><i className="fas fa-eye" /></td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={9} style={{ padding: 0 }}><EmptyState icon="fa-table-list" title="No records match these filters" /></td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="pagination">
        <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button>
        <span>Page {page + 1} of {totalPages} ({total} records)</span>
        <button disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
      </div>

      {selected && (
        <RecordDrawer fmsId={selected.fmsId} recordId={selected.recordId} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
