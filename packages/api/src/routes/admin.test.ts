// Integration tests against a REAL Postgres — same convention as records.test.ts. Covers
// users/roles/settings/audit-log/sync-log — all Super-Admin-only mutations except the read
// endpoints (users.view/roles.view/settings.view/audit.view).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { and, eq, inArray } from 'drizzle-orm';
import * as schema from '@fms/db';
import app from '../index';
import { generateId, generateSalt, hashPassword } from '../crypto';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function asJson(res: Response): Promise<any> {
  return res.json();
}

describeIfDb('admin routes (integration)', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const superAdminId = generateId('usr');
  const limitedId = generateId('usr');
  const superRoleId = 'TEST_ADMIN_SUPER';
  const limitedRoleId = 'TEST_ADMIN_LIMITED';
  const superUsername = `test_admin_super_${Date.now()}`;
  const limitedUsername = `test_admin_limited_${Date.now()}`;
  const password = 'correct-horse-battery-staple';
  let superToken: string;
  let limitedToken: string;
  let createdUserId: string;
  let otherActiveSuperAdminIds: string[] = [];

  const env = { DATABASE_URL: DATABASE_URL! };

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    db = drizzle(pool, { schema });

    // This suite runs against the real shared Neon DB (see feedback_neon_http_driver_ci memory),
    // which already has a real seeded Super Administrator (packages/db/src/seed.ts) plus whatever
    // other Super Admins exist in practice. The "refuses to deactivate the last active Super Admin"
    // test below needs its own test user to genuinely BE the last one, so we park every other
    // active Super Admin as INACTIVE for the duration of this suite and restore them in afterAll
    // (try/finally below) so a mid-run crash can't leave a real admin locked out.
    const others = await db.select({ userId: schema.users.userId }).from(schema.users).where(
      and(eq(schema.users.roleId, 'SUPER_ADMIN'), eq(schema.users.status, 'ACTIVE'), eq(schema.users.isDeleted, false)),
    );
    otherActiveSuperAdminIds = others.map((u) => u.userId);
    if (otherActiveSuperAdminIds.length) {
      await db.update(schema.users).set({ status: 'INACTIVE' }).where(inArray(schema.users.userId, otherActiveSuperAdminIds));
    }

    await db.insert(schema.roles).values([
      { roleId: superRoleId, roleName: 'Test Admin Super', permissions: { 'users.view': true, 'users.add': true, 'users.edit': true, 'roles.view': true, 'roles.edit': true, 'settings.view': true, 'settings.edit': true, 'audit.view': true }, status: 'ACTIVE' },
      { roleId: limitedRoleId, roleName: 'Test Admin Limited', permissions: { 'users.view': true, 'roles.view': true, 'settings.view': true, 'audit.view': true }, status: 'ACTIVE' },
    ]).onConflictDoNothing();

    const salt = generateSalt();
    await db.insert(schema.users).values([
      { userId: superAdminId, username: superUsername, passwordHash: await hashPassword(password, salt), passwordSalt: salt, fullName: 'Super Test', roleId: 'SUPER_ADMIN', status: 'ACTIVE', mustChangePassword: false },
      { userId: limitedId, username: limitedUsername, passwordHash: await hashPassword(password, salt), passwordSalt: salt, fullName: 'Limited Test', roleId: limitedRoleId, status: 'ACTIVE', mustChangePassword: false },
    ]);

    const loginSuper = await asJson(await app.request('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ username: superUsername, password }), headers: { 'Content-Type': 'application/json' },
    }, env));
    superToken = loginSuper.data.token;
    const loginLimited = await asJson(await app.request('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ username: limitedUsername, password }), headers: { 'Content-Type': 'application/json' },
    }, env));
    limitedToken = loginLimited.data.token;
  });

  afterAll(async () => {
    try {
      if (createdUserId) await db.delete(schema.users).where(eq(schema.users.userId, createdUserId));
      await db.delete(schema.sessions).where(eq(schema.sessions.userId, superAdminId));
      await db.delete(schema.sessions).where(eq(schema.sessions.userId, limitedId));
      await db.delete(schema.users).where(eq(schema.users.userId, superAdminId));
      await db.delete(schema.users).where(eq(schema.users.userId, limitedId));
      await db.delete(schema.roles).where(eq(schema.roles.roleId, superRoleId));
      await db.delete(schema.roles).where(eq(schema.roles.roleId, limitedRoleId));
    } finally {
      // Restore real Super Admins parked in beforeAll — must run even if the cleanup above throws,
      // otherwise a mid-run failure leaves the actual admin account locked out.
      if (otherActiveSuperAdminIds.length) {
        await db.update(schema.users).set({ status: 'ACTIVE' }).where(inArray(schema.users.userId, otherActiveSuperAdminIds));
      }
      await pool.end();
    }
  });

  const authSuper = () => ({ headers: { Authorization: `Bearer ${superToken}`, 'Content-Type': 'application/json' } });
  const authLimited = () => ({ headers: { Authorization: `Bearer ${limitedToken}`, 'Content-Type': 'application/json' } });

  it('non-super-admin cannot create a user even with users.add-shaped intent', async () => {
    const res = await app.request('/api/users', {
      method: 'POST', ...authLimited(), body: JSON.stringify({ username: `blocked_${Date.now()}`, roleId: limitedRoleId }),
    }, env);
    expect(res.status).toBe(403);
  });

  it('super admin creates a user and gets a one-time temp password', async () => {
    const res = await app.request('/api/users', {
      method: 'POST', ...authSuper(), body: JSON.stringify({ username: `newuser_${Date.now()}`, fullName: 'New Guy', roleId: limitedRoleId }),
    }, env);
    expect(res.status).toBe(200);
    const body = await asJson(res);
    expect(body.data.tempPassword).toBeTruthy();
    createdUserId = body.data.userId;
  });

  it('lists users including the newly created one', async () => {
    const res = await app.request('/api/users', authSuper(), env);
    const body = await asJson(res);
    expect(body.data.map((u: { userId: string }) => u.userId)).toContain(createdUserId);
  });

  it('refuses to deactivate the last active Super Admin', async () => {
    const res = await app.request(`/api/users/${superAdminId}/status`, {
      method: 'PATCH', ...authSuper(), body: JSON.stringify({ active: false }),
    }, env);
    expect(res.status).toBe(409);
    const body = await asJson(res);
    expect(body.code).toBe('LAST_SUPER_ADMIN');
  });

  it('lists roles', async () => {
    const res = await app.request('/api/roles', authSuper(), env);
    expect(res.status).toBe(200);
    const body = await asJson(res);
    expect(body.data.some((r: { roleId: string }) => r.roleId === superRoleId)).toBe(true);
  });

  it('non-super-admin cannot edit role permissions', async () => {
    const res = await app.request(`/api/roles/${limitedRoleId}`, {
      method: 'PATCH', ...authLimited(), body: JSON.stringify({ permissions: { 'users.view': true } }),
    }, env);
    expect(res.status).toBe(403);
  });

  it('super admin edits role permissions, normalized against the full permission set', async () => {
    const res = await app.request(`/api/roles/${limitedRoleId}`, {
      method: 'PATCH', ...authSuper(), body: JSON.stringify({ permissions: { 'users.view': true, 'sync.run': true } }),
    }, env);
    expect(res.status).toBe(200);
    const list = await asJson(await app.request('/api/roles', authSuper(), env));
    const role = list.data.find((r: { roleId: string }) => r.roleId === limitedRoleId);
    expect(role.permissions['sync.run']).toBe(true);
    expect(role.permissions['users.edit']).toBe(false); // filled in as false, not left undefined
  });

  it('reads settings', async () => {
    const res = await app.request('/api/settings', authSuper(), env);
    expect(res.status).toBe(200);
    expect(Array.isArray((await asJson(res)).data)).toBe(true);
  });

  it('rejects a non-numeric value for a numeric setting key', async () => {
    const res = await app.request('/api/settings', {
      method: 'PATCH', ...authSuper(), body: JSON.stringify({ SESSION_HOURS: 'not-a-number' }),
    }, env);
    expect(res.status).toBe(400);
  });

  it('reads audit log and sync log without error', async () => {
    const auditRes = await app.request('/api/audit-log?limit=5', authSuper(), env);
    expect(auditRes.status).toBe(200);
    const syncRes = await app.request('/api/sync-log?limit=5', authSuper(), env);
    expect(syncRes.status).toBe(200);
  });
});
