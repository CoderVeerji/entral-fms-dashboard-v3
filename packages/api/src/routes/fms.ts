import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { fmsMaster } from '@fms/db';
import { ok, AppError, generateId } from '@fms/core';
import { requireAuth } from '../middleware/auth';
import { logAudit } from '../audit';
import type { Variables } from '../types';

// FMS registry — direct successor to app/Code.gs's getFmsList/saveFmsConfig/setFmsActive, trimmed
// to only the fields v3's architecture actually uses: every connected FMS reads from its own
// FMS_Status_Publisher.gs-written Status_Cache sheet (see packages/db/src/schema.ts's comment on
// fmsMaster.statusCacheSheetName) — the raw-sheet-reading fields the old central-evaluation model
// needed (dataSheetName/stepDirectorySheetName/header rows/column headers) don't apply here.
export const fmsRoutes = new Hono<{ Variables: Variables }>();

fmsRoutes.get('/', requireAuth('fms.view'), async (c) => {
  const db = c.get('db');
  const rows = await db.select().from(fmsMaster).where(eq(fmsMaster.isDeleted, false));
  return c.json(ok(rows));
});

interface SaveFmsPayload {
  fmsId?: string; fmsName?: string; shortName?: string; spreadsheetId?: string;
  statusCacheSheetName?: string; category?: string; ownerName?: string; ownerEmail?: string; notes?: string;
}

fmsRoutes.post('/', requireAuth('fms.manage'), async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const body = await c.req.json<SaveFmsPayload>();
  if (!body.fmsName || !String(body.fmsName).trim()) throw new AppError('INVALID_INPUT', 'FMS name is required.');
  if (!body.spreadsheetId || !String(body.spreadsheetId).trim()) throw new AppError('INVALID_INPUT', 'Spreadsheet ID is required.');

  if (body.fmsId) {
    const [existing] = await db.select().from(fmsMaster).where(eq(fmsMaster.fmsId, body.fmsId)).limit(1);
    if (!existing) throw new AppError('NOT_FOUND', 'FMS not found.');
    await db.update(fmsMaster).set({
      fmsName: body.fmsName, shortName: body.shortName ?? '', spreadsheetId: body.spreadsheetId,
      statusCacheSheetName: body.statusCacheSheetName || 'Status_Cache',
      category: body.category ?? '', ownerName: body.ownerName ?? '', ownerEmail: body.ownerEmail ?? '',
      notes: body.notes ?? '', updatedAt: new Date(),
    }).where(eq(fmsMaster.fmsId, body.fmsId));
    await logAudit(db, { username: session.username, role: session.roleId, action: 'FMS_UPDATE', module: 'fms', recordId: body.fmsId });
    return c.json(ok({ fmsId: body.fmsId }, 'FMS updated.'));
  }

  const fmsId = generateId('fms');
  await db.insert(fmsMaster).values({
    fmsId, fmsName: body.fmsName, shortName: body.shortName || '', spreadsheetId: body.spreadsheetId,
    statusCacheSheetName: body.statusCacheSheetName || 'Status_Cache', active: true, sortOrder: 0,
    category: body.category ?? '', ownerName: body.ownerName ?? '', ownerEmail: body.ownerEmail ?? '', notes: body.notes ?? '',
  });
  await logAudit(db, { username: session.username, role: session.roleId, action: 'FMS_CREATE', module: 'fms', recordId: fmsId });
  return c.json(ok({ fmsId }, 'FMS connected.'));
});

fmsRoutes.patch('/:fmsId/status', requireAuth('fms.manage'), async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const { fmsId } = c.req.param();
  const { active } = await c.req.json<{ active?: boolean }>();
  const [existing] = await db.select().from(fmsMaster).where(eq(fmsMaster.fmsId, fmsId)).limit(1);
  if (!existing) throw new AppError('NOT_FOUND', 'FMS not found.');
  await db.update(fmsMaster).set({ active: !!active, updatedAt: new Date() }).where(eq(fmsMaster.fmsId, fmsId));
  await logAudit(db, { username: session.username, role: session.roleId, action: active ? 'FMS_ACTIVATE' : 'FMS_DEACTIVATE', module: 'fms', recordId: fmsId });
  return c.json(ok(true, active ? 'FMS activated.' : 'FMS deactivated.'));
});
