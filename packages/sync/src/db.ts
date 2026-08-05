import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import * as schema from '@fms/db';

// GitHub Actions runners aren't restricted the way Cloudflare Workers are, so the sync job uses a
// real pooled TCP connection (not the HTTP driver packages/api uses) for cheaper bulk upserts —
// see plan §"Sync job".
export function createSyncDb(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

// Real, repeated observation: the very FIRST query against a freshly-created Pool sometimes fails
// with Postgres error 57P01 ("terminating connection due to administrator command") — a Neon
// free-tier symptom of the compute being mid-suspend/resume exactly when the new connection
// lands (Neon scales its compute to zero on idle and wakes it on the next query). It never
// recurred on the SAME pool once past that first query. Retrying a trivial query a few times
// before starting real work absorbs that one bad transition instead of failing the whole run —
// same "no retry storms, but a heavy real read gets a genuine retry budget" principle as
// REBUILD_PLAN.md's #3, just applied to a connection warm-up instead of an API call.
export async function warmUpConnection(db: ReturnType<typeof drizzle>, attempts = 3): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      await db.execute(sql`SELECT 1`);
      return;
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw lastErr;
}
