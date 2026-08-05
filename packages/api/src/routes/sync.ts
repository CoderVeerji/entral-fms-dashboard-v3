import { Hono } from 'hono';
import { ok, AppError } from '@fms/core';
import { requireAuth } from '../middleware/auth';
import type { Env } from '../env';
import type { Variables } from '../types';

// "Sync Now" — equivalent to app/Code.gs's syncAllFms/runSync_, but the actual sync job
// (packages/sync) runs on GitHub Actions, not inside a Worker request (it needs a real Node
// runtime for googleapis + can take well over what's reasonable to hold a Worker request open
// for). This endpoint just fires GitHub's workflow_dispatch API for the already-scheduled "Sync
// FMS data" workflow — same job, triggered on demand instead of waiting for the next 5-minute
// tick. Fire-and-forget: the workflow run itself typically finishes in under a minute, but this
// endpoint returns as soon as GitHub accepts the dispatch, not when the sync itself completes.
export const syncRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const GITHUB_REPO = 'CoderVeerji/entral-fms-dashboard-v3';

syncRoutes.post('/trigger', requireAuth('sync.run'), async (c) => {
  const githubToken = c.env.GITHUB_TOKEN;
  if (!githubToken) throw new AppError('SYNC_NOT_CONFIGURED', 'GITHUB_TOKEN is not set — Sync Now is unavailable until it is.');

  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/sync.yml/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${githubToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'central-fms-dashboard-v3',
    },
    body: JSON.stringify({ ref: 'main' }),
  });

  if (res.status !== 204) {
    const body = await res.text();
    throw new AppError('SYNC_TRIGGER_FAILED', `GitHub declined the sync trigger (HTTP ${res.status}): ${body.slice(0, 300)}`);
  }

  return c.json(ok(true, 'Sync started — new data will land in about a minute.'));
});
