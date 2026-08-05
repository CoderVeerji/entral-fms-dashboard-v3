import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import * as api from '../api';
import type { DashboardKpi, FmsHealth } from '../api';
import { KpiCard } from '../components/KpiCard';

export function DashboardPage() {
  const { token } = useAuth();
  const [kpi, setKpi] = useState<DashboardKpi | null>(null);
  const [fmsHealth, setFmsHealth] = useState<FmsHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    api.getDashboard(token).then((res) => {
      setLoading(false);
      if (!res.ok) { setError(res.message); return; }
      setKpi(res.data.kpi);
      setFmsHealth(res.data.fmsHealth);
    });
  }, [token]);

  if (loading) return <div className="app-loading">Loading dashboard…</div>;
  if (error) return <div className="login-error">{error}</div>;
  if (!kpi) return null;

  return (
    <div className="dashboard-page">
      <div className="grid grid-cols-5" style={{ marginBottom: 22 }}>
        <KpiCard icon="fa-layer-group" color="blue" value={kpi.totalActiveFms} label="Connected FMS" />
        <KpiCard icon="fa-database" color="blue" value={kpi.totalActiveRecords} label="Active Records" />
        <KpiCard icon="fa-circle-play" color="blue" value={kpi.runningOnTime} label="Running On Time" />
        <KpiCard icon="fa-triangle-exclamation" color="amber" value={kpi.atRisk} label="At Risk" />
        <KpiCard icon="fa-circle-exclamation" color="red" value={kpi.overdue + kpi.stalled} label="Overdue / Stalled" />
      </div>

      <div className="section-title"><i className="fas fa-heart-pulse" />FMS Health</div>
      <div className="grid grid-cols-3">
        {fmsHealth.map((f) => (
          <div className="card" key={f.fmsId}>
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
                  {f.activeRecords} active · {f.overdueRecords} overdue · {f.atRiskRecords} at risk
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
