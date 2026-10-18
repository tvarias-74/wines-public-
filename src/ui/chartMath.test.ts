import { describe, expect, it } from 'vitest';
import { compactNumber, niceScale } from './chartMath';

describe('niceScale', () => {
  it('rounds the maximum up to a clean tick and always includes zero', () => {
    expect(niceScale(0)).toEqual({ max: 1, ticks: [0, 1] });
    expect(niceScale(2)).toEqual({ max: 2, ticks: [0, 1, 2] });
    expect(niceScale(5)).toEqual({ max: 6, ticks: [0, 2, 4, 6] });
    expect(niceScale(23)).toEqual({ max: 30, ticks: [0, 10, 20, 30] });
    expect(niceScale(87).ticks).toEqual([0, 50, 100]);
    expect(niceScale(1234).max).toBeGreaterThanOrEqual(1234);
  });
  it('never yields more than a handful of ticks and always covers the data', () => {
    for (const m of [1, 3, 7, 11, 40, 99, 100, 101, 640, 5000, 123456]) {
      const s = niceScale(m);
      expect(s.max).toBeGreaterThanOrEqual(m);
      expect(s.ticks.length).toBeLessThanOrEqual(6);
      expect(s.ticks[s.ticks.length - 1]).toBe(s.max);
    }
  });
});

describe('compactNumber', () => {
  it('abbreviates thousands and millions', () => {
    expect(compactNumber(0)).toBe('0');
    expect(compactNumber(999)).toBe('999');
    expect(compactNumber(1000)).toBe('1K');
    expect(compactNumber(2500)).toBe('2.5K');
    expect(compactNumber(1_200_000)).toBe('1.2M');
  });
});
