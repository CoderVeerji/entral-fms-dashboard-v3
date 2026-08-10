import { Hono } from 'hono';
import { and, eq, sql } from 'drizzle-orm';
import { records, actionItems } from '@fms/db';
import { ok } from '@fms/core';
import { requireAuth } from '../middleware/auth';
import type { Variables } from '../types';

// Direct successor to app/Code.gs's getUpdateHealth — same freshness-card + per-record staleness
// view (which record hasn't been touched in how long), now a real indexed SQL query
// (idx_records_fms_freshness) instead of a full in-memory scan/sort.
export const updateHealthRoutes = new Hono<{ Variables: Variables }>();

const HARD_CAP = 2000;

updateHealthRoutes.get('/', requireAuth('records.view'), async (c) => {
  const db = c.get('db');
  const q = c.req.query();

  // NOT_STARTED means the current stage has no plan time at all (see app/FMS_Status_Publisher.gs's
  // evaluateRecord_) — per ops guidance there's always some real reason a step hasn't been given a
  // plan yet (waiting on another department, a hold, etc.), so it's never "gone quiet" in the sense
  // this page means; it only becomes trackable once something gives it a plan. Excluded from both
  // the cards and the row list, same as it's excluded from the Dashboard's status counts.
  const notStartedCondition = sql`${records.recordStatus} != 'NOT_STARTED'`;

  // Cards reflect every freshness bucket for the current fmsId scope regardless of which one is
  // selected below — same convention as Code.gs's getUpdateHealth, which built `cards` from the
  // unfiltered base set so switching the freshness filter doesn't change the card counts.
  const cardConditions = [eq(records.isArchived, false), notStartedCondition];
  if (q.fmsId) cardConditions.push(eq(records.fmsId, q.fmsId));
  const cardRows = await db.select({
    freshness: records.freshness,
    count: sql<number>`count(*)`,
    updatedToday: sql<number>`count(*) filter (where ${records.lastUpdate} >= date_trunc('day', now()))`,
  }).from(records).where(and(...cardConditions)).groupBy(records.freshness);

  const cards = { updatedToday: 0, warning: 0, stale: 0, critical: 0, neverUpdated: 0 };
  cardRows.forEach((r) => {
    cards.updatedToday += Number(r.updatedToday);
    if (r.freshness === 'Warning') cards.warning = Number(r.count);
    if (r.freshness === 'Stale') cards.stale = Number(r.count);
    if (r.freshness === 'Critical') cards.critical = Number(r.count);
    if (r.freshness === 'Never') cards.neverUpdated = Number(r.count);
  });

  const conditions = [eq(records.isArchived, false), notStartedCondition];
  if (q.fmsId) conditions.push(eq(records.fmsId, q.fmsId));
  if (q.freshness) conditions.push(eq(records.freshness, q.freshness));
  if (q.todayOnly === 'true') conditions.push(sql`${records.lastUpdate} >= date_trunc('day', now())`);
  const where = and(...conditions);

  const start = Math.max(0, Number(q.start) || 0);
  let length = Number(q.length);
  if (!length || length < 0) length = 50;
  length = Math.min(length, HARD_CAP);

  // Open-action counts per (fmsId, recordId), pre-aggregated as its own subquery and LEFT JOINed
  // in — NOT a correlated scalar subquery in the same SELECT as the count(*) over() window
  // function below. That combination was observed (via updateHealth.test.ts) to make Postgres
  // mis-evaluate the correlated subquery, over-counting openActions for a record even when only
  // one matching action_items row genuinely existed. A LEFT JOIN against a GROUP BY aggregate is
  // the standard way to compute a per-row count alongside a window function and doesn't hit
  // whatever query-plan interaction caused that.
  const openActionsAgg = db.select({
    fmsId: actionItems.fmsId, recordId: actionItems.recordId,
    // count(*) is Postgres bigint, which the driver returns as a string — cast to int here so the
    // JSON response actually carries a number, not "1" (see updateHealth.test.ts's regression).
    count: sql<number>`count(*)::int`.as('open_actions_count'),
  }).from(actionItems)
    .where(and(eq(actionItems.isDeleted, false), sql`${actionItems.status} not in ('Resolved', 'Cancelled')`))
    .groupBy(actionItems.fmsId, actionItems.recordId)
    .as('open_actions_agg');

  // Oldest/never-updated first (nulls first, then ascending lastUpdate) — same "most urgent
  // first" order as Code.gs's descending-hoursSinceUpdate sort (with null treated as infinite).
  const rowsWithTotal = await db.select({
    fmsId: records.fmsId, recordId: records.recordId, displayName: records.displayName,
    currentStage: records.currentStage, doer: records.doer, planTime: records.planTime,
    delay: records.delay, lastUpdate: records.lastUpdate, freshness: records.freshness,
    openActions: sql<number>`coalesce(${openActionsAgg.count}, 0)`,
    totalCount: sql<number>`count(*) over()`,
  }).from(records)
    .leftJoin(openActionsAgg, and(eq(openActionsAgg.fmsId, records.fmsId), eq(openActionsAgg.recordId, records.recordId)))
    .where(where)
    .orderBy(sql`${records.lastUpdate} asc nulls first`)
    .limit(length).offset(start);

  const rowsTotal = rowsWithTotal.length > 0 ? Number(rowsWithTotal[0].totalCount) : 0;
  const rows = rowsWithTotal.map(({ totalCount: _totalCount, ...rest }) => rest);

  return c.json(ok({ rows, cards, rowsTotal, start, length }));
});
