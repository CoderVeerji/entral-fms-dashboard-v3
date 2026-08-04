import { eq, and, notInArray, sql } from 'drizzle-orm';
import { records, stageEvents, fmsEvalCache } from '@fms/db';
import { computeAggregates, finalizeBucket, computeTimelinessScore, computePendingHealthScore, computeDataQualityScore, computeFreshnessScore, computeOverallFmsScore } from '@fms/core';
import type { NormalizedRecord, NormalizedStageEvent } from './transform';
import type { createSyncDb } from './db';

type Db = ReturnType<typeof createSyncDb>['db'];

// Batched upsert into `records` — see plan §"Sync job" step 4 (~500 rows/statement; this app's
// scale today is far under that in one call, batching is here so it stays correct as FMS/record
// counts grow rather than needing to be revisited later).
const BATCH_SIZE = 500;

export async function upsertRecords(db: Db, rows: NormalizedRecord[]): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    if (!batch.length) continue;
    await db.insert(records).values(batch).onConflictDoUpdate({
      target: [records.fmsId, records.recordId],
      set: {
        rawRow: sql`excluded.raw_row`, displayName: sql`excluded.display_name`,
        currentStage: sql`excluded.current_stage`, doer: sql`excluded.doer`, doerEmail: sql`excluded.doer_email`,
        planTime: sql`excluded.plan_time`, recordStatus: sql`excluded.record_status`, delay: sql`excluded.delay`,
        completedSteps: sql`excluded.completed_steps`, totalSteps: sql`excluded.total_steps`,
        lastUpdate: sql`excluded.last_update`, freshness: sql`excluded.freshness`,
        sequenceException: sql`excluded.sequence_exception`, isClosed: sql`excluded.is_closed`,
        isArchived: sql`excluded.is_archived`, syncedAt: sql`now()`,
      },
    });
  }
}

// Only records whose Status_Cache `updated_at` moved since last sync get their stage_events
// re-parsed/re-written — the sync job's own "skip unnecessary work" optimization (see plan; not a
// duplicate of the publisher's own is_closed cursor, just a cheap per-record diff on this side).
export async function upsertStageEvents(db: Db, fmsId: string, recordId: string, events: NormalizedStageEvent[]): Promise<void> {
  await db.delete(stageEvents).where(and(eq(stageEvents.fmsId, fmsId), eq(stageEvents.recordId, recordId)));
  if (events.length) await db.insert(stageEvents).values(events);
}

export async function markArchived(db: Db, fmsId: string, recordIds: string[]): Promise<void> {
  if (!recordIds.length) return;
  await db.update(records).set({ isArchived: true, syncedAt: new Date() })
    .where(and(eq(records.fmsId, fmsId), sql`${records.recordId} = ANY(${recordIds})`));
}

// Recomputes this FMS's fms_eval_cache row from whatever is currently in `records`/`stage_events`
// — mirrors app/Code.gs's evaluateFms_ + writeFmsEvalCacheRow_, using the ported aggregation/
// scoring module (packages/core) instead of re-deriving the math here.
export async function refreshFmsEvalCache(db: Db, fmsId: string): Promise<void> {
  const recordRows = await db.select({
    recordId: records.recordId, recordStatus: records.recordStatus, freshness: records.freshness,
  }).from(records).where(and(eq(records.fmsId, fmsId), eq(records.isArchived, false)));

  const stageRows = await db.select({
    recordId: stageEvents.recordId, stageName: stageEvents.stageName, doerName: stageEvents.doerName,
    doerEmail: stageEvents.doerEmail, status: stageEvents.status, varianceMinutes: stageEvents.varianceMinutes,
  }).from(stageEvents).where(eq(stageEvents.fmsId, fmsId));

  // freshness/doerName/etc. are nullable text columns in Postgres (a row can exist before every
  // field is known) — coalesced to the core module's non-null string types at this one boundary.
  const recordsForAgg = recordRows.map((r) => ({ ...r, freshness: r.freshness ?? 'Never' }));
  const stagesForAgg = stageRows.map((r) => ({ ...r, stageName: r.stageName ?? '' }));

  const { totals, stageAgg, doerAgg } = computeAggregates(recordsForAgg, stagesForAgg);
  const stageBottlenecks = Object.values(stageAgg).map(finalizeBucket).sort((a, b) => b.bottleneckScore - a.bottleneckScore);
  const doerBottlenecks = Object.values(doerAgg).map(finalizeBucket).sort((a, b) => b.bottleneckScore - a.bottleneckScore);

  const timeliness = computeTimelinessScore(totals);
  const pendingHealth = computePendingHealthScore(totals);
  const dataQuality = computeDataQualityScore(totals);
  const freshness = computeFreshnessScore(recordsForAgg.map((r) => r.freshness));
  const overall = computeOverallFmsScore(timeliness, pendingHealth, dataQuality, freshness);

  await db.insert(fmsEvalCache).values({
    fmsId, computedAt: new Date(), totals, scores: { timeliness, pendingHealth, dataQuality, freshness, overall },
    stageBottlenecks, doerBottlenecks, criticalSample: [], completedToday: 0,
  }).onConflictDoUpdate({
    target: fmsEvalCache.fmsId,
    set: {
      computedAt: sql`excluded.computed_at`, totals: sql`excluded.totals`, scores: sql`excluded.scores`,
      stageBottlenecks: sql`excluded.stage_bottlenecks`, doerBottlenecks: sql`excluded.doer_bottlenecks`,
    },
  });
}

export async function existingRecordIds(db: Db, fmsId: string): Promise<string[]> {
  const rows = await db.select({ recordId: records.recordId }).from(records)
    .where(and(eq(records.fmsId, fmsId), eq(records.isArchived, false)));
  return rows.map((r) => r.recordId);
}

export { notInArray };
