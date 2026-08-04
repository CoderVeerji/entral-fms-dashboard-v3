// Integration tests against a REAL Postgres — run automatically in CI via the postgres:16 service
// container declared in v3/.github/workflows/ci.yml (see plan §"Test strategy": a service
// container, not Neon branch-per-run, is the simpler choice for routine test runs). Locally,
// these are skipped unless DATABASE_URL is set (e.g. pointed at a local `docker compose up db` or
// a scratch Neon branch) — see v3/README.md "Running tests locally".
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

describeIfDb('auth routes (integration)', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const testUserId = generateId('usr');
  const testRoleId = 'TEST_VIEWER';
  const username = `test_${Date.now()}`;
  const password = 'correct-horse-battery-staple';

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    db = drizzle(pool, { schema });

    await db.insert(schema.roles).values({
      roleId: testRoleId, roleName: 'Test Viewer', permissions: { 'dashboard.view': true }, status: 'ACTIVE',
    }).onConflictDoNothing();

    const salt = generateSalt();
    await db.insert(schema.users).values({
      userId: testUserId, username, passwordHash: await hashPassword(password, salt), passwordSalt: salt,
      fullName: 'Test User', email: 'test@example.com', roleId: testRoleId, status: 'ACTIVE',
      mustChangePassword: false,
    });
  });

  afterAll(async () => {
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, testUserId));
    await db.delete(schema.users).where(eq(schema.users.userId, testUserId));
    await db.delete(schema.roles).where(eq(schema.roles.roleId, testRoleId));
    await pool.end();
  });

  const env = { DATABASE_URL: DATABASE_URL! };

  it('rejects login with a wrong password (401 INVALID_CREDENTIALS)', async () => {
    const res = await app.request('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ username, password: 'wrong' }), headers: { 'Content-Type': 'application/json' },
    }, env);
    expect(res.status).toBe(401);
    const body = await asJson(res);
    expect(body.code).toBe('INVALID_CREDENTIALS');
  });

  it('logs in successfully and returns a usable token', async () => {
    const res = await app.request('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ username, password }), headers: { 'Content-Type': 'application/json' },
    }, env);
    expect(res.status).toBe(200);
    const body = await asJson(res);
    expect(body.ok).toBe(true);
    expect(body.data.token).toBeTruthy();
    expect(body.data.user.username).toBe(username);
  });

  it('an unauthenticated request to a protected route returns 401 NO_SESSION', async () => {
    const res = await app.request('/api/auth/me', {}, env);
    expect(res.status).toBe(401);
    const body = await asJson(res);
    expect(body.code).toBe('NO_SESSION');
  });

  it('a valid token can access /me and matches the logged-in user', async () => {
    const loginRes = await app.request('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ username, password }), headers: { 'Content-Type': 'application/json' },
    }, env);
    const { data } = await asJson(loginRes);

    const meRes = await app.request('/api/auth/me', { headers: { Authorization: `Bearer ${data.token}` } }, env);
    expect(meRes.status).toBe(200);
    const meBody = await asJson(meRes);
    expect(meBody.data.username).toBe(username);
  });

  it('logout revokes the token — a subsequent /me call is rejected', async () => {
    const loginRes = await app.request('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ username, password }), headers: { 'Content-Type': 'application/json' },
    }, env);
    const { data } = await asJson(loginRes);

    await app.request('/api/auth/logout', {
      method: 'POST', headers: { Authorization: `Bearer ${data.token}` },
    }, env);

    const meRes = await app.request('/api/auth/me', { headers: { Authorization: `Bearer ${data.token}` } }, env);
    expect(meRes.status).toBe(401);
    const meBody = await asJson(meRes);
    expect(meBody.code).toBe('SESSION_REVOKED');
  });

  it('5 wrong-password attempts lock the account (401 ACCOUNT_LOCKED on the 6th, even with the right password)', async () => {
    for (let i = 0; i < 5; i++) {
      await app.request('/api/auth/login', {
        method: 'POST', body: JSON.stringify({ username, password: 'wrong' }), headers: { 'Content-Type': 'application/json' },
      }, env);
    }
    const res = await app.request('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ username, password }), headers: { 'Content-Type': 'application/json' },
    }, env);
    expect(res.status).toBe(401);
    const body = await asJson(res);
    expect(body.code).toBe('ACCOUNT_LOCKED');
  });
});
