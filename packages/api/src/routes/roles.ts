import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { roles } from '@fms/db';
import { ok, AppError, PERMISSIONS, type PermissionMap } from '@fms/core';
import { requireAuth } from '../middleware/auth';
import { logAudit } from '../audit';
import type { Variables } from '../types';

// Direct successor to app/Code.gs's getRoles/saveRolePermissions.
export const rolesRoutes = new Hono<{ Variables: Variables }>();

rolesRoutes.get('/', requireAuth('roles.view'), async (c) => {
  const db = c.get('db');
  const rows = await db.select().from(roles).where(eq(roles.isDeleted, false));
  return c.json(ok(rows.map((r) => ({ roleId: r.roleId, roleName: r.roleName, permissions: r.permissions, status: r.status }))));
});

rolesRoutes.patch('/:roleId', requireAuth(), async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  if (session.roleId !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only Super Admin can edit roles.');
  const { roleId } = c.req.param();
  const { permissions } = await c.req.json<{ permissions?: PermissionMap }>();

  const [role] = await db.select().from(roles).where(and(eq(roles.roleId, roleId), eq(roles.isDeleted, false))).limit(1);
  if (!role) throw new AppError('NOT_FOUND', 'Role not found.');

  const normalized: PermissionMap = {};
  for (const p of PERMISSIONS) normalized[p] = !!permissions?.[p];

  await db.update(roles).set({ permissions: normalized, updatedAt: new Date() }).where(eq(roles.roleId, roleId));
  await logAudit(db, { username: session.username, role: session.roleId, action: 'ROLE_UPDATE', module: 'roles', recordId: roleId });
  return c.json(ok(true, 'Role permissions updated.'));
});
