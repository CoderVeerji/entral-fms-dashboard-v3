import { Hono } from 'hono';
import { and, asc, desc, eq, getTableColumns, gte, isNotNull, lte, sql } from 'drizzle-orm';
import { records, stageEvents, actionItems } from '@fms/db';
import { ok, AppError } from '@fms/core';
import { requireAuth } from '../middleware/auth';
import type { Variables } from '../types';

// Direct successor to app/Code.gs's getLiveRecords — same filter contract (fmsId/status/stage/
// doer/freshness/search/dateFrom/dateTo/start/length), but every filter is now a real indexed SQL
// WHERE clause instead of a JS .filter() over an in-memory array (see plan §"Database schema" —
// idx_records_fms_status/freshness/doer/stage/plan_time, idx_records_search_trgm). This is the
// actual fix for the original "Live Records is slow" complaint.
export const recordsRoutes = new Hono<{ Variables: Variables }>();

const HARD_CAP = 2000;

recordsRoutes.get('/', requireAuth('records.view'), async (c) => {
  const db = c.get('db');
  const q = c.req.query();

  const conditions = [eq(records.isArchived, false)];
  if (q.fmsId) conditions.push(eq(records.fmsId, q.fmsId));
  if (q.status) conditions.push(eq(records.recordStatus, q.status));
  if (q.stage) conditions.push(eq(records.currentStage, q.stage));
  if (q.doer) conditions.push(eq(records.doer, q.doer));
  if (q.freshness) conditions.push(eq(records.freshness, q.freshness));
  if (q.dateFrom) {
    const d = new Date(q.dateFrom);
    if (!Number.isNaN(d.getTime())) conditions.push(gte(records.planTime, d));
  }
  if (q.dateTo) {
    const d = new Date(q.dateTo);
    if (!Number.isNaN(d.getTime())) conditions.push(lte(records.planTime, d));
  }
  if (q.search && q.search.trim()) {
    // Matches the gin_trgm_ops index built on this exact concatenated expression
    // (packages/db/migrations/0000_init.sql, idx_records_search_trgm) — searching displayName/
    // recordId/doer in one ILIKE, same fields app/Code.gs's getLiveRecords searched.
    const term = `%${q.search.trim()}%`;
    conditions.push(sql`(${records.displayName} || ' ' || ${records.recordId} || ' ' || coalesce(${records.doer}, '')) ILIKE ${term}`);
  }

  const where = and(...conditions);

  const start = Math.max(0, Number(q.start) || 0);
  let length = Number(q.length);
  if (!length || length < 0) length = 50;
  length = Math.min(length, HARD_CAP);

  // One round trip instead of two: `count(*) over()` rides along with the page of rows instead
  // of a separate COUNT query — halves the Neon HTTP-driver latency this endpoint pays per call
  // (see plan §"Backend API" on why Workers uses the HTTP driver, not a pooled connection).
  const rowsWithTotal = await db.select({
    ...getTableColumns(records),
    totalCount: sql<number>`count(*) over()`,
  }).from(records).where(where)
    .orderBy(desc(records.planTime))
    .limit(length).offset(start);

  const total = rowsWithTotal.length > 0 ? Number(rowsWithTotal[0].totalCount) : 0;
  const rows = rowsWithTotal.map(({ totalCount: _totalCount, ...rest }) => rest);

  return c.json(ok({ records: rows, total, start, length }));
});

// Powers Live Records' Stage/Doer filter dropdowns — real distinct values instead of a free-text
// box the user has to type an exact, case-sensitive match into. Scoped to the selected FMS (or
// all, if none) so the dropdown only ever offers options that actually exist right now.
recordsRoutes.get('/filter-options', requireAuth('records.view'), async (c) => {
  const db = c.get('db');
  const q = c.req.query();
  const conditions = [eq(records.isArchived, false)];
  if (q.fmsId) conditions.push(eq(records.fmsId, q.fmsId));

  const stageRows = await db.selectDistinct({ value: records.currentStage }).from(records)
    .where(and(...conditions, isNotNull(records.currentStage)));
  const doerRows = await db.selectDistinct({ value: records.doer }).from(records)
    .where(and(...conditions, isNotNull(records.doer)));

  const stages = stageRows.map((r) => r.value).filter((v): v is string => !!v).sort();
  const doers = doerRows.map((r) => r.value).filter((v): v is string => !!v).sort();
  return c.json(ok({ stages, doers }));
});

recordsRoutes.get('/:fmsId/:recordId', requireAuth('records.view'), async (c) => {
  const db = c.get('db');
  const { fmsId, recordId } = c.req.param();

  const [record] = await db.select().from(records)
    .where(and(eq(records.fmsId, fmsId), eq(records.recordId, recordId))).limit(1);
  if (!record) throw new AppError('NOT_FOUND', 'Record not found.');

  const stages = await db.select().from(stageEvents)
    .where(and(eq(stageEvents.fmsId, fmsId), eq(stageEvents.recordId, recordId)))
    .orderBy(asc(stageEvents.stageIndex));

  const actions = await db.select().from(actionItems)
    .where(and(eq(actionItems.fmsId, fmsId), eq(actionItems.recordId, recordId), eq(actionItems.isDeleted, false)))
    .orderBy(desc(actionItems.createdAt));

  return c.json(ok({ record, stages, actions }));
});
