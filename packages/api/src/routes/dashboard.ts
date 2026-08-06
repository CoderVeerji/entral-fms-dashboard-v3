import { Hono } from 'hono';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { fmsMaster, fmsEvalCache, records } from '@fms/db';
import { ok } from '@fms/core';
import { requireAuth } from '../middleware/auth';
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
  const fmsIdFilter = c.req.query('fmsId');

  const fmsConditions = [eq(fmsMaster.active, true), eq(fmsMaster.isDeleted, false)];
  if (fmsIdFilter) fmsConditions.push(eq(fmsMaster.fmsId, fmsIdFilter));
  const configs = await db.select().from(fmsMaster).where(and(...fmsConditions));

  const evalRows = configs.length
    ? await db.select().from(fmsEvalCache).where(inArray(fmsEvalCache.fmsId, configs.map((c2) => c2.fmsId)))
    : [];
  const evalByFmsId = new Map(evalRows.map((r) => [r.fmsId, r]));

  const kpi = {
    totalActiveFms: configs.length, totalActiveRecords: 0, runningOnTime: 0, atRisk: 0,
    overdue: 0, stalled: 0, completedOnTime: 0, completedLate: 0, dataExceptions: 0, staleRecords: 0,
  };

  const fmsHealth = configs.map((config) => {
    const row = evalByFmsId.get(config.fmsId);
    if (!row || !row.totals) {
      return { fmsId: config.fmsId, fmsName: config.fmsName, error: 'Not synced yet', healthBadge: 'grey' as const };
    }
    const totals = row.totals as EvalTotals;
    const scores = (row.scores as EvalScores) || { overall: null };

    kpi.totalActiveRecords += totals.total;
    kpi.runningOnTime += totals.runningOnTime;
    kpi.atRisk += totals.atRisk;
    kpi.overdue += totals.overdue;
    kpi.stalled += totals.stalled;
    kpi.completedOnTime += totals.completedOnTime;
    kpi.completedLate += totals.completedLate;
    kpi.dataExceptions += totals.dataException;
    kpi.staleRecords += totals.staleRecords;

    const healthBadge = (totals.overdue > 0 || totals.stalled > 0) ? 'red' : (totals.atRisk > 0 ? 'amber' : 'green');
    return {
      fmsId: config.fmsId, fmsName: config.fmsName, error: null, overallScore: scores.overall,
      activeRecords: totals.total, overdueRecords: totals.overdue, atRiskRecords: totals.atRisk,
      stalledRecords: totals.stalled, computedAt: row.computedAt, healthBadge,
    };
  });

  // Freshness breakdown — full 5-bucket split, live indexed GROUP BY (see header comment).
  const freshnessConditions = [eq(records.isArchived, false)];
  if (fmsIdFilter) freshnessConditions.push(eq(records.fmsId, fmsIdFilter));
  else if (configs.length) freshnessConditions.push(inArray(records.fmsId, configs.map((c2) => c2.fmsId)));
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

  // Needs Attention — every connected FMS's own critical_sample (already sorted worst-delay-first
  // by packages/sync), merged and re-sorted, capped for the Dashboard's own display.
  const needsAttention: (CriticalSampleEntry & { fmsId: string; fmsName: string })[] = [];
  configs.forEach((config) => {
    const row = evalByFmsId.get(config.fmsId);
    const sample = (row?.criticalSample as CriticalSampleEntry[] | null) ?? [];
    sample.forEach((entry) => needsAttention.push({ ...entry, fmsId: config.fmsId, fmsName: config.fmsName }));
  });
  needsAttention.sort((a, b) => (b.delay?.minutes ?? 0) - (a.delay?.minutes ?? 0));

  return c.json(ok({ kpi, fmsHealth, freshness, needsAttention: needsAttention.slice(0, 20) }));
});
