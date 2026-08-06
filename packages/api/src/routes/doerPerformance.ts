import { Hono } from 'hono';
import { and, eq, inArray, ne, notInArray } from 'drizzle-orm';
import { fmsMaster, fmsEvalCache, actionItems } from '@fms/db';
import { ok, safeRatio, scoreOrNull, SCORING, type FinalizedBucket } from '@fms/core';
import { requireAuth } from '../middleware/auth';
import type { Variables } from '../types';

// Direct successor to app/Code.gs's getDoerPerformance — rolls up each doer's pre-aggregated
// per-FMS bucket (fms_eval_cache.doer_bottlenecks, same buckets Bottleneck Analysis reads) across
// every FMS they touch, then applies the same weighted score Code.gs used (SCORING.DOER_WEIGHTS:
// 60% timeliness + 25% pending-health + 15% freshness proxy).
export const doerPerformanceRoutes = new Hono<{ Variables: Variables }>();

interface DoerRollup {
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

doerPerformanceRoutes.get('/', requireAuth('reports.view'), async (c) => {
  const db = c.get('db');
  const q = c.req.query();

  const fmsConditions = [eq(fmsMaster.isDeleted, false), eq(fmsMaster.active, true)];
  if (q.fmsId) fmsConditions.push(eq(fmsMaster.fmsId, q.fmsId));
  const configs = await db.select().from(fmsMaster).where(and(...fmsConditions));

  const evalRows = await db.select().from(fmsEvalCache).where(
    configs.length ? inArray(fmsEvalCache.fmsId, configs.map((f) => f.fmsId)) : eq(fmsEvalCache.fmsId, '__none__'),
  );
  const evalByFmsId = new Map(evalRows.map((r) => [r.fmsId, r]));

  const doerMap = new Map<string, DoerRollup>();
  for (const config of configs) {
    const row = evalByFmsId.get(config.fmsId);
    const buckets = (row?.doerBottlenecks as FinalizedBucket[] | null) ?? [];
    for (const b of buckets) {
      const key = `${b.doerName}|${b.doerEmail}`;
      let d = doerMap.get(key);
      if (!d) {
        d = { doerName: b.doerName, email: b.doerEmail, fmsIds: new Set(), assigned: 0, completed: 0, onTime: 0, late: 0, pending: 0, overdue: 0, stalled: 0, totalDelayMinutes: 0, delayEvents: 0, staleRecords: 0 };
        doerMap.set(key, d);
      }
      d.fmsIds.add(config.fmsId);
      d.assigned += b.assigned; d.completed += b.completed; d.onTime += b.onTime; d.late += b.late;
      d.pending += b.pending; d.overdue += b.overdue; d.stalled += b.stalled; d.staleRecords += b.criticalStale;
      if (b.avgDelayMinutes) { d.totalDelayMinutes += b.avgDelayMinutes * (b.late + b.overdue); d.delayEvents += b.late + b.overdue; }
    }
  }

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
    const timeliness = scoreOrNull(safeRatio(d.onTime, d.completed));
    const pendingHealth = scoreOrNull(safeRatio(d.pending - d.overdue - d.stalled, d.pending));
    const avgDelay = d.delayEvents ? Math.round(d.totalDelayMinutes / d.delayEvents) : null;
    const freshnessProxy = d.assigned ? scoreOrNull(100 - (safeRatio(d.staleRecords, d.assigned) ?? 0)) : null;

    const w = SCORING.DOER_WEIGHTS;
    const parts: number[] = [];
    let weightSum = 0;
    if (timeliness !== null) { parts.push(timeliness * w.timeliness); weightSum += w.timeliness; }
    if (pendingHealth !== null) { parts.push(pendingHealth * w.pendingHealth); weightSum += w.pendingHealth; }
    if (freshnessProxy !== null) { parts.push(freshnessProxy * w.freshness); weightSum += w.freshness; }
    const performanceScore = d.completed === 0 || weightSum === 0 ? null
      : scoreOrNull(parts.reduce((a, b) => a + b, 0) / weightSum);

    return {
      doerName: d.doerName, email: d.email, fmsCount: d.fmsIds.size, assignedStages: d.assigned,
      completed: d.completed, onTime: d.onTime, late: d.late, pending: d.pending, overdue: d.overdue, stalled: d.stalled,
      avgDelayMinutes: avgDelay, staleRecords: d.staleRecords,
      openActions: openActionsByEmail.get(d.email.toLowerCase()) ?? 0, performanceScore,
    };
  });
  rows.sort((a, b) => (b.performanceScore ?? -1) - (a.performanceScore ?? -1));

  return c.json(ok(rows));
});
