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

describeIfDb('MIS report routes (integration)', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const testUserId = generateId('usr');
  const testRoleId = 'TEST_MIS_VIEWER';
  const username = `test_mis_${Date.now()}`;
  const password = 'correct-horse-battery-staple';
  const fmsA = 'fms_mis_test_a';
  let token: string;

  const env = { DATABASE_URL: DATABASE_URL! };

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    db = drizzle(pool, { schema });

    await db.insert(schema.fmsMaster).values({
      fmsId: fmsA, fmsName: 'MIS Test FMS', spreadsheetId: 'sheet_mis', active: true,
    }).onConflictDoNothing();

    await db.insert(schema.roles).values({
      roleId: testRoleId, roleName: 'Test MIS Viewer',
      permissions: { 'reports.view': true }, status: 'ACTIVE',
    }).onConflictDoNothing();

    const salt = generateSalt();
    await db.insert(schema.users).values({
      userId: testUserId, username, passwordHash: await hashPassword(password, salt), passwordSalt: salt,
      fullName: 'Test MIS User', roleId: testRoleId, status: 'ACTIVE', mustChangePassword: false,
    });

    await db.insert(schema.records).values([
      // completedSteps 0 + planTime inside period -> counts as a "new" record for that day
      { fmsId: fmsA, recordId: 'm1', displayName: 'New Today', recordStatus: 'RUNNING_ON_TIME', freshness: 'Fresh', planTime: new Date('2026-08-02T10:00:00Z'), completedSteps: 0, totalSteps: 3 },
      { fmsId: fmsA, recordId: 'm2', displayName: 'Overdue Now', recordStatus: 'OVERDUE', freshness: 'Stale', completedSteps: 1, totalSteps: 3 },
      { fmsId: fmsA, recordId: 'm3', displayName: 'Completed Late', recordStatus: 'COMPLETED_LATE', freshness: 'Fresh', completedSteps: 3, totalSteps: 3 },
    ]);
    await db.insert(schema.stageEvents).values([
      { fmsId: fmsA, recordId: 'm3', stageIndex: 0, stageName: 'Invoicing', doerName: 'Priya', doerEmail: 'priya@x.com', status: 'COMPLETED_LATE', actualTime: new Date('2026-08-02T12:00:00Z'), varianceMinutes: 90 },
      { fmsId: fmsA, recordId: 'm3', stageIndex: 1, stageName: 'Dispatch', doerName: 'Ravi', doerEmail: 'ravi@x.com', status: 'COMPLETED_ON_TIME', actualTime: new Date('2026-08-02T13:00:00Z'), varianceMinutes: 5 },
      // Outside the 2026-08-02 window entirely — must not be counted
      { fmsId: fmsA, recordId: 'm2', stageIndex: 0, stageName: 'Invoicing', doerName: 'Priya', doerEmail: 'priya@x.com', status: 'COMPLETED_ON_TIME', actualTime: new Date('2026-07-01T09:00:00Z'), varianceMinutes: 0 },
    ]);
    await db.insert(schema.actionItems).values([
      { actionId: generateId('act'), fmsId: fmsA, recordId: 'm2', actionType: 'Follow-up', priority: 'High', title: 'Chase', status: 'Open', createdAt: new Date('2026-08-02T08:00:00Z') },
    ]);

    const loginRes = await app.request('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ username, password }), headers: { 'Content-Type': 'application/json' },
    }, env);
    const loginBody = await asJson(loginRes);
    token = loginBody.data.token;
  });

  afterAll(async () => {
    await db.delete(schema.actionItems).where(eq(schema.actionItems.fmsId, fmsA));
    await db.delete(schema.stageEvents).where(eq(schema.stageEvents.fmsId, fmsA));
    await db.delete(schema.records).where(eq(schema.records.fmsId, fmsA));
    await db.delete(schema.fmsMaster).where(eq(schema.fmsMaster.fmsId, fmsA));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, testUserId));
    await db.delete(schema.users).where(eq(schema.users.userId, testUserId));
    await db.delete(schema.roles).where(eq(schema.roles.roleId, testRoleId));
    await pool.end();
  });

  const auth = () => ({ headers: { Authorization: `Bearer ${token}` } });

  it('requires auth (401 without a token)', async () => {
    const res = await app.request('/api/reports/mis?reportType=DAILY', {}, env);
    expect(res.status).toBe(401);
  });

  it('rejects an invalid reportType', async () => {
    const res = await app.request('/api/reports/mis?reportType=FORTNIGHTLY', auth(), env);
    expect(res.status).toBe(400);
  });

  it('YEARLY report spans the Indian financial year (Apr 1 - Mar 31)', async () => {
    const res = await app.request(`/api/reports/mis?reportType=YEARLY&year=2026&fmsId=${fmsA}`, auth(), env);
    expect(res.status).toBe(200);
    const body = await asJson(res);
    expect(body.data.periodLabel).toBe('FY 2026-27');
    // Boundary exactness (does "April 1" mean server-local midnight or UTC midnight?) is left to
    // the server's own timezone, same pre-existing assumption DAILY/WEEKLY/MONTHLY already make —
    // just check the year is right and August 2026 (well inside FY2026-27) is captured.
    expect(new Date(body.data.periodStart).getUTCFullYear()).toBe(2026);
    expect(new Date(body.data.periodEnd).getUTCFullYear()).toBe(2027);
    // m3's two August 2026 events AND m2's July 2026 event all fall inside FY2026-27 (Apr 2026 -
    // Mar 2027) — unlike the DAILY test above, where only the August day captured 2 of these 3.
    expect(body.data.metrics.completed).toBe(3);
  });

  it('breakdown rows include onTimePercent for the positive/minus scoring toggle', async () => {
    const res = await app.request(`/api/reports/mis?reportType=DAILY&date=2026-08-02&fmsId=${fmsA}`, auth(), env);
    const body = await asJson(res);
    const invoicing = body.data.stageBreakdown.find((s: { key: string }) => s.key === 'Invoicing');
    expect(invoicing.onTimePercent).toBe(0); // 0 onTime / 1 completed (it was late)
    const dispatch = body.data.stageBreakdown.find((s: { key: string }) => s.key === 'Dispatch');
    expect(dispatch.onTimePercent).toBe(100);
  });

  it('DAILY report scopes completed metrics to that day and current-status metrics to now', async () => {
    const res = await app.request(`/api/reports/mis?reportType=DAILY&date=2026-08-02&fmsId=${fmsA}`, auth(), env);
    expect(res.status).toBe(200);
    const body = await asJson(res);
    expect(body.data.metrics.newRecords).toBe(1); // m1
    expect(body.data.metrics.completed).toBe(2); // m3's two stage events that day
    expect(body.data.metrics.completedOnTime).toBe(1);
    expect(body.data.metrics.completedLate).toBe(1);
    expect(body.data.metrics.overdueAtEnd).toBe(1); // m2, current status, not date-bound
    expect(body.data.metrics.openedActions).toBe(1);
  });

  it('stage/doer breakdowns only include events completed within the period', async () => {
    const res = await app.request(`/api/reports/mis?reportType=DAILY&date=2026-08-02&fmsId=${fmsA}`, auth(), env);
    const body = await asJson(res);
    const stageKeys = body.data.stageBreakdown.map((s: { key: string }) => s.key).sort();
    expect(stageKeys).toEqual(['Dispatch', 'Invoicing']);
    const invoicing = body.data.stageBreakdown.find((s: { key: string }) => s.key === 'Invoicing');
    expect(invoicing.completed).toBe(1); // the July event is excluded
  });

  it('a period with no activity returns zeroed metrics, not an error', async () => {
    const res = await app.request(`/api/reports/mis?reportType=DAILY&date=2020-01-01&fmsId=${fmsA}`, auth(), env);
    expect(res.status).toBe(200);
    const body = await asJson(res);
    expect(body.data.metrics.completed).toBe(0);
    expect(body.data.bestStage).toBeNull();
  });
});
