import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '@fms/db';

// GitHub Actions runners aren't restricted the way Cloudflare Workers are, so the sync job uses a
// real pooled TCP connection (not the HTTP driver packages/api uses) for cheaper bulk upserts —
// see plan §"Sync job".
export function createSyncDb(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });
  return { db, pool };
}
