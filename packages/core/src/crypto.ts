// Ported from app/Code.gs's sha256Hex_/generateSalt_/hashPassword_/generateToken_/generateId_/
// generateTempPassword_ — uses the Web Crypto API (crypto.subtle / crypto.randomUUID /
// crypto.getRandomValues), which is available both in Node 19+ (used by packages/db's seed
// script and packages/sync) and in the Cloudflare Workers runtime (packages/api) — one
// implementation, no per-runtime duplication.

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function generateSalt(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

export async function hashPassword(password: string, salt: string): Promise<string> {
  return sha256Hex(`${salt}:${password}`);
}

export function generateToken(): string {
  return crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
}

export function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
}

const TEMP_PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
export function generateTempPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let out = '';
  for (let i = 0; i < 10; i++) out += TEMP_PASSWORD_CHARS.charAt(bytes[i] % TEMP_PASSWORD_CHARS.length);
  return `${out}#1`;
}

export function isValidEmail(email: string | null | undefined): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email ?? '').trim());
}
