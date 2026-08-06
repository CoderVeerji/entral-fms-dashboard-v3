import { Hono } from 'hono';
import { eq, and, sql } from 'drizzle-orm';
import { users, roles, sessions } from '@fms/db';
import { ok, AppError, generateTempPassword } from '@fms/core';
import { sha256Hex, hashPassword, generateSalt, generateToken, generateId, isValidEmail } from '../crypto';
import { requireAuth } from '../middleware/auth';
import { withDbRetry } from '../retry';
import { getSetting } from '../settings';
import { logAudit } from '../audit';
import { sendEmail, passwordResetEmailHtml } from '../email';
import type { Env } from '../env';
import type { Variables } from '../types';

// Direct port of app/Code.gs's login/logout/changePassword/requestPasswordReset — see that file
// for the original Apps Script version this mirrors field-for-field (failed-attempt lockout after
// 5 tries, 15-minute lock window, must_change_password flow).
export const authRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

authRoutes.post('/login', async (c) => {
  const db = c.get('db');
  const body = await c.req.json<{ username?: string; password?: string }>();
  const username = String(body.username ?? '').trim();
  const password = String(body.password ?? '');
  if (!username || !password) throw new AppError('INVALID_INPUT', 'Username and password are required.');

  const [user] = await withDbRetry('login user lookup', () => db.select().from(users)
    .where(and(sql`lower(${users.username}) = lower(${username})`, eq(users.isDeleted, false))).limit(1));
  if (!user) {
    await logAudit(db, { username, action: 'LOGIN_FAIL', module: 'auth', success: false, errorMessage: 'no such user' });
    throw new AppError('INVALID_CREDENTIALS', 'Invalid username or password.');
  }
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
    await logAudit(db, { username, action: 'LOGIN_FAIL', module: 'auth', success: false, errorMessage: 'bad password' });
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
  await logAudit(db, { username: user.username, role: user.roleId, action: 'LOGIN_SUCCESS', module: 'auth' });

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
  const [session] = await db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash)).limit(1);
  await db.update(sessions).set({ revoked: true }).where(eq(sessions.tokenHash, tokenHash));
  if (session) await logAudit(db, { username: session.username, role: session.roleId, action: 'LOGOUT', module: 'auth' });
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
  await logAudit(db, { username: session.username, role: session.roleId, action: 'PASSWORD_CHANGE', module: 'auth' });

  return c.json(ok(true, 'Password updated successfully.'));
});

authRoutes.get('/me', requireAuth(), async (c) => {
  const session = c.get('session');
  return c.json(ok(session));
});

authRoutes.patch('/me', requireAuth(), async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const { fullName, email } = await c.req.json<{ fullName?: string; email?: string }>();
  if (email && !isValidEmail(email)) throw new AppError('INVALID_INPUT', 'Invalid email address.');

  await db.update(users).set({
    fullName: fullName || undefined, email: email || undefined, updatedAt: new Date(), updatedBy: session.username,
  }).where(eq(users.userId, session.userId));
  await logAudit(db, { username: session.username, role: session.roleId, action: 'MY_ACCOUNT_UPDATE', module: 'users' });

  return c.json(ok(true, 'Profile updated.'));
});

// Self-service "Forgot Password" — no auth required (this IS the account-recovery path).
// Deliberately always returns the SAME generic message regardless of what actually happened
// (unknown username, no email on file, email send failure) so the login screen never reveals
// whether a given username exists — matches app/Code.gs's requestPasswordReset exactly on this
// point. Improves on that version in one way: the password is only ever reset AFTER the email is
// confirmed sent (not before), so a delivery failure can never leave an account silently reset
// with no way to learn the new password.
const GENERIC_RESET_MESSAGE = 'If that account exists and has a registered email, a temporary password has been sent to it. If not, please contact your administrator.';

authRoutes.post('/request-password-reset', async (c) => {
  const db = c.get('db');
  const body = await c.req.json<{ username?: string }>();
  const username = String(body.username ?? '').trim();
  if (!username) return c.json(ok(true, GENERIC_RESET_MESSAGE));

  const [user] = await withDbRetry('reset-request user lookup', () => db.select().from(users).where(and(
    sql`lower(${users.username}) = lower(${username})`, eq(users.isDeleted, false), eq(users.status, 'ACTIVE'),
  )).limit(1));
  if (!user || !isValidEmail(user.email)) {
    await logAudit(db, { username, action: 'PASSWORD_RESET_REQUEST', module: 'auth', success: false, errorMessage: 'no such active account or no email on file' });
    return c.json(ok(true, GENERIC_RESET_MESSAGE));
  }

  const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, GMAIL_SENDER_EMAIL } = c.env;
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN || !GMAIL_SENDER_EMAIL) {
    console.error('Gmail credentials not fully set — password reset requested but no email can be sent.');
    await logAudit(db, { username: user.username, action: 'PASSWORD_RESET_REQUEST', module: 'auth', success: false, errorMessage: 'email not configured' });
    return c.json(ok(true, GENERIC_RESET_MESSAGE));
  }

  const tempPassword = generateTempPassword();
  const appUrl = c.env.APP_URL || 'https://fms-dashboard-web.pages.dev';
  const sendResult = await sendEmail(
    { clientId: GMAIL_CLIENT_ID, clientSecret: GMAIL_CLIENT_SECRET, refreshToken: GMAIL_REFRESH_TOKEN, senderEmail: GMAIL_SENDER_EMAIL },
    user.email!, 'Your Central FMS Dashboard password reset',
    passwordResetEmailHtml(user.username, tempPassword, appUrl),
    `Temporary password: ${tempPassword}\n\nYou will be asked to set a new password at your next login.`,
  );
  if (!sendResult.ok) {
    console.error('Password reset email failed to send:', sendResult.error);
    await logAudit(db, { username: user.username, action: 'PASSWORD_RESET_REQUEST', module: 'auth', success: false, errorMessage: String(sendResult.error) });
    return c.json(ok(true, GENERIC_RESET_MESSAGE));
  }

  const salt = generateSalt();
  await db.update(users).set({
    passwordHash: await hashPassword(tempPassword, salt), passwordSalt: salt, mustChangePassword: true,
    failedAttempts: 0, lockedUntil: null, updatedAt: new Date(), updatedBy: 'self-service-reset',
  }).where(eq(users.userId, user.userId));
  await logAudit(db, { username: user.username, role: user.roleId, action: 'PASSWORD_RESET_REQUEST', module: 'auth', success: true });

  return c.json(ok(true, GENERIC_RESET_MESSAGE));
});

export { isValidEmail };
