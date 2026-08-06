// Ported from app/Code.gs's isStageCompleted_/newAggBucket_/accumulateBucket_/finalizeBucket_/
// computeAggregates_ — adapted to operate on already-normalized `records` + `stage_events` rows
// (see packages/db/src/schema.ts) instead of nested evaluatedRecords[].stageResults, since the
// sync job (packages/sync) already flattens Status_Cache's stage_results_json into stage_events
// at ingest time. The math itself (bottleneck score formula, weighting) is unchanged.
import { STATUS } from './constants';
import { humanDelay } from './format';
import { safeRatio } from './scoring';

export function isStageCompleted(status: string): boolean {
  return status === STATUS.STAGE.COMPLETED_ON_TIME || status === STATUS.STAGE.COMPLETED_LATE
    || status === STATUS.STAGE.COMPLETED_EARLY || status === STATUS.STAGE.UNPLANNED_COMPLETED;
}

export interface RecordForAgg {
  recordId: string;
  recordStatus: string;
  freshness: string;
}

export interface StageEventForAgg {
  recordId: string;
  stageName: string;
  doerName: string | null;
  doerEmail: string | null;
  status: string;
  varianceMinutes: number | null;
}

export interface AggBucket {
  key: string;
  doerName: string;
  doerEmail: string;
  assigned: number;
  completed: number;
  onTime: number;
  late: number;
  pending: number;
  overdue: number;
  stalled: number;
  totalDelayMinutes: number;
  maxDelayMinutes: number;
  dataExceptions: number;
  criticalStale: number;
  // Freshness is a RECORD-level fact (unlike overdue/stalled/late, which are genuinely per-stage),
  // but accumulateBucket is called once per stage_event — without this, a doer or stage touching
  // several stages of the same critically-stale record would count that one record's criticality
  // once per stage, inflating criticalStale (and the bottleneckScore weight riding on it) past
  // what's even possible system-wide. Tracked here so finalizeBucket's output stays a plain
  // count; never spread into FinalizedBucket or serialized.
  criticalStaleRecordIds: Set<string>;
}

export function newAggBucket(key: string, doerName?: string | null, doerEmail?: string | null): AggBucket {
  return {
    key, doerName: doerName || '', doerEmail: doerEmail || '', assigned: 0, completed: 0, onTime: 0,
    late: 0, pending: 0, overdue: 0, stalled: 0, totalDelayMinutes: 0, maxDelayMinutes: 0,
    dataExceptions: 0, criticalStale: 0, criticalStaleRecordIds: new Set(),
  };
}

// `recordFreshness` is looked up by the caller (computeAggregates) from the owning record — a
// stage_events row has no freshness column of its own, that's a record-level field.
export function accumulateBucket(bucket: AggBucket, stageEvent: StageEventForAgg, recordFreshness: string): void {
  if (stageEvent.status === STATUS.STAGE.SKIPPED) return; // bypassed by business logic, never "assigned" work
  bucket.assigned++;
  if (isStageCompleted(stageEvent.status)) {
    bucket.completed++;
    if (stageEvent.status === STATUS.STAGE.COMPLETED_ON_TIME || stageEvent.status === STATUS.STAGE.COMPLETED_EARLY) bucket.onTime++;
    if (stageEvent.status === STATUS.STAGE.COMPLETED_LATE) {
      bucket.late++;
      bucket.totalDelayMinutes += Math.max(0, stageEvent.varianceMinutes || 0);
      bucket.maxDelayMinutes = Math.max(bucket.maxDelayMinutes, stageEvent.varianceMinutes || 0);
    }
  } else {
    bucket.pending++;
    if (stageEvent.status === STATUS.STAGE.OVERDUE) {
      bucket.overdue++;
      bucket.totalDelayMinutes += Math.max(0, stageEvent.varianceMinutes || 0);
      bucket.maxDelayMinutes = Math.max(bucket.maxDelayMinutes, stageEvent.varianceMinutes || 0);
    }
    if (stageEvent.status === STATUS.STAGE.STALLED) bucket.stalled++;
  }
  if (stageEvent.status === STATUS.STAGE.DATA_EXCEPTION) bucket.dataExceptions++;
  if (recordFreshness === STATUS.FRESHNESS.CRITICAL && !bucket.criticalStaleRecordIds.has(stageEvent.recordId)) {
    bucket.criticalStaleRecordIds.add(stageEvent.recordId);
    bucket.criticalStale++;
  }
}

export interface FinalizedBucket {
  key: string;
  doerName: string;
  doerEmail: string;
  assigned: number;
  completed: number;
  onTime: number;
  late: number;
  pending: number;
  overdue: number;
  stalled: number;
  avgDelayMinutes: number | null;
  avgDelayHuman: string | null;
  maxDelayMinutes: number;
  maxDelayHuman: string | null;
  onTimePercent: number | null;
  dataExceptions: number;
  criticalStale: number;
  totalDelayDays: number;
  bottleneckScore: number;
  reason: string;
}

// Bottleneck score formula (unchanged from Code.gs SCORING.FORMULAS.bottleneck):
// (overdue*4) + (stalled*4) + (late*2) + delayDays + (criticalStale*3) + (dataExceptions*2)
export function finalizeBucket(b: AggBucket): FinalizedBucket {
  const onTimePct = safeRatio(b.onTime, b.completed);
  const avgDelay = (b.overdue + b.late) > 0 ? Math.round(b.totalDelayMinutes / (b.overdue + b.late)) : null;
  const totalDelayDays = Math.round((b.totalDelayMinutes / 1440) * 10) / 10;
  const bottleneckScore = (b.overdue * 4) + (b.stalled * 4) + (b.late * 2) + totalDelayDays
    + (b.criticalStale * 3) + (b.dataExceptions * 2);

  const reasonParts: string[] = [];
  if (b.overdue) reasonParts.push(`${b.overdue} overdue (x4 = ${b.overdue * 4})`);
  if (b.stalled) reasonParts.push(`${b.stalled} stalled/no-deadline (x4 = ${b.stalled * 4})`);
  if (b.late) reasonParts.push(`${b.late} completed late (x2 = ${b.late * 2})`);
  if (totalDelayDays) reasonParts.push(`${totalDelayDays} total delay-days`);
  if (b.criticalStale) reasonParts.push(`${b.criticalStale} critically stale (x3 = ${b.criticalStale * 3})`);
  if (b.dataExceptions) reasonParts.push(`${b.dataExceptions} data exceptions (x2 = ${b.dataExceptions * 2})`);
  const reason = reasonParts.length
    ? `${reasonParts.join(' + ')} = ${Math.round(bottleneckScore * 10) / 10}`
    : 'No overdue, late, stalled or stale activity — score is 0.';

  return {
    key: b.key, doerName: b.doerName, doerEmail: b.doerEmail, assigned: b.assigned, completed: b.completed,
    onTime: b.onTime, late: b.late, pending: b.pending, overdue: b.overdue, stalled: b.stalled,
    avgDelayMinutes: avgDelay, avgDelayHuman: avgDelay !== null ? humanDelay(avgDelay) : null,
    maxDelayMinutes: Math.round(b.maxDelayMinutes), maxDelayHuman: b.maxDelayMinutes ? humanDelay(b.maxDelayMinutes) : null,
    onTimePercent: onTimePct, dataExceptions: b.dataExceptions, criticalStale: b.criticalStale,
    totalDelayDays, bottleneckScore: Math.round(bottleneckScore * 10) / 10, reason,
  };
}

export interface AggregateTotals {
  total: number;
  notStarted: number;
  runningOnTime: number;
  atRisk: number;
  overdue: number;
  stalled: number;
  completedOnTime: number;
  completedLate: number;
  dataException: number;
  staleRecords: number;
  criticalStale: number;
  neverUpdated: number;
  onTimeCompleted: number;
  earlyCompleted: number;
  totalCompleted: number;
  pendingNotOverdue: number;
  totalPending: number;
  validStageCells: number;
  expectedStageCells: number;
}

const PENDING_STATUSES = new Set<string>([
  STATUS.RECORD.NOT_STARTED, STATUS.RECORD.RUNNING_ON_TIME, STATUS.RECORD.AT_RISK,
  STATUS.RECORD.OVERDUE, STATUS.RECORD.STALLED,
]);

export function computeAggregates(records: RecordForAgg[], stageEvents: StageEventForAgg[]): {
  totals: AggregateTotals;
  stageAgg: Record<string, AggBucket>;
  doerAgg: Record<string, AggBucket>;
} {
  const totals: AggregateTotals = {
    total: records.length, notStarted: 0, runningOnTime: 0, atRisk: 0, overdue: 0, stalled: 0,
    completedOnTime: 0, completedLate: 0, dataException: 0, staleRecords: 0, criticalStale: 0, neverUpdated: 0,
    onTimeCompleted: 0, earlyCompleted: 0, totalCompleted: 0, pendingNotOverdue: 0, totalPending: 0,
    validStageCells: 0, expectedStageCells: 0,
  };

  const freshnessByRecordId = new Map<string, string>();
  for (const rec of records) {
    freshnessByRecordId.set(rec.recordId, rec.freshness);
    switch (rec.recordStatus) {
      case STATUS.RECORD.NOT_STARTED: totals.notStarted++; break;
      case STATUS.RECORD.RUNNING_ON_TIME: totals.runningOnTime++; break;
      case STATUS.RECORD.AT_RISK: totals.atRisk++; break;
      case STATUS.RECORD.OVERDUE: totals.overdue++; break;
      case STATUS.RECORD.STALLED: totals.stalled++; break;
      case STATUS.RECORD.COMPLETED_ON_TIME: totals.completedOnTime++; break;
      case STATUS.RECORD.COMPLETED_LATE: totals.completedLate++; break;
      case STATUS.RECORD.DATA_EXCEPTION: totals.dataException++; break;
      default: break;
    }
    if (rec.freshness === STATUS.FRESHNESS.STALE) totals.staleRecords++;
    if (rec.freshness === STATUS.FRESHNESS.CRITICAL) totals.criticalStale++;
    if (rec.freshness === STATUS.FRESHNESS.NEVER) totals.neverUpdated++;
    if (PENDING_STATUSES.has(rec.recordStatus)) {
      totals.totalPending++;
      if (rec.recordStatus !== STATUS.RECORD.OVERDUE && rec.recordStatus !== STATUS.RECORD.STALLED) totals.pendingNotOverdue++;
    }
  }

  const stageAgg: Record<string, AggBucket> = {};
  const doerAgg: Record<string, AggBucket> = {};

  for (const sr of stageEvents) {
    const recordFreshness = freshnessByRecordId.get(sr.recordId) ?? STATUS.FRESHNESS.NEVER;

    totals.expectedStageCells += 2;
    if (sr.status !== STATUS.STAGE.DATA_EXCEPTION) totals.validStageCells += 2;
    if (sr.status === STATUS.STAGE.COMPLETED_ON_TIME) totals.onTimeCompleted++;
    if (sr.status === STATUS.STAGE.COMPLETED_EARLY) totals.earlyCompleted++;
    if (isStageCompleted(sr.status)) totals.totalCompleted++;

    const stageKey = sr.stageName;
    if (!stageAgg[stageKey]) stageAgg[stageKey] = newAggBucket(stageKey, sr.doerName, sr.doerEmail);
    accumulateBucket(stageAgg[stageKey], sr, recordFreshness);

    if (sr.doerName) {
      const doerKey = `${sr.doerName}|${sr.doerEmail || ''}`;
      if (!doerAgg[doerKey]) doerAgg[doerKey] = newAggBucket(sr.doerName, sr.doerName, sr.doerEmail);
      accumulateBucket(doerAgg[doerKey], sr, recordFreshness);
    }
  }

  return { totals, stageAgg, doerAgg };
}
