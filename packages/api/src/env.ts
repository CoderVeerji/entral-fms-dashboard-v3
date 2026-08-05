export interface Env {
  DATABASE_URL: string;
  // Optional — only needed for the "Sync Now" button (POST /api/sync/trigger). A fine-grained
  // GitHub PAT scoped to just this repo with Actions: Read and write. Absent = that one endpoint
  // returns SYNC_NOT_CONFIGURED; everything else keeps working (automatic 5-minute sync doesn't
  // need it at all).
  GITHUB_TOKEN?: string;
}
