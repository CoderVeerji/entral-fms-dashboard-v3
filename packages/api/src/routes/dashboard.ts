import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { fmsMaster, fmsEvalCache } from '@fms/db';
import { ok } from '@fms/core';
import { requireAuth } from '../middleware/auth';
import type { Variables } from '../types';

// Direct successor to app/Code.gs's getDashboardData — reads the small, already-computed
// fms_eval_cache row per FMS (refreshed by packages/sync every run, see
// refreshFmsEvalCache in packages/sync/src/upsert.ts) instead of scanning every record, same
// "cache-only, never live-compute on a user's click" principle the old app's getFmsLiteEval_
// followed.
export const dashboardRoutes = new Hono<{ Variables: Variables }>();

interface EvalTotals {
  total: number; runningOnTime: number; atRisk: number; overdue: number; stalled: number;
  completedOnTime: number; completedLate: number; dataException: number; staleRecords: number;
}
interface EvalScores { overall: number | null }

dashboardRoutes.get('/', requireAuth('dashboard.view'), async (c) => {
  const db = c.get('db');

  const configs = await db.select().from(fmsMaster)
    .where(and(eq(fmsMaster.active, true), eq(fmsMaster.isDeleted, false)));
  const evalRows = await db.select().from(fmsEvalCache);
  const evalByFmsId = new Map(evalRows.map((r) => [r.fmsId, r]));

  const kpi = {
    totalActiveFms: configs.length, totalActiveRecords: 0, runningOnTime: 0, atRisk: 0,
    overdue: 0, stalled: 0, completedOnTime: 0, completedLate: 0, dataExceptions: 0, staleRecords: 0,
  };

  const fmsHealth = configs.map((config) => {
    const row = evalByFmsId.get(config.fmsId);
    if (!row || !row.totals) {
      return { fmsId: config.fmsId, fmsName: config.fmsName, error: 'Not synced yet', healthBadge: 'grey' as const };
    }
    const totals = row.totals as EvalTotals;
    const scores = (row.scores as EvalScores) || { overall: null };

    kpi.totalActiveRecords += totals.total;
    kpi.runningOnTime += totals.runningOnTime;
    kpi.atRisk += totals.atRisk;
    kpi.overdue += totals.overdue;
    kpi.stalled += totals.stalled;
    kpi.completedOnTime += totals.completedOnTime;
    kpi.completedLate += totals.completedLate;
    kpi.dataExceptions += totals.dataException;
    kpi.staleRecords += totals.staleRecords;

    const healthBadge = (totals.overdue > 0 || totals.stalled > 0) ? 'red' : (totals.atRisk > 0 ? 'amber' : 'green');
    return {
      fmsId: config.fmsId, fmsName: config.fmsName, error: null, overallScore: scores.overall,
      activeRecords: totals.total, overdueRecords: totals.overdue, atRiskRecords: totals.atRisk,
      stalledRecords: totals.stalled, computedAt: row.computedAt, healthBadge,
    };
  });

  return c.json(ok({ kpi, fmsHealth }));
});
