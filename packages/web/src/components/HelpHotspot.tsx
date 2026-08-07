import { useHelp } from '../context/HelpContext';

interface HelpHotspotProps {
  title: string;
  en: string;
  hi: string;
  // Absolute-positioned corner badge by default (needs a `position: relative` ancestor, e.g. a
  // .card/.kpi-card) — set for a table header, an inline label, or anywhere a floating badge
  // would overlap something instead.
  inline?: boolean;
}

// Renders nothing at all when Help mode is off (see HelpContext) — zero footprint on every page
// until someone actually turns it on. A plain <button>, not a wrapper around the annotated
// element, specifically so it never interferes with that element's own click behavior (e.g. a
// KPI card that navigates on click) — see the header comment on why an event-bubbling approach
// was rejected.
export function HelpHotspot({ title, en, hi, inline }: HelpHotspotProps) {
  const { enabled, show } = useHelp();
  if (!enabled) return null;

  return (
    <button
      type="button"
      className={inline ? 'help-hotspot-badge help-hotspot-inline' : 'help-hotspot-badge'}
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); show({ title, en, hi }); }}
      title="What is this?"
    >
      ?
    </button>
  );
}
