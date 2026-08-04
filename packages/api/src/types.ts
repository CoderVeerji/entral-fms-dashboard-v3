import type { Db } from './db';
import type { Permission, PermissionMap } from '@fms/core';

export interface SessionContext {
  userId: string;
  username: string;
  fullName: string | null;
  email: string | null;
  roleId: string;
  roleName: string;
  permissions: PermissionMap;
}

// Hono's per-request context variables — `db` is set once per request in index.ts, `session` is
// set by the requireAuth middleware once the bearer token has been validated.
export type Variables = {
  db: Db;
  session: SessionContext;
};

export type { Permission };
