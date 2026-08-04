// One-time bootstrap script — ports app/Code.gs's setupApplication() (the role/superadmin-seeding
// part only; sheet/trigger creation has no equivalent here). Run once against a freshly-migrated
// database: `npm run -w packages/db seed` (needs DATABASE_URL in the environment).
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { ROLE_SEED, generateId, generateSalt, hashPassword, generateTempPassword } from '@fms/core';
import * as schema from './schema';

const SUPERADMIN_USERNAME = 'superadmin';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set.');
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });

  try {
    let rolesSeeded = 0;
    for (const [roleId, permissions] of Object.entries(ROLE_SEED)) {
      const [existing] = await db.select().from(schema.roles).where(eq(schema.roles.roleId, roleId)).limit(1);
      if (existing) continue;
      await db.insert(schema.roles).values({
        roleId, roleName: roleId.replace(/_/g, ' '), permissions, status: 'ACTIVE',
      });
      rolesSeeded++;
    }
    console.log(`Roles seeded: ${rolesSeeded} (of ${Object.keys(ROLE_SEED).length} total).`);

    const [existingAdmin] = await db.select().from(schema.users)
      .where(eq(schema.users.username, SUPERADMIN_USERNAME)).limit(1);

    if (existingAdmin) {
      console.log('Super Admin already exists — nothing to do. Use resetUserPassword via the API if you need a new temp password.');
    } else {
      const tempPassword = generateTempPassword();
      const salt = generateSalt();
      await db.insert(schema.users).values({
        userId: generateId('usr'), username: SUPERADMIN_USERNAME,
        passwordHash: await hashPassword(tempPassword, salt), passwordSalt: salt,
        fullName: 'Super Administrator', roleId: 'SUPER_ADMIN', status: 'ACTIVE', mustChangePassword: true,
      });
      console.log('=== Super Admin created ===');
      console.log(`Username: ${SUPERADMIN_USERNAME}`);
      console.log(`Temporary password: ${tempPassword}`);
      console.log('You will be asked to set a new password at first login. This password is shown only once.');
    }

    await db.insert(schema.appSettings).values([
      { key: 'APP_NAME', value: 'Central FMS Management Dashboard', description: 'Application display name' },
      { key: 'COMPANY_NAME', value: 'Le Fabco Pvt. Ltd.', description: 'Company name shown in header/login' },
      { key: 'SESSION_HOURS', value: '12', description: 'Session validity length in hours' },
      { key: 'ON_TIME_TOLERANCE_MINUTES', value: '30', description: 'Tolerance window around Plan time to count as on-time' },
      { key: 'STALE_WARNING_HOURS', value: '24', description: 'Hours since last update before Warning freshness' },
      { key: 'STALE_CRITICAL_HOURS', value: '72', description: 'Hours since last update before Critical freshness' },
      { key: 'AT_RISK_WINDOW_MINUTES', value: '240', description: 'Minutes before Plan time to mark a running stage At Risk' },
    ]).onConflictDoNothing();
    console.log('App settings seeded (existing keys left untouched).');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exitCode = 1;
});
