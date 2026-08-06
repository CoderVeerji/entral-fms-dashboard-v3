import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { appSettings } from '@fms/db';
import { ok, AppError } from '@fms/core';
import { requireAuth } from '../middleware/auth';
import { logAudit } from '../audit';
import type { Variables } from '../types';

// Direct successor to app/Code.gs's getSettings/saveSettings — unlike that version, this returns
// the raw key/value/description rows rather than a hand-typed object, so a newly seeded setting
// (packages/db/src/seed.ts) shows up here with zero route changes.
export const appSettingsRoutes = new Hono<{ Variables: Variables }>();

const NUMERIC_KEYS = new Set([
  'SESSION_HOURS', 'CACHE_MINUTES', 'ON_TIME_TOLERANCE_MINUTES', 'STALE_WARNING_HOURS',
  'STALE_CRITICAL_HOURS', 'DEFAULT_PAGE_SIZE', 'AT_RISK_WINDOW_MINUTES',
]);

appSettingsRoutes.get('/', requireAuth('settings.view'), async (c) => {
  const db = c.get('db');
  const rows = await db.select().from(appSettings);
  return c.json(ok(rows));
});

appSettingsRoutes.patch('/', requireAuth('settings.edit'), async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const payload = await c.req.json<Record<string, string>>();

  for (const [key, value] of Object.entries(payload)) {
    if (NUMERIC_KEYS.has(key) && Number.isNaN(Number(value))) {
      throw new AppError('INVALID_INPUT', `${key} must be a number.`);
    }
  }

  const existing = await db.select({ key: appSettings.key }).from(appSettings);
  const existingKeys = new Set(existing.map((r) => r.key));

  for (const [key, value] of Object.entries(payload)) {
    if (!existingKeys.has(key)) continue;
    await db.update(appSettings).set({ value: String(value), updatedAt: new Date(), updatedBy: session.username })
      .where(eq(appSettings.key, key));
  }

  await logAudit(db, { username: session.username, role: session.roleId, action: 'SETTINGS_UPDATE', module: 'settings', details: payload });

  const rows = await db.select().from(appSettings);
  return c.json(ok(rows, 'Settings saved.'));
});
