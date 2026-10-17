import { describe, expect, it } from 'vitest';
import { parseBackup, serializeBackup, validateData } from './portability';
import { buildRows, placedOf, stockOf } from './inventory';
import { buildSampleData } from './sample';
import { emptyData, NOW } from './helpers.test-util';

/** A cellar exactly as the first version of the app stored it. */
function v1(): Record<string, unknown> {
  return {
    app: 'cellar-book',
    exportedAt: '2026-10-01T10:00:00.000Z',
    schema: 1,
    producers: [{ id: 'p1', name: 'Château Alpha' }, { id: 'p2', name: 'Maison Brut' }],
    bottlings: [
      { id: 'b1', producerId: 'p1', name: 'Grand Vin', type: 'red', country: 'France', grapes: [{ grape: 'Merlot', percent: 80 }] },
      { id: 'b2', producerId: 'p1', name: 'Blanc', type: 'white', grapes: [] },
      { id: 'b3', producerId: 'p1', name: 'Rosé', type: 'rose', grapes: [] },
      { id: 'b4', producerId: 'p1', name: 'Skin', type: 'orange', grapes: [] },
      { id: 'b5', producerId: 'p2', name: 'Brut', type: 'sparkling', grapes: [] },
      { id: 'b6', producerId: 'p2', name: 'Sauternes', type: 'sweet', grapes: [] },
      { id: 'b7', producerId: 'p2', name: 'Port', type: 'fortified', grapes: [] },
      { id: 'b8', producerId: 'p2', name: 'Mystery', type: 'other', grapes: [] },
    ],
    vintages: [
      { id: 'v1', bottlingId: 'b1', year: 2018, sizeMl: 750, drinkFrom: 2024, drinkTo: 2035, location: 'Rack A2', notes: 'n' },
      { id: 'v2', bottlingId: 'b1', year: 2019, sizeMl: 750, location: ' rack a2 ' },
      { id: 'v3', bottlingId: 'b2', year: 2020, sizeMl: 750, location: 'Fridge' },
      { id: 'v4', bottlingId: 'b3', year: 2021, sizeMl: 750 },
      { id: 'v5', bottlingId: 'b4', year: 2022, sizeMl: 750, location: 'Rack A2' },
      { id: 'v6', bottlingId: 'b5', year: null, sizeMl: 750 },
      { id: 'v7', bottlingId: 'b6', year: 2015, sizeMl: 375 },
      { id: 'v8', bottlingId: 'b7', year: 2016, sizeMl: 750 },
      { id: 'v9', bottlingId: 'b8', year: 2017, sizeMl: 750, location: 'Shelf 9' },
    ],
    purchases: [
      { id: 'u1', vintageId: 'v1', date: '2021-03-05', quantity: 6, unitPrice: 50 },
      { id: 'u2', vintageId: 'v2', quantity: 4 },
      { id: 'u3', vintageId: 'v3', quantity: 2 },
      { id: 'u4', vintageId: 'v4', quantity: 1 },
      { id: 'u5', vintageId: 'v5', quantity: 3 },
      { id: 'u6', vintageId: 'v6', quantity: 1 },
      { id: 'u7', vintageId: 'v7', quantity: 1 },
      { id: 'u8', vintageId: 'v8', quantity: 1 },
      { id: 'u9', vintageId: 'v9', quantity: 2 },
    ],
    consumptions: [
      { id: 'c1', vintageId: 'v1', date: '2025-01-01', quantity: 2, reason: 'drunk', notes: 'lovely' },
      { id: 'c2', vintageId: 'v9', date: '2025-01-01', quantity: 2, reason: 'drunk' }, // finished
    ],
    settings: { currency: 'USD', drinkSoonYears: 2 },
    meta: { lastBackupAt: '2026-09-01T00:00:00.000Z' },
  };
}

describe('upgrading a version-1 cellar', () => {
  const data = validateData(v1());
  const b = (id: string) => data.bottlings.find((x) => x.id === id)!;

  it('becomes a version-2 cellar with the new, empty parts', () => {
    expect(data.schema).toBe(3);
    expect(data.groups).toEqual([]);
    expect(data.reviews).toEqual([]);
    expect(data.settings).toMatchObject({ currency: 'USD', drinkSoonYears: 2, divisionCapacity: 15, customImpressions: [] });
    expect(data.meta.lastBackupAt).toBe('2026-09-01T00:00:00.000Z');
  });

  it('turns the single "type" into colour and still/sparkling, without guessing what v1 never knew', () => {
    expect(b('b1')).toMatchObject({ colour: 'red', sparkling: false });
    expect(b('b2')).toMatchObject({ colour: 'white', sparkling: false });
    expect(b('b3')).toMatchObject({ colour: 'rose', sparkling: false });
    expect(b('b4')).toMatchObject({ colour: 'orange', sparkling: false });
    expect(b('b5')).toMatchObject({ sparkling: true });
    expect(b('b5')).not.toHaveProperty('colour'); // v1 never recorded a sparkling wine's colour
    expect(b('b6')).toMatchObject({ style: 'sweet', sparkling: false });
    expect(b('b7')).toMatchObject({ style: 'fortified', sparkling: false });
    for (const id of ['b6', 'b7', 'b8']) expect(b(id)).not.toHaveProperty('colour');
    for (const x of data.bottlings) expect(x).not.toHaveProperty('type');
  });

  it('keeps everything else on the bottling', () => {
    expect(b('b1')).toMatchObject({ country: 'France', grapes: [{ grape: 'Merlot', percent: 80 }] });
  });

  it('turns the free-text location into a real place holding that vintage’s bottles', () => {
    const names = data.locations.map((l) => l.name);
    expect(names.sort()).toEqual(['Fridge', 'Rack A2', 'Shelf 9']); // "Rack A2" and " rack a2 " are one place
    expect(data.locations.every((l) => l.kind === 'other')).toBe(true);
    const rack = data.locations.find((l) => l.name === 'Rack A2')!;
    const at = (vid: string) => data.placements.filter((p) => p.vintageId === vid);
    expect(at('v1')).toEqual([expect.objectContaining({ locationId: rack.id, quantity: 4 })]); // 6 bought − 2 drunk
    expect(at('v2')).toEqual([expect.objectContaining({ locationId: rack.id, quantity: 4 })]);
    expect(at('v5')).toEqual([expect.objectContaining({ locationId: rack.id, quantity: 3 })]);
    expect(at('v3')[0]?.quantity).toBe(2);
    for (const v of data.vintages) expect(v).not.toHaveProperty('location');
  });

  it('makes no placement for wines with no bottles left, or with no location', () => {
    expect(data.placements.some((p) => p.vintageId === 'v9')).toBe(false); // finished
    expect(data.placements.some((p) => p.vintageId === 'v4')).toBe(false); // never had one
  });

  it('keeps every bottle, price and tasting note exactly as they were', () => {
    expect(stockOf(data, 'v1')).toBe(4);
    expect(stockOf(data, 'v9')).toBe(0);
    expect(data.consumptions[0]).toMatchObject({ notes: 'lovely', quantity: 2 });
    const rows = buildRows(data, NOW);
    expect(rows.find((r) => r.vintage.id === 'v1')).toMatchObject({ bottles: 4, avgPrice: 50, unplaced: 0 });
    expect(rows.every((r) => r.bottles === 0 || placedOf(data, r.vintage.id) <= r.bottles)).toBe(true);
  });

  it('is accepted from a file, and a second round trip changes nothing', () => {
    const parsed = parseBackup(JSON.stringify(v1()));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error();
    const again = parseBackup(serializeBackup(parsed.data, NOW));
    expect(again.ok && again.data).toEqual(parsed.data);
  });

  it('copes with junk instead of throwing', () => {
    const junk = { schema: 1, producers: 'oops', bottlings: [1, null, { type: 'red' }], vintages: {}, purchases: null, consumptions: undefined };
    expect(() => validateData(junk)).toThrow(); // rejected by the validator with a message…
    expect(parseBackup(JSON.stringify(junk)).ok).toBe(false); // …never an uncaught crash
  });
});

describe('the current version is rejected when it is inconsistent', () => {
  const good = () => JSON.parse(serializeBackup(buildSampleData(emptyData()), NOW));
  const bad = (mutate: (d: any) => void, why: RegExp) => {
    const d = good();
    mutate(d);
    const r = parseBackup(JSON.stringify(d));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(why);
  };

  it('accepts the demo cellar untouched', () => {
    expect(parseBackup(JSON.stringify(good())).ok).toBe(true);
  });
  it('rejects more bottles placed than owned', () => bad((d) => { d.placements[0].quantity += 500; }, /more bottles|can hold/));
  it('rejects a division over its capacity', () => {
    bad((d) => {
      const loc = d.locations.find((l: any) => l.kind === 'division' && l.capacity === 15);
      const p = d.placements.find((x: any) => x.locationId !== loc.id);
      p.locationId = loc.id;
      d.locations.find((l: any) => l.id === loc.id).capacity = 1;
    }, /can hold|more bottles/);
  });
  it('rejects the same wine placed twice in one place', () => bad((d) => { d.placements.push({ ...d.placements[0], id: 'dup' }); }, /same place|more bottles/));
  it('rejects placements that point at nothing', () => {
    bad((d) => { d.placements[0].locationId = 'nowhere'; }, /storage place/);
    bad((d) => { d.placements[0].vintageId = 'nowhere'; }, /wine that is not/);
  });
  it('rejects an unknown colour, style or kind', () => {
    bad((d) => { d.bottlings[0].colour = 'purple'; }, /colour/);
    bad((d) => { d.bottlings[0].style = 'foamy'; }, /style/);
    bad((d) => { d.locations[0].kind = 'attic'; }, /kind/);
  });
  it('rejects a winery that points at a missing group', () => bad((d) => { d.producers[0].groupId = 'ghost'; }, /owner group/));
  it('rejects a rating outside 1–20', () => {
    bad((d) => { d.consumptions.find((c: any) => c.rating).rating = 25; }, /rating/);
    bad((d) => { d.consumptions.find((c: any) => c.rating).rating = 0; }, /rating/);
  });
  it('rejects a review link that is not a web address, and a score outside its scale', () => {
    bad((d) => { d.reviews[0].url = 'javascript:alert(1)'; }, /web address/);
    bad((d) => { d.reviews[0].score = 250; }, /outside its scale/);
  });
  it('rejects quantities, prices, sizes and years that make no sense', () => {
    bad((d) => { d.purchases[0].quantity = -5; }, /whole number/);
    bad((d) => { d.purchases[0].quantity = 2.5; }, /whole number/);
    bad((d) => { d.purchases[0].unitPrice = -1; }, /negative price/);
    bad((d) => { d.vintages[0].sizeMl = 0; }, /bottle size/);
    bad((d) => { d.vintages[0].year = 99999.5; }, /year/);
    bad((d) => { d.vintages[0].drinkFrom = 2040; d.vintages[0].drinkTo = 2030; }, /impossible drinking window/);
  });
  it('rejects a consumption that does not make sense', () => {
    bad((d) => { d.consumptions[0].date = 'not a date'; }, /date/);
    bad((d) => { d.consumptions[0].quantity = 0; }, /whole number/);
    bad((d) => { d.consumptions[0].quantity = 500; }, /more bottles out|more bottles than/);
  });
  it('clamps absurd settings instead of trusting them', () => {
    const d = good();
    d.settings.drinkSoonYears = 1e9;
    d.settings.divisionCapacity = -4;
    const r = parseBackup(JSON.stringify(d));
    expect(r.ok && r.data.settings).toMatchObject({ drinkSoonYears: 5, divisionCapacity: 1 });
  });
  it('is not fooled by __proto__ in a file', () => {
    const r = parseBackup('{"schema":2,"__proto__":{"polluted":true},"groups":[],"producers":[],"bottlings":[],"vintages":[],"purchases":[],"consumptions":[],"locations":[],"placements":[],"reviews":[]}');
    expect(r.ok).toBe(true);
    expect(({} as any).polluted).toBeUndefined();
  });
});
