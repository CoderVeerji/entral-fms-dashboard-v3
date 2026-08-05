import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { dataHealthCache } from '@fms/db';
import { ok } from '@fms/core';
import { requireAuth } from '../middleware/auth';
import type { Variables } from '../types';

// Instant read of the last (automatic, every sync run) check — never triggers a live scan
// itself, same "cache-only" principle as app/Code.gs's getDataHealthReport. The checks
// themselves run in packages/sync (see packages/sync/src/dataHealth.ts) every 5 minutes.
export const dataHealthRoutes = new Hono<{ Variables: Variables }>();

dataHealthRoutes.get('/', requireAuth('settings.view'), async (c) => {
  const db = c.get('db');
  const [row] = await db.select().from(dataHealthCache).where(eq(dataHealthCache.id, 1)).limit(1);
  if (!row) return c.json(ok({ checkedAt: null, issues: [], issueCount: 0 }));
  return c.json(ok({ checkedAt: row.checkedAt, issues: row.issues || [], issueCount: row.issueCount || 0 }));
});
