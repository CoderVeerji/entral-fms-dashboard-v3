import { Hono } from 'hono';
import { and, asc, desc, eq, gte, lte, sql, count } from 'drizzle-orm';
import { records, stageEvents } from '@fms/db';
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

  const [{ value: total }] = await db.select({ value: count() }).from(records).where(where);

  const start = Math.max(0, Number(q.start) || 0);
  let length = Number(q.length);
  if (!length || length < 0) length = 50;
  length = Math.min(length, HARD_CAP);

  const rows = await db.select().from(records).where(where)
    .orderBy(desc(records.planTime))
    .limit(length).offset(start);

  return c.json(ok({ records: rows, total, start, length }));
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

  return c.json(ok({ record, stages }));
});
