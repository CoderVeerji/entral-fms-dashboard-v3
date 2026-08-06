import { Hono } from 'hono';
import { and, eq, inArray } from 'drizzle-orm';
import { fmsMaster, fmsEvalCache, records, stageEvents } from '@fms/db';
import { ok, computeAggregates, finalizeBucket, isStageCompleted, type FinalizedBucket } from '@fms/core';
import { requireAuth } from '../middleware/auth';
import type { Variables } from '../types';

// Direct successor to app/Code.gs's getBottlenecks. No date filter: reads the pre-aggregated
// stage/doer buckets already sitting in fms_eval_cache (written by packages/sync every run) —
// same "cache-only" principle as the Dashboard, no per-record scan on a page load. With a date
// filter: recomputes live from records + stage_events using the same shared aggregation module
// the sync job uses (@fms/core's computeAggregates/finalizeBucket), matching Code.gs's
// computeLiveBottlenecks_ — a stage event that's still OPEN (not completed) always reflects
// today's live state regardless of the date range; only COMPLETED events are date-filtered by
// when they actually finished, since "a delay that happened in the past" makes no sense for
// something still unresolved right now.
export const bottlenecksRoutes = new Hono<{ Variables: Variables }>();

interface FmsBucket extends FinalizedBucket { fmsId: string; fmsName: string }

function parseFilterDate(v: string | undefined, endOfDay: boolean): Date | null {
  if (!v) return null;
  const d = new Date(v + (endOfDay ? 'T23:59:59.999' : 'T00:00:00'));
  return Number.isNaN(d.getTime()) ? null : d;
}

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
    const fmsIds = configs.map((f) => f.fmsId);
    if (fmsIds.length) {
      const recRows = await db.select({
        fmsId: records.fmsId, recordId: records.recordId, recordStatus: records.recordStatus, freshness: records.freshness,
      }).from(records).where(and(inArray(records.fmsId, fmsIds), eq(records.isArchived, false)));
      const evRows = await db.select().from(stageEvents).where(inArray(stageEvents.fmsId, fmsIds));

      const recByFms = new Map<string, typeof recRows>();
      recRows.forEach((r) => { const arr = recByFms.get(r.fmsId) ?? []; arr.push(r); recByFms.set(r.fmsId, arr); });
      const evByFms = new Map<string, typeof evRows>();
      evRows.forEach((e) => { const arr = evByFms.get(e.fmsId) ?? []; arr.push(e); evByFms.set(e.fmsId, arr); });

      for (const config of configs) {
        const recs = recByFms.get(config.fmsId) ?? [];
        const events = (evByFms.get(config.fmsId) ?? []).filter((e) => {
          if (!isStageCompleted(e.status)) return true;
          if (!e.actualTime) return false;
          const t = e.actualTime.getTime();
          if (dateFrom && t < dateFrom.getTime()) return false;
          if (dateTo && t > dateTo.getTime()) return false;
          return true;
        });
        const normalizedRecs = recs.map((r) => ({ ...r, freshness: r.freshness ?? 'Never' }));
        const { stageAgg, doerAgg } = computeAggregates(normalizedRecs, events);
        Object.values(stageAgg).forEach((b) => byStage.push({ ...finalizeBucket(b), fmsId: config.fmsId, fmsName: config.fmsName }));
        Object.values(doerAgg).forEach((b) => byDoer.push({ ...finalizeBucket(b), fmsId: config.fmsId, fmsName: config.fmsName }));
      }
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
