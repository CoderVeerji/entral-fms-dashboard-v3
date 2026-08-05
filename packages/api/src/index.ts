import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createDb } from './db';
import { AppError, fail } from '@fms/core';
import { statusForCode } from './errors';
import { authRoutes } from './routes/auth';
import { fmsRoutes } from './routes/fms';
import { recordsRoutes } from './routes/records';
import { dashboardRoutes } from './routes/dashboard';
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
app.route('/api/dashboard', dashboardRoutes);

export default app;
