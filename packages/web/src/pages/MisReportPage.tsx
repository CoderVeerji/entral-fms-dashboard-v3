import { useEffect, useState, useCallback, type MouseEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import * as api from '../api';
import type { FmsConfig, MisReport, MisStageBreakdown, MisFmsBreakdown } from '../api';
import { KpiCard } from '../components/KpiCard';
import { exportCsv } from '../utils/csv';
import { BucketDetailPanel, type DrillTarget } from './BottleneckPage';

const COMPLETED_STATUSES = 'COMPLETED_ON_TIME,COMPLETED_LATE,COMPLETED_EARLY,UNPLANNED_COMPLETED';
const ON_TIME_STATUSES = 'COMPLETED_ON_TIME,COMPLETED_EARLY';

type ReportType = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
type ScoreMode = 'positive' | 'minus';

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}
function thisMonthStr(): string {
  return new Date().toISOString().slice(0, 7);
}
function currentFyStartYear(): number {
  const now = new Date();
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
}

// The positive/minus scoring toggle the person asked for — same underlying on-time percentage,
// shown two ways: "90%" (achievement framing) in positive mode, or "-10%" (delay-penalty framing,
// what's missing from 100%) in minus mode. Never two different underlying calculations, just two
// ways of presenting the one number, exactly matching the "100 me se 90 -> -10 ya 90" example.
function ScoreCell({ onTimePercent, mode }: { onTimePercent: number | null; mode: ScoreMode }) {
  if (onTimePercent === null) return <span style={{ color: 'var(--text-soft)' }}>—</span>;
  if (mode === 'positive') {
    const color = onTimePercent >= 90 ? 'green' : onTimePercent >= 70 ? 'amber' : 'red';
    return <span className={'badge badge-' + color}>{onTimePercent}%</span>;
  }
  const penalty = Math.round((100 - onTimePercent) * 10) / 10;
  const color = penalty <= 10 ? 'green' : penalty <= 30 ? 'amber' : 'red';
  return <span className={'badge badge-' + color}>{penalty === 0 ? '0%' : `-${penalty}%`}</span>;
}

export function MisReportPage() {
  const { token } = useAuth();
  const [fmsList, setFmsList] = useState<FmsConfig[]>([]);
  const [fmsId, setFmsId] = useState('');
  const [reportType, setReportType] = useState<ReportType>('DAILY');
  const [date, setDate] = useState(todayStr());
  const [month, setMonth] = useState(thisMonthStr());
  const [year, setYear] = useState(String(currentFyStartYear()));
  const [scoreMode, setScoreMode] = useState<ScoreMode>('positive');
  const [report, setReport] = useState<MisReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drillTarget, setDrillTarget] = useState<DrillTarget | null>(null);

  useEffect(() => {
    if (!token) return;
    api.getFmsList(token).then((res) => { if (res.ok) setFmsList(res.data); });
  }, [token]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    const res = await api.getMisReport(token, reportType, {
      fmsId: fmsId || undefined,
      date: (reportType === 'DAILY' || reportType === 'WEEKLY') ? date : undefined,
      month: reportType === 'MONTHLY' ? month : undefined,
      year: reportType === 'YEARLY' ? year : undefined,
    });
    setLoading(false);
    if (!res.ok) { setError(res.message); return; }
    setReport(res.data);
  }, [token, fmsId, reportType, date, month, year]);

  useEffect(() => { load(); }, [load]);

  function exportReport() {
    if (!report) return;
    exportCsv(`mis-report-${report.reportType.toLowerCase()}-${report.periodLabel}`,
      ['FMS', 'New', 'Completed', 'On Time', 'Late', 'Pending', 'Overdue', 'Score %'],
      report.fmsBreakdown.map((f) => [f.fmsName, f.newRecords, f.completed, f.onTime, f.late, f.pending, f.overdue, f.onTimePercent ?? '']));
  }

  function BreakdownTable({ title, rows, icon, scope }: { title: string; rows: MisStageBreakdown[]; icon: string; scope: 'stage' | 'doer' }) {
    // "Completed"/"On Time"/"Late" here are stage_events within this report's own period (see
    // misReport.ts) — the drill-down must carry the same period bounds and status grouping the
    // count was computed with, or the list wouldn't match the number shown.
    function drill(e: MouseEvent, r: MisStageBreakdown, status: string | undefined, label: string) {
      e.stopPropagation();
      if (!report) return;
      setDrillTarget({
        fmsId: fmsId || undefined, scope, key: r.key, status,
        dateFrom: report.periodStart, dateTo: report.periodEnd, label: `${r.key} — ${label} (${report.periodLabel})`,
      });
    }
    return (
      <>
        <div className="section-title"><i className={'fas ' + icon} />{title}</div>
        <div className="table-scroll" style={{ marginBottom: 22 }}>
          <table className="records-table">
            <thead>
              <tr><th>{title === 'By Stage' ? 'Stage' : 'Doer'}</th><th>Completed</th><th>On Time</th><th>Late</th><th>Score</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>{r.key}</td>
                  <td><span className="stat-link" onClick={(e) => drill(e, r, COMPLETED_STATUSES, 'Completed')}>{r.completed}</span></td>
                  <td><span className="stat-link" onClick={(e) => drill(e, r, ON_TIME_STATUSES, 'On time')}>{r.onTime}</span></td>
                  <td><span className="stat-link" onClick={(e) => drill(e, r, 'COMPLETED_LATE', 'Late')}>{r.late}</span></td>
                  <td><ScoreCell onTimePercent={r.onTimePercent} mode={scoreMode} /></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5} className="empty-state">No activity for this period.</td></tr>}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  return (
    <div className="mis-report-page">
      <div className="filter-bar">
        <select value={fmsId} onChange={(e) => setFmsId(e.target.value)}>
          <option value="">All FMS</option>
          {fmsList.map((f) => <option key={f.fmsId} value={f.fmsId}>{f.fmsName}</option>)}
        </select>
        <select value={reportType} onChange={(e) => setReportType(e.target.value as ReportType)}>
          <option value="DAILY">Daily</option>
          <option value="WEEKLY">Weekly</option>
          <option value="MONTHLY">Monthly</option>
          <option value="YEARLY">Yearly (Financial Year)</option>
        </select>
        {reportType === 'MONTHLY' ? (
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        ) : reportType === 'YEARLY' ? (
          <select value={year} onChange={(e) => setYear(e.target.value)}>
            {Array.from({ length: 6 }).map((_, i) => {
              const y = currentFyStartYear() - i;
              return <option key={y} value={y}>{`FY ${y}-${String((y + 1) % 100).padStart(2, '0')}`}</option>;
            })}
          </select>
        ) : (
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        )}
        <div style={{ display: 'flex', gap: 4 }}>
          <button className={'btn btn-sm ' + (scoreMode === 'positive' ? 'btn-primary' : 'btn-outline')} onClick={() => setScoreMode('positive')} title="Show as achievement % (e.g. 90%)">
            Positive
          </button>
          <button className={'btn btn-sm ' + (scoreMode === 'minus' ? 'btn-danger' : 'btn-outline')} onClick={() => setScoreMode('minus')} title="Show as delay penalty (e.g. -10%)">
            Minus (Delay Penalty)
          </button>
        </div>
        <div className="no-print" style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <button className="btn btn-outline btn-sm" disabled={!report} onClick={exportReport}><i className="fas fa-file-csv" /> Export CSV</button>
          <button className="btn btn-outline btn-sm" onClick={() => window.print()}><i className="fas fa-print" /> Print</button>
        </div>
      </div>

      {error && <div className="login-error">{error}</div>}
      {loading && <div className="app-loading">Loading…</div>}

      {report && !loading && (
        <>
          <div className="section-title"><i className="fas fa-calendar-days" />{report.periodLabel}</div>
          <div className="grid grid-cols-5" style={{ marginBottom: 22 }}>
            <KpiCard icon="fa-file-circle-plus" color="blue" value={report.metrics.newRecords} label="New Records" />
            <KpiCard icon="fa-circle-check" color="green" value={report.metrics.completed} label="Stages Completed" />
            <KpiCard icon="fa-clock" color="amber" value={report.metrics.completedLate} label="Completed Late" />
            <KpiCard icon="fa-hourglass-half" color="red" value={report.metrics.overdueAtEnd} label="Overdue / Stalled Now" />
            <KpiCard icon="fa-layer-group" color="grey" value={report.metrics.closingPending} label="Still Pending" />
          </div>

          <div className="grid grid-cols-2" style={{ marginBottom: 22, gap: 14 }}>
            <div className="card">
              <div style={{ fontWeight: 800, marginBottom: 8 }}>Best / Worst Stage</div>
              <div style={{ fontSize: 13, color: 'var(--text-soft)' }}>
                Best: {report.bestStage ? <>{report.bestStage.key} <ScoreCell onTimePercent={report.bestStage.onTimePercent} mode={scoreMode} /></> : '—'}<br />
                Worst: {report.worstStage ? <>{report.worstStage.key} <ScoreCell onTimePercent={report.worstStage.onTimePercent} mode={scoreMode} /></> : '—'}
              </div>
            </div>
            <div className="card">
              <div style={{ fontWeight: 800, marginBottom: 8 }}>Best / Worst Doer</div>
              <div style={{ fontSize: 13, color: 'var(--text-soft)' }}>
                Best: {report.bestDoer ? <>{report.bestDoer.key} <ScoreCell onTimePercent={report.bestDoer.onTimePercent} mode={scoreMode} /></> : '—'}<br />
                Worst: {report.worstDoer ? <>{report.worstDoer.key} <ScoreCell onTimePercent={report.worstDoer.onTimePercent} mode={scoreMode} /></> : '—'}
              </div>
            </div>
          </div>

          <div className="section-title"><i className="fas fa-layer-group" />Per-FMS Breakdown</div>
          <div className="table-scroll" style={{ marginBottom: 22 }}>
            <table className="records-table">
              <thead>
                <tr><th>FMS</th><th>New</th><th>Completed</th><th>On Time</th><th>Late</th><th>Pending</th><th>Overdue</th><th>Score</th></tr>
              </thead>
              <tbody>
                {report.fmsBreakdown.map((f: MisFmsBreakdown) => (
                  <tr key={f.fmsId}>
                    <td>{f.fmsName}</td><td>{f.newRecords}</td><td>{f.completed}</td>
                    <td>{f.onTime}</td><td>{f.late}</td><td>{f.pending}</td><td>{f.overdue}</td>
                    <td><ScoreCell onTimePercent={f.onTimePercent} mode={scoreMode} /></td>
                  </tr>
                ))}
                {report.fmsBreakdown.length === 0 && (
                  <tr><td colSpan={8} className="empty-state">No FMS activity for this period.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <BreakdownTable title="By Stage" rows={report.stageBreakdown} icon="fa-diagram-project" scope="stage" />
          <BreakdownTable title="By Doer" rows={report.doerBreakdown} icon="fa-users" scope="doer" />
        </>
      )}

      {drillTarget && <BucketDetailPanel target={drillTarget} onClose={() => setDrillTarget(null)} />}
    </div>
  );
}
