# Central FMS Dashboard v3 — Postgres + Cloudflare Workers + Cloudflare Pages

New stack replacing the Google Apps Script + Sheets backend (`../app`, `../central` — both stay
untouched and working during this migration). See `../../.claude/plans/federated-booping-treehouse.md`
(or ask for the plan) for the full architecture rationale. Every service below has a genuine free
tier that needs **no credit card**.

## Packages

- `packages/db` — Postgres schema (Drizzle ORM) + one-time seed script. Shared by `api` and `sync`.
- `packages/core` — ported business logic (status/scoring/bottleneck math, crypto helpers, response envelope). Shared by `db`, `api`, `sync`.
- `packages/api` — REST API on Cloudflare Workers (Hono).
- `packages/sync` — scheduled job (GitHub Actions) that reads each FMS's `Status_Cache` sheet and populates Postgres.
- `packages/web` — React frontend (Vite), deployed to Cloudflare Pages.

## Manual setup steps (one-time, do these in order)

### 1. GitHub — public repo (needed for free unlimited Actions minutes)

The sync job runs every 5 minutes; GitHub's free *private*-repo Actions minutes don't comfortably
cover that cadence, but public repos get unlimited minutes (see the plan's "Known risks" section).
This repo contains no proprietary data — only generic, FMS-agnostic code; secrets (DB connection
string, Google service account key) are never committed.

```
gh repo create <your-org>/central-fms-dashboard-v3 --public --source=. --push
```

### 2. Neon — free Postgres, no card

1. Sign up at neon.tech with just an email (no card).
2. Create a project (any region). Copy the connection string it gives you — that's `DATABASE_URL`.
3. Apply the schema:
   ```
   psql "$DATABASE_URL" -f packages/db/migrations/0000_init.sql
   ```
4. Seed roles + the first Super Admin login + default settings:
   ```
   cd packages/db
   DATABASE_URL="..." npm run seed
   ```
   This prints a **one-time** temporary password for username `superadmin` — save it, it is never shown again (matches `../app/Code.gs`'s `setupApplication()` behavior).

### 3. Cloudflare — Workers (API) + Pages (frontend), no card

1. Sign up at cloudflare.com with just an email (no card required for the Workers/Pages free plan).
2. Install Wrangler and log in:
   ```
   npm install -g wrangler
   wrangler login
   ```
3. Deploy the API:
   ```
   cd packages/api
   wrangler secret put DATABASE_URL      # paste the same Neon connection string
   wrangler deploy
   ```
   Note the deployed URL it prints (`https://fms-dashboard-api.<you>.workers.dev`).
4. Point the frontend at that API URL and deploy it:
   ```
   cd packages/web
   echo "VITE_API_BASE_URL=https://fms-dashboard-api.<you>.workers.dev" > .env.production
   npm run build
   wrangler pages deploy dist --project-name=fms-dashboard-web
   ```
5. Log in at the Pages URL it gives you, using `superadmin` + the temporary password from step 2.4. You'll be asked to set a new password immediately (`mustChangePassword`).

### 4. Google service account — read-only access to each FMS's Status_Cache (needed starting Phase M1)

Each connected FMS's `FMS_Status_Publisher.gs` (in that FMS's own spreadsheet) is untouched by
this migration — the sync job just needs read access to the `Status_Cache` sheet it writes.

1. Create a Google Cloud project (console.cloud.google.com) — free, no card needed for this specific step (only compute/DB products require billing).
2. Enable the "Google Sheets API" for that project.
3. IAM & Admin → Service Accounts → Create → download the JSON key.
4. For each connected FMS: open that FMS's spreadsheet → Share → paste the service account's email (looks like `...@<project>.iam.gserviceaccount.com`) → give it **Viewer** access.
5. In your GitHub repo → Settings → Secrets and variables → Actions, add:
   - `DATABASE_URL` — same Neon connection string
   - `GOOGLE_SERVICE_ACCOUNT_JSON` — the full contents of the downloaded JSON key file, as one secret value

The sync workflow (`.github/workflows/sync.yml`) then runs automatically every 5 minutes, and can also be triggered manually from the Actions tab ("Run workflow" — equivalent to the old app's "Sync Now" button).

## Running tests locally

```
npm install
npm test              # unit tests everywhere; DB-integration tests auto-skip without DATABASE_URL
```

To also run the DB-integration tests locally (`packages/api/src/routes/auth.test.ts`), point
`DATABASE_URL` at any real Postgres — a local one via `docker compose up -d db` (see
`docker-compose.yml`) if Docker is available, or a disposable Neon branch:

```
DATABASE_URL="postgres://fms:fms@localhost:5432/fms_test" npm test
```

CI (`.github/workflows/ci.yml`) always runs the full suite, including DB-integration tests,
against a `postgres:16` service container — no local Docker needed to get real CI coverage.

## Current status

M0 (infra + auth skeleton) is complete: schema, ported core logic, Workers API with
login/logout/change-password/permission middleware, Vite+React login page + authenticated shell,
CI, and this setup guide. M1 (one real FMS, Live Records fast — the actual point of this
migration) is next — see the plan for the full phase list.
