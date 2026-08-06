import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import * as api from '../api';
import type { FmsConfig, DoerPerformanceRow } from '../api';
import { EmptyState } from '../components/EmptyState';
import { SkeletonBlock } from '../components/SkeletonBlock';
import { Leaderboard } from '../components/Leaderboard';

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
                  <th>Doer</th><th>FMS</th><th>Assigned</th><th>Completed</th><th>On Time</th>
                  <th>Late</th><th>Overdue</th><th>Avg Delay</th><th>Open Actions</th><th>Score</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.email || r.doerName}>
                    <td>{r.doerName}</td>
                    <td>{r.fmsCount}</td>
                    <td>{r.assignedStages}</td>
                    <td>{r.completed}</td>
                    <td>{r.onTime}</td>
                    <td>{r.late}</td>
                    <td>{r.overdue + r.stalled}</td>
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
                  <tr><td colSpan={10} style={{ padding: 0 }}><EmptyState icon="fa-users" title="No doer activity for this scope" /></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
