import { eq, and } from 'drizzle-orm';
import { fmsMaster, syncLog } from '@fms/db';
import { createSyncDb } from './db';
import { readStatusCacheSheet } from './sheets';
import { transformStatusCacheRow, findArchivedRecordIds } from './transform';
import { upsertRecords, upsertStageEvents, markArchived, refreshFmsEvalCache, existingRecordIds } from './upsert';

// Entrypoint for the GitHub Actions scheduled workflow (see /.github/workflows/sync.yml) — see
// plan §"Sync job" for the full per-FMS run sequence. M0 has zero rows in fms_master (nothing
// connected yet), so this run intentionally does nothing but prove DB connectivity — the first
// real FMS gets onboarded in M1.
async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set.');
  const { db, pool } = createSyncDb(databaseUrl);

  try {
    const activeFms = await db.select().from(fmsMaster)
      .where(and(eq(fmsMaster.active, true), eq(fmsMaster.isDeleted, false)));

    if (!activeFms.length) {
      console.log('No active FMS connected yet — nothing to sync (this is expected until M1).');
      return;
    }

    for (const fms of activeFms) {
      const startedAt = new Date();
      try {
        if (!fms.statusCacheSheetName) {
          console.log(`Skipping ${fms.fmsName}: no status_cache_sheet_name configured (non-distributed FMS not yet supported by this sync job).`);
          continue;
        }

        const rawRows = await readStatusCacheSheet(fms.spreadsheetId, fms.statusCacheSheetName);
        const normalized = rawRows.map((r) => transformStatusCacheRow(fms.fmsId, r));

        const previouslyKnown = await existingRecordIds(db, fms.fmsId);
        const currentlyPresent = normalized.map((n) => n.record.recordId);
        const archivedIds = findArchivedRecordIds(previouslyKnown, currentlyPresent);
        await markArchived(db, fms.fmsId, archivedIds);

        await upsertRecords(db, normalized.map((n) => n.record));
        for (const { record, stageEvents } of normalized) {
          await upsertStageEvents(db, fms.fmsId, record.recordId, stageEvents);
        }
        await refreshFmsEvalCache(db, fms.fmsId);

        await db.insert(syncLog).values({
          fmsId: fms.fmsId, startedAt, completedAt: new Date(), status: 'SUCCESS',
          rowsRead: rawRows.length, durationMs: Date.now() - startedAt.getTime(), triggeredBy: 'sync-job',
        });
        console.log(`Synced ${fms.fmsName}: ${rawRows.length} rows, ${archivedIds.length} newly archived.`);
      } catch (err) {
        // One FMS failing must never abort the run for the others — same principle as
        // warmFmsCache's per-FMS try/catch in the old app/Code.gs.
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Sync failed for ${fms.fmsName}:`, message);
        await db.insert(syncLog).values({
          fmsId: fms.fmsId, startedAt, completedAt: new Date(), status: 'FAILED',
          rowsRead: 0, durationMs: Date.now() - startedAt.getTime(), errorMessage: message, triggeredBy: 'sync-job',
        });
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Sync job crashed:', err);
  process.exitCode = 1;
});
