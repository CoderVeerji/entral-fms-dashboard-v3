import { Hono } from 'hono';
import { eq, and, sql } from 'drizzle-orm';
import { users, roles, sessions } from '@fms/db';
import { ok, AppError } from '@fms/core';
import { sha256Hex, hashPassword, generateSalt, generateToken, generateId, isValidEmail } from '../crypto';
import { requireAuth } from '../middleware/auth';
import { getSetting } from '../settings';
import type { Variables } from '../types';

// Direct port of app/Code.gs's login/logout/changePassword — see that file for the original
// Apps Script version this mirrors field-for-field (failed-attempt lockout after 5 tries, 15-
// minute lock window, must_change_password flow).
export const authRoutes = new Hono<{ Variables: Variables }>();

authRoutes.post('/login', async (c) => {
  const db = c.get('db');
  const body = await c.req.json<{ username?: string; password?: string }>();
  const username = String(body.username ?? '').trim();
  const password = String(body.password ?? '');
  if (!username || !password) throw new AppError('INVALID_INPUT', 'Username and password are required.');

  const [user] = await db.select().from(users)
    .where(and(sql`lower(${users.username}) = lower(${username})`, eq(users.isDeleted, false))).limit(1);
  if (!user) throw new AppError('INVALID_CREDENTIALS', 'Invalid username or password.');
  if (user.status !== 'ACTIVE') throw new AppError('ACCOUNT_INACTIVE', 'This account is not active. Contact your administrator.');
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    throw new AppError('ACCOUNT_LOCKED', 'Account temporarily locked due to repeated failed attempts. Try later.');
  }

  const computed = await hashPassword(password, user.passwordSalt);
  if (computed !== user.passwordHash) {
    const attempts = (user.failedAttempts ?? 0) + 1;
    const patch: Partial<typeof users.$inferInsert> = { failedAttempts: attempts, updatedAt: new Date() };
    if (attempts >= 5) {
      patch.lockedUntil = new Date(Date.now() + 15 * 60000);
      patch.failedAttempts = 0;
    }
    await db.update(users).set(patch).where(eq(users.userId, user.userId));
    throw new AppError('INVALID_CREDENTIALS', 'Invalid username or password.');
  }

  const [role] = await db.select().from(roles)
    .where(and(eq(roles.roleId, user.roleId), eq(roles.isDeleted, false))).limit(1);
  if (!role) throw new AppError('NO_ROLE', 'This account has no valid role assigned.');

  const token = generateToken();
  const sessionHours = Number(await getSetting(db, 'SESSION_HOURS', '12'));
  const expiresAt = new Date(Date.now() + sessionHours * 3600000);

  await db.insert(sessions).values({
    sessionId: generateId('sess'), userId: user.userId, username: user.username, roleId: user.roleId,
    tokenHash: await sha256Hex(token), expiresAt, lastSeen: new Date(),
  });
  await db.update(users).set({ lastLogin: new Date(), failedAttempts: 0, lockedUntil: null, updatedAt: new Date() })
    .where(eq(users.userId, user.userId));

  return c.json(ok({
    token,
    user: {
      userId: user.userId, username: user.username, fullName: user.fullName, email: user.email,
      roleId: user.roleId, roleName: role.roleName, mustChangePassword: !!user.mustChangePassword,
      permissions: role.permissions,
    },
  }, 'Login successful.'));
});

authRoutes.post('/logout', async (c) => {
  const db = c.get('db');
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return c.json(ok(true));
  const tokenHash = await sha256Hex(token);
  await db.update(sessions).set({ revoked: true }).where(eq(sessions.tokenHash, tokenHash));
  return c.json(ok(true, 'Logged out.'));
});

authRoutes.post('/change-password', requireAuth(), async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const body = await c.req.json<{ currentPassword?: string; newPassword?: string }>();
  const newPassword = String(body.newPassword ?? '');
  if (newPassword.length < 8) throw new AppError('WEAK_PASSWORD', 'Password must be at least 8 characters.');

  const [user] = await db.select().from(users).where(eq(users.userId, session.userId)).limit(1);
  if (!user) throw new AppError('NOT_FOUND', 'User not found.');

  if (!user.mustChangePassword) {
    const currentPassword = String(body.currentPassword ?? '');
    if ((await hashPassword(currentPassword, user.passwordSalt)) !== user.passwordHash) {
      throw new AppError('INVALID_CREDENTIALS', 'Current password is incorrect.');
    }
  }
  const salt = generateSalt();
  await db.update(users).set({
    passwordHash: await hashPassword(newPassword, salt), passwordSalt: salt, mustChangePassword: false,
    updatedAt: new Date(), updatedBy: session.username,
  }).where(eq(users.userId, user.userId));

  return c.json(ok(true, 'Password updated successfully.'));
});

authRoutes.get('/me', requireAuth(), async (c) => {
  const session = c.get('session');
  return c.json(ok(session));
});

export { isValidEmail };
