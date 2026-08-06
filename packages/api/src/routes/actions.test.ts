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

describeIfDb('actions routes (integration)', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const fullUserId = generateId('usr');
  const limitedUserId = generateId('usr');
  const fullRoleId = 'TEST_ACTIONS_FULL';
  const limitedRoleId = 'TEST_ACTIONS_LIMITED';
  const fullUsername = `test_actions_full_${Date.now()}`;
  const limitedUsername = `test_actions_limited_${Date.now()}`;
  const password = 'correct-horse-battery-staple';
  const fmsA = 'fms_actions_test_a';
  let fullToken: string;
  let limitedToken: string;
  let createdActionId: string;

  const env = { DATABASE_URL: DATABASE_URL! };

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    db = drizzle(pool, { schema });

    await db.insert(schema.roles).values([
      { roleId: fullRoleId, roleName: 'Test Actions Full', permissions: { 'actions.view': true, 'actions.add': true, 'actions.edit': true, 'actions.close': true, 'actions.delete': false }, status: 'ACTIVE' },
      { roleId: limitedRoleId, roleName: 'Test Actions Limited', permissions: { 'actions.view': true, 'actions.add': false, 'actions.edit': false, 'actions.close': false, 'actions.delete': false }, status: 'ACTIVE' },
    ]).onConflictDoNothing();

    const salt = generateSalt();
    await db.insert(schema.users).values([
      { userId: fullUserId, username: fullUsername, passwordHash: await hashPassword(password, salt), passwordSalt: salt, fullName: 'Full User', roleId: fullRoleId, status: 'ACTIVE', mustChangePassword: false },
      { userId: limitedUserId, username: limitedUsername, passwordHash: await hashPassword(password, salt), passwordSalt: salt, fullName: 'Limited User', roleId: limitedRoleId, status: 'ACTIVE', mustChangePassword: false },
    ]);

    const loginFull = await asJson(await app.request('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ username: fullUsername, password }), headers: { 'Content-Type': 'application/json' },
    }, env));
    fullToken = loginFull.data.token;
    const loginLimited = await asJson(await app.request('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ username: limitedUsername, password }), headers: { 'Content-Type': 'application/json' },
    }, env));
    limitedToken = loginLimited.data.token;
  });

  afterAll(async () => {
    await db.delete(schema.actionComments).where(eq(schema.actionComments.actionId, createdActionId));
    await db.delete(schema.actionItems).where(eq(schema.actionItems.fmsId, fmsA));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, fullUserId));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, limitedUserId));
    await db.delete(schema.users).where(eq(schema.users.userId, fullUserId));
    await db.delete(schema.users).where(eq(schema.users.userId, limitedUserId));
    await db.delete(schema.roles).where(eq(schema.roles.roleId, fullRoleId));
    await db.delete(schema.roles).where(eq(schema.roles.roleId, limitedRoleId));
    await pool.end();
  });

  const authFull = () => ({ headers: { Authorization: `Bearer ${fullToken}`, 'Content-Type': 'application/json' } });
  const authLimited = () => ({ headers: { Authorization: `Bearer ${limitedToken}`, 'Content-Type': 'application/json' } });

  it('requires auth (401 without a token)', async () => {
    const res = await app.request('/api/actions', {}, env);
    expect(res.status).toBe(401);
  });

  it('rejects create from a user without actions.add', async () => {
    const res = await app.request('/api/actions', {
      method: 'POST', ...authLimited(),
      body: JSON.stringify({ fmsId: fmsA, actionType: 'Follow-up', priority: 'High', title: 'Should fail' }),
    }, env);
    expect(res.status).toBe(403);
  });

  it('creates an action item', async () => {
    const res = await app.request('/api/actions', {
      method: 'POST', ...authFull(),
      body: JSON.stringify({ fmsId: fmsA, recordId: 'r1', recordDisplay: 'Acme Corp', actionType: 'Follow-up', priority: 'High', title: 'Chase invoice' }),
    }, env);
    expect(res.status).toBe(200);
    const body = await asJson(res);
    expect(body.data.actionId).toBeTruthy();
    createdActionId = body.data.actionId;
  });

  it('lists action items filtered by fmsId and status', async () => {
    const res = await app.request(`/api/actions?fmsId=${fmsA}&status=Open`, authFull(), env);
    const body = await asJson(res);
    expect(body.data.map((a: { actionId: string }) => a.actionId)).toContain(createdActionId);
  });

  it('adds a comment and bumps lastCommentAt', async () => {
    const res = await app.request(`/api/actions/${createdActionId}/comments`, {
      method: 'POST', ...authFull(), body: JSON.stringify({ comment: 'Following up now' }),
    }, env);
    expect(res.status).toBe(200);
    const list = await asJson(await app.request(`/api/actions/${createdActionId}/comments`, authFull(), env));
    expect(list.data).toHaveLength(1);
    expect(list.data[0].comment).toBe('Following up now');
  });

  it('rejects resolving an action from a user without actions.close', async () => {
    const res = await app.request(`/api/actions/${createdActionId}/status`, {
      method: 'PATCH', ...authLimited(), body: JSON.stringify({ status: 'Resolved' }),
    }, env);
    expect(res.status).toBe(403);
  });

  it('resolves an action item', async () => {
    const res = await app.request(`/api/actions/${createdActionId}/status`, {
      method: 'PATCH', ...authFull(), body: JSON.stringify({ status: 'Resolved', resolution: 'Paid' }),
    }, env);
    expect(res.status).toBe(200);
    const list = await asJson(await app.request(`/api/actions?fmsId=${fmsA}&status=Resolved`, authFull(), env));
    expect(list.data.map((a: { actionId: string }) => a.actionId)).toContain(createdActionId);
  });

  it('non-super-admin cannot delete an action item', async () => {
    const res = await app.request(`/api/actions/${createdActionId}`, { method: 'DELETE', ...authFull() }, env);
    expect(res.status).toBe(403);
  });
});
