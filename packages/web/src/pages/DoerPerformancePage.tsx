import { useEffect, useState, useCallback, type MouseEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import * as api from '../api';
import type { FmsConfig, DoerPerformanceRow } from '../api';
import { EmptyState } from '../components/EmptyState';
import { SkeletonBlock } from '../components/SkeletonBlock';
import { Leaderboard } from '../components/Leaderboard';
import { BucketDetailPanel, type DrillTarget } from './BottleneckPage';
import { HelpHotspot } from '../components/HelpHotspot';

const COMPLETED_STATUSES = 'COMPLETED_ON_TIME,COMPLETED_LATE,COMPLETED_EARLY,UNPLANNED_COMPLETED';
const ON_TIME_STATUSES = 'COMPLETED_ON_TIME,COMPLETED_EARLY';

function scoreColor(score: number | null): string {
  if (score === null) return 'grey';
  if (score >= 75) return 'green';
  if (score >= 50) return 'amber';
  return 'red';
}

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Monday-start calendar week, through today — "this week so far", not a future-dated range.
function startOfWeekMonday(d: Date): Date {
  const day = d.getDay(); // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(d);
  monday.setDate(d.getDate() - diffToMonday);
  return monday;
}

export function DoerPerformancePage() {
  const { token, user } = useAuth();
  const [fmsList, setFmsList] = useState<FmsConfig[]>([]);
  const [fmsId, setFmsId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [rows, setRows] = useState<DoerPerformanceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drillTarget, setDrillTarget] = useState<DrillTarget | null>(null);

  function drill(e: MouseEvent, r: DoerPerformanceRow, status: string | undefined, label: string) {
    e.stopPropagation();
    setDrillTarget({ fmsId, scope: 'doer', key: r.doerName, status, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, label: `${r.doerName} — ${label}` });
  }

  function applyPreset(preset: 'today' | 'yesterday' | 'week') {
    const now = new Date();
    if (preset === 'today') { const s = toISODate(now); setDateFrom(s); setDateTo(s); return; }
    if (preset === 'yesterday') {
      const y = new Date(now); y.setDate(now.getDate() - 1);
      const s = toISODate(y); setDateFrom(s); setDateTo(s); return;
    }
    setDateFrom(toISODate(startOfWeekMonday(now))); setDateTo(toISODate(now));
  }

  useEffect(() => {
    if (!token) return;
    api.getFmsList(token).then((res) => { if (res.ok) setFmsList(res.data); });
  }, [token]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    const res = await api.getDoerPerformance(token, { fmsId: fmsId || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined });
    setLoading(false);
    if (!res.ok) { setError(res.message); return; }
    setRows(res.data);
  }, [token, fmsId, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  // Ranked by the same 0-100 timeliness/lateness score as the Score column below — judged purely
  // on how on-time and how late someone is, never on how much work they were given (see
  // doerPerformance.ts's SCORING.DOER_WEIGHTS). Completed count shown as context only, not the
  // ranking driver. Rows with no completed work yet (performanceScore null) have nothing to judge
  // and are left off the leaderboard entirely rather than sorting to the bottom as a "0".
  const leaderboardRows = rows
    .filter((r) => r.performanceScore !== null)
    .sort((a, b) => (b.performanceScore ?? 0) - (a.performanceScore ?? 0))
    .map((r) => ({ key: r.email || r.doerName, name: r.doerName, score: r.performanceScore ?? 0, subtitle: `${r.completed} completed` }));
  const currentUserKey = user?.email ? rows.find((r) => r.email?.toLowerCase() === user.email?.toLowerCase())?.email : undefined;

  return (
    <div className="doer-performance-page">
      <div className="filter-bar">
        <select value={fmsId} onChange={(e) => setFmsId(e.target.value)}>
          <option value="">All FMS</option>
          {fmsList.map((f) => <option key={f.fmsId} value={f.fmsId}>{f.fmsName}</option>)}
        </select>
        <label className="filter-date-label">
          From
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </label>
        <label className="filter-date-label">
          To
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </label>
        <button className="btn btn-outline btn-sm" onClick={() => applyPreset('today')}>Today</button>
        <button className="btn btn-outline btn-sm" onClick={() => applyPreset('yesterday')}>Yesterday</button>
        <button className="btn btn-outline btn-sm" onClick={() => applyPreset('week')}>This Week</button>
        {(dateFrom || dateTo) && (
          <button className="btn btn-ghost btn-sm" onClick={() => { setDateFrom(''); setDateTo(''); }}>
            <i className="fas fa-xmark" /> Clear dates
          </button>
        )}
        <HelpHotspot inline title="Doer Performance"
          en="Every person's work rolled up across every FMS they touch, judged purely on timeliness — how often they're on time and how late when they're not — never on how much work they were given. The Leaderboard and the Score column use the same judgment. Filter by date range to check a specific period; leave it blank for all-time. Click any count to see the exact stage events."
          hi="Har vyakti ka kaam, jitni bhi FMS mein wo kaam karta hai un sabko milakar — sirf timeliness pe judge kiya jata hai: kitni baar time pe kiya, aur jab nahi kiya to kitna late — kabhi bhi kitna kaam mila usse nahi. Leaderboard aur Score column dono isi judgment se bante hain. Date range se specific period check karo; khaali chodo to all-time. Kisi bhi count pe click karke exact stage events dekh sakte ho." />
      </div>

      {error && <div className="login-error">{error}</div>}

      {loading ? (
        <div className="card"><SkeletonBlock rows={6} /></div>
      ) : (
        <>
          {leaderboardRows.length > 0 && (
            <>
              <div className="section-title"><i className="fas fa-medal" />Leaderboard — On-Time Performance</div>
              <div style={{ marginBottom: 22 }}>
                <Leaderboard rows={leaderboardRows} currentUserKey={currentUserKey} scoreLabel="Score" scoreSuffix="/100" />
              </div>
            </>
          )}

          <div className="table-scroll">
            <table className="records-table">
              <thead>
                <tr>
                  <th>Doer</th>
                  <th>FMS Count
                    <HelpHotspot inline title="FMS Count" en="How many different connected FMS this person does work in." hi="Ye vyakti kitni alag-alag connected FMS mein kaam karta hai." />
                  </th>
                  <th>Assigned</th><th>Completed</th><th>On Time</th>
                  <th>Late</th><th>Overdue</th><th>Stalled</th><th>Avg Delay</th><th>Open Actions</th>
                  <th>Score
                    <HelpHotspot inline title="Score"
                      en="A 0-100 timeliness score: 55% on-time rate, 30% how late on average when late (the more days, the lower), 15% how much of everything they've ever been assigned is currently overdue. Never affected by how much work someone has — a person with 5 tasks all on time scores exactly as well as one with 500."
                      hi="Ek 0-100 timeliness score: 55% on-time rate, 30% jab late kiya to average kitna late (jitne zyada din, utna kam score), 15% kitna kaam abhi overdue hai unke total assigned mein se. Kaam kitna mila iska koi asar nahi — 5 tasks sab on-time waala bhi utna hi achha score karega jitna 500 tasks waala." />
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.email || r.doerName}>
                    <td>{r.doerName}</td>
                    <td>{r.fmsCount}</td>
                    {/* Every count drills into the specific stage events behind it, same as
                        Bottleneck Analysis — a doer's "4 overdue" is a dead end otherwise. */}
                    <td><span className="stat-link" onClick={(e) => drill(e, r, undefined, 'All assigned stage events')}>{r.assignedStages}</span></td>
                    <td><span className="stat-link" onClick={(e) => drill(e, r, COMPLETED_STATUSES, 'Completed')}>{r.completed}</span></td>
                    <td><span className="stat-link" onClick={(e) => drill(e, r, ON_TIME_STATUSES, 'On time')}>{r.onTime}</span></td>
                    <td><span className="stat-link" onClick={(e) => drill(e, r, 'COMPLETED_LATE', 'Completed late')}>{r.late}</span></td>
                    <td><span className="stat-link" onClick={(e) => drill(e, r, 'OVERDUE', 'Overdue')}>{r.overdue}</span></td>
                    <td><span className="stat-link" onClick={(e) => drill(e, r, 'STALLED', 'Stalled')}>{r.stalled}</span></td>
                    <td>{r.avgDelayMinutes != null ? `${r.avgDelayMinutes}m` : '—'}</td>
                    <td>{r.openActions || '—'}</td>
                    <td>
                      {r.performanceScore != null
                        ? <span className={'badge badge-' + scoreColor(r.performanceScore)}>{r.performanceScore.toFixed(1)}</span>
                        : '—'}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={11} style={{ padding: 0 }}><EmptyState icon="fa-users" title="No doer activity for this scope" /></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {drillTarget && <BucketDetailPanel target={drillTarget} onClose={() => setDrillTarget(null)} />}
    </div>
  );
}
