-- Hand-written initial migration (mirrors packages/db/src/schema.ts exactly).
-- Once DATABASE_URL is available against a real Neon project, subsequent schema changes should
-- go through `drizzle-kit generate` in this package instead of hand-editing SQL — this file only
-- exists to bootstrap the very first schema before any live connection exists to generate against.
-- Run with: psql "$DATABASE_URL" -f packages/db/migrations/0000_init.sql

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ==== Reference / admin tables ====

CREATE TABLE app_settings (
  key text PRIMARY KEY,
  value text,
  description text,
  updated_at timestamptz,
  updated_by text
);

CREATE TABLE roles (
  role_id text PRIMARY KEY,
  role_name text NOT NULL,
  permissions jsonb NOT NULL,
  status text DEFAULT 'ACTIVE',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  is_deleted boolean DEFAULT false
);

CREATE TABLE fms_master (
  fms_id text PRIMARY KEY,
  fms_name text NOT NULL,
  short_name text,
  spreadsheet_id text NOT NULL,
  spreadsheet_url text,
  data_sheet_name text,
  step_directory_sheet_name text,
  header_row integer DEFAULT 1,
  data_start_row integer DEFAULT 2,
  unique_id_header text,
  display_name_header text,
  timestamp_header text,
  active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  category text,
  owner_name text,
  owner_email text,
  status_cache_sheet_name text DEFAULT 'Status_Cache',
  last_successful_sync timestamptz,
  last_sync_status text,
  notes text,
  created_at timestamptz DEFAULT now(),
  created_by text,
  updated_at timestamptz DEFAULT now(),
  updated_by text,
  is_deleted boolean DEFAULT false
);

CREATE TABLE users (
  user_id text PRIMARY KEY,
  username text NOT NULL,
  password_hash text NOT NULL,
  password_salt text NOT NULL,
  full_name text,
  email text,
  role_id text NOT NULL REFERENCES roles(role_id),
  status text DEFAULT 'ACTIVE',
  profile_image_url text,
  last_login timestamptz,
  failed_attempts integer DEFAULT 0,
  locked_until timestamptz,
  must_change_password boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  created_by text,
  updated_at timestamptz DEFAULT now(),
  updated_by text,
  is_deleted boolean DEFAULT false
);
CREATE UNIQUE INDEX idx_users_username ON users (username);

CREATE TABLE sessions (
  session_id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(user_id),
  username text NOT NULL,
  role_id text NOT NULL,
  token_hash text NOT NULL,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen timestamptz DEFAULT now(),
  ip_hint text,
  user_agent text,
  revoked boolean DEFAULT false
);
CREATE UNIQUE INDEX idx_sessions_token_hash ON sessions (token_hash);
CREATE INDEX idx_sessions_user_revoked ON sessions (user_id, revoked);

-- ==== Hot-path tables (the actual fix for slow filtering) ====

CREATE TABLE records (
  fms_id text NOT NULL,
  record_id text NOT NULL,
  raw_row integer,
  display_name text,
  current_stage text,
  doer text,
  doer_email text,
  plan_time timestamptz,
  record_status text NOT NULL,
  delay jsonb,
  completed_steps integer DEFAULT 0,
  total_steps integer DEFAULT 0,
  last_update timestamptz,
  freshness text,
  sequence_exception boolean DEFAULT false,
  is_closed boolean DEFAULT false,
  is_archived boolean DEFAULT false,
  synced_at timestamptz DEFAULT now(),
  PRIMARY KEY (fms_id, record_id)
);
CREATE INDEX idx_records_fms_status ON records (fms_id, record_status);
CREATE INDEX idx_records_fms_freshness ON records (fms_id, freshness);
CREATE INDEX idx_records_fms_doer ON records (fms_id, doer);
CREATE INDEX idx_records_fms_stage ON records (fms_id, current_stage);
CREATE INDEX idx_records_plan_time ON records (fms_id, plan_time);
-- Trigram search index: replaces Code.gs getLiveRecords' JS .indexOf() substring search across
-- displayName/recordId/doer. gin_trgm_ops needs pg_trgm (enabled above).
CREATE INDEX idx_records_search_trgm ON records
  USING gin ((display_name || ' ' || record_id || ' ' || coalesce(doer, '')) gin_trgm_ops);

CREATE TABLE stage_events (
  fms_id text NOT NULL,
  record_id text NOT NULL,
  stage_index integer NOT NULL,
  stage_name text NOT NULL,
  doer_name text,
  doer_email text,
  status text NOT NULL,
  plan_time timestamptz,
  actual_time timestamptz,
  variance_minutes integer,
  PRIMARY KEY (fms_id, record_id, stage_index)
);
CREATE INDEX idx_stage_events_stage ON stage_events (fms_id, stage_name, actual_time);
CREATE INDEX idx_stage_events_doer ON stage_events (fms_id, doer_name, actual_time);
CREATE INDEX idx_stage_events_status ON stage_events (status);

-- ==== Materialized rollups (refreshed by packages/sync every run) ====

CREATE TABLE fms_eval_cache (
  fms_id text PRIMARY KEY,
  computed_at timestamptz,
  totals jsonb,
  scores jsonb,
  stage_bottlenecks jsonb,
  doer_bottlenecks jsonb,
  critical_sample jsonb,
  completed_today integer DEFAULT 0
);

CREATE TABLE dashboard_kpis (
  id integer PRIMARY KEY DEFAULT 1,
  computed_at timestamptz,
  totals jsonb,
  fms_summaries jsonb
);

-- ==== Operational tables ====

CREATE TABLE action_items (
  action_id text PRIMARY KEY,
  fms_id text,
  record_id text,
  record_display text,
  stage_name text,
  action_type text NOT NULL,
  priority text NOT NULL,
  title text NOT NULL,
  description text,
  assigned_to text,
  assigned_email text,
  created_by text,
  created_at timestamptz DEFAULT now(),
  due_at timestamptz,
  status text DEFAULT 'Open',
  resolved_by text,
  resolved_at timestamptz,
  resolution text,
  last_comment_at timestamptz,
  is_deleted boolean DEFAULT false
);
CREATE INDEX idx_action_items_status ON action_items (status);
CREATE INDEX idx_action_items_assigned ON action_items (assigned_to);
CREATE INDEX idx_action_items_record ON action_items (fms_id, record_id);
CREATE INDEX idx_action_items_due ON action_items (due_at);

CREATE TABLE action_comments (
  comment_id text PRIMARY KEY,
  action_id text NOT NULL REFERENCES action_items(action_id),
  comment text NOT NULL,
  created_by text,
  created_at timestamptz DEFAULT now(),
  is_deleted boolean DEFAULT false
);

CREATE TABLE escalation_rules (
  rule_id text PRIMARY KEY,
  rule_name text,
  fms_id text,
  stage_name text,
  delay_minutes integer,
  priority text,
  escalate_to text,
  escalate_email text,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  is_deleted boolean DEFAULT false
);

CREATE TABLE audit_log (
  log_id bigserial PRIMARY KEY,
  timestamp timestamptz DEFAULT now(),
  username text,
  role text,
  action text,
  module text,
  record_id text,
  details jsonb,
  success boolean DEFAULT true,
  error_message text
);
CREATE INDEX idx_audit_log_timestamp ON audit_log (timestamp);
CREATE INDEX idx_audit_log_username ON audit_log (username);

CREATE TABLE report_snapshots (
  snapshot_id text PRIMARY KEY,
  snapshot_date date NOT NULL,
  snapshot_type text NOT NULL,
  fms_id text NOT NULL,
  metrics jsonb,
  created_at timestamptz DEFAULT now(),
  created_by text
);
CREATE UNIQUE INDEX idx_report_snapshots_unique ON report_snapshots (snapshot_date, snapshot_type, fms_id);

CREATE TABLE user_preferences (
  user_id text PRIMARY KEY REFERENCES users(user_id),
  theme text DEFAULT 'light',
  accent text DEFAULT 'ocean',
  sidebar_collapsed boolean DEFAULT false,
  default_fms_id text,
  default_date_range text,
  tour_completed boolean DEFAULT false,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE sync_log (
  sync_id bigserial PRIMARY KEY,
  fms_id text NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  status text NOT NULL,
  rows_read integer DEFAULT 0,
  duration_ms integer,
  error_message text,
  triggered_by text DEFAULT 'sync-job'
);
CREATE INDEX idx_sync_log_fms ON sync_log (fms_id, started_at);

CREATE TABLE data_health_cache (
  id integer PRIMARY KEY DEFAULT 1,
  checked_at timestamptz,
  issue_count integer DEFAULT 0,
  issues jsonb
);
