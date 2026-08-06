import { useEffect, useState, useCallback, type MouseEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import * as api from '../api';
import type { FmsConfig, DoerPerformanceRow } from '../api';
import { EmptyState } from '../components/EmptyState';
import { SkeletonBlock } from '../components/SkeletonBlock';
import { Leaderboard } from '../components/Leaderboard';
import { BucketDetailPanel, type DrillTarget } from './BottleneckPage';

const COMPLETED_STATUSES = 'COMPLETED_ON_TIME,COMPLETED_LATE,COMPLETED_EARLY,UNPLANNED_COMPLETED';
const ON_TIME_STATUSES = 'COMPLETED_ON_TIME,COMPLETED_EARLY';

function scoreColor(score: number | null): string {
  if (score === null) return 'grey';
  if (score >= 75) return 'green';
  if (score >= 50) return 'amber';
  return 'red';
}

export function DoerPerformancePage() {
  const { token, user } = useAuth();
  const [fmsList, setFmsList] = useState<FmsConfig[]>([]);
  const [fmsId, setFmsId] = useState('');
  const [rows, setRows] = useState<DoerPerformanceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drillTarget, setDrillTarget] = useState<DrillTarget | null>(null);

  function drill(e: MouseEvent, r: DoerPerformanceRow, status: string | undefined, label: string) {
    e.stopPropagation();
    setDrillTarget({ fmsId, scope: 'doer', key: r.doerName, status, label: `${r.doerName} — ${label}` });
  }

  useEffect(() => {
    if (!token) return;
    api.getFmsList(token).then((res) => { if (res.ok) setFmsList(res.data); });
  }, [token]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    const res = await api.getDoerPerformance(token, fmsId || undefined);
    setLoading(false);
    if (!res.ok) { setError(res.message); return; }
    setRows(res.data);
  }, [token, fmsId]);

  useEffect(() => { load(); }, [load]);

  // Ranked by total stages completed ("points") — a productivity leaderboard, distinct from the
  // 0-100 quality performanceScore shown in the detail table below. Sorted rows already come back
  // sorted by performanceScore from the API, so re-sort here by completed count for this view.
  const leaderboardRows = [...rows]
    .sort((a, b) => b.completed - a.completed)
    .map((r) => ({ key: r.email || r.doerName, name: r.doerName, score: r.completed }));
  const currentUserKey = user?.email ? rows.find((r) => r.email?.toLowerCase() === user.email?.toLowerCase())?.email : undefined;

  return (
    <div className="doer-performance-page">
      <div className="filter-bar">
        <select value={fmsId} onChange={(e) => setFmsId(e.target.value)}>
          <option value="">All FMS</option>
          {fmsList.map((f) => <option key={f.fmsId} value={f.fmsId}>{f.fmsName}</option>)}
        </select>
      </div>

      {error && <div className="login-error">{error}</div>}

      {loading ? (
        <div className="card"><SkeletonBlock rows={6} /></div>
      ) : (
        <>
          {leaderboardRows.length > 0 && (
            <>
              <div className="section-title"><i className="fas fa-medal" />Leaderboard — Stages Completed</div>
              <div style={{ marginBottom: 22 }}>
                <Leaderboard rows={leaderboardRows} currentUserKey={currentUserKey} scoreLabel="Completed" scoreSuffix=" pts" />
              </div>
            </>
          )}

          <div className="table-scroll">
            <table className="records-table">
              <thead>
                <tr>
                  <th>Doer</th><th>FMS Count</th><th>Assigned</th><th>Completed</th><th>On Time</th>
                  <th>Late</th><th>Overdue</th><th>Stalled</th><th>Avg Delay</th><th>Open Actions</th><th>Score</th>
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
