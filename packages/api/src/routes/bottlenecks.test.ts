// Integration tests against a REAL Postgres — same convention as records.test.ts.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import * as schema from '@fms/db';
import app from '../index';
import { generateId, generateSalt, hashPassword } from '../crypto';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function asJson(res: Response): Promise<any> {
  return res.json();
}

describeIfDb('bottlenecks routes (integration)', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const testUserId = generateId('usr');
  const testRoleId = 'TEST_BN_VIEWER';
  const username = `test_bn_${Date.now()}`;
  const password = 'correct-horse-battery-staple';
  const fmsA = 'fms_bn_test_a';
  let token: string;

  const env = { DATABASE_URL: DATABASE_URL! };

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    db = drizzle(pool, { schema });

    await db.insert(schema.fmsMaster).values({
      fmsId: fmsA, fmsName: 'Bottleneck Test FMS', spreadsheetId: 'sheet_bn', active: true,
    }).onConflictDoNothing();

    await db.insert(schema.roles).values({
      roleId: testRoleId, roleName: 'Test Bottleneck Viewer',
      permissions: { 'records.view': true }, status: 'ACTIVE',
    }).onConflictDoNothing();

    const salt = generateSalt();
    await db.insert(schema.users).values({
      userId: testUserId, username, passwordHash: await hashPassword(password, salt), passwordSalt: salt,
      fullName: 'Test BN User', roleId: testRoleId, status: 'ACTIVE', mustChangePassword: false,
    });

    await db.insert(schema.fmsEvalCache).values({
      fmsId: fmsA, computedAt: new Date(),
      stageBottlenecks: [{ key: 'Invoicing', doerName: '', doerEmail: '', assigned: 5, completed: 2, onTime: 1, late: 1, pending: 3, overdue: 2, stalled: 0, avgDelayMinutes: 60, avgDelayHuman: '1h', maxDelayMinutes: 60, maxDelayHuman: '1h', onTimePercent: 50, dataExceptions: 0, criticalStale: 0, totalDelayDays: 0.1, bottleneckScore: 10.1, reason: 'test' }],
      doerBottlenecks: [{ key: 'Priya', doerName: 'Priya', doerEmail: 'priya@x.com', assigned: 5, completed: 2, onTime: 1, late: 1, pending: 3, overdue: 2, stalled: 0, avgDelayMinutes: 60, avgDelayHuman: '1h', maxDelayMinutes: 60, maxDelayHuman: '1h', onTimePercent: 50, dataExceptions: 0, criticalStale: 0, totalDelayDays: 0.1, bottleneckScore: 10.1, reason: 'test' }],
    });

    await db.insert(schema.records).values([
      { fmsId: fmsA, recordId: 'r1', displayName: 'Rec 1', recordStatus: 'OVERDUE', freshness: 'Stale' },
    ]);
    await db.insert(schema.stageEvents).values([
      { fmsId: fmsA, recordId: 'r1', stageIndex: 0, stageName: 'Invoicing', doerName: 'Priya', doerEmail: 'priya@x.com', status: 'COMPLETED_LATE', actualTime: new Date('2026-08-02T00:00:00Z'), varianceMinutes: 90 },
      { fmsId: fmsA, recordId: 'r1', stageIndex: 1, stageName: 'Dispatch', doerName: 'Ravi', doerEmail: 'ravi@x.com', status: 'OVERDUE', varianceMinutes: 30 },
    ]);

    const loginRes = await app.request('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ username, password }), headers: { 'Content-Type': 'application/json' },
    }, env);
    const loginBody = await asJson(loginRes);
    token = loginBody.data.token;
  });

  afterAll(async () => {
    await db.delete(schema.stageEvents).where(eq(schema.stageEvents.fmsId, fmsA));
    await db.delete(schema.records).where(eq(schema.records.fmsId, fmsA));
    await db.delete(schema.fmsEvalCache).where(eq(schema.fmsEvalCache.fmsId, fmsA));
    await db.delete(schema.fmsMaster).where(eq(schema.fmsMaster.fmsId, fmsA));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, testUserId));
    await db.delete(schema.users).where(eq(schema.users.userId, testUserId));
    await db.delete(schema.roles).where(eq(schema.roles.roleId, testRoleId));
    await pool.end();
  });

  const auth = () => ({ headers: { Authorization: `Bearer ${token}` } });

  it('requires auth (401 without a token)', async () => {
    const res = await app.request('/api/bottlenecks', {}, env);
    expect(res.status).toBe(401);
  });

  it('without a date filter, reads pre-aggregated buckets from fms_eval_cache', async () => {
    const res = await app.request(`/api/bottlenecks?fmsId=${fmsA}`, auth(), env);
    expect(res.status).toBe(200);
    const body = await asJson(res);
    expect(body.data.byStage[0].key).toBe('Invoicing');
    expect(body.data.byStage[0].fmsId).toBe(fmsA);
    expect(body.data.byDoer[0].key).toBe('Priya');
  });

  it('with a date filter, recomputes live from records + stage_events', async () => {
    const res = await app.request(`/api/bottlenecks?fmsId=${fmsA}&dateFrom=2026-08-02&dateTo=2026-08-02`, auth(), env);
    expect(res.status).toBe(200);
    const body = await asJson(res);
    // Dispatch is still OPEN (OVERDUE) so it always counts regardless of date range; Invoicing's
    // completion falls inside the range too, so both stages should appear.
    const stageKeys = body.data.byStage.map((b: { key: string }) => b.key).sort();
    expect(stageKeys).toEqual(['Dispatch', 'Invoicing']);
  });

  it('a date range excluding the completion date drops the completed-only stage but keeps the open one', async () => {
    const res = await app.request(`/api/bottlenecks?fmsId=${fmsA}&dateFrom=2020-01-01&dateTo=2020-01-02`, auth(), env);
    const body = await asJson(res);
    const stageKeys = body.data.byStage.map((b: { key: string }) => b.key).sort();
    expect(stageKeys).toEqual(['Dispatch']); // Invoicing's only event completed outside the range
  });
});
