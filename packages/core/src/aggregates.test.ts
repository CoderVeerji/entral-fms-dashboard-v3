import { describe, it, expect } from 'vitest';
import {
  isStageCompleted, newAggBucket, accumulateBucket, finalizeBucket, computeAggregates,
  type StageEventForAgg, type RecordForAgg,
} from './aggregates';
import { STATUS } from './constants';

describe('isStageCompleted', () => {
  it('treats ON_TIME/LATE/EARLY/UNPLANNED_COMPLETED as completed', () => {
    expect(isStageCompleted(STATUS.STAGE.COMPLETED_ON_TIME)).toBe(true);
    expect(isStageCompleted(STATUS.STAGE.COMPLETED_LATE)).toBe(true);
    expect(isStageCompleted(STATUS.STAGE.COMPLETED_EARLY)).toBe(true);
    expect(isStageCompleted(STATUS.STAGE.UNPLANNED_COMPLETED)).toBe(true);
  });

  it('treats OVERDUE/STALLED/SKIPPED/NOT_STARTED as not completed', () => {
    expect(isStageCompleted(STATUS.STAGE.OVERDUE)).toBe(false);
    expect(isStageCompleted(STATUS.STAGE.STALLED)).toBe(false);
    expect(isStageCompleted(STATUS.STAGE.SKIPPED)).toBe(false);
    expect(isStageCompleted(STATUS.STAGE.NOT_STARTED)).toBe(false);
  });
});

describe('accumulateBucket', () => {
  it('SKIPPED stages are excluded entirely — never counted as assigned/pending work', () => {
    const bucket = newAggBucket('Stage A');
    accumulateBucket(bucket, mkEvent({ status: STATUS.STAGE.SKIPPED }), STATUS.FRESHNESS.FRESH);
    expect(bucket.assigned).toBe(0);
    expect(bucket.pending).toBe(0);
  });

  it('STALLED is weighted the same as OVERDUE — both count as pending, both feed bottleneckScore x4', () => {
    const overdueBucket = newAggBucket('Stage A');
    accumulateBucket(overdueBucket, mkEvent({ status: STATUS.STAGE.OVERDUE, varianceMinutes: 120 }), STATUS.FRESHNESS.FRESH);
    const stalledBucket = newAggBucket('Stage A');
    accumulateBucket(stalledBucket, mkEvent({ status: STATUS.STAGE.STALLED }), STATUS.FRESHNESS.FRESH);

    // STALLED never had a plan time to compute variance against, so it does NOT add delay minutes
    // the way OVERDUE does (see Code.gs's evaluateRecord_ comment) — but must still move the
    // bottleneck score by the same x4 weight as an overdue stage.
    expect(finalizeBucket(overdueBucket).bottleneckScore).toBeGreaterThan(0);
    expect(finalizeBucket(stalledBucket).bottleneckScore).toBe(4); // 1 stalled * 4, no delay days
  });

  it('CRITICAL freshness on the owning record increments criticalStale regardless of stage status', () => {
    const bucket = newAggBucket('Stage A');
    accumulateBucket(bucket, mkEvent({ status: STATUS.STAGE.COMPLETED_ON_TIME }), STATUS.FRESHNESS.CRITICAL);
    expect(bucket.criticalStale).toBe(1);
  });
});

describe('finalizeBucket', () => {
  it('produces a human-readable reason string that matches the score components', () => {
    const bucket = newAggBucket('Stage A');
    accumulateBucket(bucket, mkEvent({ status: STATUS.STAGE.OVERDUE, varianceMinutes: 1440 }), STATUS.FRESHNESS.FRESH); // 1 day overdue
    const finalized = finalizeBucket(bucket);
    expect(finalized.reason).toContain('1 overdue (x4 = 4)');
    expect(finalized.reason).toContain('1 total delay-days');
    expect(finalized.bottleneckScore).toBe(5); // 4 (overdue) + 1 (delay day)
  });

  it('says exactly "score is 0" when nothing bad happened', () => {
    const bucket = newAggBucket('Stage A');
    accumulateBucket(bucket, mkEvent({ status: STATUS.STAGE.COMPLETED_ON_TIME }), STATUS.FRESHNESS.FRESH);
    const finalized = finalizeBucket(bucket);
    expect(finalized.bottleneckScore).toBe(0);
    expect(finalized.reason).toBe('No overdue, late, stalled or stale activity — score is 0.');
  });

  it('onTimePercent is null (not a crash) when nothing has completed yet', () => {
    const bucket = newAggBucket('Stage A');
    accumulateBucket(bucket, mkEvent({ status: STATUS.STAGE.OVERDUE }), STATUS.FRESHNESS.FRESH);
    expect(finalizeBucket(bucket).onTimePercent).toBeNull();
  });
});

describe('computeAggregates', () => {
  it('produces correct totals and per-stage/per-doer buckets from a small fixture', () => {
    const records: RecordForAgg[] = [
      { recordId: 'r1', recordStatus: STATUS.RECORD.OVERDUE, freshness: STATUS.FRESHNESS.STALE },
      { recordId: 'r2', recordStatus: STATUS.RECORD.COMPLETED_ON_TIME, freshness: STATUS.FRESHNESS.FRESH },
      { recordId: 'r3', recordStatus: STATUS.RECORD.STALLED, freshness: STATUS.FRESHNESS.CRITICAL },
    ];
    const stageEvents: StageEventForAgg[] = [
      mkEvent({ recordId: 'r1', stageName: 'Stage A', doerName: 'Amit', status: STATUS.STAGE.OVERDUE, varianceMinutes: 60 }),
      mkEvent({ recordId: 'r2', stageName: 'Stage A', doerName: 'Amit', status: STATUS.STAGE.COMPLETED_ON_TIME }),
      mkEvent({ recordId: 'r3', stageName: 'Stage B', doerName: 'Ravi', status: STATUS.STAGE.STALLED }),
    ];

    const { totals, stageAgg, doerAgg } = computeAggregates(records, stageEvents);

    expect(totals.total).toBe(3);
    expect(totals.overdue).toBe(1);
    expect(totals.completedOnTime).toBe(1);
    expect(totals.stalled).toBe(1);
    expect(totals.totalPending).toBe(2); // OVERDUE + STALLED
    expect(totals.pendingNotOverdue).toBe(0); // neither of the 2 pending ones is "not overdue/stalled"

    expect(Object.keys(stageAgg)).toEqual(['Stage A', 'Stage B']);
    expect(stageAgg['Stage A'].assigned).toBe(2);
    expect(doerAgg['Amit|'].assigned).toBe(2);
    expect(doerAgg['Ravi|'].assigned).toBe(1);
  });
});

function mkEvent(overrides: Partial<StageEventForAgg>): StageEventForAgg {
  return {
    recordId: 'r1', stageName: 'Stage A', doerName: null, doerEmail: null,
    status: STATUS.STAGE.NOT_STARTED, varianceMinutes: null, ...overrides,
  };
}
