import { AppError } from '@fms/core';

export { AppError };

// Maps AppError codes (same code strings app/Code.gs's AppError_ already used, e.g.
// requireSession_'s NO_SESSION/SESSION_INVALID/SESSION_REVOKED/SESSION_EXPIRED/ACCOUNT_INACTIVE/
// NO_ROLE, or FORBIDDEN from a failed permission check) to a real HTTP status — the old Apps
// Script transport always answered 200 with an ok:false body; this backend is real REST, so a
// caller can also just check res.status instead of parsing the body.
const CODE_TO_STATUS: Record<string, number> = {
  NO_SESSION: 401,
  SESSION_INVALID: 401,
  SESSION_REVOKED: 401,
  SESSION_EXPIRED: 401,
  ACCOUNT_INACTIVE: 401,
  ACCOUNT_LOCKED: 401,
  INVALID_CREDENTIALS: 401,
  NO_ROLE: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  SHEET_MISSING: 404,
  INVALID_INPUT: 400,
  WEAK_PASSWORD: 400,
  DUPLICATE: 409,
  LAST_SUPER_ADMIN: 409,
};

export function statusForCode(code: string): number {
  return CODE_TO_STATUS[code] ?? 500;
}
