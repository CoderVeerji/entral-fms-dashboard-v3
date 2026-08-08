import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigation } from '../context/NavigationContext';
import * as api from '../api';
import type { DashboardKpi, FmsHealth, DashboardFreshness, NeedsAttentionEntry, FmsConfig, DoerPerformanceRow } from '../api';
import { KpiCard } from '../components/KpiCard';
import { SkeletonBlock } from '../components/SkeletonBlock';
import { ChartCard } from '../components/ChartCard';
import { StatusBadge } from '../components/StatusBadge';
import { RecordDrawer } from '../components/RecordDrawer';
import { EmptyState } from '../components/EmptyState';
import { HelpHotspot } from '../components/HelpHotspot';

const DOER_SNAPSHOT_SIZE = 5;

export function DashboardPage() {
  const { token } = useAuth();
  const { navigate } = useNavigation();
  const [fmsList, setFmsList] = useState<FmsConfig[]>([]);
  const [fmsId, setFmsId] = useState('');
  const [kpi, setKpi] = useState<DashboardKpi | null>(null);
  const [fmsHealth, setFmsHealth] = useState<FmsHealth[]>([]);
  const [freshness, setFreshness] = useState<DashboardFreshness | null>(null);
  const [needsAttention, setNeedsAttention] = useState<NeedsAttentionEntry[]>([]);
  const [doerRows, setDoerRows] = useState<DoerPerformanceRow[]>([]);
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
    const [res, doerRes] = await Promise.all([
      api.getDashboard(token, fmsId || undefined),
      api.getDoerPerformance(token, { fmsId: fmsId || undefined }),
    ]);
    setLoading(false);
    if (!res.ok) { setError(res.message); return; }
    setError(null);
    setKpi(res.data.kpi);
    setFmsHealth(res.data.fmsHealth);
    setFreshness(res.data.freshness);
    setNeedsAttention(res.data.needsAttention);
    // Doer Snapshot is a secondary widget — a permission gap or transient failure on this call
    // shouldn't blank the whole Dashboard, just leave the snapshot empty.
    setDoerRows(doerRes.ok ? doerRes.data : []);
  }, [token, fmsId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="card"><SkeletonBlock rows={8} /></div>;
  if (error) return <div className="login-error">{error}</div>;
  if (!kpi) return null;

  const erroredFms = fmsHealth.filter((f) => f.error);
  // Worst-first (most overdue+stalled) — same "worst thing first" convention as the Needs
  // Attention table below. Full detail (on-time %, delay, every doer) lives on Doer Performance;
  // this is just enough to see who's carrying the load without leaving the Dashboard.
  const topDoers = [...doerRows].sort((a, b) => (b.overdue + b.stalled) - (a.overdue + a.stalled)).slice(0, DOER_SNAPSHOT_SIZE);

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
        <div onClick={() => navigate('liveRecords', fmsId ? { fmsId } : {})} style={{ cursor: 'pointer', position: 'relative' }}>
          <KpiCard icon="fa-database" color="blue" value={kpi.totalActiveRecords} label="Active Records" />
          <HelpHotspot title="Active Records"
            en="The total count of every record across your connected FMS — running, completed, everything — except ones marked archived. Not just the pending ones; see Running On Time/At Risk/Overdue/Stalled below for the pending breakdown."
            hi="Saari connected FMS ke saare records ka total count — running, completed, sab kuch — sirf archived records isme nahi aate. Ye sirf pending wale nahi hain; pending ka breakdown neeche Running On Time/At Risk/Overdue/Stalled cards mein dekho." />
        </div>
        <div onClick={() => navigate('liveRecords', { ...(fmsId ? { fmsId } : {}), status: 'RUNNING_ON_TIME' })} style={{ cursor: 'pointer', position: 'relative' }}>
          <KpiCard icon="fa-circle-play" color="blue" value={kpi.runningOnTime} label="Running On Time" />
          <HelpHotspot title="Running On Time"
            en="Records on schedule right now — their current step still has time before its deadline. Nothing to worry about yet."
            hi="Records jo abhi time pe chal rahe hain — current step ki deadline aane me abhi time hai. Abhi tension lene wali baat nahi." />
        </div>
        <div onClick={() => navigate('liveRecords', { ...(fmsId ? { fmsId } : {}), status: 'AT_RISK' })} style={{ cursor: 'pointer', position: 'relative' }}>
          <KpiCard icon="fa-triangle-exclamation" color="amber" value={kpi.atRisk} label="At Risk" />
          <HelpHotspot title="At Risk"
            en="Records whose current step's deadline is coming up very soon. Worth checking now, before they slip into Overdue."
            hi="Records jinke current step ki deadline bahut jald aane wali hai. Abhi check kar lo, warna Overdue ho jayenge." />
        </div>
        <div onClick={() => navigate('liveRecords', { ...(fmsId ? { fmsId } : {}), status: 'OVERDUE' })} style={{ cursor: 'pointer', position: 'relative' }}>
          <KpiCard icon="fa-circle-exclamation" color="red" value={kpi.overdue} label="Overdue" />
          <HelpHotspot title="Overdue"
            en="Records that missed their planned deadline and are still not done. These need attention first."
            hi="Records jinki planned deadline nikal chuki hai aur abhi tak complete nahi hue. Inko sabse pehle dekho." />
        </div>
        <div onClick={() => navigate('liveRecords', { ...(fmsId ? { fmsId } : {}), status: 'STALLED' })} style={{ cursor: 'pointer', position: 'relative' }}>
          <KpiCard icon="fa-hourglass-half" color="red" value={kpi.stalled} label="Stalled (no deadline set)" />
          <HelpHotspot title="Stalled"
            en="Records whose current step never got a deadline (plan time) at all, and nobody has touched them in a while — different from Overdue, which had a deadline that got missed."
            hi="Records jinke current step ka koi deadline (plan time) kabhi tha hi nahi, aur kaafi time se koi update nahi aaya — Overdue se alag hai, wahan deadline miss hui thi, yahan deadline thi hi nahi." />
        </div>
      </div>

      <div className="section-title">
        <i className="fas fa-calendar-day" />Today's Workload
        <HelpHotspot inline title="Today's Workload"
          en="Every record with a real deadline, grouped by calendar date instead of by status — a simpler question than the status cards above: what's due today, what's already late from before today, and what's coming later. A record due at 9am today and still open counts as 'Due Today' here even though it's already Overdue above — this is a date view, not a status view."
          hi="Har record jiska real deadline hai, status ki jagah calendar date ke hisab se group kiya gaya hai — upar wale status cards se ek simple sawaal: aaj kya due hai, aaj se pehle ka kya miss ho chuka hai, aur aage kya aane wala hai. Jo record aaj subah 9 baje due tha aur abhi bhi khula hai, wo yahan 'Due Today' mein ginega chahe upar wo already Overdue ho — ye date wala view hai, status wala nahi." />
      </div>
      <div className="grid grid-cols-3" style={{ marginBottom: 22 }}>
        <div onClick={() => navigate('liveRecords', { ...(fmsId ? { fmsId } : {}), workload: 'dueToday' })} style={{ cursor: 'pointer', position: 'relative' }}>
          <KpiCard icon="fa-calendar-check" color="blue" value={kpi.dueToday} label="Due Today" />
          <HelpHotspot title="Due Today"
            en="Records whose current step's deadline falls today — whether that time has already passed today or is still ahead."
            hi="Records jinke current step ki deadline aaj ki hai — chahe wo time aaj nikal chuka ho ya abhi aana baaki ho." />
        </div>
        <div onClick={() => navigate('liveRecords', { ...(fmsId ? { fmsId } : {}), workload: 'overdueBeforeToday' })} style={{ cursor: 'pointer', position: 'relative' }}>
          <KpiCard icon="fa-calendar-xmark" color="red" value={kpi.overdueBeforeToday} label="Overdue (Before Today)" />
          <HelpHotspot title="Overdue (Before Today)"
            en="Records whose deadline was on some earlier date and are still not done — carried over from a previous day, not just today's list."
            hi="Records jinki deadline kisi pehle wali date ki thi aur abhi tak complete nahi hue — pichle kisi din se carry over hue hain, sirf aaj ki list nahi." />
        </div>
        <div onClick={() => navigate('liveRecords', { ...(fmsId ? { fmsId } : {}), workload: 'upcoming' })} style={{ cursor: 'pointer', position: 'relative' }}>
          <KpiCard icon="fa-calendar-plus" color="green" value={kpi.upcoming} label="Upcoming" />
          <HelpHotspot title="Upcoming"
            en="Records whose deadline is on some future date — not due yet, nothing to do right now."
            hi="Records jinki deadline aane wali kisi date ki hai — abhi due nahi hai, abhi kuch karne ki zaroorat nahi." />
        </div>
      </div>

      {freshness && (
        <div onClick={() => navigate('updateHealth', fmsId ? { fmsId } : {})} style={{ cursor: 'pointer', position: 'relative' }}>
          <div className="section-title">
            <i className="fas fa-bolt" />Data Freshness
            <HelpHotspot inline title="Data Freshness"
              en="How recently each record was last touched — this is about activity, not deadlines. A record can be 'Running On Time' above and still count here if nobody has updated it in a while. Click through to Update Health for the full breakdown by how long."
              hi="Har record ko last kab touch kiya gaya — ye deadline ke baare mein nahi hai, activity ke baare mein hai. Ek record 'Running On Time' bhi ho sakta hai aur yahan bhi gin sakta hai agar koi update nahi aaya. Poora breakdown (kitne din se) dekhne ke liye Update Health pe click karo." />
          </div>
          <KpiCard icon="fa-magnifying-glass" color="amber"
            value={freshness.warning + freshness.stale + freshness.critical + freshness.never}
            label="Needs a Check (Warning + Stale + Critical + Never Updated)" />
        </div>
      )}

      <div className="section-title">
        <i className="fas fa-heart-pulse" />FMS Health
        <HelpHotspot inline title="FMS Health"
          en="Each connected FMS's overall score (0-100) — combines how many records are overdue/stalled, data quality issues, and freshness. Click a card's numbers to see exactly which records they count."
          hi="Har connected FMS ka overall score (0-100) — kitne records overdue/stalled hain, data quality issues, aur freshness sab milakar. Card ke numbers pe click karke exact records dekh sakte ho." />
      </div>
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
                  {/* Each count drills into Live Records pre-filtered to exactly what it's counting —
                      stopPropagation so clicking a number doesn't also fire the card's own
                      fmsId-only click-through above it. */}
                  <span className="stat-link" onClick={(e) => { e.stopPropagation(); navigate('liveRecords', { fmsId: f.fmsId }); }}>
                    {f.activeRecords} active
                  </span>
                  {' · '}
                  <span className="stat-link" onClick={(e) => { e.stopPropagation(); navigate('liveRecords', { fmsId: f.fmsId, status: 'OVERDUE' }); }}>
                    {f.overdueRecords} overdue
                  </span>
                  {' · '}
                  <span className="stat-link" onClick={(e) => { e.stopPropagation(); navigate('liveRecords', { fmsId: f.fmsId, status: 'STALLED' }); }}>
                    {f.stalledRecords} stalled
                  </span>
                  {' · '}
                  <span className="stat-link" onClick={(e) => { e.stopPropagation(); navigate('liveRecords', { fmsId: f.fmsId, status: 'AT_RISK' }); }}>
                    {f.atRiskRecords} at risk
                  </span>
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

      <div className="section-title">
        <i className="fas fa-users" />Doer Snapshot
        <HelpHotspot inline title="Doer Snapshot"
          en="Who's carrying the most pending/overdue work right now, across every connected FMS — worst first. This is a quick glance only; click through for on-time %, delay, and every doer, not just the top few."
          hi="Abhi sabse zyada pending/overdue kaam kiske paas hai, saari connected FMS mein se — sabse zyada wala pehle. Ye sirf quick glance hai; on-time %, delay, aur har doer (sirf top wale nahi) dekhne ke liye click karo." />
      </div>
      <div className="card" style={{ marginBottom: 22 }}>
        {topDoers.map((d) => (
          <div key={d.email || d.doerName} className="stat-row" style={{ cursor: 'pointer' }}
            onClick={() => navigate('liveRecords', { doer: d.doerName, status: 'OVERDUE' })}>
            <span>{d.doerName} <span style={{ color: 'var(--text-soft)', fontSize: 12 }}>({d.fmsCount} FMS)</span></span>
            <b>
              <span className="stat-link" onClick={(e) => { e.stopPropagation(); navigate('liveRecords', { doer: d.doerName }); }}>{d.pending} pending</span>
              {' · '}
              <span className="stat-link" onClick={(e) => { e.stopPropagation(); navigate('liveRecords', { doer: d.doerName, status: 'OVERDUE' }); }}>{d.overdue} overdue</span>
            </b>
          </div>
        ))}
        {topDoers.length === 0 && <EmptyState icon="fa-users" title="No doer activity yet" />}
        <div style={{ marginTop: 12, textAlign: 'right' }}>
          <button className="btn btn-outline btn-sm" onClick={() => navigate('doerPerformance')}>View full Doer Performance report →</button>
        </div>
      </div>

      <div className="section-title">
        <i className="fas fa-triangle-exclamation" />Needs Attention
        <HelpHotspot inline title="Needs Attention"
          en="The most urgent records right now, across every connected FMS — overdue, stalled, or critically stale — sorted worst delay first. Click a row to open its full detail."
          hi="Abhi ke sabse zaroori records, saari connected FMS mein se — overdue, stalled, ya critically stale — sabse zyada delay wale pehle. Row pe click karke poora detail khul jayega." />
      </div>
      <div className="table-scroll" style={{ marginBottom: 22 }}>
        <table className="records-table">
          <thead>
            <tr><th>Record</th><th>FMS</th><th>Stage</th><th>Doer</th><th>Status</th><th>Delay</th><th>Freshness</th><th></th></tr>
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
                <td className="row-view-cell" title="View details"><i className="fas fa-eye" /></td>
              </tr>
            ))}
            {needsAttention.length === 0 && (
              <tr><td colSpan={8} style={{ padding: 0 }}><EmptyState icon="fa-circle-check" title="Nothing needs urgent attention right now" /></td></tr>
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
