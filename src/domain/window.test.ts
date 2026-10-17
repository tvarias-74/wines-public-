import { describe, expect, it } from 'vitest';
import { describeStatus, formatWindow, presetWindow, validateWindow, WINDOW_PRESETS, windowStatus } from './window';

describe('windowStatus', () => {
  const w = { drinkFrom: 2024, drinkTo: 2032 };

  it('is unknown without any window', () => {
    expect(windowStatus({}, 2026)).toBe('unknown');
    // a peak alone is not a drinking window
    expect(windowStatus({ peakFrom: 2026, peakTo: 2028 }, 2026)).toBe('unknown');
  });

  it('walks through the lifecycle', () => {
    expect(windowStatus(w, 2023)).toBe('hold');
    expect(windowStatus(w, 2024)).toBe('ready');
    expect(windowStatus(w, 2030)).toBe('ready');
    expect(windowStatus(w, 2031)).toBe('soon');
    expect(windowStatus(w, 2032)).toBe('soon');
    expect(windowStatus(w, 2033)).toBe('past');
  });

  it('treats the last year of the window as still drinkable', () => {
    expect(windowStatus({ drinkFrom: 2020, drinkTo: 2026 }, 2026)).toBe('soon');
    expect(windowStatus({ drinkFrom: 2020, drinkTo: 2026 }, 2027)).toBe('past');
  });

  it('honours the drink-soon threshold', () => {
    const cfg = { drinkFrom: 2020, drinkTo: 2028 };
    expect(windowStatus(cfg, 2026, 1)).toBe('ready');
    expect(windowStatus(cfg, 2027, 1)).toBe('soon');
    expect(windowStatus(cfg, 2026, 2)).toBe('soon');
    expect(windowStatus(cfg, 2028, 0)).toBe('soon');
    expect(windowStatus(cfg, 2027, 0)).toBe('ready');
  });

  it('reports peak inside the peak range, but urgency beats peak', () => {
    const cfg = { drinkFrom: 2020, drinkTo: 2035, peakFrom: 2026, peakTo: 2030 };
    expect(windowStatus(cfg, 2025)).toBe('ready');
    expect(windowStatus(cfg, 2026)).toBe('peak');
    expect(windowStatus(cfg, 2030)).toBe('peak');
    expect(windowStatus(cfg, 2031)).toBe('ready');
    const closing = { drinkFrom: 2020, drinkTo: 2027, peakFrom: 2025, peakTo: 2027 };
    expect(windowStatus(closing, 2026)).toBe('soon');
  });

  it('copes with half-open windows', () => {
    expect(windowStatus({ drinkFrom: 2030 }, 2026)).toBe('hold');
    expect(windowStatus({ drinkFrom: 2020 }, 2040)).toBe('ready');
    expect(windowStatus({ drinkTo: 2030 }, 2010)).toBe('ready');
    expect(windowStatus({ drinkTo: 2030 }, 2031)).toBe('past');
  });
});

describe('validateWindow', () => {
  it('accepts sensible windows', () => {
    expect(validateWindow({})).toEqual({});
    expect(validateWindow({ drinkFrom: 2024, drinkTo: 2030, peakFrom: 2026, peakTo: 2028 })).toEqual({});
  });
  it('rejects reversed ranges, absurd years and peaks outside the window', () => {
    expect(validateWindow({ drinkFrom: 2030, drinkTo: 2024 }).drinkTo).toBeDefined();
    expect(validateWindow({ drinkFrom: 24 }).drinkFrom).toBeDefined();
    expect(validateWindow({ drinkFrom: 2024, drinkTo: 2030, peakFrom: 2020 }).peakFrom).toBeDefined();
    expect(validateWindow({ drinkFrom: 2024, drinkTo: 2030, peakTo: 2035 }).peakTo).toBeDefined();
    expect(validateWindow({ peakFrom: 2030, peakTo: 2027 }).peakTo).toBeDefined();
  });
});

describe('presets', () => {
  it('apply offsets from the vintage and always produce a valid window', () => {
    for (const p of WINDOW_PRESETS) {
      const w = presetWindow(p, 2018);
      expect(validateWindow(w)).toEqual({});
      expect(w.drinkFrom).toBe(2018 + p.from);
    }
    expect(presetWindow(WINDOW_PRESETS[0]!, 2020)).toEqual({ drinkFrom: 2020, drinkTo: 2023, peakFrom: 2020, peakTo: 2021 });
  });
  it('grow with aging potential', () => {
    const ends = WINDOW_PRESETS.map((p) => p.to);
    expect([...ends].sort((a, b) => a - b)).toEqual(ends);
  });
});

describe('formatting', () => {
  it('formats windows and statuses', () => {
    expect(formatWindow({ drinkFrom: 2024, drinkTo: 2030 })).toBe('2024–2030');
    expect(formatWindow({ drinkFrom: 2024 })).toBe('from 2024');
    expect(formatWindow({ drinkTo: 2030 })).toBe('until 2030');
    expect(formatWindow({})).toBe('Not set');
    const w = { drinkFrom: 2020, drinkTo: 2026 };
    expect(describeStatus(w, 'soon', 2026)).toBe('Closes this year');
    expect(describeStatus({ drinkFrom: 2027 }, 'hold', 2026)).toBe('Opens next year');
  });
});
