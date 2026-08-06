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

  // Cards reflect every freshness bucket for the current fmsId scope regardless of which one is
  // selected below — same convention as Code.gs's getUpdateHealth, which built `cards` from the
  // unfiltered base set so switching the freshness filter doesn't change the card counts.
  const cardConditions = [eq(records.isArchived, false)];
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

  const conditions = [eq(records.isArchived, false)];
  if (q.fmsId) conditions.push(eq(records.fmsId, q.fmsId));
  if (q.freshness) conditions.push(eq(records.freshness, q.freshness));
  if (q.todayOnly === 'true') conditions.push(sql`${records.lastUpdate} >= date_trunc('day', now())`);
  const where = and(...conditions);

  const start = Math.max(0, Number(q.start) || 0);
  let length = Number(q.length);
  if (!length || length < 0) length = 50;
  length = Math.min(length, HARD_CAP);

  // Oldest/never-updated first (nulls first, then ascending lastUpdate) — same "most urgent
  // first" order as Code.gs's descending-hoursSinceUpdate sort (with null treated as infinite).
  const rowsWithTotal = await db.select({
    fmsId: records.fmsId, recordId: records.recordId, displayName: records.displayName,
    currentStage: records.currentStage, doer: records.doer, planTime: records.planTime,
    delay: records.delay, lastUpdate: records.lastUpdate, freshness: records.freshness,
    // count(*) is Postgres bigint, which the driver returns as a string — cast to int here so the
    // JSON response actually carries a number, not "1" (see updateHealth.test.ts's regression).
    openActions: sql<number>`(select count(*)::int from ${actionItems} where ${actionItems.fmsId} = ${records.fmsId} and ${actionItems.recordId} = ${records.recordId} and ${actionItems.isDeleted} = false and ${actionItems.status} not in ('Resolved', 'Cancelled'))`,
    totalCount: sql<number>`count(*) over()`,
  }).from(records).where(where)
    .orderBy(sql`${records.lastUpdate} asc nulls first`)
    .limit(length).offset(start);

  const rowsTotal = rowsWithTotal.length > 0 ? Number(rowsWithTotal[0].totalCount) : 0;
  const rows = rowsWithTotal.map(({ totalCount: _totalCount, ...rest }) => rest);

  return c.json(ok({ rows, cards, rowsTotal, start, length }));
});
