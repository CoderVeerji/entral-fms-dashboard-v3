import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigation } from '../context/NavigationContext';
import * as api from '../api';
import type { DashboardKpi, FmsHealth, DashboardFreshness, NeedsAttentionEntry, FmsConfig } from '../api';
import { KpiCard } from '../components/KpiCard';
import { SkeletonBlock } from '../components/SkeletonBlock';
import { ChartCard } from '../components/ChartCard';
import { StatusBadge } from '../components/StatusBadge';
import { RecordDrawer } from '../components/RecordDrawer';
import { EmptyState } from '../components/EmptyState';

export function DashboardPage() {
  const { token } = useAuth();
  const { navigate } = useNavigation();
  const [fmsList, setFmsList] = useState<FmsConfig[]>([]);
  const [fmsId, setFmsId] = useState('');
  const [kpi, setKpi] = useState<DashboardKpi | null>(null);
  const [fmsHealth, setFmsHealth] = useState<FmsHealth[]>([]);
  const [freshness, setFreshness] = useState<DashboardFreshness | null>(null);
  const [needsAttention, setNeedsAttention] = useState<NeedsAttentionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ fmsId: string; recordId: string } | null>(null);

  useEffect(() => {
    if (!token) return;
    api.getFmsList(token).then((res) => { if (res.ok) setFmsList(res.data); });
  }, [token]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const res = await api.getDashboard(token, fmsId || undefined);
    setLoading(false);
    if (!res.ok) { setError(res.message); return; }
    setError(null);
    setKpi(res.data.kpi);
    setFmsHealth(res.data.fmsHealth);
    setFreshness(res.data.freshness);
    setNeedsAttention(res.data.needsAttention);
  }, [token, fmsId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="card"><SkeletonBlock rows={8} /></div>;
  if (error) return <div className="login-error">{error}</div>;
  if (!kpi) return null;

  const erroredFms = fmsHealth.filter((f) => f.error);

  return (
    <div className="dashboard-page">
      <div className="filter-bar">
        <select value={fmsId} onChange={(e) => setFmsId(e.target.value)}>
          <option value="">All FMS</option>
          {fmsList.map((f) => <option key={f.fmsId} value={f.fmsId}>{f.fmsName}</option>)}
        </select>
      </div>

      {erroredFms.length > 0 && (
        <div className="login-error" style={{ marginBottom: 18 }}>
          <i className="fas fa-triangle-exclamation" /> {erroredFms.length} FMS source{erroredFms.length === 1 ? '' : 's'} not syncing right now:{' '}
          {erroredFms.map((f) => f.fmsName).join(', ')}
        </div>
      )}

      {/* Every KPI card jumps to Live Records pre-filtered to what it's counting — same
          click-through the v1 app had, so a number is never a dead end. Overdue and Stalled are
          split (not merged into one card) since they have different root causes — a missed
          deadline vs. one that was never set — and Stalled is often the dominant issue. */}
      <div className="grid grid-cols-5" style={{ marginBottom: 22 }}>
        <div onClick={() => navigate('liveRecords', fmsId ? { fmsId } : {})} style={{ cursor: 'pointer' }}>
          <KpiCard icon="fa-database" color="blue" value={kpi.totalActiveRecords} label="Active Records" />
        </div>
        <div onClick={() => navigate('liveRecords', { ...(fmsId ? { fmsId } : {}), status: 'RUNNING_ON_TIME' })} style={{ cursor: 'pointer' }}>
          <KpiCard icon="fa-circle-play" color="blue" value={kpi.runningOnTime} label="Running On Time" />
        </div>
        <div onClick={() => navigate('liveRecords', { ...(fmsId ? { fmsId } : {}), status: 'AT_RISK' })} style={{ cursor: 'pointer' }}>
          <KpiCard icon="fa-triangle-exclamation" color="amber" value={kpi.atRisk} label="At Risk" />
        </div>
        <div onClick={() => navigate('liveRecords', { ...(fmsId ? { fmsId } : {}), status: 'OVERDUE' })} style={{ cursor: 'pointer' }}>
          <KpiCard icon="fa-circle-exclamation" color="red" value={kpi.overdue} label="Overdue" />
        </div>
        <div onClick={() => navigate('liveRecords', { ...(fmsId ? { fmsId } : {}), status: 'STALLED' })} style={{ cursor: 'pointer' }}>
          <KpiCard icon="fa-hourglass-half" color="red" value={kpi.stalled} label="Stalled (no deadline set)" />
        </div>
      </div>

      {freshness && (
        <>
          <div className="section-title"><i className="fas fa-bolt" />Data Freshness</div>
          <div className="grid grid-cols-5" style={{ marginBottom: 22 }}>
            <div onClick={() => navigate('updateHealth', { ...(fmsId ? { fmsId } : {}), freshness: 'Fresh' })} style={{ cursor: 'pointer' }}>
              <KpiCard icon="fa-check" color="green" value={freshness.fresh} label="Fresh" />
            </div>
            <div onClick={() => navigate('updateHealth', { ...(fmsId ? { fmsId } : {}), freshness: 'Warning' })} style={{ cursor: 'pointer' }}>
              <KpiCard icon="fa-clock" color="amber" value={freshness.warning} label="Warning" />
            </div>
            <div onClick={() => navigate('updateHealth', { ...(fmsId ? { fmsId } : {}), freshness: 'Stale' })} style={{ cursor: 'pointer' }}>
              <KpiCard icon="fa-hourglass-half" color="red" value={freshness.stale} label="Stale" />
            </div>
            <div onClick={() => navigate('updateHealth', { ...(fmsId ? { fmsId } : {}), freshness: 'Critical' })} style={{ cursor: 'pointer' }}>
              <KpiCard icon="fa-fire" color="red" value={freshness.critical} label="Critical" />
            </div>
            <div onClick={() => navigate('updateHealth', { ...(fmsId ? { fmsId } : {}), freshness: 'Never' })} style={{ cursor: 'pointer' }}>
              <KpiCard icon="fa-ban" color="grey" value={freshness.never} label="Never Updated" />
            </div>
          </div>
        </>
      )}

      <div className="section-title"><i className="fas fa-heart-pulse" />FMS Health</div>
      <div className="grid grid-cols-3" style={{ marginBottom: 22 }}>
        {fmsHealth.map((f) => (
          <div className="card" key={f.fmsId} onClick={() => navigate('liveRecords', { fmsId: f.fmsId })} style={{ cursor: 'pointer' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div style={{ fontWeight: 800, color: 'var(--navy)' }}>{f.fmsName}</div>
              <span className={'badge badge-' + f.healthBadge}>
                {f.healthBadge === 'green' ? 'Healthy' : f.healthBadge === 'amber' ? 'Watch' : f.healthBadge === 'red' ? 'Critical' : 'Pending'}
              </span>
            </div>
            {f.error ? (
              <div style={{ fontSize: 12, color: 'var(--text-soft)' }}>{f.error}</div>
            ) : (
              <>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--navy)' }}>
                  {f.overallScore != null ? f.overallScore.toFixed(1) : '—'}
                  <span style={{ fontSize: 12, color: 'var(--text-soft)', fontWeight: 600 }}> / 100</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-soft)', marginTop: 4 }}>
                  {f.activeRecords} active · {f.overdueRecords} overdue · {f.stalledRecords} stalled · {f.atRiskRecords} at risk
                </div>
              </>
            )}
          </div>
        ))}
        {fmsHealth.length === 0 && (
          <div className="card" style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--text-soft)', padding: 30 }}>
            No connected FMS yet.
          </div>
        )}
      </div>

      <div className="section-title"><i className="fas fa-triangle-exclamation" />Needs Attention</div>
      <div className="table-scroll" style={{ marginBottom: 22 }}>
        <table className="records-table">
          <thead>
            <tr><th>Record</th><th>FMS</th><th>Stage</th><th>Doer</th><th>Status</th><th>Delay</th><th>Freshness</th></tr>
          </thead>
          <tbody>
            {needsAttention.map((r) => (
              <tr key={`${r.fmsId}:${r.recordId}`} className="row-clickable" onClick={() => setSelected({ fmsId: r.fmsId, recordId: r.recordId })}>
                <td>{r.displayName || r.recordId}</td>
                <td>{r.fmsName}</td>
                <td>{r.currentStage || '—'}</td>
                <td>{r.doer || '—'}</td>
                <td><StatusBadge status={r.recordStatus} /></td>
                <td>{r.delay?.human || '—'}</td>
                <td><StatusBadge status={r.freshness} /></td>
              </tr>
            ))}
            {needsAttention.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 0 }}><EmptyState icon="fa-circle-check" title="Nothing needs urgent attention right now" /></td></tr>
            )}
          </tbody>
        </table>
      </div>

      {fmsHealth.some((f) => !f.error) && (
        <div className="grid grid-cols-2">
          <ChartCard
            title="FMS Health Scores" type="bar"
            labels={fmsHealth.filter((f) => !f.error).map((f) => f.fmsName)}
            datasets={[{ label: 'Overall Score', data: fmsHealth.filter((f) => !f.error).map((f) => f.overallScore ?? 0) }]}
          />
          <ChartCard
            title="Record Status Distribution" type="doughnut"
            labels={['Running On Time', 'At Risk', 'Overdue', 'Stalled', 'Completed On Time', 'Completed Late']}
            datasets={[{ data: [kpi.runningOnTime, kpi.atRisk, kpi.overdue, kpi.stalled, kpi.completedOnTime, kpi.completedLate] }]}
          />
        </div>
      )}

      {selected && (
        <RecordDrawer fmsId={selected.fmsId} recordId={selected.recordId} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
