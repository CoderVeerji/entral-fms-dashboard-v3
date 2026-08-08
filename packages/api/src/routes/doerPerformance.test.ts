// Integration tests against a REAL Postgres — same convention as bottlenecks.test.ts.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import * as schema from '@fms/db';
import type { FinalizedBucket } from '@fms/core';
import app from '../index';
import { generateId, generateSalt, hashPassword } from '../crypto';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function asJson(res: Response): Promise<any> {
  return res.json();
}

describeIfDb('doer performance routes (integration)', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const testUserId = generateId('usr');
  const testRoleId = 'TEST_DOER_VIEWER';
  const username = `test_doer_${Date.now()}`;
  const password = 'correct-horse-battery-staple';
  const fmsA = 'fms_doer_test_a';
  const fmsB = 'fms_doer_test_b';
  let token: string;

  const env = { DATABASE_URL: DATABASE_URL! };

  // A doer's rollup key is `${doerName}|${doerEmail}` (see doerPerformance.ts's rollupDoerBuckets)
  // and the "no fmsId filter" tests below deliberately query across EVERY active FMS in the whole
  // test database — Vitest runs test files concurrently against the same shared Postgres, so
  // reusing a plain 'priya@x.com'/'ravi@x.com' here previously collided with bottlenecks.test.ts's
  // and misReport.test.ts's own identically-named fixtures whenever their beforeAll happened to
  // still be present, silently inflating fmsCount/assigned/completed (a real, intermittent CI
  // failure this caused). Suffixed with .doerperf so this file's identities can never collide with
  // another test file's, regardless of execution order/timing.
  function bucket(overrides: Partial<FinalizedBucket> = {}) {
    return {
      key: 'Priya', doerName: 'Priya', doerEmail: 'priya.doerperf@x.com', assigned: 10, completed: 8, onTime: 6, late: 2,
      pending: 2, overdue: 1, stalled: 0, avgDelayMinutes: 45, avgDelayHuman: '45m', maxDelayMinutes: 90,
      maxDelayHuman: '1h 30m', onTimePercent: 75, dataExceptions: 0, criticalStale: 1, totalDelayDays: 0.1,
      bottleneckScore: 5.1, reason: 'test', ...overrides,
    };
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    db = drizzle(pool, { schema });

    await db.insert(schema.fmsMaster).values([
      { fmsId: fmsA, fmsName: 'Doer Test FMS A', spreadsheetId: 'sheet_doer_a', active: true },
      { fmsId: fmsB, fmsName: 'Doer Test FMS B', spreadsheetId: 'sheet_doer_b', active: true },
    ]).onConflictDoNothing();

    await db.insert(schema.roles).values({
      roleId: testRoleId, roleName: 'Test Doer Viewer', permissions: { 'reports.view': true }, status: 'ACTIVE',
    }).onConflictDoNothing();

    const salt = generateSalt();
    await db.insert(schema.users).values({
      userId: testUserId, username, passwordHash: await hashPassword(password, salt), passwordSalt: salt,
      fullName: 'Test Doer User', roleId: testRoleId, status: 'ACTIVE', mustChangePassword: false,
    });

    // Priya appears in both FMS — rollup should combine her stats across both.
    await db.insert(schema.fmsEvalCache).values([
      { fmsId: fmsA, computedAt: new Date(), doerBottlenecks: [bucket()] },
      { fmsId: fmsB, computedAt: new Date(), doerBottlenecks: [bucket({ assigned: 5, completed: 5, onTime: 5, late: 0, pending: 0, overdue: 0, criticalStale: 0, avgDelayMinutes: null })] },
    ]);

    await db.insert(schema.actionItems).values([
      { actionId: generateId('act'), fmsId: fmsA, assignedEmail: 'priya.doerperf@x.com', actionType: 'Follow-up', priority: 'High', title: 'Open one', status: 'Open' },
      { actionId: generateId('act'), fmsId: fmsA, assignedEmail: 'priya.doerperf@x.com', actionType: 'Follow-up', priority: 'Low', title: 'Resolved one', status: 'Resolved' },
    ]);

    // For the dateFrom/dateTo live-recompute branch — same pattern as bottlenecks.test.ts's own
    // date-range test (this is the exact same shared computeLiveBuckets helper both routes call).
    await db.insert(schema.records).values([
      { fmsId: fmsA, recordId: 'dr1', displayName: 'Doer Range Rec', recordStatus: 'OVERDUE', freshness: 'Stale' },
    ]);
    await db.insert(schema.stageEvents).values([
      { fmsId: fmsA, recordId: 'dr1', stageIndex: 0, stageName: 'Review', doerName: 'Ravi', doerEmail: 'ravi.doerperf@x.com', status: 'COMPLETED_LATE', actualTime: new Date('2026-08-02T00:00:00Z'), varianceMinutes: 90 },
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
    await db.delete(schema.actionItems).where(eq(schema.actionItems.fmsId, fmsA));
    await db.delete(schema.fmsEvalCache).where(eq(schema.fmsEvalCache.fmsId, fmsA));
    await db.delete(schema.fmsEvalCache).where(eq(schema.fmsEvalCache.fmsId, fmsB));
    await db.delete(schema.fmsMaster).where(eq(schema.fmsMaster.fmsId, fmsA));
    await db.delete(schema.fmsMaster).where(eq(schema.fmsMaster.fmsId, fmsB));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, testUserId));
    await db.delete(schema.users).where(eq(schema.users.userId, testUserId));
    await db.delete(schema.roles).where(eq(schema.roles.roleId, testRoleId));
    await pool.end();
  });

  const auth = () => ({ headers: { Authorization: `Bearer ${token}` } });

  it('requires auth (401 without a token)', async () => {
    const res = await app.request('/api/reports/doer-performance', {}, env);
    expect(res.status).toBe(401);
  });

  it('rolls up one doer across multiple FMS', async () => {
    const res = await app.request('/api/reports/doer-performance', auth(), env);
    expect(res.status).toBe(200);
    const body = await asJson(res);
    const priya = body.data.find((d: { email: string }) => d.email === 'priya.doerperf@x.com');
    expect(priya.fmsCount).toBe(2);
    expect(priya.assignedStages).toBe(15); // 10 + 5
    expect(priya.completed).toBe(13); // 8 + 5
    expect(priya.performanceScore).not.toBeNull();
  });

  it('counts only open (non-resolved) action items assigned to the doer', async () => {
    const res = await app.request('/api/reports/doer-performance', auth(), env);
    const body = await asJson(res);
    const priya = body.data.find((d: { email: string }) => d.email === 'priya.doerperf@x.com');
    expect(priya.openActions).toBe(1);
  });

  it('scopes to a single fmsId when filtered', async () => {
    const res = await app.request(`/api/reports/doer-performance?fmsId=${fmsB}`, auth(), env);
    const body = await asJson(res);
    const priya = body.data.find((d: { email: string }) => d.email === 'priya.doerperf@x.com');
    expect(priya.fmsCount).toBe(1);
    expect(priya.assignedStages).toBe(5);
  });

  it('with a date range, recomputes live from records + stage_events (not the fms_eval_cache rollup)', async () => {
    const res = await app.request(`/api/reports/doer-performance?fmsId=${fmsA}&dateFrom=2026-08-02&dateTo=2026-08-02`, auth(), env);
    expect(res.status).toBe(200);
    const body = await asJson(res);
    // Priya only exists in the eval-cache fixture, not in records/stage_events, so a date-filtered
    // query (which ignores the cache entirely) must not find her.
    expect(body.data.find((d: { email: string }) => d.email === 'priya.doerperf@x.com')).toBeUndefined();
    const ravi = body.data.find((d: { email: string }) => d.email === 'ravi.doerperf@x.com');
    expect(ravi.completed).toBe(1);
    expect(ravi.late).toBe(1);
  });

  it('a date range excluding the completion date finds nothing for that doer', async () => {
    const res = await app.request(`/api/reports/doer-performance?fmsId=${fmsA}&dateFrom=2020-01-01&dateTo=2020-01-02`, auth(), env);
    const body = await asJson(res);
    expect(body.data.find((d: { email: string }) => d.email === 'ravi.doerperf@x.com')).toBeUndefined();
  });
});
