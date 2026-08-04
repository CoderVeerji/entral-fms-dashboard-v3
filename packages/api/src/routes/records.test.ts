// Integration tests against a REAL Postgres — same convention as auth.test.ts (see that file's
// header comment): auto-run in CI via the postgres:16 service container, skipped locally unless
// DATABASE_URL is set.
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

describeIfDb('records routes (integration)', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const testUserId = generateId('usr');
  const testRoleId = 'TEST_RECORDS_VIEWER';
  const username = `test_records_${Date.now()}`;
  const password = 'correct-horse-battery-staple';
  const fmsA = 'fms_test_a';
  const fmsB = 'fms_test_b';
  let token: string;

  const env = { DATABASE_URL: DATABASE_URL! };

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    db = drizzle(pool, { schema });

    await db.insert(schema.roles).values({
      roleId: testRoleId, roleName: 'Test Records Viewer',
      permissions: { 'records.view': true }, status: 'ACTIVE',
    }).onConflictDoNothing();

    const salt = generateSalt();
    await db.insert(schema.users).values({
      userId: testUserId, username, passwordHash: await hashPassword(password, salt), passwordSalt: salt,
      fullName: 'Test Records User', roleId: testRoleId, status: 'ACTIVE', mustChangePassword: false,
    });

    await db.insert(schema.records).values([
      { fmsId: fmsA, recordId: 'r1', displayName: 'Acme Corp', doer: 'Priya', recordStatus: 'OVERDUE', freshness: 'Stale', planTime: new Date('2026-08-01T00:00:00Z') },
      { fmsId: fmsA, recordId: 'r2', displayName: 'Beta Traders', doer: 'Ravi', recordStatus: 'COMPLETED_ON_TIME', freshness: 'Fresh', planTime: new Date('2026-08-02T00:00:00Z') },
      { fmsId: fmsA, recordId: 'r3', displayName: 'Gamma Foam House', doer: 'Priya', recordStatus: 'RUNNING_ON_TIME', freshness: 'Fresh', planTime: new Date('2026-08-03T00:00:00Z') },
      { fmsId: fmsA, recordId: 'r4', displayName: 'Archived Record', doer: 'Ravi', recordStatus: 'OVERDUE', freshness: 'Critical', isArchived: true },
      { fmsId: fmsB, recordId: 'r5', displayName: 'Other FMS Record', doer: 'Amit', recordStatus: 'OVERDUE', freshness: 'Stale' },
    ]);
    await db.insert(schema.stageEvents).values([
      { fmsId: fmsA, recordId: 'r1', stageIndex: 0, stageName: 'Invoicing', status: 'OVERDUE' },
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
    await db.delete(schema.records).where(eq(schema.records.fmsId, fmsB));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, testUserId));
    await db.delete(schema.users).where(eq(schema.users.userId, testUserId));
    await db.delete(schema.roles).where(eq(schema.roles.roleId, testRoleId));
    await pool.end();
  });

  const auth = () => ({ headers: { Authorization: `Bearer ${token}` } });

  it('requires auth (401 without a token)', async () => {
    const res = await app.request('/api/records', {}, env);
    expect(res.status).toBe(401);
  });

  it('lists records scoped to one fmsId, excluding archived and other FMS', async () => {
    const res = await app.request(`/api/records?fmsId=${fmsA}`, auth(), env);
    expect(res.status).toBe(200);
    const body = await asJson(res);
    const ids = body.data.records.map((r: { recordId: string }) => r.recordId).sort();
    expect(ids).toEqual(['r1', 'r2', 'r3']); // r4 archived, r5 other FMS — both excluded
    expect(body.data.total).toBe(3);
  });

  it('filters by status', async () => {
    const res = await app.request(`/api/records?fmsId=${fmsA}&status=OVERDUE`, auth(), env);
    const body = await asJson(res);
    expect(body.data.records.map((r: { recordId: string }) => r.recordId)).toEqual(['r1']);
  });

  it('filters by doer', async () => {
    const res = await app.request(`/api/records?fmsId=${fmsA}&doer=Priya`, auth(), env);
    const body = await asJson(res);
    expect(body.data.records.map((r: { recordId: string }) => r.recordId).sort()).toEqual(['r1', 'r3']);
  });

  it('filters by freshness', async () => {
    const res = await app.request(`/api/records?fmsId=${fmsA}&freshness=Fresh`, auth(), env);
    const body = await asJson(res);
    expect(body.data.records.map((r: { recordId: string }) => r.recordId).sort()).toEqual(['r2', 'r3']);
  });

  it('search matches display name substring (case-insensitive)', async () => {
    const res = await app.request(`/api/records?fmsId=${fmsA}&search=foam`, auth(), env);
    const body = await asJson(res);
    expect(body.data.records.map((r: { recordId: string }) => r.recordId)).toEqual(['r3']);
  });

  it('search matches doer name too', async () => {
    const res = await app.request(`/api/records?fmsId=${fmsA}&search=Ravi`, auth(), env);
    const body = await asJson(res);
    expect(body.data.records.map((r: { recordId: string }) => r.recordId)).toEqual(['r2']);
  });

  it('date range filters by planTime', async () => {
    const res = await app.request(`/api/records?fmsId=${fmsA}&dateFrom=2026-08-02&dateTo=2026-08-02`, auth(), env);
    const body = await asJson(res);
    expect(body.data.records.map((r: { recordId: string }) => r.recordId)).toEqual(['r2']);
  });

  it('pagination respects start/length', async () => {
    const res = await app.request(`/api/records?fmsId=${fmsA}&start=1&length=1`, auth(), env);
    const body = await asJson(res);
    expect(body.data.records).toHaveLength(1);
    expect(body.data.total).toBe(3); // total reflects the full filtered set, not just this page
  });

  it('record detail returns the record plus its stage events in order', async () => {
    const res = await app.request(`/api/records/${fmsA}/r1`, auth(), env);
    expect(res.status).toBe(200);
    const body = await asJson(res);
    expect(body.data.record.recordId).toBe('r1');
    expect(body.data.stages).toHaveLength(1);
    expect(body.data.stages[0].stageName).toBe('Invoicing');
  });

  it('record detail 404s for a record that does not exist', async () => {
    const res = await app.request(`/api/records/${fmsA}/does-not-exist`, auth(), env);
    expect(res.status).toBe(404);
  });
});
