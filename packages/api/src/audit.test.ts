// Integration test against a REAL Postgres — same convention as records.test.ts. Confirms the
// audit log actually gets written to (see the bug this fixes: routes/auditLog.ts only ever READ
// the table — nothing anywhere wrote to it, so the Audit Log page was always empty).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import * as schema from '@fms/db';
import app from './index';
import { generateId, generateSalt, hashPassword } from './crypto';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function asJson(res: Response): Promise<any> {
  return res.json();
}

describeIfDb('audit logging (integration)', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const userId = generateId('usr');
  const roleId = 'TEST_AUDIT_ROLE';
  const username = `test_audit_${Date.now()}`;
  const password = 'correct-horse-battery-staple';
  let token: string;

  const env = { DATABASE_URL: DATABASE_URL! };

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    db = drizzle(pool, { schema });

    await db.insert(schema.roles).values({
      roleId, roleName: 'Test Audit Role', permissions: { 'settings.view': true, 'audit.view': true }, status: 'ACTIVE',
    }).onConflictDoNothing();

    const salt = generateSalt();
    await db.insert(schema.users).values({
      userId, username, passwordHash: await hashPassword(password, salt), passwordSalt: salt,
      fullName: 'Test Audit User', roleId, status: 'ACTIVE', mustChangePassword: false,
    });

    const loginRes = await app.request('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ username, password }), headers: { 'Content-Type': 'application/json' },
    }, env);
    const loginBody = await asJson(loginRes);
    token = loginBody.data.token;
  });

  afterAll(async () => {
    await db.delete(schema.auditLog).where(eq(schema.auditLog.username, username));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    await db.delete(schema.users).where(eq(schema.users.userId, userId));
    await db.delete(schema.roles).where(eq(schema.roles.roleId, roleId));
    await pool.end();
  });

  it('login success is recorded in the audit log', async () => {
    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.username, username));
    expect(rows.some((r) => r.action === 'LOGIN_SUCCESS')).toBe(true);
  });

  it('a bad-password attempt is recorded as a failure', async () => {
    await app.request('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ username, password: 'wrong-password' }), headers: { 'Content-Type': 'application/json' },
    }, env);
    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.username, username));
    const fail = rows.find((r) => r.action === 'LOGIN_FAIL');
    expect(fail).toBeTruthy();
    expect(fail?.success).toBe(false);
  });

  it('a logged-in Audit Log request can read back its own login entry', async () => {
    const res = await app.request(`/api/audit-log?username=${username}`, { headers: { Authorization: `Bearer ${token}` } }, env);
    expect(res.status).toBe(200);
    const body = await asJson(res);
    expect(body.data.some((r: { action: string }) => r.action === 'LOGIN_SUCCESS')).toBe(true);
  });
});
