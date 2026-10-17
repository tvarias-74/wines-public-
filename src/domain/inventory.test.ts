import { describe, expect, it } from 'vitest';
import { addPurchase } from './actions';
import { buildRows, computeStats, filterRows, forecastByYear, groupByProducer, purchaseEntries, purchasesByYear, stockOf, wineTitle } from './inventory';
import { add, drink, emptyData, NOW } from './helpers.test-util';
import type { CellarData } from './types';

function cellar(): { data: CellarData; ids: Record<string, string> } {
  let data = emptyData();
  const ids: Record<string, string> = {};
  const put = (key: string, input: Parameters<typeof add>[1], purchase?: Parameters<typeof add>[2]) => {
    const r = add(data, input, purchase);
    data = r.data;
    ids[key] = r.id;
  };
  put('bg18', { producer: 'Château Alpha', bottling: 'Grand Vin', year: 2018, country: 'France', region: 'Bordeaux', grapes: [{ grape: 'Merlot', percent: 70 }, { grape: 'Cabernet Franc', percent: 30 }], drinkFrom: 2024, drinkTo: 2035 }, { quantity: 6, unitPrice: 50, date: '2021-03-01' });
  put('bg16', { producer: 'Château Alpha', bottling: 'Grand Vin', year: 2016, country: 'France', drinkFrom: 2020, drinkTo: 2026 }, { quantity: 3, unitPrice: 40, date: '2019-04-01' });
  put('bs17', { producer: 'Château Alpha', bottling: 'Second Vin', year: 2017, country: 'France' }, { quantity: 12, date: '2020-01-01' });
  put('zeta', { producer: 'Zeta Wines', bottling: 'Riesling', colour: 'white', year: 2022, country: 'Germany', drinkFrom: 2030, drinkTo: 2040 }, { quantity: 4, unitPrice: 20, date: '2024-06-01' });
  put('nv', { producer: 'Émile Brut', bottling: 'Cuvée', colour: 'white', sparkling: true, year: null }, { quantity: 2, unitPrice: 35 });
  data = drink(data, ids.bg16!, 3); // finished
  data = drink(data, ids.bg18!, 1);
  return { data, ids };
}

describe('buildRows', () => {
  it('derives stock, spend and statuses from the ledger', () => {
    const { data, ids } = cellar();
    const rows = buildRows(data, NOW);
    const byId = new Map(rows.map((r) => [r.vintage.id, r]));
    expect(byId.get(ids.bg18!)).toMatchObject({ bottles: 5, purchased: 6, consumed: 1, spent: 300, avgPrice: 50, status: 'ready', firstPurchase: '2021-03-01' });
    expect(byId.get(ids.bg16!)).toMatchObject({ bottles: 0, status: 'soon' });
    expect(byId.get(ids.bs17!)).toMatchObject({ bottles: 12, avgPrice: null, status: 'unknown', spent: 0 });
    expect(byId.get(ids.zeta!)?.status).toBe('hold');
  });

  it('averages only over bottles with a known price', () => {
    let { data, ids } = cellar();
    const r = addPurchase(data, ids.bg18!, { quantity: 4 }); // unpriced gift
    if (!r.ok) throw new Error();
    data = r.data;
    const row = buildRows(data, NOW).find((x) => x.vintage.id === ids.bg18!)!;
    expect(row.bottles).toBe(9);
    expect(row.avgPrice).toBe(50);
    expect(row.pricedBottles).toBe(6);
  });

  it('never reports negative stock', () => {
    const { data, ids } = cellar();
    const broken = { ...data, purchases: data.purchases.filter((p) => p.vintageId !== ids.bg16!) };
    expect(buildRows(broken, NOW).find((r) => r.vintage.id === ids.bg16!)?.bottles).toBe(0);
    expect(stockOf(broken, ids.bg16!)).toBe(0);
  });
});

describe('groupByProducer', () => {
  it('rolls bottle counts up producer → bottling → vintage and sorts sensibly', () => {
    const { data } = cellar();
    const groups = groupByProducer(filterRows(buildRows(data, NOW), {}));
    // accents are ignored when sorting: "Château Alpha", "Émile Brut", "Zeta Wines"
    expect(groups.map((g) => g.producer.name)).toEqual(['Château Alpha', 'Émile Brut', 'Zeta Wines']);
    const alpha = groups[0]!;
    expect(alpha.bottles).toBe(5 + 12);
    expect(alpha.bottlings.map((b) => [b.bottling.name, b.bottles])).toEqual([['Grand Vin', 5], ['Second Vin', 12]]);
    expect(alpha.bottlings[0]!.rows.map((r) => r.vintage.year)).toEqual([2018]);
  });

  it('lists newest vintages first and non-vintage last when finished wines are included', () => {
    let { data } = cellar();
    ({ data } = add(data, { producer: 'Château Alpha', bottling: 'Grand Vin', year: null }, { quantity: 1 }));
    const g = groupByProducer(filterRows(buildRows(data, NOW), { includeFinished: true }))[0]!;
    expect(g.bottlings[0]!.rows.map((r) => r.vintage.year)).toEqual([2018, 2016, null]);
  });
});

describe('filterRows', () => {
  const rows = () => buildRows(cellar().data, NOW);
  it('hides finished wines unless asked', () => {
    expect(filterRows(rows(), {})).toHaveLength(4);
    expect(filterRows(rows(), { includeFinished: true })).toHaveLength(5);
  });
  it('searches producer, bottling, grapes and region, ignoring case and accents, requiring every word', () => {
    expect(filterRows(rows(), { query: 'chateau' })).toHaveLength(2);
    expect(filterRows(rows(), { query: 'emile' })).toHaveLength(1);
    expect(filterRows(rows(), { query: 'merlot' })).toHaveLength(1);
    expect(filterRows(rows(), { query: 'alpha second' })).toHaveLength(1);
    expect(filterRows(rows(), { query: 'bordeaux 2018' })).toHaveLength(1);
    expect(filterRows(rows(), { query: 'nonsense' })).toHaveLength(0);
  });
  it('filters by colour, still/sparkling, status and country', () => {
    expect(filterRows(rows(), { colour: 'white' })).toHaveLength(2);
    expect(filterRows(rows(), { fizz: 'sparkling' })).toHaveLength(1);
    expect(filterRows(rows(), { fizz: 'still' })).toHaveLength(3);
    expect(filterRows(rows(), { status: 'unknown' })).toHaveLength(2);
    expect(filterRows(rows(), { country: 'Germany' })).toHaveLength(1);
    expect(filterRows(rows(), { country: '__not_set__' })).toHaveLength(1);
  });
});

describe('computeStats', () => {
  it('counts bottles, cost basis and status buckets for wines in stock only', () => {
    const s = computeStats(buildRows(cellar().data, NOW));
    expect(s.bottles).toBe(5 + 12 + 4 + 2);
    expect(s.wines).toBe(4);
    expect(s.producers).toBe(3);
    // priced stock: 5×50 + 4×20 + 2×35 = 400; the 12 Second Vin have no price
    expect(s.costOfStock).toBe(400);
    expect(s.pricedBottles).toBe(11);
    expect(s.unpricedBottles).toBe(12);
    expect(s.byStatus).toMatchObject({ ready: 5, hold: 4, unknown: 14, soon: 0 });
    expect(s.byColour[0]).toMatchObject({ key: 'red', bottles: 17 });
    expect(s.byFizz).toEqual([{ key: 'still', label: 'Still', bottles: 21 }, { key: 'sparkling', label: 'Sparkling', bottles: 2 }]);
    expect(s.byCountry.find((c) => c.label === 'France')?.bottles).toBe(17);
    expect(s.byCountry.find((c) => c.label === 'Not set')?.bottles).toBe(2);
  });
});

describe('forecastByYear', () => {
  it('shows how the cellar matures if nothing is opened', () => {
    const f = forecastByYear(buildRows(cellar().data, NOW), 2026, 6, 1);
    expect(f.map((y) => y.year)).toEqual([2026, 2027, 2028, 2029, 2030, 2031]);
    expect(f[0]!.counts).toMatchObject({ ready: 5, hold: 4, unknown: 14 });
    expect(f[4]!.counts).toMatchObject({ ready: 9, hold: 0 }); // Riesling opens in 2030
    // every year accounts for every bottle in stock
    for (const y of f) expect(Object.values(y.counts).reduce((a, b) => a + b, 0)).toBe(23);
  });
});

describe('purchases', () => {
  it('lists newest first, undated last, and totals by year', () => {
    const { data } = cellar();
    const entries = purchaseEntries(data);
    expect(entries[0]!.purchase.date).toBe('2024-06-01');
    expect(entries[entries.length - 1]!.purchase.date).toBeUndefined();
    const years = purchasesByYear(entries);
    expect(years.map((y) => y.year)).toEqual([2024, 2021, 2020, 2019, null]);
    expect(years.find((y) => y.year === 2024)).toMatchObject({ bottles: 4, spent: 80, purchases: 1 });
    expect(years.find((y) => y.year === 2020)).toMatchObject({ bottles: 12, spent: 0, pricedBottles: 0 });
  });
});

describe('wineTitle', () => {
  it('names the wine, and the bottle size only when it is not standard', () => {
    const { data, ids } = cellar();
    const rows = buildRows(data, NOW);
    expect(wineTitle(rows.find((r) => r.vintage.id === ids.bg18!)!)).toBe('Château Alpha Grand Vin 2018');
    expect(wineTitle(rows.find((r) => r.vintage.id === ids.nv!)!)).toBe('Émile Brut Cuvée NV');
    const mag = add(data, { producer: 'Château Alpha', bottling: 'Grand Vin', year: 2018, sizeMl: 1500 }, { quantity: 1 });
    expect(wineTitle(buildRows(mag.data, NOW).find((r) => r.vintage.id === mag.id)!)).toBe('Château Alpha Grand Vin 2018 (Magnum)');
  });
});
