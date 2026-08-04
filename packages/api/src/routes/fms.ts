import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { fmsMaster } from '@fms/db';
import { ok, AppError, generateId } from '@fms/core';
import { requireAuth } from '../middleware/auth';
import type { Variables } from '../types';

// FMS registry — minimal for M1 (list + create/update only, matches app/Code.gs's getFmsList/
// saveFmsConfig). A full "FMS Sources" management UI (test-connection, activate/deactivate,
// reorder) is M2 scope per the plan; this exists now purely so a real FMS can be registered for
// packages/sync to read from.
export const fmsRoutes = new Hono<{ Variables: Variables }>();

fmsRoutes.get('/', requireAuth('fms.view'), async (c) => {
  const db = c.get('db');
  const rows = await db.select().from(fmsMaster).where(eq(fmsMaster.isDeleted, false));
  return c.json(ok(rows));
});

fmsRoutes.post('/', requireAuth('fms.manage'), async (c) => {
  const db = c.get('db');
  const body = await c.req.json<{
    fmsId?: string; fmsName?: string; shortName?: string; spreadsheetId?: string;
    statusCacheSheetName?: string; active?: boolean;
  }>();
  if (!body.fmsName || !String(body.fmsName).trim()) throw new AppError('INVALID_INPUT', 'FMS name is required.');
  if (!body.spreadsheetId || !String(body.spreadsheetId).trim()) throw new AppError('INVALID_INPUT', 'Spreadsheet ID is required.');

  if (body.fmsId) {
    const [existing] = await db.select().from(fmsMaster).where(eq(fmsMaster.fmsId, body.fmsId)).limit(1);
    if (!existing) throw new AppError('NOT_FOUND', 'FMS not found.');
    await db.update(fmsMaster).set({
      fmsName: body.fmsName, shortName: body.shortName ?? '', spreadsheetId: body.spreadsheetId,
      statusCacheSheetName: body.statusCacheSheetName || 'Status_Cache',
      active: body.active ?? true, updatedAt: new Date(),
    }).where(eq(fmsMaster.fmsId, body.fmsId));
    return c.json(ok({ fmsId: body.fmsId }, 'FMS updated.'));
  }

  const fmsId = generateId('fms');
  await db.insert(fmsMaster).values({
    fmsId, fmsName: body.fmsName, shortName: body.shortName || '', spreadsheetId: body.spreadsheetId,
    statusCacheSheetName: body.statusCacheSheetName || 'Status_Cache', active: true, sortOrder: 0,
  });
  return c.json(ok({ fmsId }, 'FMS connected.'));
});
