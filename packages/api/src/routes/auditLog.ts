import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { auditLog } from '@fms/db';
import { ok } from '@fms/core';
import { requireAuth } from '../middleware/auth';
import type { Variables } from '../types';

// Direct successor to app/Code.gs's getAuditLogs.
export const auditLogRoutes = new Hono<{ Variables: Variables }>();

auditLogRoutes.get('/', requireAuth('audit.view'), async (c) => {
  const db = c.get('db');
  const q = c.req.query();

  const conditions = [];
  if (q.username) conditions.push(eq(auditLog.username, q.username));
  if (q.module) conditions.push(eq(auditLog.module, q.module));
  if (q.action) conditions.push(eq(auditLog.action, q.action));

  const limit = Math.min(Number(q.limit) || 500, 2000);
  const rows = await db.select().from(auditLog)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(auditLog.timestamp)).limit(limit);

  return c.json(ok(rows));
});
