import { BOTTLE_SIZES, STANDARD_BOTTLE_ML } from './types';

export function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // randomUUID only exists in secure contexts; plain-http LAN access still has to work.
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Case-, accent- and whitespace-insensitive form used for matching and search. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/ς/g, 'σ')
    .replace(/\s+/g, ' ')
    .trim();
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
export function compareText(a: string, b: string): number {
  return collator.compare(a, b);
}

/** Trimmed text, or undefined when empty. */
export function cleanText(s: string | undefined | null): string | undefined {
  const t = s?.trim();
  return t ? t : undefined;
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local calendar date as `YYYY-MM-DD` (not UTC, so "today" is the user's today). */
export function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

const DATE_RE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

/** Accepts `YYYY-MM-DD`, `YYYY-MM` or `YYYY`, and rejects impossible dates. */
export function isValidDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  if (y < 1800 || y > 2200) return false;
  if (m[2] === undefined) return true;
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return false;
  if (m[3] === undefined) return true;
  const d = Number(m[3]);
  return d >= 1 && d <= new Date(y, mo, 0).getDate();
}

export function yearOfDate(s: string): number {
  return Number(s.slice(0, 4));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(s: string | undefined | null): string {
  if (!s) return 'Date unknown';
  const m = DATE_RE.exec(s);
  if (!m) return s;
  if (m[2] === undefined) return m[1] ?? s;
  const month = MONTHS[Number(m[2]) - 1] ?? m[2];
  if (m[3] === undefined) return `${month} ${m[1]}`;
  return `${Number(m[3])} ${month} ${m[1]}`;
}

export function formatYear(year: number | null): string {
  return year === null ? 'NV' : String(year);
}

export function sizeLabel(ml: number): string {
  const known = BOTTLE_SIZES.find((s) => s.ml === ml);
  if (known) return known.label;
  return ml >= 1000 ? `${ml / 1000} L` : `${ml} ml`;
}

/** Only shown when it differs from a standard bottle. */
export function sizeBadge(ml: number): string | null {
  if (ml === STANDARD_BOTTLE_ML) return null;
  if (ml === 1500) return 'Magnum';
  if (ml === 375) return 'Half';
  return ml >= 1000 ? `${ml / 1000} L` : `${ml} ml`;
}

export function formatMoney(value: number, currency: string, maxFractionDigits = 2): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: maxFractionDigits,
    }).format(value);
  } catch {
    return `${value.toFixed(maxFractionDigits)} ${currency}`;
  }
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}
