// Indian-style date display (DD-MMM-YYYY, 12-hour clock) used everywhere a timestamp is shown —
// replaces new Date(...).toLocaleString(), which renders in whatever locale the browser happens
// to be set to instead of a format everyone here actually reads dates in.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Matches Apps Script's Date.toJSON() output (what FMS_Status_Publisher.gs's JSON.stringify
// produces for a date-type sheet cell) — used to auto-detect date values inside the free-form
// "details" object, which otherwise has no schema to say which fields are dates.
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?$/;

export function isDateLike(value: unknown): value is string {
  return typeof value === 'string' && ISO_RE.test(value) && !isNaN(new Date(value).getTime());
}

export function formatDate(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return `${d.getDate()}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

export function formatDateTime(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return String(value);
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${formatDate(d)}, ${h}:${m} ${ampm}`;
}
