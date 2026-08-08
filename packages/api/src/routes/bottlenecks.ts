import { Hono } from 'hono';
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { fmsMaster, fmsEvalCache, records, stageEvents } from '@fms/db';
import { ok, AppError, finalizeBucket, type FinalizedBucket } from '@fms/core';
import { requireAuth } from '../middleware/auth';
import { computeLiveBuckets, parseFilterDate } from '../liveAggregation';
import type { Variables } from '../types';

// Direct successor to app/Code.gs's getBottlenecks. No date filter: reads the pre-aggregated
// stage/doer buckets already sitting in fms_eval_cache (written by packages/sync every run) —
// same "cache-only" principle as the Dashboard, no per-record scan on a page load. With a date
// filter: recomputes live via liveAggregation.ts's shared computeLiveBuckets (same module
// doerPerformance.ts's own date-filtered path uses), matching Code.gs's computeLiveBottlenecks_ —
// a stage event that's still OPEN (not completed) always reflects today's live state regardless
// of the date range; only COMPLETED events are date-filtered by when they actually finished,
// since "a delay that happened in the past" makes no sense for something still unresolved right
// now.
export const bottlenecksRoutes = new Hono<{ Variables: Variables }>();

interface FmsBucket extends FinalizedBucket { fmsId: string; fmsName: string }

bottlenecksRoutes.get('/', requireAuth('records.view'), async (c) => {
  const db = c.get('db');
  const q = c.req.query();

  const fmsConditions = [eq(fmsMaster.isDeleted, false), eq(fmsMaster.active, true)];
  if (q.fmsId) fmsConditions.push(eq(fmsMaster.fmsId, q.fmsId));
  const configs = await db.select().from(fmsMaster).where(and(...fmsConditions));

  const dateFrom = parseFilterDate(q.dateFrom, false);
  const dateTo = parseFilterDate(q.dateTo, true);

  const byStage: FmsBucket[] = [];
  const byDoer: FmsBucket[] = [];

  if (dateFrom || dateTo) {
    const liveByFms = await computeLiveBuckets(db, configs, dateFrom, dateTo);
    for (const config of configs) {
      const live = liveByFms[config.fmsId];
      if (!live) continue;
      Object.values(live.stageAgg).forEach((b) => byStage.push({ ...finalizeBucket(b), fmsId: config.fmsId, fmsName: config.fmsName }));
      Object.values(live.doerAgg).forEach((b) => byDoer.push({ ...finalizeBucket(b), fmsId: config.fmsId, fmsName: config.fmsName }));
    }
  } else {
    const evalRows = await db.select().from(fmsEvalCache);
    const evalByFmsId = new Map(evalRows.map((r) => [r.fmsId, r]));
    for (const config of configs) {
      const row = evalByFmsId.get(config.fmsId);
      if (!row) continue;
      ((row.stageBottlenecks as FinalizedBucket[] | null) ?? []).forEach((b) => byStage.push({ ...b, fmsId: config.fmsId, fmsName: config.fmsName }));
      ((row.doerBottlenecks as FinalizedBucket[] | null) ?? []).forEach((b) => byDoer.push({ ...b, fmsId: config.fmsId, fmsName: config.fmsName }));
    }
  }

  byStage.sort((a, b) => b.bottleneckScore - a.bottleneckScore);
  byDoer.sort((a, b) => b.bottleneckScore - a.bottleneckScore);

  return c.json(ok({
    byStage, byDoer,
    formula: '(overdue x4) + (stalled x4) + (late x2) + delayDays + (criticalStale x3) + (dataExceptions x2)',
  }));
});

// A bucket's overdue/stalled/late counts (above) are tallied from stage_events.status, which is
// per-STAGE, not the same thing as records.record_status (a record's current stage can be fine
// while an earlier or later stage independently reads OVERDUE — see aggregates.ts's
// accumulateBucket). So "which records make up this 4?" can only be answered correctly by
// querying stage_events directly, never by filtering Live Records on record_status — that would
// silently show the wrong set. This endpoint is what Bottleneck/Doer Performance's drill-down
// calls instead.
bottlenecksRoutes.get('/detail', requireAuth('records.view'), async (c) => {
  const db = c.get('db');
  const q = c.req.query();
  if (!q.key) throw new AppError('INVALID_INPUT', 'key is required.');
  if (q.scope !== 'stage' && q.scope !== 'doer') throw new AppError('INVALID_INPUT', 'scope must be "stage" or "doer".');

  // fmsId is optional — Doer Performance's rollup rows sum a doer across every FMS they touch
  // (see doerPerformance.ts), so when its own fmsId filter is "All FMS" there's no single FMS to
  // scope this drill-down to either.
  const conditions = q.fmsId ? [eq(stageEvents.fmsId, q.fmsId)] : [];
  conditions.push(q.scope === 'doer' ? eq(stageEvents.doerName, q.key) : eq(stageEvents.stageName, q.key));
  // Comma-separated so a caller can ask for a bucket like "Completed" or "On Time", which are
  // several STAGE statuses combined (see aggregates.ts's isStageCompleted), not one.
  if (q.status) {
    const statuses = q.status.split(',').map((s) => s.trim()).filter(Boolean);
    if (statuses.length === 1) conditions.push(eq(stageEvents.status, statuses[0]));
    else if (statuses.length > 1) conditions.push(inArray(stageEvents.status, statuses));
  }
  // Only MIS Report's drill-down uses these — its "Late"/"On Time"/"Completed" counts are scoped
  // to actualTime falling inside the report period (see misReport.ts), unlike Bottleneck
  // Analysis's buckets which (without its own date filter) look at everything ever.
  if (q.dateFrom) {
    const d = new Date(q.dateFrom);
    if (!Number.isNaN(d.getTime())) conditions.push(gte(stageEvents.actualTime, d));
  }
  if (q.dateTo) {
    const d = new Date(q.dateTo);
    if (!Number.isNaN(d.getTime())) conditions.push(lte(stageEvents.actualTime, d));
  }

  const rows = await db.select({
    fmsId: stageEvents.fmsId, recordId: stageEvents.recordId, displayName: records.displayName, stageName: stageEvents.stageName,
    doerName: stageEvents.doerName, doerEmail: stageEvents.doerEmail, status: stageEvents.status,
    planTime: stageEvents.planTime, actualTime: stageEvents.actualTime, varianceMinutes: stageEvents.varianceMinutes,
  }).from(stageEvents)
    .leftJoin(records, and(eq(records.fmsId, stageEvents.fmsId), eq(records.recordId, stageEvents.recordId)))
    .where(and(...conditions))
    .orderBy(desc(stageEvents.varianceMinutes));

  return c.json(ok(rows));
});
