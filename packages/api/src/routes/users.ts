import { Hono } from 'hono';
import { and, eq, ne, count } from 'drizzle-orm';
import { users, roles } from '@fms/db';
import { ok, AppError, generateId, generateTempPassword, isValidEmail } from '@fms/core';
import { requireAuth } from '../middleware/auth';
import { hashPassword, generateSalt } from '../crypto';
import { logAudit } from '../audit';
import type { Db } from '../db';
import type { Variables } from '../types';

// Direct successor to app/Code.gs's getUsers/saveUser/setUserStatus/unlockUser/
// resetUserPassword/updateMyAccount. Every mutating action here is Super Admin-only, same
// restriction Code.gs enforced inline (permission alone wasn't enough — the ADD/EDIT
// permissions exist for other roles too, but user management itself was always Super Admin-gated).
export const usersRoutes = new Hono<{ Variables: Variables }>();

async function countActiveSuperAdmins(db: Db, excludeUserId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(users)
    .where(and(eq(users.isDeleted, false), eq(users.roleId, 'SUPER_ADMIN'), eq(users.status, 'ACTIVE'), ne(users.userId, excludeUserId)));
  return Number(row?.n ?? 0);
}

usersRoutes.get('/', requireAuth('users.view'), async (c) => {
  const db = c.get('db');
  const rows = await db.select({
    userId: users.userId, username: users.username, fullName: users.fullName, email: users.email,
    roleId: users.roleId, roleName: roles.roleName, status: users.status, profileImageUrl: users.profileImageUrl,
    lastLogin: users.lastLogin, mustChangePassword: users.mustChangePassword, createdAt: users.createdAt,
  }).from(users).leftJoin(roles, eq(users.roleId, roles.roleId)).where(eq(users.isDeleted, false));
  return c.json(ok(rows));
});

interface SaveUserPayload {
  userId?: string;
  username?: string;
  fullName?: string;
  email?: string;
  roleId?: string;
  profileImageUrl?: string;
}

usersRoutes.post('/', requireAuth(), async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  if (session.roleId !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only Super Admin can manage users.');
  const payload = await c.req.json<SaveUserPayload>();

  if (!payload.username?.trim()) throw new AppError('INVALID_INPUT', 'Username is required.');
  if (payload.email && !isValidEmail(payload.email)) throw new AppError('INVALID_INPUT', 'Invalid email address.');

  const [dupe] = await db.select({ userId: users.userId }).from(users).where(and(
    eq(users.isDeleted, false), payload.userId ? ne(users.userId, payload.userId) : undefined,
    eq(users.username, payload.username),
  )).limit(1);

  if (payload.userId) {
    const [existing] = await db.select().from(users).where(and(eq(users.userId, payload.userId), eq(users.isDeleted, false))).limit(1);
    if (!existing) throw new AppError('NOT_FOUND', 'User not found.');
    if (dupe) throw new AppError('DUPLICATE', 'Username already in use.');
    if (existing.roleId === 'SUPER_ADMIN' && payload.roleId !== 'SUPER_ADMIN' && await countActiveSuperAdmins(db, payload.userId) === 0) {
      throw new AppError('LAST_SUPER_ADMIN', 'Cannot change the role of the final active Super Admin.');
    }
    await db.update(users).set({
      username: payload.username, fullName: payload.fullName ?? '', email: payload.email ?? '',
      roleId: payload.roleId ?? existing.roleId, profileImageUrl: payload.profileImageUrl ?? '',
      updatedAt: new Date(), updatedBy: session.username,
    }).where(eq(users.userId, payload.userId));
    await logAudit(db, { username: session.username, role: session.roleId, action: 'USER_UPDATE', module: 'users', recordId: payload.userId });
    return c.json(ok(true, 'User updated.'));
  }

  if (dupe) throw new AppError('DUPLICATE', 'Username already in use.');
  const tempPassword = generateTempPassword();
  const salt = generateSalt();
  const newId = generateId('usr');
  await db.insert(users).values({
    userId: newId, username: payload.username, passwordHash: await hashPassword(tempPassword, salt), passwordSalt: salt,
    fullName: payload.fullName ?? '', email: payload.email ?? '', roleId: payload.roleId ?? 'VIEWER', status: 'ACTIVE',
    profileImageUrl: payload.profileImageUrl ?? '', mustChangePassword: true, createdBy: session.username, updatedBy: session.username,
  });
  await logAudit(db, { username: session.username, role: session.roleId, action: 'USER_CREATE', module: 'users', recordId: newId });
  return c.json(ok({ userId: newId, tempPassword }, 'User created. Share the temporary password securely — it will not be shown again.'));
});

usersRoutes.patch('/:userId/status', requireAuth(), async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  if (session.roleId !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only Super Admin can manage users.');
  const { userId } = c.req.param();
  const { active } = await c.req.json<{ active?: boolean }>();

  const [user] = await db.select().from(users).where(and(eq(users.userId, userId), eq(users.isDeleted, false))).limit(1);
  if (!user) throw new AppError('NOT_FOUND', 'User not found.');
  if (!active && user.roleId === 'SUPER_ADMIN' && await countActiveSuperAdmins(db, userId) === 0) {
    throw new AppError('LAST_SUPER_ADMIN', 'Cannot deactivate the final active Super Admin.');
  }
  await db.update(users).set({ status: active ? 'ACTIVE' : 'INACTIVE', updatedAt: new Date(), updatedBy: session.username })
    .where(eq(users.userId, userId));
  await logAudit(db, { username: session.username, role: session.roleId, action: active ? 'USER_ACTIVATE' : 'USER_DEACTIVATE', module: 'users', recordId: userId });
  return c.json(ok(true, active ? 'User activated.' : 'User deactivated.'));
});

usersRoutes.post('/:userId/unlock', requireAuth(), async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  if (session.roleId !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only Super Admin can manage users.');
  const { userId } = c.req.param();
  const [user] = await db.select().from(users).where(and(eq(users.userId, userId), eq(users.isDeleted, false))).limit(1);
  if (!user) throw new AppError('NOT_FOUND', 'User not found.');
  await db.update(users).set({ lockedUntil: null, failedAttempts: 0, updatedAt: new Date(), updatedBy: session.username })
    .where(eq(users.userId, userId));
  await logAudit(db, { username: session.username, role: session.roleId, action: 'USER_UNLOCK', module: 'users', recordId: userId });
  return c.json(ok(true, 'Account unlocked.'));
});

usersRoutes.post('/:userId/reset-password', requireAuth(), async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  if (session.roleId !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only Super Admin can manage users.');
  const { userId } = c.req.param();
  const [user] = await db.select().from(users).where(and(eq(users.userId, userId), eq(users.isDeleted, false))).limit(1);
  if (!user) throw new AppError('NOT_FOUND', 'User not found.');

  const tempPassword = generateTempPassword();
  const salt = generateSalt();
  await db.update(users).set({
    passwordHash: await hashPassword(tempPassword, salt), passwordSalt: salt, mustChangePassword: true,
    failedAttempts: 0, lockedUntil: null, updatedAt: new Date(), updatedBy: session.username,
  }).where(eq(users.userId, userId));
  await logAudit(db, { username: session.username, role: session.roleId, action: 'USER_PASSWORD_RESET', module: 'users', recordId: userId });
  return c.json(ok({ tempPassword }, 'Temporary password generated. It will not be shown again.'));
});
