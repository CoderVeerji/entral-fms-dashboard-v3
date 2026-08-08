import { Hono } from 'hono';
import { and, eq, inArray, ne, notInArray } from 'drizzle-orm';
import { fmsMaster, fmsEvalCache, actionItems } from '@fms/db';
import { ok, safeRatio, scoreOrNull, computeLatenessPenalty, SCORING, finalizeBucket, type FinalizedBucket } from '@fms/core';
import { requireAuth } from '../middleware/auth';
import { computeLiveBuckets, parseFilterDate } from '../liveAggregation';
import type { Variables } from '../types';

// Direct successor to app/Code.gs's getDoerPerformance — rolls up each doer's per-FMS bucket
// across every FMS they touch, then applies a weighted score (SCORING.DOER_WEIGHTS) judged purely
// on timeliness/lateness, never on how much work someone was given (a senior with few tasks and
// perfect timeliness scores exactly as well as someone with hundreds — see constants.ts's comment
// on DOER_WEIGHTS). Without a date range: reads the pre-aggregated buckets already sitting in
// fms_eval_cache (written by packages/sync every run), same "cache-only" principle as the
// Dashboard/Bottleneck Analysis. With a date range: recomputes live via liveAggregation.ts's
// shared computeLiveBuckets (same module bottlenecks.ts's own date-range branch uses) — an open
// stage event always reflects today's live state; only completed ones are date-filtered by when
// they actually finished.
export const doerPerformanceRoutes = new Hono<{ Variables: Variables }>();

export interface DoerRollup {
  doerName: string;
  email: string;
  fmsIds: Set<string>;
  assigned: number;
  completed: number;
  onTime: number;
  late: number;
  pending: number;
  overdue: number;
  stalled: number;
  totalDelayMinutes: number;
  delayEvents: number;
  staleRecords: number;
}

// Shared with the AI Assistant's get_doer_performance tool (packages/api/src/ai/tools.ts) — one
// scoring formula, not a second copy that could drift from what DoerPerformancePage.tsx shows.
export function scoreDoerRollup(d: DoerRollup) {
  const onTimeRate = scoreOrNull(safeRatio(d.onTime, d.completed));
  const avgDelayMinutes = d.delayEvents ? Math.round(d.totalDelayMinutes / d.delayEvents) : null;
  const latenessPenalty = computeLatenessPenalty(avgDelayMinutes);
  const overdueRate = d.assigned ? scoreOrNull(100 - (safeRatio(d.overdue, d.assigned) ?? 0)) : null;

  const w = SCORING.DOER_WEIGHTS;
  const parts: number[] = [];
  let weightSum = 0;
  if (onTimeRate !== null) { parts.push(onTimeRate * w.onTimeRate); weightSum += w.onTimeRate; }
  if (latenessPenalty !== null) { parts.push(latenessPenalty * w.latenessPenalty); weightSum += w.latenessPenalty; }
  if (overdueRate !== null) { parts.push(overdueRate * w.overdueRate); weightSum += w.overdueRate; }
  const performanceScore = d.completed === 0 || weightSum === 0 ? null
    : scoreOrNull(parts.reduce((a, b) => a + b, 0) / weightSum);

  return { onTimeRate, avgDelayMinutes, overdueRate, performanceScore };
}

export function rollupDoerBuckets(perFms: { fmsId: string; buckets: FinalizedBucket[] }[]) {
  const doerMap = new Map<string, DoerRollup>();
  for (const { fmsId, buckets } of perFms) {
    for (const b of buckets) {
      const key = `${b.doerName}|${b.doerEmail}`;
      let d = doerMap.get(key);
      if (!d) {
        d = { doerName: b.doerName, email: b.doerEmail, fmsIds: new Set(), assigned: 0, completed: 0, onTime: 0, late: 0, pending: 0, overdue: 0, stalled: 0, totalDelayMinutes: 0, delayEvents: 0, staleRecords: 0 };
        doerMap.set(key, d);
      }
      d.fmsIds.add(fmsId);
      d.assigned += b.assigned; d.completed += b.completed; d.onTime += b.onTime; d.late += b.late;
      d.pending += b.pending; d.overdue += b.overdue; d.stalled += b.stalled; d.staleRecords += b.criticalStale;
      if (b.avgDelayMinutes) { d.totalDelayMinutes += b.avgDelayMinutes * (b.late + b.overdue); d.delayEvents += b.late + b.overdue; }
    }
  }
  return doerMap;
}

doerPerformanceRoutes.get('/', requireAuth('reports.view'), async (c) => {
  const db = c.get('db');
  const q = c.req.query();

  const fmsConditions = [eq(fmsMaster.isDeleted, false), eq(fmsMaster.active, true)];
  if (q.fmsId) fmsConditions.push(eq(fmsMaster.fmsId, q.fmsId));
  const configs = await db.select().from(fmsMaster).where(and(...fmsConditions));

  const dateFrom = parseFilterDate(q.dateFrom, false);
  const dateTo = parseFilterDate(q.dateTo, true);

  let perFms: { fmsId: string; buckets: FinalizedBucket[] }[];
  if (dateFrom || dateTo) {
    const liveByFms = await computeLiveBuckets(db, configs, dateFrom, dateTo);
    perFms = configs.map((config) => ({
      fmsId: config.fmsId,
      buckets: Object.values(liveByFms[config.fmsId]?.doerAgg ?? {}).map(finalizeBucket),
    }));
  } else {
    const evalRows = configs.length
      ? await db.select().from(fmsEvalCache).where(inArray(fmsEvalCache.fmsId, configs.map((f) => f.fmsId)))
      : [];
    const evalByFmsId = new Map(evalRows.map((r) => [r.fmsId, r]));
    perFms = configs.map((config) => ({
      fmsId: config.fmsId,
      buckets: (evalByFmsId.get(config.fmsId)?.doerBottlenecks as FinalizedBucket[] | null) ?? [],
    }));
  }

  const doerMap = rollupDoerBuckets(perFms);

  let openActionsByEmail = new Map<string, number>();
  const fmsIds = configs.map((f) => f.fmsId);
  if (fmsIds.length) {
    const openActions = await db.select().from(actionItems).where(and(
      inArray(actionItems.fmsId, fmsIds), eq(actionItems.isDeleted, false),
      notInArray(actionItems.status, ['Resolved', 'Cancelled']), ne(actionItems.assignedEmail, ''),
    ));
    const counts = new Map<string, number>();
    openActions.forEach((a) => {
      const email = (a.assignedEmail || '').toLowerCase();
      if (!email) return;
      counts.set(email, (counts.get(email) ?? 0) + 1);
    });
    openActionsByEmail = counts;
  }

  const rows = Array.from(doerMap.values()).map((d) => {
    const { avgDelayMinutes, performanceScore } = scoreDoerRollup(d);
    return {
      doerName: d.doerName, email: d.email, fmsCount: d.fmsIds.size, assignedStages: d.assigned,
      completed: d.completed, onTime: d.onTime, late: d.late, pending: d.pending, overdue: d.overdue, stalled: d.stalled,
      avgDelayMinutes, staleRecords: d.staleRecords,
      openActions: openActionsByEmail.get(d.email.toLowerCase()) ?? 0, performanceScore,
    };
  });
  rows.sort((a, b) => (b.performanceScore ?? -1) - (a.performanceScore ?? -1));

  return c.json(ok(rows));
});
