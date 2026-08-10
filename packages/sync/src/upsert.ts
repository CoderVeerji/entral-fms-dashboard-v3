import { eq, and, inArray, notInArray, sql } from 'drizzle-orm';
import { records, stageEvents, fmsEvalCache } from '@fms/db';
import { computeAggregates, finalizeBucket, computeTimelinessScore, computePendingHealthScore, computeDataQualityScore, computeFreshnessScore, computeOverallFmsScore } from '@fms/core';
import type { NormalizedRecord, NormalizedStageEvent, RecordSnapshot } from './transform';
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
        isArchived: sql`excluded.is_archived`, details: sql`excluded.details`, syncedAt: sql`now()`,
      },
    });
  }
}

// Replaces stage_events only for the given record_ids (the ones diffChangedRecords found actually
// changed this run, plus any just-archived) — NOT a full-FMS wipe. A record's stage_results_json
// lives inside the same Status_Cache row compared by diffChangedRecords, so "record content
// unchanged" already guarantees its derived stage_events are unchanged too; touching only the
// changed subset is what makes a 5-minute sync cadence affordable on Neon's free egress allowance
// (see plan §"Sync job" / transform.ts's diffChangedRecords comment) instead of rewriting every
// stage_event for every record on every run regardless of whether anything moved.
export async function replaceStageEventsForRecords(db: Db, fmsId: string, recordIds: string[], events: NormalizedStageEvent[]): Promise<void> {
  if (!recordIds.length) return;
  for (let i = 0; i < recordIds.length; i += BATCH_SIZE) {
    const idBatch = recordIds.slice(i, i + BATCH_SIZE);
    await db.delete(stageEvents).where(and(eq(stageEvents.fmsId, fmsId), inArray(stageEvents.recordId, idBatch)));
  }
  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE);
    if (batch.length) await db.insert(stageEvents).values(batch);
  }
}

export async function markArchived(db: Db, fmsId: string, recordIds: string[]): Promise<void> {
  if (!recordIds.length) return;
  await db.update(records).set({ isArchived: true, syncedAt: new Date() })
    .where(and(eq(records.fmsId, fmsId), inArray(records.recordId, recordIds)));
}

// Recomputes this FMS's fms_eval_cache row from whatever is currently in `records`/`stage_events`
// — mirrors app/Code.gs's evaluateFms_ + writeFmsEvalCacheRow_, using the ported aggregation/
// scoring module (packages/core) instead of re-deriving the math here.
const CRITICAL_SAMPLE_LIMIT = 50;

export async function refreshFmsEvalCache(db: Db, fmsId: string): Promise<void> {
  const recordRows = await db.select({
    recordId: records.recordId, recordStatus: records.recordStatus, freshness: records.freshness,
    displayName: records.displayName, currentStage: records.currentStage, doer: records.doer,
    planTime: records.planTime, delay: records.delay, lastUpdate: records.lastUpdate,
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

  // Mirrors app/Code.gs's computeFmsLiteAggregate_ — the Dashboard's "Needs Attention" list:
  // every OVERDUE/STALLED record or one whose freshness has gone Critical, worst delay first.
  // This is what Central's Dashboard reads directly (fms_eval_cache.critical_sample) instead of
  // scanning every record live on each page load.
  const delayMinutes = (d: unknown): number => (d && typeof d === 'object' && 'minutes' in d ? Number((d as { minutes: unknown }).minutes) || 0 : 0);
  const criticalSample = recordsForAgg
    .filter((r) => r.recordStatus === 'OVERDUE' || r.recordStatus === 'STALLED' || r.freshness === 'Critical')
    .sort((a, b) => delayMinutes(b.delay) - delayMinutes(a.delay))
    .slice(0, CRITICAL_SAMPLE_LIMIT)
    .map((r) => ({
      recordId: r.recordId, displayName: r.displayName, currentStage: r.currentStage, doer: r.doer,
      planTime: r.planTime ? r.planTime.toISOString() : null, delay: r.delay,
      lastUpdate: r.lastUpdate ? r.lastUpdate.toISOString() : null, freshness: r.freshness, recordStatus: r.recordStatus,
    }));

  const todayStr = new Date().toISOString().slice(0, 10);
  const completedToday = recordsForAgg.filter((r) => r.lastUpdate && r.lastUpdate.toISOString().slice(0, 10) === todayStr
    && (r.recordStatus === 'COMPLETED_ON_TIME' || r.recordStatus === 'COMPLETED_LATE')).length;

  await db.insert(fmsEvalCache).values({
    fmsId, computedAt: new Date(), totals, scores: { timeliness, pendingHealth, dataQuality, freshness, overall },
    stageBottlenecks, doerBottlenecks, criticalSample, completedToday,
  }).onConflictDoUpdate({
    target: fmsEvalCache.fmsId,
    set: {
      computedAt: sql`excluded.computed_at`, totals: sql`excluded.totals`, scores: sql`excluded.scores`,
      stageBottlenecks: sql`excluded.stage_bottlenecks`, doerBottlenecks: sql`excluded.doer_bottlenecks`,
      criticalSample: sql`excluded.critical_sample`, completedToday: sql`excluded.completed_today`,
    },
  });
}

// One read serving two purposes: the full snapshot (every field diffChangedRecords compares) for
// content-diffing, and (by filtering out already-archived rows) the "previously known" id list
// findArchivedRecordIds needs — a record already marked archived doesn't need to be re-detected as
// missing every run, same as the narrower query this replaced.
export async function existingRecordSnapshots(db: Db, fmsId: string): Promise<Map<string, RecordSnapshot>> {
  const rows = await db.select({
    recordId: records.recordId, rawRow: records.rawRow, displayName: records.displayName,
    currentStage: records.currentStage, doer: records.doer, doerEmail: records.doerEmail,
    planTime: records.planTime, recordStatus: records.recordStatus, delay: records.delay,
    completedSteps: records.completedSteps, totalSteps: records.totalSteps, lastUpdate: records.lastUpdate,
    freshness: records.freshness, sequenceException: records.sequenceException, isClosed: records.isClosed,
    isArchived: records.isArchived, details: records.details,
  }).from(records).where(eq(records.fmsId, fmsId));
  // Coalesce nullable columns to the same non-null defaults transformStatusCacheRow already
  // applies to a fresh read, so an old stored NULL never looks "changed" against a freshly-read ''.
  return new Map(rows.map((r) => [r.recordId, {
    rawRow: r.rawRow, displayName: r.displayName ?? '', currentStage: r.currentStage ?? '',
    doer: r.doer ?? '', doerEmail: r.doerEmail ?? '', planTime: r.planTime, recordStatus: r.recordStatus,
    delay: r.delay, completedSteps: r.completedSteps ?? 0, totalSteps: r.totalSteps ?? 0,
    lastUpdate: r.lastUpdate, freshness: r.freshness ?? 'Never', sequenceException: r.sequenceException ?? false,
    isClosed: r.isClosed ?? false, isArchived: r.isArchived ?? false,
    details: (r.details as Record<string, unknown> | null) ?? null,
  } satisfies RecordSnapshot]));
}

export { notInArray };
