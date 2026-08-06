import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { appSettings } from '@fms/db';
import { createDb } from './db';
import { AppError, fail } from '@fms/core';
import { statusForCode } from './errors';
import { authRoutes } from './routes/auth';
import { fmsRoutes } from './routes/fms';
import { recordsRoutes } from './routes/records';
import { updateHealthRoutes } from './routes/updateHealth';
import { bottlenecksRoutes } from './routes/bottlenecks';
import { misReportRoutes } from './routes/misReport';
import { doerPerformanceRoutes } from './routes/doerPerformance';
import { actionsRoutes } from './routes/actions';
import { usersRoutes } from './routes/users';
import { rolesRoutes } from './routes/roles';
import { appSettingsRoutes } from './routes/appSettings';
import { auditLogRoutes } from './routes/auditLog';
import { syncLogRoutes } from './routes/syncLog';
import { dashboardRoutes } from './routes/dashboard';
import { syncRoutes } from './routes/sync';
import { dataHealthRoutes } from './routes/dataHealth';
import type { Env } from './env';
import type { Variables } from './types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Real CORS — this is what a normal Cloudflare Pages page + real REST API gets for free, unlike
// the Apps Script HtmlService sandbox this replaces (see plan intro: this incidentally also ends
// the whole google.script.run/fetch/JSONP transport saga from the old stack).
app.use('*', cors());

app.use('*', async (c, next) => {
  c.set('db', createDb(c.env.DATABASE_URL));
  await next();
});

app.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json(fail(err.code, err.message), statusForCode(err.code) as 400 | 401 | 403 | 404 | 409 | 500);
  }
  console.error(err);
  return c.json(fail('SERVER_ERROR', err.message || 'Unexpected server error.'), 500);
});

app.get('/api/health', (c) => c.json({ ok: true }));

app.route('/api/auth', authRoutes);
app.route('/api/fms', fmsRoutes);
app.route('/api/records', recordsRoutes);
app.route('/api/update-health', updateHealthRoutes);
app.route('/api/bottlenecks', bottlenecksRoutes);
app.route('/api/reports/mis', misReportRoutes);
app.route('/api/reports/doer-performance', doerPerformanceRoutes);
app.route('/api/actions', actionsRoutes);
app.route('/api/users', usersRoutes);
app.route('/api/roles', rolesRoutes);
app.route('/api/settings', appSettingsRoutes);
app.route('/api/audit-log', auditLogRoutes);
app.route('/api/sync-log', syncLogRoutes);
app.route('/api/dashboard', dashboardRoutes);
app.route('/api/sync', syncRoutes);
app.route('/api/data-health', dataHealthRoutes);

// Cron Trigger (wrangler.toml, every 4 min) — see that file's comment for why: keeps Neon's
// free-tier compute from suspending so it isn't the *user's* request that pays the cold-start
// wake-up cost. A failed ping just means the next real request wakes it instead — never fatal.
// Attached to `app` itself (rather than wrapping the default export in a plain { fetch, scheduled }
// object) so `app.request(...)` keeps working for tests, which import this same default export.
async function scheduled(_event: ScheduledEvent, env: Env) {
  try {
    await createDb(env.DATABASE_URL).select().from(appSettings).limit(1);
  } catch (err) {
    console.error('[keep-warm] ping failed:', err);
  }
}

export default Object.assign(app, { scheduled });
