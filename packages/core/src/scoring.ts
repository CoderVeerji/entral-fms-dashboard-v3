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
