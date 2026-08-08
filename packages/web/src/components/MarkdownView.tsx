import type { ReactNode } from 'react';

// Small hand-rolled markdown renderer for the AI Assistant's answers — deliberately not
// dangerouslySetInnerHTML'd raw HTML (which would need a sanitizer dependency to be safe against
// a user's own message text getting echoed back and rendered as markup); this builds real React
// elements directly, so there's nothing to sanitize. Covers what an LLM actually produces for a
// short operational report: headings, bold/italic/code, bullet/numbered lists, horizontal rules,
// and GitHub-style pipe tables — not a full CommonMark implementation.
function parseInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let remaining = text;
  let key = 0;
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`/;
  while (remaining) {
    const m = re.exec(remaining);
    if (!m) { parts.push(remaining); break; }
    if (m.index > 0) parts.push(remaining.slice(0, m.index));
    if (m[1] !== undefined) parts.push(<b key={key++}>{m[1]}</b>);
    else if (m[2] !== undefined) parts.push(<i key={key++}>{m[2]}</i>);
    else if (m[3] !== undefined) parts.push(<code key={key++}>{m[3]}</code>);
    remaining = remaining.slice(m.index + m[0].length);
  }
  return parts;
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

const HEADING_RE = /^(#{1,4})\s+(.*)/;
const HR_RE = /^(-{3,}|\*{3,}|_{3,})$/;
const UL_RE = /^\s*[-*]\s+(.*)/;
const OL_RE = /^\s*\d+[.)]\s+(.*)/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/;

export function MarkdownView({ text }: { text: string }) {
  // The model occasionally emits an entire table (header, separator, every data row) as one
  // unbroken line instead of real newlines between rows — a `| |` substring only ever occurs at
  // exactly a row boundary (one row's trailing pipe touching the next row's leading pipe; a real
  // cell's content sits between them everywhere else), so splitting there recovers the row
  // structure regardless of whether the model bothered with newlines. Harmless no-op on an
  // already-correct multi-line table (replacing "|\n|" with itself).
  const lines = text.replace(/\r\n/g, '\n').replace(/\|\s*\|/g, '|\n|').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    if (HR_RE.test(line.trim())) { blocks.push(<hr key={key++} className="md-hr" />); i++; continue; }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      blocks.push(<div key={key++} className={`md-heading md-h${heading[1].length}`}>{parseInline(heading[2])}</div>);
      i++; continue;
    }

    if (line.includes('|') && lines[i + 1] && TABLE_SEP_RE.test(lines[i + 1])) {
      const headerCells = splitTableRow(line);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].includes('|')) { rows.push(splitTableRow(lines[j])); j++; }
      blocks.push(
        <div key={key++} className="md-table-scroll">
          <table className="md-table">
            <thead><tr>{headerCells.map((c, ci) => <th key={ci}>{parseInline(c)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci}>{parseInline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      i = j; continue;
    }

    if (UL_RE.test(line)) {
      const items: string[] = [];
      let j = i;
      let m: RegExpExecArray | null;
      while (j < lines.length && (m = UL_RE.exec(lines[j]))) { items.push(m[1]); j++; }
      blocks.push(<ul key={key++} className="md-list">{items.map((it, ii) => <li key={ii}>{parseInline(it)}</li>)}</ul>);
      i = j; continue;
    }

    if (OL_RE.test(line)) {
      const items: string[] = [];
      let j = i;
      let m: RegExpExecArray | null;
      while (j < lines.length && (m = OL_RE.exec(lines[j]))) { items.push(m[1]); j++; }
      blocks.push(<ol key={key++} className="md-list">{items.map((it, ii) => <li key={ii}>{parseInline(it)}</li>)}</ol>);
      i = j; continue;
    }

    const paraLines = [line];
    let j = i + 1;
    while (j < lines.length && lines[j].trim() && !HEADING_RE.test(lines[j]) && !UL_RE.test(lines[j]) && !OL_RE.test(lines[j]) && !HR_RE.test(lines[j].trim())) {
      paraLines.push(lines[j]); j++;
    }
    blocks.push(<p key={key++} className="md-p">{parseInline(paraLines.join(' '))}</p>);
    i = j;
  }

  return <div className="md-content">{blocks}</div>;
}
