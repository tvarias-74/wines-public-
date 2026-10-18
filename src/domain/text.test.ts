import { describe, expect, it } from 'vitest';
import { formatDate, formatMoney, isValidDate, normalizeText, toIsoDate } from './text';

describe('formatMoney', () => {
  // Digits only, so the test holds in any device locale (€412.50, 412,50 €, …).
  const digits = (s: string) => s.replace(/[^\d.,]/g, '');
  it('keeps both decimals for fractional amounts and none for whole ones', () => {
    expect(digits(formatMoney(412.5, 'EUR'))).toMatch(/^412[.,]50$/);
    expect(digits(formatMoney(425, 'EUR'))).toBe('425');
    expect(digits(formatMoney(0.5, 'EUR'))).toMatch(/^0[.,]50$/);
  });
  it('rounds to whole units when asked for no decimals', () => {
    expect(digits(formatMoney(2475.4, 'EUR', 0))).toMatch(/^2[.,\s]?475$/);
  });
  it('survives an unknown currency code', () => {
    expect(formatMoney(5, 'XXXX')).toContain('XXXX');
  });
});

describe('dates', () => {
  it('validates full, month and year dates and rejects impossible ones', () => {
    for (const ok of ['2024-02-29', '2024-12', '1999']) expect(isValidDate(ok), ok).toBe(true);
    for (const bad of ['2023-02-29', '2024-13', '2024-00-10', '24', '2024-1-1', '', 'abc', '1700']) expect(isValidDate(bad), bad).toBe(false);
  });
  it('formats partial dates as precisely as they are known', () => {
    expect(formatDate('2024-03-05')).toBe('5 Mar 2024');
    expect(formatDate('2024-03')).toBe('Mar 2024');
    expect(formatDate('2024')).toBe('2024');
    expect(formatDate(undefined)).toBe('Date unknown');
  });
  it('writes the local calendar date, not the UTC one', () => {
    expect(toIsoDate(new Date(2026, 0, 1, 0, 30))).toBe('2026-01-01');
    expect(toIsoDate(new Date(2026, 11, 31, 23, 30))).toBe('2026-12-31');
  });
});

describe('normalizeText', () => {
  it('ignores case, accents, Greek final sigma and extra whitespace', () => {
    expect(normalizeText('  Château   Léoville ')).toBe('chateau leoville');
    expect(normalizeText('ΜΠΟΥΤΑΡΗΣ')).toBe(normalizeText('Μπουταρής'));
    expect(normalizeText('Müller-Thurgau')).toBe('muller-thurgau');
  });
});
