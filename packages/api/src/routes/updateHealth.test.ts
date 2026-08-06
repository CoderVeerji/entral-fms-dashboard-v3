// Integration tests against a REAL Postgres — same convention as records.test.ts (see that
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

describeIfDb('update-health routes (integration)', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const testUserId = generateId('usr');
  const testRoleId = 'TEST_UH_VIEWER';
  const username = `test_uh_${Date.now()}`;
  const password = 'correct-horse-battery-staple';
  const fmsA = 'fms_uh_test_a';
  let token: string;

  const env = { DATABASE_URL: DATABASE_URL! };

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    db = drizzle(pool, { schema });

    await db.insert(schema.roles).values({
      roleId: testRoleId, roleName: 'Test Update Health Viewer',
      permissions: { 'records.view': true }, status: 'ACTIVE',
    }).onConflictDoNothing();

    const salt = generateSalt();
    await db.insert(schema.users).values({
      userId: testUserId, username, passwordHash: await hashPassword(password, salt), passwordSalt: salt,
      fullName: 'Test UH User', roleId: testRoleId, status: 'ACTIVE', mustChangePassword: false,
    });

    const now = new Date();
    const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600000);
    await db.insert(schema.records).values([
      { fmsId: fmsA, recordId: 'u1', displayName: 'Never Updated', recordStatus: 'RUNNING_ON_TIME', freshness: 'Never', lastUpdate: null },
      { fmsId: fmsA, recordId: 'u2', displayName: 'Fresh Record', recordStatus: 'RUNNING_ON_TIME', freshness: 'Fresh', lastUpdate: now },
      { fmsId: fmsA, recordId: 'u3', displayName: 'Stale Record', recordStatus: 'OVERDUE', freshness: 'Stale', lastUpdate: hoursAgo(50) },
      { fmsId: fmsA, recordId: 'u4', displayName: 'Critical Record', recordStatus: 'STALLED', freshness: 'Critical', lastUpdate: hoursAgo(200) },
      { fmsId: fmsA, recordId: 'u5', displayName: 'Archived Record', recordStatus: 'OVERDUE', freshness: 'Critical', isArchived: true, lastUpdate: hoursAgo(300) },
    ]);
    await db.insert(schema.actionItems).values([
      { actionId: generateId('act'), fmsId: fmsA, recordId: 'u3', actionType: 'Follow-up', priority: 'High', title: 'Chase it up', status: 'Open' },
    ]);

    const loginRes = await app.request('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ username, password }), headers: { 'Content-Type': 'application/json' },
    }, env);
    const loginBody = await asJson(loginRes);
    token = loginBody.data.token;
  });

  afterAll(async () => {
    await db.delete(schema.actionItems).where(eq(schema.actionItems.fmsId, fmsA));
    await db.delete(schema.records).where(eq(schema.records.fmsId, fmsA));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, testUserId));
    await db.delete(schema.users).where(eq(schema.users.userId, testUserId));
    await db.delete(schema.roles).where(eq(schema.roles.roleId, testRoleId));
    await pool.end();
  });

  const auth = () => ({ headers: { Authorization: `Bearer ${token}` } });

  it('requires auth (401 without a token)', async () => {
    const res = await app.request('/api/update-health', {}, env);
    expect(res.status).toBe(401);
  });

  it('excludes archived records and orders oldest/never-updated first', async () => {
    const res = await app.request(`/api/update-health?fmsId=${fmsA}`, auth(), env);
    expect(res.status).toBe(200);
    const body = await asJson(res);
    const ids = body.data.rows.map((r: { recordId: string }) => r.recordId);
    expect(ids).toEqual(['u1', 'u4', 'u3', 'u2']); // never first, then oldest to newest, u5 archived excluded
    expect(body.data.rowsTotal).toBe(4);
  });

  it('cards reflect freshness bucket counts regardless of freshness filter', async () => {
    const res = await app.request(`/api/update-health?fmsId=${fmsA}&freshness=Critical`, auth(), env);
    const body = await asJson(res);
    expect(body.data.cards).toEqual({ updatedToday: 1, warning: 0, stale: 1, critical: 1, neverUpdated: 1 });
    expect(body.data.rows.map((r: { recordId: string }) => r.recordId)).toEqual(['u4']);
  });

  it('todayOnly filters to records updated since midnight', async () => {
    const res = await app.request(`/api/update-health?fmsId=${fmsA}&todayOnly=true`, auth(), env);
    const body = await asJson(res);
    expect(body.data.rows.map((r: { recordId: string }) => r.recordId)).toEqual(['u2']);
  });

  it('surfaces open action counts per record', async () => {
    const res = await app.request(`/api/update-health?fmsId=${fmsA}&freshness=Stale`, auth(), env);
    const body = await asJson(res);
    expect(body.data.rows[0].openActions).toBe(1);
  });
});
