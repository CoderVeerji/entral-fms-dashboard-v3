import { google } from 'googleapis';
import type { StatusCacheRow } from './transform';

// Service-account read of one FMS's own Status_Cache sheet (app/FMS_Status_Publisher.gs, never
// modified by this job — see plan §"Sync job"). GOOGLE_SERVICE_ACCOUNT_JSON holds the full JSON
// key content as a single-line string (GitHub Actions secret — see /README.md "Manual setup
// steps"); creating the GCP project + service-account key needs no billing/credit card, only
// Cloud Run/Cloud SQL/Firebase Functions do.
function getAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set.');
  const credentials = JSON.parse(raw);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
}

const STATUS_CACHE_HEADERS: (keyof StatusCacheRow)[] = [
  'record_id', 'raw_row', 'display_name', 'current_stage', 'doer', 'doer_email', 'plan_time_iso',
  'record_status', 'delay_json', 'completed_steps', 'total_steps', 'last_update_iso', 'freshness',
  'sequence_exception', 'stage_results_json', 'is_closed', 'updated_at',
];

// Reads the FULL Status_Cache sheet (A:Q) in one call — see plan's answer to "does the sync job
// need its own is_closed watermark": no, Status_Cache is already small/lean per FMS, a full read
// every run is cheap at this app's scale and avoids duplicating the publisher's own cursor logic.
export async function readStatusCacheSheet(spreadsheetId: string, sheetName: string): Promise<StatusCacheRow[]> {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const range = `${sheetName}!A:Q`;
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range, valueRenderOption: 'UNFORMATTED_VALUE' });
  const rows = resp.data.values ?? [];
  if (rows.length < 2) return [];

  const [, ...dataRows] = rows; // first row is the header row — trust the known column order above
  return dataRows
    .filter((r) => r.some((cell) => cell !== '' && cell !== null && cell !== undefined))
    .map((r) => {
      const obj = {} as StatusCacheRow;
      STATUS_CACHE_HEADERS.forEach((key, i) => { (obj as unknown as Record<string, unknown>)[key] = r[i] ?? ''; });
      return obj;
    });
}
