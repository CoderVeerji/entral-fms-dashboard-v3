import { describe, it, expect } from 'vitest';
import { statusForCode } from './errors';

describe('statusForCode', () => {
  it('maps every session-related code to 401, matching requireSession_ semantics', () => {
    for (const code of ['NO_SESSION', 'SESSION_INVALID', 'SESSION_REVOKED', 'SESSION_EXPIRED', 'ACCOUNT_INACTIVE', 'NO_ROLE']) {
      expect(statusForCode(code)).toBe(401);
    }
  });

  it('maps FORBIDDEN to 403', () => expect(statusForCode('FORBIDDEN')).toBe(403));
  it('maps NOT_FOUND to 404', () => expect(statusForCode('NOT_FOUND')).toBe(404));
  it('maps INVALID_INPUT to 400', () => expect(statusForCode('INVALID_INPUT')).toBe(400));
  it('maps DUPLICATE to 409', () => expect(statusForCode('DUPLICATE')).toBe(409));
  it('falls back to 500 for an unrecognized code', () => expect(statusForCode('SOMETHING_NEW')).toBe(500));
});
