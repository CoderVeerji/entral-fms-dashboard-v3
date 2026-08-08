// Ported 1:1 from app/Code.gs's safeRatio_/scoreOrNull_/computeTimelinessScore_/
// computePendingHealthScore_/computeDataQualityScore_/computeFreshnessScore_/computeOverallFmsScore_.
import { SCORING, STATUS } from './constants';

export function safeRatio(num: number, den: number): number | null {
  if (!den || den <= 0) return null;
  return Math.round((num / den) * 1000) / 10;
}

export function scoreOrNull(value: number | null | undefined): number | null {
  return value === null || value === undefined || Number.isNaN(value) ? null : Math.round(value * 10) / 10;
}

export interface ScoreTotals {
  onTimeCompleted: number;
  earlyCompleted: number;
  totalCompleted: number;
  pendingNotOverdue: number;
  totalPending: number;
  validStageCells: number;
  expectedStageCells: number;
}

export function computeTimelinessScore(totals: ScoreTotals): number | null {
  return scoreOrNull(safeRatio(totals.onTimeCompleted + totals.earlyCompleted, totals.totalCompleted));
}

export function computePendingHealthScore(totals: ScoreTotals): number | null {
  return scoreOrNull(safeRatio(totals.pendingNotOverdue, totals.totalPending));
}

export function computeDataQualityScore(totals: ScoreTotals): number | null {
  return scoreOrNull(safeRatio(totals.validStageCells, totals.expectedStageCells));
}

// Doer Performance's "how late, not just late-or-not" signal — decays linearly from 100 (no
// delay) to 0 at ~6.7 days average delay (100 / 15 per day). Applies to avgDelayMinutes, which
// itself is only ever computed across a doer's late/overdue stage events (see doerPerformance.ts)
// — a null/zero average (nothing late) scores the max, matching timeliness ratios elsewhere in
// this module reading 100 when there's nothing to penalize.
export function computeLatenessPenalty(avgDelayMinutes: number | null | undefined): number | null {
  if (avgDelayMinutes === null || avgDelayMinutes === undefined || Number.isNaN(avgDelayMinutes)) return 100;
  const avgDelayDays = Math.max(0, avgDelayMinutes) / 1440;
  return scoreOrNull(Math.max(0, 100 - avgDelayDays * 15));
}

export function computeFreshnessScore(freshnessValues: string[]): number | null {
  if (!freshnessValues.length) return null;
  const points: Record<string, number> = { Fresh: 100, Warning: 60, Stale: 25, Critical: 0, Never: 0 };
  const sum = freshnessValues.reduce((s, f) => s + (points[f] || 0), 0);
  return scoreOrNull(sum / freshnessValues.length);
}

export function computeOverallFmsScore(
  timeliness: number | null, pendingHealth: number | null, dataQuality: number | null, freshness: number | null,
): number | null {
  const parts: number[] = [];
  let weightSum = 0;
  const w = SCORING.FMS_WEIGHTS;
  if (timeliness !== null) { parts.push(timeliness * w.timeliness); weightSum += w.timeliness; }
  if (pendingHealth !== null) { parts.push(pendingHealth * w.pendingHealth); weightSum += w.pendingHealth; }
  if (dataQuality !== null) { parts.push(dataQuality * w.dataQuality); weightSum += w.dataQuality; }
  if (freshness !== null) { parts.push(freshness * w.freshness); weightSum += w.freshness; }
  if (weightSum === 0) return null;
  return scoreOrNull(parts.reduce((a, b) => a + b, 0) / weightSum);
}

export { STATUS };
