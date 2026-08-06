import { Fragment, useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import * as api from '../api';
import type { FmsConfig, BottleneckBucket } from '../api';

function scoreColor(score: number): string {
  if (score >= 10) return 'red';
  if (score >= 4) return 'amber';
  return 'green';
}

function BucketTable({ rows, keyLabel }: { rows: BottleneckBucket[]; keyLabel: string }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  return (
    <div className="table-scroll">
      <table className="records-table">
        <thead>
          <tr>
            <th>{keyLabel}</th><th>FMS</th><th>Assigned</th><th>Overdue</th><th>Stalled</th>
            <th>Completed Late</th><th>On-Time %</th><th>Avg Delay</th><th>Score</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b, i) => (
            <Fragment key={i}>
              <tr onClick={() => setExpanded(expanded === i ? null : i)} style={{ cursor: 'pointer' }}>
                <td>{b.key}</td>
                <td>{b.fmsName}</td>
                <td>{b.assigned}</td>
                <td>{b.overdue}</td>
                <td>{b.stalled}</td>
                <td>{b.late}</td>
                <td>{b.onTimePercent != null ? `${b.onTimePercent}%` : '—'}</td>
                <td>{b.avgDelayHuman || '—'}</td>
                <td><span className={'badge badge-' + scoreColor(b.bottleneckScore)}>{b.bottleneckScore}</span></td>
              </tr>
              {expanded === i && (
                <tr>
                  <td colSpan={9} style={{ background: 'var(--panel-bg, #F8FAFD)', fontSize: 12.5, color: 'var(--text-soft)', padding: '10px 14px' }}>
                    {b.reason}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={9} className="empty-state">No bottleneck activity for this scope.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function BottleneckPage() {
  const { token } = useAuth();
  const [fmsList, setFmsList] = useState<FmsConfig[]>([]);
  const [fmsId, setFmsId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [view, setView] = useState<'stage' | 'doer'>('stage');
  const [byStage, setByStage] = useState<BottleneckBucket[]>([]);
  const [byDoer, setByDoer] = useState<BottleneckBucket[]>([]);
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
    const res = await api.getBottlenecks(token, { fmsId: fmsId || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined });
    setLoading(false);
    if (!res.ok) { setError(res.message); return; }
    setByStage(res.data.byStage);
    setByDoer(res.data.byDoer);
  }, [token, fmsId, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="bottleneck-page">
      <div className="filter-bar">
        <select value={fmsId} onChange={(e) => setFmsId(e.target.value)}>
          <option value="">All FMS</option>
          {fmsList.map((f) => <option key={f.fmsId} value={f.fmsId}>{f.fmsName}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          <button className={view === 'stage' ? 'tab-active' : ''} onClick={() => setView('stage')}>By Stage</button>
          <button className={view === 'doer' ? 'tab-active' : ''} onClick={() => setView('doer')}>By Doer</button>
        </div>
      </div>

      {error && <div className="login-error">{error}</div>}
      {loading ? <div className="app-loading">Loading…</div> : (
        view === 'stage'
          ? <BucketTable rows={byStage} keyLabel="Stage" />
          : <BucketTable rows={byDoer} keyLabel="Doer" />
      )}
    </div>
  );
}
