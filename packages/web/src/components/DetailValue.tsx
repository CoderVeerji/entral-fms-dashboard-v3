// Port of app/index.html's DetailValue — auto-detects a URL or email in a raw sheet cell value
// and renders it as a real link instead of plain text.
const URL_RE = /^https?:\/\/\S+$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function DetailValue({ value }: { value: unknown }) {
  const s = value === null || value === undefined || value === '' ? '' : String(value);
  if (!s) return <span style={{ color: 'var(--text-soft)' }}>—</span>;
  if (URL_RE.test(s)) {
    return <a href={s} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm"><i className="fas fa-arrow-up-right-from-square" /> Open Link</a>;
  }
  if (EMAIL_RE.test(s)) {
    return <a href={`mailto:${s}`}>{s}</a>;
  }
  return <b>{s}</b>;
}
