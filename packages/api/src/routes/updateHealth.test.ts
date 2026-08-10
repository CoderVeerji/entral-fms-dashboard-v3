// Integration tests against a REAL Postgres — same convention as records.test.ts (see that
// file's header comment): auto-run in CI via the postgres:16 service container, skipped locally
// unless DATABASE_URL is set.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { and, eq } from 'drizzle-orm';
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

    // Defensive cleanup before inserting fresh fixtures: this suite runs against a real, shared
    // Neon database (no fresh-per-run container), so a prior run that crashed or got cancelled
    // before reaching afterAll can leave this fmsId's rows behind — actionItems has no natural key
    // tying it to (fmsId, recordId), so a stray leftover row silently double-counts openActions on
    // every run after that until cleaned up. Idempotent: a no-op on a clean database.
    await db.delete(schema.actionItems).where(eq(schema.actionItems.fmsId, fmsA));
    await db.delete(schema.records).where(eq(schema.records.fmsId, fmsA));

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
      { fmsId: fmsA, recordId: 'u6', displayName: 'No Plan Yet', recordStatus: 'NOT_STARTED', freshness: 'Critical', lastUpdate: hoursAgo(400) },
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
    // u5 archived and u6 NOT_STARTED (no plan on its current stage) both excluded
    expect(ids).toEqual(['u1', 'u4', 'u3', 'u2']); // never first, then oldest to newest
    expect(body.data.rowsTotal).toBe(4);
  });

  it('excludes NOT_STARTED records (no plan on current stage) from both cards and rows', async () => {
    const res = await app.request(`/api/update-health?fmsId=${fmsA}&freshness=Critical`, auth(), env);
    const body = await asJson(res);
    // u6 is Critical freshness like u4, but NOT_STARTED — must not inflate the critical card or appear in rows
    expect(body.data.cards.critical).toBe(1);
    expect(body.data.rows.map((r: { recordId: string }) => r.recordId)).toEqual(['u4']);
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
    // Diagnostic (temporary): this assertion has failed with 2 instead of 1 despite beforeAll
    // clearing fmsA before inserting a single fixture row — dumping the actual matching rows into
    // the failure message (visible in CI's annotation) shows whether it's a genuine second row
    // (and if so, when it was created / what actionId it has) instead of guessing blind.
    if (body.data.rows[0]?.openActions !== 1) {
      const actual = await db.select().from(schema.actionItems)
        .where(and(eq(schema.actionItems.fmsId, fmsA), eq(schema.actionItems.recordId, 'u3')));
      throw new Error(`Expected 1 open action for ${fmsA}/u3, API reported ${body.data.rows[0]?.openActions}. DB rows: ${JSON.stringify(actual)}`);
    }
    expect(body.data.rows[0].openActions).toBe(1);
  });
});
