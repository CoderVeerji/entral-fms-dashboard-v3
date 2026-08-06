import { auditLog } from '@fms/db';
import type { Db } from './db';

interface AuditEntry {
  username: string;
  role?: string;
  action: string;
  module: string;
  recordId?: string;
  details?: unknown;
  success?: boolean;
  errorMessage?: string;
}

// Direct successor to app/Code.gs's logAudit_ — called after every mutating action across the
// app (login/logout, action item CRUD, user/role/settings/FMS changes, sync runs) so the Audit
// Log page (packages/api/src/routes/auditLog.ts) actually has something to show. Swallows its own
// errors, same guarantee as the original: a broken audit write must never fail the real request.
export async function logAudit(db: Db, entry: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLog).values({
      username: entry.username,
      role: entry.role ?? '',
      action: entry.action,
      module: entry.module,
      recordId: entry.recordId ?? '',
      details: (entry.details ?? {}) as object,
      success: entry.success ?? true,
      errorMessage: entry.errorMessage ?? '',
    });
  } catch {
    // never let an audit-log failure break the request it's describing
  }
}
