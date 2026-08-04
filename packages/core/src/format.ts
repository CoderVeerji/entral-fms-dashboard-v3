// Ported 1:1 from app/Code.gs's humanDelay_/minutesToDelayObj_.

export function humanDelay(mins: number | null | undefined): string | null {
  if (mins == null) return null;
  const m = Math.round(Math.max(0, mins));
  if (m < 60) return m + 'm';
  if (m < 1440) return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
  return Math.floor(m / 1440) + 'd ' + Math.floor((m % 1440) / 60) + 'h';
}

export interface DelayObj {
  minutes: number;
  hours: number;
  days: number;
  human: string | null;
}

export function minutesToDelayObj(mins: number | null | undefined): DelayObj | null {
  if (mins === null || mins === undefined || Number.isNaN(mins)) return null;
  const m = Math.max(0, mins);
  return {
    minutes: Math.round(m),
    hours: Math.round((m / 60) * 10) / 10,
    days: Math.round((m / 1440) * 10) / 10,
    human: humanDelay(m),
  };
}
