import type { Config } from 'drizzle-kit';

// DATABASE_URL is provided at generate/push time only (never committed) — see the root README's
// "Manual setup steps" for how to get this from a free Neon project (no credit card required).
export default {
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
} satisfies Config;
