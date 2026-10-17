import { describe, expect, it } from 'vitest';
import { removeSampleData } from './actions';
import { buildRows, computeStats } from './inventory';
import { parseBackup, serializeBackup } from './portability';
import { buildSampleData } from './sample';
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
    expect(s.byType.length).toBeGreaterThan(3);
  });

  it('removes completely, leaving an empty cellar', () => {
    const left = removeSampleData(data);
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
