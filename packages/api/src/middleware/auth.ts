import type { Context, Next } from 'hono';
import { eq, and } from 'drizzle-orm';
import { sessions, users, roles } from '@fms/db';
import type { Permission, PermissionMap } from '@fms/core';
import { sha256Hex } from '../crypto';
import { AppError } from '../errors';
import { withDbRetry } from '../retry';
import type { Variables } from '../types';

// Direct analogue of app/Code.gs's requireSession_(token, requiredPermission). Re-reads the
// role's permission set from the DB on every request (not baked into a JWT) — this is what makes
// a permission-matrix edit take effect on the user's very next request, and makes logout revoke
// access immediately, exactly like the Apps Script original. See plan §"Backend API" for why this
// beats a JWT here.
export function requireAuth(permission?: Permission) {
  return async (c: Context<{ Variables: Variables }>, next: Next) => {
    const authHeader = c.req.header('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) throw new AppError('NO_SESSION', 'Please sign in to continue.');

    const db = c.get('db');
    const tokenHash = await sha256Hex(token);

    const [session] = await withDbRetry('session lookup', () =>
      db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash)).limit(1));
    if (!session) throw new AppError('SESSION_INVALID', 'Your session is invalid. Please sign in again.');
    if (session.revoked) throw new AppError('SESSION_REVOKED', 'Your session has ended. Please sign in again.');
    if (!session.expiresAt || session.expiresAt.getTime() < Date.now()) {
      throw new AppError('SESSION_EXPIRED', 'Your session has expired. Please sign in again.');
    }

    const [user] = await db.select().from(users)
      .where(and(eq(users.userId, session.userId), eq(users.isDeleted, false))).limit(1);
    if (!user || user.status !== 'ACTIVE') throw new AppError('ACCOUNT_INACTIVE', 'This account is no longer active.');

    const [role] = await db.select().from(roles)
      .where(and(eq(roles.roleId, user.roleId), eq(roles.isDeleted, false))).limit(1);
    if (!role) throw new AppError('NO_ROLE', 'This account has no valid role assigned.');

    const permissions = role.permissions as PermissionMap;
    if (permission && !permissions[permission]) {
      throw new AppError('FORBIDDEN', 'You do not have permission to perform this action.');
    }

    // Best-effort last_seen touch, throttled the same way requireSession_ did (only write if
    // stale by more than 60s) — never blocks or fails the request if it errors.
    const lastSeenMs = session.lastSeen ? session.lastSeen.getTime() : 0;
    if (Date.now() - lastSeenMs > 60000) {
      db.update(sessions).set({ lastSeen: new Date() }).where(eq(sessions.sessionId, session.sessionId)).catch(() => {});
    }

    c.set('session', {
      userId: user.userId, username: user.username, fullName: user.fullName, email: user.email,
      roleId: user.roleId, roleName: role.roleName, permissions,
    });
    await next();
  };
}
