import { eq, and } from 'drizzle-orm';
import { fmsMaster, syncLog, dataHealthCache } from '@fms/db';
import { createSyncDb } from './db';
import { readStatusCacheSheet } from './sheets';
import { transformStatusCacheRow, findArchivedRecordIds } from './transform';
import { upsertRecords, replaceStageEventsForFms, markArchived, refreshFmsEvalCache, existingRecordIds } from './upsert';
import { dedupeAndFindDuplicates, checkSuspiciousDates, checkNegativeDelay, type DataHealthIssue } from './dataHealth';

// Entrypoint for the GitHub Actions scheduled workflow (see /.github/workflows/sync.yml) — see
// plan §"Sync job" for the full per-FMS run sequence.
async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set.');
  const { db, pool } = createSyncDb(databaseUrl);

  try {
    const activeFms = await db.select().from(fmsMaster)
      .where(and(eq(fmsMaster.active, true), eq(fmsMaster.isDeleted, false)));

    if (!activeFms.length) {
      console.log('No active FMS connected yet — nothing to sync.');
      return;
    }

    const syncedFms: { fmsId: string; fmsName: string }[] = [];
    const allIssues: DataHealthIssue[] = [];

    for (const fms of activeFms) {
      const startedAt = new Date();
      try {
        if (!fms.statusCacheSheetName) {
          console.log(`Skipping ${fms.fmsName}: no status_cache_sheet_name configured (non-distributed FMS not yet supported by this sync job).`);
          continue;
        }

        const rawRows = await readStatusCacheSheet(fms.spreadsheetId, fms.statusCacheSheetName);
        const rawNormalized = rawRows.map((r) => transformStatusCacheRow(fms.fmsId, r));

        // Defensive dedupe (see dataHealth.ts's comment) — also what prevents a Postgres
        // "ON CONFLICT DO UPDATE command cannot affect row a second time" crash if Status_Cache
        // ever genuinely has a repeated record_id in one read.
        const { deduped, duplicateIds } = dedupeAndFindDuplicates(rawNormalized);
        if (duplicateIds.length) {
          allIssues.push({
            fmsId: fms.fmsId, fmsName: fms.fmsName, type: 'DUPLICATE_RECORDS',
            detail: `This FMS's own Status_Cache sheet has duplicate record_id rows: ${duplicateIds.slice(0, 8).join(', ')}`
              + `${duplicateIds.length > 8 ? ` (+${duplicateIds.length - 8} more)` : ''} — fix at the source (FMS_Status_Publisher.gs).`,
          });
        }

        const previouslyKnown = await existingRecordIds(db, fms.fmsId);
        const currentlyPresent = deduped.map((n) => n.record.recordId);
        const archivedIds = findArchivedRecordIds(previouslyKnown, currentlyPresent);
        await markArchived(db, fms.fmsId, archivedIds);

        await upsertRecords(db, deduped.map((n) => n.record));
        const allStageEvents = deduped.flatMap((n) => n.stageEvents);
        await replaceStageEventsForFms(db, fms.fmsId, allStageEvents);
        await refreshFmsEvalCache(db, fms.fmsId);

        await db.insert(syncLog).values({
          fmsId: fms.fmsId, startedAt, completedAt: new Date(), status: 'SUCCESS',
          rowsRead: rawRows.length, durationMs: Date.now() - startedAt.getTime(), triggeredBy: 'sync-job',
        });
        console.log(`Synced ${fms.fmsName}: ${rawRows.length} rows, ${archivedIds.length} newly archived, ${duplicateIds.length} duplicates.`);
        syncedFms.push({ fmsId: fms.fmsId, fmsName: fms.fmsName });
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

    // Data health checks run AFTER every FMS's own sync, over whatever's now in Postgres — see
    // app/Code.gs's runDataIntegrityChecks_, the same checks that used to require someone to
    // click "Run Full System Test" to see. One issue here can't abort another FMS's check.
    for (const fms of syncedFms) {
      try {
        allIssues.push(...await checkSuspiciousDates(db, fms.fmsId, fms.fmsName));
        allIssues.push(...await checkNegativeDelay(db, fms.fmsId, fms.fmsName));
      } catch (err) {
        console.error(`Data health check failed for ${fms.fmsName}:`, err instanceof Error ? err.message : err);
      }
    }

    const checkedAt = new Date();
    await db.insert(dataHealthCache).values({ id: 1, checkedAt, issueCount: allIssues.length, issues: allIssues })
      .onConflictDoUpdate({ target: dataHealthCache.id, set: { checkedAt, issueCount: allIssues.length, issues: allIssues } });
    console.log(`Data health: ${allIssues.length} issue(s) found across ${syncedFms.length} synced FMS.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Sync job crashed:', err);
  process.exitCode = 1;
});
