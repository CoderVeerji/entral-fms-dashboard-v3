// Integration tests against a REAL Postgres — same convention as updateHealth.test.ts (see that
// file's header comment): auto-run in CI via the postgres:16 service container, skipped locally
// unless DATABASE_URL is set.
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

describeIfDb('dashboard routes (integration)', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const testUserId = generateId('usr');
  const testRoleId = 'TEST_DASH_VIEWER';
  const username = `test_dash_${Date.now()}`;
  const password = 'correct-horse-battery-staple';
  const fmsA = 'fms_dash_test_a';
  let token: string;

  const env = { DATABASE_URL: DATABASE_URL! };

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    db = drizzle(pool, { schema });

    await db.insert(schema.roles).values({
      roleId: testRoleId, roleName: 'Test Dashboard Viewer',
      permissions: { 'dashboard.view': true }, status: 'ACTIVE',
    }).onConflictDoNothing();

    const salt = generateSalt();
    await db.insert(schema.users).values({
      userId: testUserId, username, passwordHash: await hashPassword(password, salt), passwordSalt: salt,
      fullName: 'Test Dashboard User', roleId: testRoleId, status: 'ACTIVE', mustChangePassword: false,
    });

    await db.insert(schema.fmsMaster).values({
      fmsId: fmsA, fmsName: 'Test Dashboard FMS', spreadsheetId: 'sheet_dash_test',
      statusCacheSheetName: 'Status_Cache', active: true, isDeleted: false,
    });

    const now = new Date();
    const hoursFromNow = (h: number) => new Date(now.getTime() + h * 3600000);
    // d1: due earlier today, still open (Overdue (Before Today) must NOT count this — same day)
    // d2: due later today, still open (Due Today)
    // d3: due tomorrow (Upcoming)
    // d4: due yesterday, still open (Overdue (Before Today))
    // d5: no plan at all (NOT_STARTED) — must not land in any of the three buckets
    await db.insert(schema.records).values([
      { fmsId: fmsA, recordId: 'd1', displayName: 'Due earlier today', recordStatus: 'OVERDUE', freshness: 'Fresh', planTime: hoursFromNow(-2) },
      { fmsId: fmsA, recordId: 'd2', displayName: 'Due later today', recordStatus: 'RUNNING_ON_TIME', freshness: 'Fresh', planTime: hoursFromNow(2) },
      { fmsId: fmsA, recordId: 'd3', displayName: 'Due tomorrow', recordStatus: 'RUNNING_ON_TIME', freshness: 'Fresh', planTime: hoursFromNow(30) },
      { fmsId: fmsA, recordId: 'd4', displayName: 'Due yesterday', recordStatus: 'OVERDUE', freshness: 'Critical', planTime: hoursFromNow(-30) },
      { fmsId: fmsA, recordId: 'd5', displayName: 'No plan yet', recordStatus: 'NOT_STARTED', freshness: 'Never', planTime: null },
    ]);

    const loginRes = await app.request('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ username, password }), headers: { 'Content-Type': 'application/json' },
    }, env);
    const loginBody = await asJson(loginRes);
    token = loginBody.data.token;
  });

  afterAll(async () => {
    await db.delete(schema.records).where(eq(schema.records.fmsId, fmsA));
    await db.delete(schema.fmsMaster).where(eq(schema.fmsMaster.fmsId, fmsA));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, testUserId));
    await db.delete(schema.users).where(eq(schema.users.userId, testUserId));
    await db.delete(schema.roles).where(eq(schema.roles.roleId, testRoleId));
    await pool.end();
  });

  const auth = () => ({ headers: { Authorization: `Bearer ${token}` } });

  it('requires auth (401 without a token)', async () => {
    const res = await app.request('/api/dashboard', {}, env);
    expect(res.status).toBe(401);
  });

  it("buckets planTime into Today's Workload by calendar date, excluding NOT_STARTED (no plan)", async () => {
    const res = await app.request(`/api/dashboard?fmsId=${fmsA}`, auth(), env);
    expect(res.status).toBe(200);
    const body = await asJson(res);
    // d1 + d2 both fall today (regardless of whether the exact time already passed);
    // d4 (yesterday) is the only Overdue (Before Today); d3 (tomorrow) is the only Upcoming.
    expect(body.data.kpi.dueToday).toBe(2);
    expect(body.data.kpi.overdueBeforeToday).toBe(1);
    expect(body.data.kpi.upcoming).toBe(1);
  });
});
