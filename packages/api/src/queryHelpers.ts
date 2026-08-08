// Shared by every route accepting a multi-select filter (?fmsId=a,b,c, ?doer=x,y) — same param
// name as the old single-value filter, now CSV, so a single value ("?fmsId=a") still works
// unchanged. See MultiSelectDropdown.tsx on the frontend for the UI this feeds.
export function parseCsvParam(v: string | undefined): string[] {
  if (!v) return [];
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}
