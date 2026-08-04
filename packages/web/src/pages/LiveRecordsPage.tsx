import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import * as api from '../api';
import type { FmsConfig, RecordRow } from '../api';

const PAGE_SIZE = 25;

const STATUS_OPTIONS = [
  'NOT_STARTED', 'RUNNING_ON_TIME', 'AT_RISK', 'OVERDUE', 'STALLED',
  'COMPLETED_ON_TIME', 'COMPLETED_LATE', 'DATA_EXCEPTION',
];
const FRESHNESS_OPTIONS = ['Fresh', 'Warning', 'Stale', 'Critical', 'Never'];

function statusClass(status: string): string {
  if (status === 'OVERDUE' || status === 'STALLED' || status === 'DATA_EXCEPTION') return 'badge badge-critical';
  if (status === 'AT_RISK') return 'badge badge-warning';
  if (status === 'COMPLETED_ON_TIME' || status === 'COMPLETED_LATE') return 'badge badge-done';
  return 'badge badge-neutral';
}

export function LiveRecordsPage() {
  const { token } = useAuth();
  const [fmsList, setFmsList] = useState<FmsConfig[]>([]);
  const [fmsId, setFmsId] = useState('');
  const [status, setStatus] = useState('');
  const [freshness, setFreshness] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    api.getFmsList(token).then((res) => { if (res.ok) setFmsList(res.data); });
  }, [token]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    const res = await api.getRecords(token, {
      fmsId: fmsId || undefined, status: status || undefined, freshness: freshness || undefined,
      search: search || undefined, start: page * PAGE_SIZE, length: PAGE_SIZE,
    });
    setLoading(false);
    if (!res.ok) { setError(res.message); return; }
    setRows(res.data.records);
    setTotal(res.data.total);
  }, [token, fmsId, status, freshness, search, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [fmsId, status, freshness, search]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="live-records-page">
      <h2>Live Records</h2>

      <div className="filter-bar">
        <input
          type="text" placeholder="Search name, ID, doer..." value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
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
      </div>

      {error && <div className="login-error">{error}</div>}

      {/* Wide data table: own horizontal-scroll container on narrow screens, per the shared
          mobile breakpoint convention in styles.css — never shrinks columns illegibly. */}
      <div className="table-scroll">
        <table className="records-table">
          <thead>
            <tr>
              <th>Record</th><th>FMS</th><th>Stage</th><th>Doer</th><th>Status</th>
              <th>Freshness</th><th>Plan Time</th><th>Delay</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.fmsId}:${r.recordId}`}>
                <td>{r.displayName || r.recordId}</td>
                <td>{fmsList.find((f) => f.fmsId === r.fmsId)?.fmsName || r.fmsId}</td>
                <td>{r.currentStage || '—'}</td>
                <td>{r.doer || '—'}</td>
                <td><span className={statusClass(r.recordStatus)}>{r.recordStatus.replace(/_/g, ' ')}</span></td>
                <td>{r.freshness || '—'}</td>
                <td>{r.planTime ? new Date(r.planTime).toLocaleString() : '—'}</td>
                <td>{r.delay?.human || '—'}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={8} className="empty-state">No records match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pagination">
        <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button>
        <span>Page {page + 1} of {totalPages} ({total} records)</span>
        <button disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
      </div>
    </div>
  );
}
