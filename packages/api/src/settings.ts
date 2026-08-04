import { eq } from 'drizzle-orm';
import { appSettings } from '@fms/db';
import type { Db } from './db';

// Minimal settings reader for M0 — a single key lookup with a fallback default, mirroring
// app/Code.gs's getSettingRaw_. No in-memory caching yet (Code.gs cached this in CacheService for
// 5 minutes); Workers has no equivalent free built-in cache primitive worth adding before it's
// shown to matter — see REBUILD_PLAN.md principle #6 (don't build a mechanism before it's needed).
export async function getSetting(db: Db, key: string, fallback: string): Promise<string> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  return row?.value ?? fallback;
}
