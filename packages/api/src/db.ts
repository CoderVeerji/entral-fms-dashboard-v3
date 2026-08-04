import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from '@fms/db';

// Workers can't open raw TCP sockets, so the API layer uses Neon's HTTP driver (one request per
// query) rather than a pooled connection — see plan §"Backend API". packages/sync (a normal
// GitHub Actions VM) uses a real pooled TCP connection instead for bulk upserts.
export function createDb(databaseUrl: string) {
  const sql = neon(databaseUrl);
  return drizzle(sql, { schema });
}

export type Db = ReturnType<typeof createDb>;
