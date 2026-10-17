import { describe, expect, it } from 'vitest';
import { removeSampleData } from './actions';
import { buildRows, computeStats } from './inventory';
import { parseBackup, serializeBackup } from './portability';
import { buildSampleData } from './sample';
import { isKnownImpression } from './impressions';
import { emptyData, NOW } from './helpers.test-util';

describe('sample data', () => {
  const data = buildSampleData(emptyData());

  it('is a valid cellar document', () => {
    expect(parseBackup(serializeBackup(data, NOW)).ok).toBe(true);
  });

  it('never has more bottles drunk than bought, and everything is linked', () => {
    for (const r of buildRows(data, NOW)) expect(r.consumed, r.vintage.id).toBeLessThanOrEqual(r.purchased);
    expect(buildRows(data, NOW)).toHaveLength(data.vintages.length);
  });

  it('shows every drinking-window status so the demo is informative', () => {
    const s = computeStats(buildRows(data, NOW));
    for (const status of ['hold', 'ready', 'peak', 'soon', 'past', 'unknown'] as const) expect(s.byStatus[status], status).toBeGreaterThan(0);
    expect(s.bottles).toBeGreaterThan(50);
    expect(s.byColour.length).toBeGreaterThan(3);
  });

  it('uses only tasting words that exist in the table, and ratings in range', () => {
    const rated = data.consumptions.filter((c) => c.rating !== undefined);
    expect(rated.length).toBeGreaterThan(5);
    for (const c of data.consumptions) {
      for (const id of c.impressions ?? []) expect(isKnownImpression(id), id).toBe(true);
      if (c.rating !== undefined) expect(c.rating >= 1 && c.rating <= 20 && (c.rating * 2) % 1 === 0, String(c.rating)).toBe(true);
    }
  });

  it('shows an owner family spanning regions and countries, a colour of every kind and a review', () => {
    expect(data.groups.length).toBeGreaterThanOrEqual(3);
    const countriesOf = (groupId: string) => {
      const producers = data.producers.filter((p) => p.groupId === groupId).map((p) => p.id);
      return new Set(data.bottlings.filter((b) => producers.includes(b.producerId)).map((b) => b.country));
    };
    expect(data.groups.some((g) => countriesOf(g.id).size >= 2)).toBe(true);
    expect(new Set(data.bottlings.map((b) => b.colour))).toEqual(new Set(['red', 'white', 'rose', 'orange']));
    expect(data.bottlings.some((b) => b.sparkling)).toBe(true);
    expect(data.bottlings.some((b) => b.style === 'fortified')).toBe(true);
    expect(data.reviews.length).toBeGreaterThan(0);
    for (const r of data.reviews) expect(r.sourceName).toBe('Sample Wine Guide'); // never attributed to a real critic
  });

  it('removes completely, leaving an empty cellar', () => {
    const left = removeSampleData(data);
    expect(left.groups).toHaveLength(0);
    expect(left.locations).toHaveLength(0);
    expect(left.placements).toHaveLength(0);
    expect(left.reviews).toHaveLength(0);
    expect(left.producers).toHaveLength(0);
    expect(left.bottlings).toHaveLength(0);
    expect(left.vintages).toHaveLength(0);
    expect(left.purchases).toHaveLength(0);
    expect(left.consumptions).toHaveLength(0);
  });

  it('can be loaded on top of existing data without changing it', () => {
    const base = emptyData();
    buildSampleData(base);
    expect(base.vintages).toHaveLength(0);
  });
});
