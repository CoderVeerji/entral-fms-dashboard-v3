import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigation } from '../context/NavigationContext';
import * as api from '../api';
import type { FmsConfig, UpdateHealthRow, UpdateHealthCards } from '../api';
import { KpiCard } from '../components/KpiCard';
import { StatusBadge } from '../components/StatusBadge';
import { RecordDrawer } from '../components/RecordDrawer';
import { EmptyState } from '../components/EmptyState';
import { SkeletonBlock } from '../components/SkeletonBlock';
import { formatDateTime } from '../utils/date';
import { HelpHotspot } from '../components/HelpHotspot';

const PAGE_SIZE = 25;

function hoursSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.round(((Date.now() - new Date(iso).getTime()) / 3600000) * 10) / 10;
}

export function UpdateHealthPage() {
  const { token } = useAuth();
  // Seeds filters from a cross-page jump (e.g. Dashboard's "Stale" card) via useNavigation().params
  // — same pattern as LiveRecordsPage — read once on mount only, so the user's own subsequent
  // filter changes here are never silently overwritten.
  const { params: navParams } = useNavigation();
  const [fmsList, setFmsList] = useState<FmsConfig[]>([]);
  const [fmsId, setFmsId] = useState(navParams.fmsId ?? '');
  const [freshness, setFreshness] = useState(navParams.freshness ?? '');
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
          <div style={{ position: 'relative' }}>
            <KpiCard icon="fa-check" color="green" value={cards.updatedToday} label="Updated Today" />
            <HelpHotspot title="Updated Today" en="Records that had some activity (a stage plan or actual filled in) today." hi="Records jinme aaj kuch activity hui hai (stage ka plan ya actual bhara gaya)." />
          </div>
          <div onClick={() => toggleFreshness('Warning')} style={{ cursor: 'pointer', position: 'relative' }}>
            <KpiCard icon="fa-triangle-exclamation" color="amber" value={cards.warning} label="Warning" />
            <HelpHotspot title="Warning" en="No update for a little while — not urgent yet, but worth keeping an eye on." hi="Kuch time se koi update nahi aaya — abhi urgent nahi, par nazar rakho." />
          </div>
          <div onClick={() => toggleFreshness('Stale')} style={{ cursor: 'pointer', position: 'relative' }}>
            <KpiCard icon="fa-hourglass-half" color="red" value={cards.stale} label="Stale" />
            <HelpHotspot title="Stale" en="No update for several days — someone should check on this record." hi="Kai dino se koi update nahi — kisi ko ye record check karna chahiye." />
          </div>
          <div onClick={() => toggleFreshness('Critical')} style={{ cursor: 'pointer', position: 'relative' }}>
            <KpiCard icon="fa-fire" color="red" value={cards.critical} label="Critical" />
            <HelpHotspot title="Critical" en="No update in a long time — the most neglected records, regardless of whether they have a deadline." hi="Bahut lambe time se koi update nahi — sabse zyada neglect hue records, chahe deadline ho ya na ho." />
          </div>
          <div onClick={() => toggleFreshness('Never')} style={{ cursor: 'pointer', position: 'relative' }}>
            <KpiCard icon="fa-ban" color="grey" value={cards.neverUpdated} label="Never Updated" />
            <HelpHotspot title="Never Updated" en="No activity has ever been recorded for these — not even the first step." hi="Inpe kabhi koi activity record hi nahi hui — pehla step bhi nahi." />
          </div>
        </div>
      )}

      <div className="filter-bar">
        <HelpHotspot inline title="Update Health"
          en="Which records have gone quiet, and for how long — sorted by freshness (activity), not deadlines. Use this to find records everyone has forgotten about, even ones that technically aren't overdue."
          hi="Kaunse records chup ho gaye hain, aur kab se — freshness (activity) ke hisab se sorted hai, deadline se nahi. Isse wo records milte hain jinhe sab bhool gaye, chahe wo technically overdue na ho." />
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
                <th>Last Update</th><th>Hours Since</th><th>Open Actions</th><th></th>
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
                  <td>{r.lastUpdate ? formatDateTime(r.lastUpdate) : 'Never'}</td>
                  <td>{hoursSince(r.lastUpdate) ?? '—'}</td>
                  <td>{r.openActions || '—'}</td>
                  <td className="row-view-cell" title="View details"><i className="fas fa-eye" /></td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={9} style={{ padding: 0 }}><EmptyState icon="fa-heart-pulse" title="No records match these filters" /></td></tr>
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
