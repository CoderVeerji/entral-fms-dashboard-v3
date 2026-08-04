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

describeIfDb('fms routes (integration)', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const viewerUserId = generateId('usr');
  const managerUserId = generateId('usr');
  const viewerRoleId = 'TEST_FMS_VIEWER';
  const managerRoleId = 'TEST_FMS_MANAGER';
  const viewerUsername = `test_fms_viewer_${Date.now()}`;
  const managerUsername = `test_fms_manager_${Date.now()}`;
  const password = 'correct-horse-battery-staple';
  let viewerToken: string;
  let managerToken: string;
  let createdFmsId: string;

  const env = { DATABASE_URL: DATABASE_URL! };

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    db = drizzle(pool, { schema });

    await db.insert(schema.roles).values([
      { roleId: viewerRoleId, roleName: 'Test FMS Viewer', permissions: { 'fms.view': true, 'fms.manage': false }, status: 'ACTIVE' },
      { roleId: managerRoleId, roleName: 'Test FMS Manager', permissions: { 'fms.view': true, 'fms.manage': true }, status: 'ACTIVE' },
    ]).onConflictDoNothing();

    const salt1 = generateSalt();
    const salt2 = generateSalt();
    await db.insert(schema.users).values([
      { userId: viewerUserId, username: viewerUsername, passwordHash: await hashPassword(password, salt1), passwordSalt: salt1, roleId: viewerRoleId, status: 'ACTIVE', mustChangePassword: false },
      { userId: managerUserId, username: managerUsername, passwordHash: await hashPassword(password, salt2), passwordSalt: salt2, roleId: managerRoleId, status: 'ACTIVE', mustChangePassword: false },
    ]);

    for (const [uname, setToken] of [[viewerUsername, (t: string) => { viewerToken = t; }], [managerUsername, (t: string) => { managerToken = t; }]] as const) {
      const res = await app.request('/api/auth/login', {
        method: 'POST', body: JSON.stringify({ username: uname, password }), headers: { 'Content-Type': 'application/json' },
      }, env);
      const body = await asJson(res);
      setToken(body.data.token);
    }
  });

  afterAll(async () => {
    if (createdFmsId) await db.delete(schema.fmsMaster).where(eq(schema.fmsMaster.fmsId, createdFmsId));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, viewerUserId));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, managerUserId));
    await db.delete(schema.users).where(eq(schema.users.userId, viewerUserId));
    await db.delete(schema.users).where(eq(schema.users.userId, managerUserId));
    await db.delete(schema.roles).where(eq(schema.roles.roleId, viewerRoleId));
    await db.delete(schema.roles).where(eq(schema.roles.roleId, managerRoleId));
    await pool.end();
  });

  it('a viewer (fms.manage=false) cannot create an FMS (403)', async () => {
    const res = await app.request('/api/fms', {
      method: 'POST', headers: { Authorization: `Bearer ${viewerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fmsName: 'Should Fail', spreadsheetId: 'abc' }),
    }, env);
    expect(res.status).toBe(403);
  });

  it('a manager can create an FMS, and it then shows up in the list', async () => {
    const createRes = await app.request('/api/fms', {
      method: 'POST', headers: { Authorization: `Bearer ${managerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fmsName: 'Test FMS', spreadsheetId: 'test-spreadsheet-id' }),
    }, env);
    expect(createRes.status).toBe(200);
    const createBody = await asJson(createRes);
    expect(createBody.data.fmsId).toBeTruthy();
    createdFmsId = createBody.data.fmsId;

    const listRes = await app.request('/api/fms', { headers: { Authorization: `Bearer ${viewerToken}` } }, env);
    const listBody = await asJson(listRes);
    expect(listBody.data.some((f: { fmsId: string }) => f.fmsId === createdFmsId)).toBe(true);
  });

  it('rejects creating an FMS without a name (400 INVALID_INPUT)', async () => {
    const res = await app.request('/api/fms', {
      method: 'POST', headers: { Authorization: `Bearer ${managerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ spreadsheetId: 'abc' }),
    }, env);
    expect(res.status).toBe(400);
    const body = await asJson(res);
    expect(body.code).toBe('INVALID_INPUT');
  });
});
