import { describe, expect, it } from 'vitest';
import { UNUSED_QUARANTINE_MS, planCleanup } from './images';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-17T12:00:00Z');

describe('photo cleanup plan', () => {
  it('never deletes a photo the first time it looks unused, it only starts the clock', () => {
    const plan = planCleanup([{ id: 'a' }, { id: 'b' }], new Set(), NOW);
    expect(plan).toEqual({ mark: ['a', 'b'], unmark: [], remove: [] });
  });

  it('keeps a photo through the whole quarantine, then deletes it', () => {
    const since = NOW - UNUSED_QUARANTINE_MS + DAY;
    expect(planCleanup([{ id: 'a', unusedSince: since }], new Set(), NOW).remove).toEqual([]);
    expect(planCleanup([{ id: 'a', unusedSince: since }], new Set(), NOW + 2 * DAY).remove).toEqual(['a']);
  });

  it('a wine using the photo again resets its clock', () => {
    const plan = planCleanup([{ id: 'a', unusedSince: NOW - 29 * DAY }, { id: 'b' }], new Set(['a', 'b']), NOW);
    expect(plan).toEqual({ mark: [], unmark: ['a'], remove: [] });
  });

  it('a restore or reload that briefly shows no photos in use cannot delete anything', () => {
    // every photo has been in use for a year, then one pass sees an empty cellar
    const all = ['a', 'b', 'c'].map((id) => ({ id }));
    const pass1 = planCleanup(all, new Set(), NOW);
    expect(pass1.remove).toEqual([]);
    // the real cellar is back before the quarantine ends: all clocks reset, nothing was lost
    const marked = all.map((i) => ({ ...i, unusedSince: NOW }));
    expect(planCleanup(marked, new Set(['a', 'b', 'c']), NOW + 5 * DAY)).toEqual({ mark: [], unmark: ['a', 'b', 'c'], remove: [] });
  });

  it('a clock in the future (the device date was changed) is restarted, not trusted', () => {
    expect(planCleanup([{ id: 'a', unusedSince: NOW + 400 * DAY }], new Set(), NOW)).toEqual({ mark: ['a'], unmark: [], remove: [] });
  });
});
