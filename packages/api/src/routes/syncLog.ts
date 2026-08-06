import { Hono } from 'hono';
import { desc, eq } from 'drizzle-orm';
import { syncLog } from '@fms/db';
import { ok } from '@fms/core';
import { requireAuth } from '../middleware/auth';
import type { Variables } from '../types';

// Direct successor to app/Code.gs's getSyncLogs.
export const syncLogRoutes = new Hono<{ Variables: Variables }>();

syncLogRoutes.get('/', requireAuth('audit.view'), async (c) => {
  const db = c.get('db');
  const q = c.req.query();
  const limit = Math.min(Number(q.limit) || 200, 1000);

  const rows = await db.select().from(syncLog)
    .where(q.fmsId ? eq(syncLog.fmsId, q.fmsId) : undefined)
    .orderBy(desc(syncLog.startedAt)).limit(limit);

  return c.json(ok(rows));
});
