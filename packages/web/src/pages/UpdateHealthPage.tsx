import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import * as api from '../api';
import type { FmsConfig, UpdateHealthRow, UpdateHealthCards } from '../api';
import { KpiCard } from '../components/KpiCard';
import { StatusBadge } from '../components/StatusBadge';
import { RecordDrawer } from '../components/RecordDrawer';
import { EmptyState } from '../components/EmptyState';
import { SkeletonBlock } from '../components/SkeletonBlock';

const PAGE_SIZE = 25;

function hoursSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.round(((Date.now() - new Date(iso).getTime()) / 3600000) * 10) / 10;
}

export function UpdateHealthPage() {
  const { token } = useAuth();
  const [fmsList, setFmsList] = useState<FmsConfig[]>([]);
  const [fmsId, setFmsId] = useState('');
  const [freshness, setFreshness] = useState('');
  const [todayOnly, setTodayOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<UpdateHealthRow[]>([]);
  const [cards, setCards] = useState<UpdateHealthCards | null>(null);
  const [rowsTotal, setRowsTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ fmsId: string; recordId: string } | null>(null);

  useEffect(() => {
    if (!token) return;
    api.getFmsList(token).then((res) => { if (res.ok) setFmsList(res.data); });
  }, [token]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    const res = await api.getUpdateHealth(token, {
      fmsId: fmsId || undefined, freshness: freshness || undefined, todayOnly: todayOnly || undefined,
      start: page * PAGE_SIZE, length: PAGE_SIZE,
    });
    setLoading(false);
    if (!res.ok) { setError(res.message); return; }
    setRows(res.data.rows);
    setCards(res.data.cards);
    setRowsTotal(res.data.rowsTotal);
  }, [token, fmsId, freshness, todayOnly, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [fmsId, freshness, todayOnly]);

  const totalPages = Math.max(1, Math.ceil(rowsTotal / PAGE_SIZE));

  function toggleFreshness(f: string) {
    setFreshness((current) => (current === f ? '' : f));
  }

  return (
    <div className="update-health-page">
      {cards && (
        <div className="grid grid-cols-5" style={{ marginBottom: 22 }}>
          <KpiCard icon="fa-check" color="green" value={cards.updatedToday} label="Updated Today" />
          <div onClick={() => toggleFreshness('Warning')} style={{ cursor: 'pointer' }}>
            <KpiCard icon="fa-triangle-exclamation" color="amber" value={cards.warning} label="Warning" />
          </div>
          <div onClick={() => toggleFreshness('Stale')} style={{ cursor: 'pointer' }}>
            <KpiCard icon="fa-hourglass-half" color="red" value={cards.stale} label="Stale" />
          </div>
          <div onClick={() => toggleFreshness('Critical')} style={{ cursor: 'pointer' }}>
            <KpiCard icon="fa-fire" color="red" value={cards.critical} label="Critical" />
          </div>
          <div onClick={() => toggleFreshness('Never')} style={{ cursor: 'pointer' }}>
            <KpiCard icon="fa-ban" color="grey" value={cards.neverUpdated} label="Never Updated" />
          </div>
        </div>
      )}

      <div className="filter-bar">
        <select value={fmsId} onChange={(e) => setFmsId(e.target.value)}>
          <option value="">All FMS</option>
          {fmsList.map((f) => <option key={f.fmsId} value={f.fmsId}>{f.fmsName}</option>)}
        </select>
        <select value={freshness} onChange={(e) => setFreshness(e.target.value)}>
          <option value="">Any Freshness</option>
          <option value="Fresh">Fresh</option>
          <option value="Warning">Warning</option>
          <option value="Stale">Stale</option>
          <option value="Critical">Critical</option>
          <option value="Never">Never Updated</option>
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={todayOnly} onChange={(e) => setTodayOnly(e.target.checked)} />
          Updated today only
        </label>
      </div>

      {error && <div className="login-error">{error}</div>}

      {loading && rows.length === 0 ? (
        <div className="card"><SkeletonBlock rows={6} /></div>
      ) : (
        <div className="table-scroll">
          <table className="records-table">
            <thead>
              <tr>
                <th>Record</th><th>FMS</th><th>Stage</th><th>Doer</th><th>Freshness</th>
                <th>Last Update</th><th>Hours Since</th><th>Open Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.fmsId}:${r.recordId}`} className="row-clickable" onClick={() => setSelected({ fmsId: r.fmsId, recordId: r.recordId })}>
                  <td>{r.displayName || r.recordId}</td>
                  <td>{fmsList.find((f) => f.fmsId === r.fmsId)?.fmsName || r.fmsId}</td>
                  <td>{r.currentStage || '—'}</td>
                  <td>{r.doer || '—'}</td>
                  <td><StatusBadge status={r.freshness || 'Never'} /></td>
                  <td>{r.lastUpdate ? new Date(r.lastUpdate).toLocaleString() : 'Never'}</td>
                  <td>{hoursSince(r.lastUpdate) ?? '—'}</td>
                  <td>{r.openActions || '—'}</td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 0 }}><EmptyState icon="fa-heart-pulse" title="No records match these filters" /></td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="pagination">
        <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button>
        <span>Page {page + 1} of {totalPages} ({rowsTotal} records)</span>
        <button disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
      </div>

      {selected && (
        <RecordDrawer fmsId={selected.fmsId} recordId={selected.recordId} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
