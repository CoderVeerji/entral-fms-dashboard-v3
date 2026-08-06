// Port of app/index.html's DetailValue — auto-detects a URL, email, or date in a raw sheet cell
// value and renders each as something more useful than plain text: a URL becomes an openable
// link (with an eye icon so it reads as "view this", not just a button), an email becomes a
// mailto link, and a date (Apps Script serializes date-type cells to ISO strings — see
// isDateLike's comment) gets shown in DD-MMM-YYYY form instead of a raw timestamp.
import { isDateLike, formatDateTime } from '../utils/date';

const URL_RE = /^https?:\/\/\S+$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function DetailValue({ value }: { value: unknown }) {
  const s = value === null || value === undefined || value === '' ? '' : String(value);
  if (!s) return <span style={{ color: 'var(--text-soft)' }}>—</span>;
  if (URL_RE.test(s)) {
    return <a href={s} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm"><i className="fas fa-eye" /> Open Link</a>;
  }
  if (EMAIL_RE.test(s)) {
    return <a href={`mailto:${s}`}>{s}</a>;
  }
  if (isDateLike(s)) {
    return <b>{formatDateTime(s)}</b>;
  }
  return <b>{s}</b>;
}
