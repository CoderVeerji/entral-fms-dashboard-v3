// Shared by the "Sync Now" button (routes/sync.ts) and the scheduled Cron Trigger (index.ts) —
// both just fire GitHub's workflow_dispatch API for the already-scheduled "Sync FMS data"
// workflow; the actual sync logic stays in GitHub Actions (needs a real Node runtime for
// googleapis + a pooled Postgres connection, and would blow Workers' 10ms free-tier CPU budget
// processing thousands of records — see plan §"M7" follow-up on why sync itself never moves into
// a Worker). This is deliberately just the dispatch call, nothing more.
const GITHUB_REPO = 'CoderVeerji/entral-fms-dashboard-v3';

export interface DispatchResult {
  ok: boolean;
  status: number;
  body?: string;
}

export async function dispatchGithubSync(githubToken: string): Promise<DispatchResult> {
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
    return { ok: false, status: res.status, body: (await res.text()).slice(0, 300) };
  }
  return { ok: true, status: res.status };
}
