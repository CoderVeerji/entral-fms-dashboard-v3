import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { fmsMaster, fmsEvalCache, records, dataHealthCache } from '@fms/db';
import type { AggregateTotals, FinalizedBucket } from '@fms/core';
import type { Db } from '../db';
import type { GroqTool } from './groq';
import { rollupDoerBuckets, scoreDoerRollup } from '../routes/doerPerformance';

// Every tool here is read-only and wraps the SAME data the dashboard's own pages already show
// (fms_eval_cache, records, data_health_cache — all computed by packages/sync, not re-derived
// here) — the model never sees raw table scans, only small, already-aggregated JSON, so answers
// stay grounded in real numbers and token usage per call stays cheap (see plan §"M7" on why this
// matters for staying inside the free-tier daily quota).
export const AI_TOOLS: GroqTool[] = [
  {
    name: 'get_fms_overview',
    description: 'List every connected FMS with its overall health score (0-100), active/overdue/stalled/at-risk record counts, and last sync status. Start here for any "which FMS" or "how are we doing overall" question.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'search_records',
    description: 'Search records across one or all FMS by status/doer/free text. Returns up to 15 matches with their current stage, doer, status, and delay. Use for "which records" / "show me" questions.',
    parameters: {
      type: 'object',
      properties: {
        fmsId: { type: 'string', description: 'Restrict to one FMS id (get it from get_fms_overview first). Omit to search across all FMS.' },
        status: { type: 'string', description: 'One of NOT_STARTED, RUNNING_ON_TIME, AT_RISK, OVERDUE, STALLED, COMPLETED_ON_TIME, COMPLETED_LATE, DATA_EXCEPTION.' },
        doer: { type: 'string', description: 'Exact doer name to filter by.' },
        search: { type: 'string', description: 'Free-text match against record name, id, or doer.' },
      },
    },
  },
  {
    name: 'get_bottleneck_summary',
    description: 'The 5 worst-scoring stages or doers (by bottleneck score, which weighs overdue/stalled/late/critically-stale activity) for one FMS or across all. Use for "what/who is causing delays" questions.',
    parameters: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['stage', 'doer'], description: 'Whether to rank by stage name or by doer.' },
        fmsId: { type: 'string', description: 'Restrict to one FMS id. Omit to rank across all FMS.' },
      },
      required: ['scope'],
    },
  },
  {
    name: 'get_data_health_issues',
    description: 'Automatic data-quality issues found across all connected FMS (duplicate record IDs, suspicious/likely-wrong dates, negative delays) — a sign the source spreadsheet itself has a problem, not just a slow record.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_doer_performance',
    description: 'A specific person\'s (or everyone\'s) timeliness performance across all FMS: on-time rate, average delay when late, overdue rate, and the resulting performance score (judged purely on timeliness, never on how much work they were assigned). Use this for any "how is X doing" / "X ki performance" / "who is the best/worst performer" question — not search_records or get_bottleneck_summary, which don\'t carry a performance score.',
    parameters: {
      type: 'object',
      properties: {
        doerName: { type: 'string', description: 'Partial or full name to match (case-insensitive). Omit to return everyone, best performers first.' },
      },
    },
  },
];

export async function runAiTool(db: Db, name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'get_fms_overview': return getFmsOverview(db);
    case 'search_records': return searchRecords(db, args);
    case 'get_bottleneck_summary': return getBottleneckSummary(db, args);
    case 'get_data_health_issues': return getDataHealthIssues(db);
    case 'get_doer_performance': return getDoerPerformance(db, args);
    default: return { error: `Unknown tool "${name}".` };
  }
}

async function getFmsOverview(db: Db) {
  const configs = await db.select().from(fmsMaster).where(and(eq(fmsMaster.isDeleted, false), eq(fmsMaster.active, true)));
  if (!configs.length) return [];
  const evalRows = await db.select().from(fmsEvalCache).where(inArray(fmsEvalCache.fmsId, configs.map((c) => c.fmsId)));
  const evalByFmsId = new Map(evalRows.map((r) => [r.fmsId, r]));
  return configs.map((c) => {
    const row = evalByFmsId.get(c.fmsId);
    const totals = (row?.totals as AggregateTotals | null) ?? null;
    const scores = row?.scores as { overall?: number } | null;
    return {
      fmsId: c.fmsId, fmsName: c.fmsName, overallScore: scores?.overall ?? null,
      activeRecords: totals?.total ?? 0, overdueRecords: totals?.overdue ?? 0,
      stalledRecords: totals?.stalled ?? 0, atRiskRecords: totals?.atRisk ?? 0,
      lastSyncStatus: c.lastSyncStatus, lastSuccessfulSync: c.lastSuccessfulSync ? c.lastSuccessfulSync.toISOString() : null,
    };
  });
}

async function searchRecords(db: Db, args: Record<string, unknown>) {
  const conditions = [eq(records.isArchived, false)];
  if (typeof args.fmsId === 'string' && args.fmsId) conditions.push(eq(records.fmsId, args.fmsId));
  if (typeof args.status === 'string' && args.status) conditions.push(eq(records.recordStatus, args.status));
  if (typeof args.doer === 'string' && args.doer) conditions.push(eq(records.doer, args.doer));
  if (typeof args.search === 'string' && args.search.trim()) {
    const term = `%${args.search.trim()}%`;
    conditions.push(sql`(${records.displayName} || ' ' || ${records.recordId} || ' ' || coalesce(${records.doer}, '')) ILIKE ${term}`);
  }
  return db.select({
    fmsId: records.fmsId, recordId: records.recordId, displayName: records.displayName,
    currentStage: records.currentStage, doer: records.doer, recordStatus: records.recordStatus,
    delay: records.delay, freshness: records.freshness,
  }).from(records).where(and(...conditions)).orderBy(desc(records.planTime)).limit(15);
}

async function getBottleneckSummary(db: Db, args: Record<string, unknown>) {
  const scope = args.scope === 'doer' ? 'doer' : 'stage';
  const fmsId = typeof args.fmsId === 'string' && args.fmsId ? args.fmsId : undefined;
  const fmsConditions = [eq(fmsMaster.isDeleted, false), eq(fmsMaster.active, true)];
  if (fmsId) fmsConditions.push(eq(fmsMaster.fmsId, fmsId));
  const configs = await db.select().from(fmsMaster).where(and(...fmsConditions));
  if (!configs.length) return [];
  const evalRows = await db.select().from(fmsEvalCache).where(inArray(fmsEvalCache.fmsId, configs.map((c) => c.fmsId)));
  const evalByFmsId = new Map(evalRows.map((r) => [r.fmsId, r]));

  const buckets: (FinalizedBucket & { fmsId: string; fmsName: string })[] = [];
  for (const c of configs) {
    const row = evalByFmsId.get(c.fmsId);
    const list = (scope === 'doer' ? row?.doerBottlenecks : row?.stageBottlenecks) as FinalizedBucket[] | null;
    (list ?? []).forEach((b) => buckets.push({ ...b, fmsId: c.fmsId, fmsName: c.fmsName }));
  }
  buckets.sort((a, b) => b.bottleneckScore - a.bottleneckScore);
  return buckets.slice(0, 5);
}

async function getDataHealthIssues(db: Db) {
  const [row] = await db.select().from(dataHealthCache).where(eq(dataHealthCache.id, 1)).limit(1);
  return { checkedAt: row?.checkedAt ? row.checkedAt.toISOString() : null, issueCount: row?.issueCount ?? 0, issues: row?.issues ?? [] };
}

// Reuses doerPerformance.ts's own rollup/scoring (same numbers DoerPerformancePage.tsx shows) —
// all-time only (no date-range param exposed to the model yet; the route's live-recompute branch
// is a bigger cost than a chat tool call should take on).
async function getDoerPerformance(db: Db, args: Record<string, unknown>) {
  const configs = await db.select().from(fmsMaster).where(and(eq(fmsMaster.isDeleted, false), eq(fmsMaster.active, true)));
  if (!configs.length) return [];
  const evalRows = await db.select().from(fmsEvalCache).where(inArray(fmsEvalCache.fmsId, configs.map((c) => c.fmsId)));
  const evalByFmsId = new Map(evalRows.map((r) => [r.fmsId, r]));
  const perFms = configs.map((c) => ({
    fmsId: c.fmsId,
    buckets: (evalByFmsId.get(c.fmsId)?.doerBottlenecks as FinalizedBucket[] | null) ?? [],
  }));

  const doerMap = rollupDoerBuckets(perFms);
  const nameFilter = typeof args.doerName === 'string' && args.doerName.trim() ? args.doerName.trim().toLowerCase() : null;

  const rows = Array.from(doerMap.values())
    .filter((d) => !nameFilter || d.doerName.toLowerCase().includes(nameFilter))
    .map((d) => {
      const { onTimeRate, avgDelayMinutes, overdueRate, performanceScore } = scoreDoerRollup(d);
      return {
        doerName: d.doerName, fmsCount: d.fmsIds.size, assignedStages: d.assigned, completed: d.completed,
        onTime: d.onTime, late: d.late, pending: d.pending, overdue: d.overdue, stalled: d.stalled,
        onTimeRate, avgDelayMinutes, overdueRate, performanceScore,
      };
    });
  rows.sort((a, b) => (b.performanceScore ?? -1) - (a.performanceScore ?? -1));

  if (nameFilter && !rows.length) {
    return { error: `No doer matching "${args.doerName}" found in any connected FMS's recent activity.` };
  }
  return nameFilter ? rows : rows.slice(0, 15);
}
