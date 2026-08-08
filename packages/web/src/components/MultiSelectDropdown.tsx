import { useState } from 'react';

export interface MultiSelectOption { value: string; label: string }

interface MultiSelectDropdownProps {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
}

// Checkbox-panel dropdown for "pick 2-3 at once" filters (FMS, doer) that a plain single-select
// <select> can't do. Closes via a full-viewport transparent backdrop onMouseDown — same
// click-outside convention Modal.tsx already uses, so no new hook is needed for this.
export function MultiSelectDropdown({ options, selected, onChange, placeholder }: MultiSelectDropdownProps) {
  const [open, setOpen] = useState(false);

  const buttonLabel = selected.length === 0 ? placeholder
    : selected.length === 1 ? (options.find((o) => o.value === selected[0])?.label ?? selected[0])
    : `${selected.length} selected`;

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  }

  return (
    <div className="multiselect">
      <button type="button" className="multiselect-btn" onClick={() => setOpen((o) => !o)}>
        <span>{buttonLabel}</span>
        <i className={'fas fa-chevron-' + (open ? 'up' : 'down')} />
      </button>
      {open && (
        <>
          <div className="multiselect-backdrop" onMouseDown={() => setOpen(false)} />
          <div className="multiselect-panel">
            <div className="multiselect-panel-actions">
              <button type="button" onClick={() => onChange(options.map((o) => o.value))}>Select All</button>
              <button type="button" onClick={() => onChange([])}>Clear</button>
            </div>
            <div className="multiselect-panel-options">
              {options.map((o) => (
                <label key={o.value} className="multiselect-option">
                  <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
                  {o.label}
                </label>
              ))}
              {options.length === 0 && <div className="multiselect-empty">No options</div>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
