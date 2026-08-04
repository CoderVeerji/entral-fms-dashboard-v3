import { describe, it, expect } from 'vitest';
import {
  safeRatio, scoreOrNull, computeTimelinessScore, computePendingHealthScore,
  computeDataQualityScore, computeFreshnessScore, computeOverallFmsScore,
} from './scoring';

describe('safeRatio', () => {
  it('returns null when denominator is zero (zero-division guard)', () => {
    expect(safeRatio(5, 0)).toBeNull();
  });

  it('returns null when denominator is negative', () => {
    expect(safeRatio(5, -1)).toBeNull();
  });

  it('computes a percentage rounded to 1 decimal', () => {
    expect(safeRatio(1, 3)).toBeCloseTo(33.3, 5);
  });

  it('handles a perfect ratio', () => {
    expect(safeRatio(10, 10)).toBe(100);
  });
});

describe('scoreOrNull', () => {
  it('passes through null/undefined as null', () => {
    expect(scoreOrNull(null)).toBeNull();
    expect(scoreOrNull(undefined)).toBeNull();
  });

  it('passes through NaN as null', () => {
    expect(scoreOrNull(NaN)).toBeNull();
  });

  it('rounds to 1 decimal', () => {
    expect(scoreOrNull(33.333)).toBe(33.3);
  });
});

describe('computeTimelinessScore / computePendingHealthScore / computeDataQualityScore', () => {
  const totals = {
    onTimeCompleted: 8, earlyCompleted: 2, totalCompleted: 10,
    pendingNotOverdue: 3, totalPending: 5,
    validStageCells: 18, expectedStageCells: 20,
  };

  it('timeliness = (onTime + early) / totalCompleted', () => {
    expect(computeTimelinessScore(totals)).toBe(100);
  });

  it('pendingHealth = pendingNotOverdue / totalPending', () => {
    expect(computePendingHealthScore(totals)).toBe(60);
  });

  it('dataQuality = validStageCells / expectedStageCells', () => {
    expect(computeDataQualityScore(totals)).toBe(90);
  });

  it('returns null when there is nothing completed/pending yet, not a division error', () => {
    const empty = { ...totals, totalCompleted: 0, totalPending: 0 };
    expect(computeTimelinessScore(empty)).toBeNull();
    expect(computePendingHealthScore(empty)).toBeNull();
  });
});

describe('computeFreshnessScore', () => {
  it('returns null for an empty record set', () => {
    expect(computeFreshnessScore([])).toBeNull();
  });

  it('averages freshness points (Fresh=100, Warning=60, Stale=25, Critical/Never=0)', () => {
    expect(computeFreshnessScore(['Fresh', 'Fresh'])).toBe(100);
    expect(computeFreshnessScore(['Fresh', 'Critical'])).toBe(50);
    // scoreOrNull rounds to 1 decimal, so 28.333... becomes 28.3
    expect(computeFreshnessScore(['Warning', 'Stale', 'Never'])).toBe(28.3);
  });
});

describe('computeOverallFmsScore', () => {
  it('weights timeliness 50%, pendingHealth 25%, dataQuality 15%, freshness 10%', () => {
    // all four scores equal to 80 -> overall should also be 80 regardless of weights
    expect(computeOverallFmsScore(80, 80, 80, 80)).toBe(80);
  });

  it('re-normalizes weights when one input is null instead of treating it as zero', () => {
    // Only timeliness (50%) and pendingHealth (25%) known, both 100 -> weighted avg should be 100,
    // not incorrectly diluted by the missing dataQuality/freshness weights.
    expect(computeOverallFmsScore(100, 100, null, null)).toBe(100);
  });

  it('returns null when every input is null', () => {
    expect(computeOverallFmsScore(null, null, null, null)).toBeNull();
  });
});
