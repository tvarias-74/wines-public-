import type { Vintage } from './types';

/**
 * A drinking window is expressed in whole calendar years, both ends inclusive:
 * `2024–2030` means "from 1 Jan 2024 until 31 Dec 2030". It's deliberately coarse —
 * nobody knows a wine's window to the month.
 */
export interface DrinkWindow {
  drinkFrom?: number;
  drinkTo?: number;
  peakFrom?: number;
  peakTo?: number;
}

export type WindowStatus = 'unknown' | 'hold' | 'ready' | 'peak' | 'soon' | 'past';

/** Chronological order of the lifecycle, used for legends and sorting. */
export const STATUS_ORDER: WindowStatus[] = ['hold', 'ready', 'peak', 'soon', 'past', 'unknown'];

export const STATUS_LABEL: Record<WindowStatus, string> = {
  hold: 'Not ready yet',
  ready: 'Ready',
  peak: 'At peak',
  soon: 'Drink soon',
  past: 'Past its window',
  unknown: 'No window set',
};

export const STATUS_SHORT: Record<WindowStatus, string> = {
  hold: 'Hold',
  ready: 'Ready',
  peak: 'Peak',
  soon: 'Drink soon',
  past: 'Past',
  unknown: 'No window',
};

export function windowOf(v: Vintage): DrinkWindow {
  return { drinkFrom: v.drinkFrom, drinkTo: v.drinkTo, peakFrom: v.peakFrom, peakTo: v.peakTo };
}

export function hasWindow(w: DrinkWindow): boolean {
  return w.drinkFrom !== undefined || w.drinkTo !== undefined;
}

/**
 * Where is a wine in its life in a given calendar year?
 *
 * Urgency wins over praise: a wine at peak whose window closes within
 * `soonYears` is reported as "soon", because that's the one you need to act on.
 */
export function windowStatus(w: DrinkWindow, year: number, soonYears = 1): WindowStatus {
  const { drinkFrom: from, drinkTo: to, peakFrom, peakTo } = w;
  if (from === undefined && to === undefined) return 'unknown';
  if (from !== undefined && year < from) return 'hold';
  if (to !== undefined && year > to) return 'past';
  if (to !== undefined && to - year <= soonYears) return 'soon';
  if (peakFrom !== undefined || peakTo !== undefined) {
    const pf = peakFrom ?? from ?? Number.NEGATIVE_INFINITY;
    const pt = peakTo ?? to ?? Number.POSITIVE_INFINITY;
    if (year >= pf && year <= pt) return 'peak';
  }
  return 'ready';
}

export function formatWindow(w: DrinkWindow): string {
  const { drinkFrom: from, drinkTo: to } = w;
  if (from !== undefined && to !== undefined) return from === to ? `${from}` : `${from}–${to}`;
  if (from !== undefined) return `from ${from}`;
  if (to !== undefined) return `until ${to}`;
  return 'Not set';
}

export function formatPeak(w: DrinkWindow): string | null {
  const { peakFrom: from, peakTo: to } = w;
  if (from !== undefined && to !== undefined) return from === to ? `${from}` : `${from}–${to}`;
  if (from !== undefined) return `from ${from}`;
  if (to !== undefined) return `until ${to}`;
  return null;
}

/** One-line, human description of where a wine stands, e.g. "Closes in 2027". */
export function describeStatus(w: DrinkWindow, status: WindowStatus, year: number): string {
  const { drinkFrom: from, drinkTo: to } = w;
  switch (status) {
    case 'hold':
      return from !== undefined ? (from - year === 1 ? 'Opens next year' : `Opens in ${from}`) : '';
    case 'past':
      return to !== undefined ? `Closed in ${to}` : '';
    case 'soon':
      return to === undefined ? '' : to === year ? 'Closes this year' : to - year === 1 ? 'Closes next year' : `Closes in ${to}`;
    case 'peak':
    case 'ready':
      return to !== undefined ? `Through ${to}` : 'No end date';
    default:
      return '';
  }
}

const YEAR_MIN = 1800;
const YEAR_MAX = 2300;

function validYear(n: number | undefined): boolean {
  return n === undefined || (Number.isInteger(n) && n >= YEAR_MIN && n <= YEAR_MAX);
}

/** Returns an error message per offending field; empty when the window is fine. */
export function validateWindow(w: DrinkWindow): Partial<Record<keyof DrinkWindow, string>> {
  const errors: Partial<Record<keyof DrinkWindow, string>> = {};
  const { drinkFrom: from, drinkTo: to, peakFrom, peakTo } = w;
  (['drinkFrom', 'drinkTo', 'peakFrom', 'peakTo'] as const).forEach((k) => {
    if (!validYear(w[k])) errors[k] = `Enter a year between ${YEAR_MIN} and ${YEAR_MAX}`;
  });
  if (!errors.drinkTo && from !== undefined && to !== undefined && from > to) errors.drinkTo = 'Must not be before the start year';
  if (!errors.peakTo && peakFrom !== undefined && peakTo !== undefined && peakFrom > peakTo) errors.peakTo = 'Must not be before the peak start';
  if (!errors.peakFrom && peakFrom !== undefined && from !== undefined && peakFrom < from) errors.peakFrom = 'Peak must fall inside the window';
  if (!errors.peakTo && peakTo !== undefined && to !== undefined && peakTo > to) errors.peakTo = 'Peak must fall inside the window';
  return errors;
}

/**
 * Rule-of-thumb windows by "aging potential". These are estimates, not
 * tasting advice: they exist so a freshly entered wine gets *something*
 * sensible to edit, and they are always flagged as estimates in the UI.
 */
export interface WindowPreset {
  id: string;
  label: string;
  hint: string;
  /** Offsets in years from the vintage. */
  from: number;
  to: number;
  peakFrom: number;
  peakTo: number;
}

export const WINDOW_PRESETS: WindowPreset[] = [
  { id: 'fresh', label: 'Drink young', hint: 'Fresh whites, rosé, light reds, most non-vintage sparkling', from: 0, to: 3, peakFrom: 0, peakTo: 1 },
  { id: 'medium', label: 'Mid-term', hint: 'Good whites, everyday and mid-weight reds', from: 2, to: 8, peakFrom: 3, peakTo: 6 },
  { id: 'structured', label: 'Structured', hint: 'Serious reds, vintage sparkling, top whites', from: 5, to: 15, peakFrom: 8, peakTo: 12 },
  { id: 'ageworthy', label: 'Age-worthy', hint: 'Classed growths, Barolo, fine Burgundy', from: 10, to: 30, peakFrom: 15, peakTo: 25 },
  { id: 'longlived', label: 'Very long-lived', hint: 'Vintage port, Sauternes, top Riesling', from: 15, to: 50, peakFrom: 25, peakTo: 40 },
];

/** `baseYear` is the vintage, or the current year for non-vintage wines. */
export function presetWindow(preset: WindowPreset, baseYear: number): Required<DrinkWindow> {
  return {
    drinkFrom: baseYear + preset.from,
    drinkTo: baseYear + preset.to,
    peakFrom: baseYear + preset.peakFrom,
    peakTo: baseYear + preset.peakTo,
  };
}
