export interface Env {
  DATABASE_URL: string;
  // Optional — only needed for the "Sync Now" button (POST /api/sync/trigger). A fine-grained
  // GitHub PAT scoped to just this repo with Actions: Read and write. Absent = that one endpoint
  // returns SYNC_NOT_CONFIGURED; everything else keeps working (automatic 5-minute sync doesn't
  // need it at all).
  GITHUB_TOKEN?: string;
  // Optional — only needed for "Forgot Password" (POST /api/auth/request-password-reset).
  // Gmail API (gmail.send scope), free, no card, no domain verification needed — see email.ts's
  // header comment for the one-time OAuth setup. All four must be set together; absent = the
  // endpoint still returns its normal generic message (never reveals whether email sending is
  // configured — see auth.ts) but does not actually reset anything.
  GMAIL_CLIENT_ID?: string;
  GMAIL_CLIENT_SECRET?: string;
  GMAIL_REFRESH_TOKEN?: string;
  // The Gmail address these creds were authorized for — used as both the sender and the
  // Gmail API's "me" identity.
  GMAIL_SENDER_EMAIL?: string;
  // Public web app URL, used only for the "Open Dashboard" link in reset emails.
  APP_URL?: string;
}
