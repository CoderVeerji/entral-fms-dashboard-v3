import { describe, it, expect } from 'vitest';
import { sha256Hex, generateSalt, hashPassword, generateToken, generateId, generateTempPassword, isValidEmail } from './crypto';

describe('sha256Hex', () => {
  it('produces the known SHA-256 hex digest of a fixed string', async () => {
    // echo -n "hello" | sha256sum
    expect(await sha256Hex('hello')).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('is deterministic for the same input', async () => {
    expect(await sha256Hex('same-input')).toBe(await sha256Hex('same-input'));
  });

  it('differs for different input (no accidental collisions on similar strings)', async () => {
    expect(await sha256Hex('a')).not.toBe(await sha256Hex('b'));
  });
});

describe('generateSalt / generateToken / generateId', () => {
  it('generateSalt produces a 32-char hex-like string with no dashes', () => {
    const salt = generateSalt();
    expect(salt).not.toContain('-');
    expect(salt.length).toBe(32);
  });

  it('generateToken produces unique values on repeated calls', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(30);
  });

  it('generateId prefixes correctly and stays reasonably short', () => {
    const id = generateId('usr');
    expect(id.startsWith('usr_')).toBe(true);
    expect(id.length).toBe('usr_'.length + 14);
  });
});

describe('hashPassword', () => {
  it('same password + same salt always hashes the same', async () => {
    const salt = generateSalt();
    expect(await hashPassword('correct horse', salt)).toBe(await hashPassword('correct horse', salt));
  });

  it('same password + different salt hashes differently (salting actually does something)', async () => {
    expect(await hashPassword('correct horse', 'salt-a')).not.toBe(await hashPassword('correct horse', 'salt-b'));
  });
});

describe('generateTempPassword', () => {
  it('always ends with the fixed suffix and is non-trivial length', () => {
    const pw = generateTempPassword();
    expect(pw.endsWith('#1')).toBe(true);
    expect(pw.length).toBe(12);
  });
});

describe('isValidEmail', () => {
  it('accepts a normal email', () => expect(isValidEmail('a@b.com')).toBe(true));
  it('rejects missing @', () => expect(isValidEmail('a-b.com')).toBe(false));
  it('rejects missing domain dot', () => expect(isValidEmail('a@b')).toBe(false));
  it('rejects empty/undefined', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail(undefined)).toBe(false);
  });
});
