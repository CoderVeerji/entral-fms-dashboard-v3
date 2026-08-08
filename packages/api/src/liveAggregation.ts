import { and, eq, inArray } from 'drizzle-orm';
import { fmsMaster, records, stageEvents } from '@fms/db';
import { computeAggregates, isStageCompleted, type AggBucket } from '@fms/core';
import type { Db } from './db';

// Shared by bottlenecks.ts's date-range branch and doerPerformance.ts's date-filtered path — a
// stage event that's still OPEN (not completed) always reflects today's live state regardless of
// the date range; only COMPLETED events are date-filtered by when they actually finished, since
// "a delay that happened in the past" makes no sense for something still unresolved right now
// (see bottlenecks.ts's original header comment, this is the same logic, just extracted so it's
// computed once instead of duplicated per caller).
export interface LiveFmsBuckets { stageAgg: Record<string, AggBucket>; doerAgg: Record<string, AggBucket> }

export async function computeLiveBuckets(
  db: Db, configs: (typeof fmsMaster.$inferSelect)[], dateFrom: Date | null, dateTo: Date | null,
): Promise<Record<string, LiveFmsBuckets>> {
  const result: Record<string, LiveFmsBuckets> = {};
  const fmsIds = configs.map((f) => f.fmsId);
  if (!fmsIds.length) return result;

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
    result[config.fmsId] = { stageAgg, doerAgg };
  }

  return result;
}

export function parseFilterDate(v: string | undefined, endOfDay: boolean): Date | null {
  if (!v) return null;
  const d = new Date(v + (endOfDay ? 'T23:59:59.999' : 'T00:00:00'));
  return Number.isNaN(d.getTime()) ? null : d;
}
