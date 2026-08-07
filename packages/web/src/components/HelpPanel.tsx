import type { CSSProperties } from 'react';
import { useHelp } from '../context/HelpContext';

const PANEL_WIDTH = 320;
const MARGIN = 12;
const GAP = 10;

// Anchors the panel next to whichever "?" badge was clicked (its rect is captured by HelpHotspot
// at click time) instead of always opening in a fixed screen corner — otherwise a badge near the
// top of a long page opens an explanation the user has to scroll away to read. Prefers opening
// below the badge; flips above it when there isn't enough room below. Clamped horizontally so it
// never runs off either edge, including on narrow phone screens.
function computeStyle(anchor: DOMRect): CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(PANEL_WIDTH, vw - MARGIN * 2);

  let left = anchor.left;
  if (left + width > vw - MARGIN) left = vw - MARGIN - width;
  if (left < MARGIN) left = MARGIN;

  const spaceBelow = vh - anchor.bottom;
  const spaceAbove = anchor.top;
  if (spaceBelow >= 160 || spaceBelow >= spaceAbove) {
    return { left, width, top: anchor.bottom + GAP, maxHeight: Math.max(140, spaceBelow - GAP - MARGIN) };
  }
  return { left, width, bottom: vh - anchor.top + GAP, maxHeight: Math.max(140, spaceAbove - GAP - MARGIN) };
}

// A small floating card, not a full-screen Drawer — explanations are quick reads, and the point
// of Help mode is exploring the page underneath, so nothing should dim or block it.
export function HelpPanel() {
  const { active, anchorRect, hide, lang, setLang } = useHelp();
  if (!active || !anchorRect) return null;

  return (
    <div className="help-panel" style={computeStyle(anchorRect)}>
      <div className="help-panel-head">
        <div className="help-panel-title">{active.title}</div>
        <button className="close-x" onClick={hide}><i className="fas fa-xmark" /></button>
      </div>
      <div className="help-panel-body">{lang === 'hi' ? active.hi : active.en}</div>
      <div className="help-lang-toggle">
        <button className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')}>English</button>
        <button className={lang === 'hi' ? 'active' : ''} onClick={() => setLang('hi')}>Hinglish</button>
      </div>
    </div>
  );
}
