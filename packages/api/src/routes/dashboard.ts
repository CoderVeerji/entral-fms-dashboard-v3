import { Hono } from 'hono';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { fmsMaster, fmsEvalCache, records, actionItems } from '@fms/db';
import { ok, type FinalizedBucket } from '@fms/core';
import { requireAuth } from '../middleware/auth';
import { parseCsvParam } from '../queryHelpers';
import type { Variables } from '../types';

// Direct successor to app/Code.gs's getDashboardData — reads the small, already-computed
// fms_eval_cache row per FMS (refreshed by packages/sync every run, see
// refreshFmsEvalCache in packages/sync/src/upsert.ts) instead of scanning every record, same
// "cache-only, never live-compute on a user's click" principle the old app's getFmsLiteEval_
// followed. Freshness breakdown is the one exception — a live indexed GROUP BY on `records`
// (idx_records_fms_freshness) is cheap even at this app's current scale and fms_eval_cache's
// totals only carries Stale/Critical/Never, not the full Fresh/Warning/Stale/Critical/Never split
// the Dashboard needs.
export const dashboardRoutes = new Hono<{ Variables: Variables }>();

interface EvalTotals {
  total: number; runningOnTime: number; atRisk: number; overdue: number; stalled: number;
  completedOnTime: number; completedLate: number; dataException: number; staleRecords: number;
}
interface EvalScores { overall: number | null }
interface CriticalSampleEntry {
  recordId: string; displayName: string | null; currentStage: string | null; doer: string | null;
  planTime: string | null; delay: { minutes: number; human: string | null } | null;
  lastUpdate: string | null; freshness: string; recordStatus: string;
}

dashboardRoutes.get('/', requireAuth('dashboard.view'), async (c) => {
  const db = c.get('db');
  // ?fmsId=a,b,c — multi-select from MultiSelectDropdown.tsx; a single value still works
  // unchanged. ?doer=x,y scopes only Today's Workload below — fmsHealth/kpi/topBottleneckStages
  // read from fms_eval_cache, an FMS-level aggregate with no doer dimension, so doer-filtering
  // those would mean live-recomputing them per request; not done here (see M11 plan).
  const fmsIdFilters = parseCsvParam(c.req.query('fmsId'));
  const doerFilters = parseCsvParam(c.req.query('doer'));

  const fmsConditions = [eq(fmsMaster.active, true), eq(fmsMaster.isDeleted, false)];
  if (fmsIdFilters.length) fmsConditions.push(inArray(fmsMaster.fmsId, fmsIdFilters));
  const configs = await db.select().from(fmsMaster).where(and(...fmsConditions));

  const evalRows = configs.length
    ? await db.select().from(fmsEvalCache).where(inArray(fmsEvalCache.fmsId, configs.map((c2) => c2.fmsId)))
    : [];
  const evalByFmsId = new Map(evalRows.map((r) => [r.fmsId, r]));

  const kpi = {
    totalActiveFms: configs.length, totalActiveRecords: 0, runningOnTime: 0, atRisk: 0,
    overdue: 0, stalled: 0, completedOnTime: 0, completedLate: 0, dataExceptions: 0, staleRecords: 0,
    dueToday: 0, overdueBeforeToday: 0, upcoming: 0, completedToday: 0, openActions: 0,
  };

  // Every FMS's top bottleneck stage, merged and re-sorted — same "read the already-sorted cache,
  // never recompute live" principle as fmsHealth/needsAttention below. stage_bottlenecks is stored
  // pre-sorted by bottleneckScore descending (see packages/sync/src/upsert.ts), so [0] is always
  // that FMS's worst stage without needing to re-sort per FMS.
  const topBottleneckStages: (FinalizedBucket & { fmsId: string; fmsName: string })[] = [];

  const fmsHealth = configs.map((config) => {
    const row = evalByFmsId.get(config.fmsId);
    if (!row || !row.totals) {
      return { fmsId: config.fmsId, fmsName: config.fmsName, error: 'Not synced yet', healthBadge: 'grey' as const };
    }
    const totals = row.totals as EvalTotals;
    const scores = (row.scores as EvalScores) || { overall: null };
    const stageBottlenecks = (row.stageBottlenecks as FinalizedBucket[] | null) ?? [];

    kpi.totalActiveRecords += totals.total;
    kpi.runningOnTime += totals.runningOnTime;
    kpi.atRisk += totals.atRisk;
    kpi.overdue += totals.overdue;
    kpi.stalled += totals.stalled;
    kpi.completedOnTime += totals.completedOnTime;
    kpi.completedLate += totals.completedLate;
    kpi.dataExceptions += totals.dataException;
    kpi.staleRecords += totals.staleRecords;
    kpi.completedToday += row.completedToday ?? 0;
    stageBottlenecks.forEach((b) => topBottleneckStages.push({ ...b, fmsId: config.fmsId, fmsName: config.fmsName }));

    const healthBadge = (totals.overdue > 0 || totals.stalled > 0) ? 'red' : (totals.atRisk > 0 ? 'amber' : 'green');
    return {
      fmsId: config.fmsId, fmsName: config.fmsName, error: null, overallScore: scores.overall,
      activeRecords: totals.total, overdueRecords: totals.overdue, atRiskRecords: totals.atRisk,
      stalledRecords: totals.stalled, computedAt: row.computedAt, healthBadge,
      currentBottleneck: stageBottlenecks[0]?.key ?? null,
    };
  });

  topBottleneckStages.sort((a, b) => b.bottleneckScore - a.bottleneckScore);

  // Open Actions — company-wide (or FMS-scoped) count of action items still needing attention,
  // same "not resolved/cancelled" definition doerPerformance.ts's own open-actions query already
  // uses (see that file's beforeAll comment for why "not in" rather than an allowlist).
  if (configs.length) {
    const fmsIds = configs.map((c2) => c2.fmsId);
    const [openActionsRow] = await db.select({ count: sql<number>`count(*)` }).from(actionItems)
      .where(and(eq(actionItems.isDeleted, false), inArray(actionItems.fmsId, fmsIds), notInArray(actionItems.status, ['Resolved', 'Cancelled'])));
    kpi.openActions = Number(openActionsRow?.count ?? 0);
  }

  // Freshness breakdown — full 5-bucket split, live indexed GROUP BY (see header comment).
  // NOT_STARTED (current stage has no plan time — see FMS_Status_Publisher.gs's evaluateRecord_)
  // excluded here too, same as updateHealth.ts, so the two pages' numbers agree: a record nobody
  // has scheduled yet isn't "gone quiet", it's just not started.
  const freshnessConditions = [eq(records.isArchived, false), sql`${records.recordStatus} != 'NOT_STARTED'`];
  if (configs.length) freshnessConditions.push(inArray(records.fmsId, configs.map((c2) => c2.fmsId)));
  const freshnessRows = configs.length
    ? await db.select({ freshness: records.freshness, count: sql<number>`count(*)` })
        .from(records).where(and(...freshnessConditions)).groupBy(records.freshness)
    : [];
  const freshness = { fresh: 0, warning: 0, stale: 0, critical: 0, never: 0 };
  freshnessRows.forEach((r) => {
    const n = Number(r.count);
    if (r.freshness === 'Fresh') freshness.fresh = n;
    else if (r.freshness === 'Warning') freshness.warning = n;
    else if (r.freshness === 'Stale') freshness.stale = n;
    else if (r.freshness === 'Critical') freshness.critical = n;
    else freshness.never += n; // 'Never' or null
  });

  // Today's Workload — every record with a real plan time on its current stage, bucketed by
  // calendar date against the server's own "today" (same date_trunc('day', now()) convention
  // misReport.ts's DAILY/WEEKLY/MONTHLY boundaries and updateHealth.ts's todayOnly filter already
  // use — not introducing IST-specific handling that no other feature in this app has). No status
  // filter needed: only RUNNING_ON_TIME/AT_RISK/OVERDUE records ever have a non-null planTime
  // (completed and NOT_STARTED records always have it null — see evaluateRecord_), so planTime IS
  // NOT NULL alone already means "has a real, tracked deadline". Deliberately a coarser, date-only
  // lens than the minute-precision recordStatus above it — a record due at 9am today and still
  // open is "Due Today" here even though it's already OVERDUE by status.
  const workloadConditions = [eq(records.isArchived, false), sql`${records.planTime} is not null`];
  if (configs.length) workloadConditions.push(inArray(records.fmsId, configs.map((c2) => c2.fmsId)));
  if (doerFilters.length) workloadConditions.push(inArray(records.doer, doerFilters));
  const workloadRows = configs.length
    ? await db.select({
        dueToday: sql<number>`count(*) filter (where ${records.planTime} >= date_trunc('day', now()) and ${records.planTime} < date_trunc('day', now()) + interval '1 day')`,
        overdueBeforeToday: sql<number>`count(*) filter (where ${records.planTime} < date_trunc('day', now()))`,
        upcoming: sql<number>`count(*) filter (where ${records.planTime} >= date_trunc('day', now()) + interval '1 day')`,
      }).from(records).where(and(...workloadConditions))
    : [{ dueToday: 0, overdueBeforeToday: 0, upcoming: 0 }];
  kpi.dueToday = Number(workloadRows[0]?.dueToday ?? 0);
  kpi.overdueBeforeToday = Number(workloadRows[0]?.overdueBeforeToday ?? 0);
  kpi.upcoming = Number(workloadRows[0]?.upcoming ?? 0);

  // Needs Attention — every connected FMS's own critical_sample (already sorted worst-delay-first
  // by packages/sync), merged and re-sorted, capped for the Dashboard's own display.
  const needsAttention: (CriticalSampleEntry & { fmsId: string; fmsName: string })[] = [];
  configs.forEach((config) => {
    const row = evalByFmsId.get(config.fmsId);
    const sample = (row?.criticalSample as CriticalSampleEntry[] | null) ?? [];
    sample.forEach((entry) => needsAttention.push({ ...entry, fmsId: config.fmsId, fmsName: config.fmsName }));
  });
  needsAttention.sort((a, b) => (b.delay?.minutes ?? 0) - (a.delay?.minutes ?? 0));

  return c.json(ok({
    kpi, fmsHealth, freshness, needsAttention: needsAttention.slice(0, 20),
    topBottleneckStages: topBottleneckStages.slice(0, 5),
  }));
});

// Backs UpcomingCalendarModal.tsx — every record counted in the Dashboard's own "Upcoming" card
// (see the identical date_trunc('day', now()) + interval '1 day' boundary above), grouped by
// calendar date instead of summed into one number. Returns every future date bucket in one call
// (v1 doesn't paginate by month server-side — this app's current record volume makes that an
// unnecessary mechanism to build ahead of need; month navigation is cheap to do client-side over
// the already-fetched array).
dashboardRoutes.get('/upcoming-calendar', requireAuth('dashboard.view'), async (c) => {
  const db = c.get('db');
  const fmsIdFilters = parseCsvParam(c.req.query('fmsId'));
  const doerFilters = parseCsvParam(c.req.query('doer'));

  const fmsConditions = [eq(fmsMaster.active, true), eq(fmsMaster.isDeleted, false)];
  if (fmsIdFilters.length) fmsConditions.push(inArray(fmsMaster.fmsId, fmsIdFilters));
  const configs = await db.select({ fmsId: fmsMaster.fmsId }).from(fmsMaster).where(and(...fmsConditions));
  if (!configs.length) return c.json(ok([]));

  const conditions = [
    eq(records.isArchived, false),
    inArray(records.fmsId, configs.map((c2) => c2.fmsId)),
    sql`${records.planTime} >= date_trunc('day', now()) + interval '1 day'`,
  ];
  if (doerFilters.length) conditions.push(inArray(records.doer, doerFilters));

  const rows = await db.select({
    date: sql<string>`to_char(date_trunc('day', ${records.planTime}), 'YYYY-MM-DD')`,
    count: sql<number>`count(*)`,
  }).from(records).where(and(...conditions)).groupBy(sql`date_trunc('day', ${records.planTime})`);

  return c.json(ok(rows.map((r) => ({ date: r.date, count: Number(r.count) }))));
});
