import { describe, expect, it } from 'vitest';
import {
  addConsumption, addPurchase, addWine, deleteConsumption, deletePurchase, deleteWine, hasSampleData,
  removeSampleData, updatePurchase, updateSettings, updateWine,
} from './actions';
import { buildRows, stockOf } from './inventory';
import { buildSampleData } from './sample';
import { add, drink, emptyData, NOW, wine } from './helpers.test-util';

describe('addWine', () => {
  it('creates producer, bottling, vintage and purchase', () => {
    const { data } = add(emptyData(), { grapes: [{ grape: 'Merlot', percent: 80 }, { grape: 'Cabernet Franc', percent: 20 }] }, { quantity: 6, unitPrice: 50, date: '2024-05-01' });
    expect(data.producers).toHaveLength(1);
    expect(data.bottlings).toHaveLength(1);
    expect(data.vintages).toHaveLength(1);
    expect(data.purchases).toEqual([expect.objectContaining({ quantity: 6, unitPrice: 50, date: '2024-05-01' })]);
    expect(data.bottlings[0]?.grapes).toHaveLength(2);
  });

  it('matches producers, bottlings and vintages ignoring case and accents, and adds to the existing vintage', () => {
    let { data, id } = add(emptyData(), {}, { quantity: 6, unitPrice: 50 });
    const second = addWine(data, wine({ producer: '  chateau TEST ', bottling: 'grand vin' }), { quantity: 3, unitPrice: 60 }, NOW);
    expect(second.ok && second.merged).toBe(true);
    if (!second.ok) throw new Error();
    data = second.data;
    expect(second.vintageId).toBe(id);
    expect(data.producers).toHaveLength(1);
    expect(data.vintages).toHaveLength(1);
    expect(stockOf(data, id)).toBe(9);
    expect(buildRows(data, NOW)[0]?.avgPrice).toBeCloseTo((6 * 50 + 3 * 60) / 9);
  });

  it('treats a different year or bottle size as a different vintage of the same bottling', () => {
    let { data } = add(emptyData(), { year: 2018 }, { quantity: 1 });
    ({ data } = add(data, { year: 2019 }, { quantity: 1 }));
    ({ data } = add(data, { year: 2019, sizeMl: 1500 }, { quantity: 1 }));
    expect(data.bottlings).toHaveLength(1);
    expect(data.vintages).toHaveLength(3);
  });

  it('keeps known bottling details when a later entry leaves them blank, but never overwrites an existing window', () => {
    let { data } = add(emptyData(), { region: 'Pauillac', drinkFrom: 2025, drinkTo: 2035 }, { quantity: 1 });
    ({ data } = add(data, { year: 2018, region: undefined, drinkFrom: 2030, drinkTo: 2040 }, { quantity: 1 }));
    expect(data.bottlings[0]?.region).toBe('Pauillac');
    expect(data.vintages[0]?.drinkFrom).toBe(2025);
  });

  it('rejects invalid input with per-field errors', () => {
    const r = addWine(emptyData(), wine({ producer: ' ', bottling: '', year: 1500, sizeMl: 0, drinkFrom: 2030, drinkTo: 2020 }), { quantity: 0 }, NOW);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error();
    expect(Object.keys(r.fieldErrors ?? {})).toEqual(expect.arrayContaining(['producer', 'bottling', 'year', 'sizeMl', 'drinkTo', 'purchase.quantity']));
  });

  it('rejects grape shares that add up to more than 100', () => {
    const r = addWine(emptyData(), wine({ grapes: [{ grape: 'A', percent: 70 }, { grape: 'B', percent: 50 }] }), undefined, NOW);
    expect(r.ok).toBe(false);
  });

  it('allows non-vintage wines and wines with no purchase', () => {
    const { data } = add(emptyData(), { year: null });
    expect(data.vintages[0]?.year).toBeNull();
    expect(data.purchases).toHaveLength(0);
  });

  it('tags the window as manual unless told otherwise, and omits it when absent', () => {
    expect(add(emptyData(), { drinkFrom: 2025, drinkTo: 2030 }).data.vintages[0]?.windowSource).toBe('manual');
    expect(add(emptyData(), { drinkFrom: 2025, drinkTo: 2030, windowSource: 'estimate' }).data.vintages[0]?.windowSource).toBe('estimate');
    expect(add(emptyData(), {}).data.vintages[0]).not.toHaveProperty('windowSource');
  });
});

describe('updateWine', () => {
  it('edits vintage fields in place', () => {
    const { data, id } = add(emptyData(), {}, { quantity: 6 });
    const r = updateWine(data, id, wine({ drinkFrom: 2025, drinkTo: 2035, location: 'Rack 1', year: 2018 }), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error();
    expect(r.data.vintages[0]).toMatchObject({ drinkFrom: 2025, drinkTo: 2035, location: 'Rack 1' });
  });

  it('shares bottling-level changes (type, grapes, region) across vintages and can clear them', () => {
    let { data, id } = add(emptyData(), { year: 2018, region: 'Bordeaux', grapes: [{ grape: 'Merlot' }] }, { quantity: 1 });
    ({ data } = add(data, { year: 2019 }, { quantity: 1 }));
    const r = updateWine(data, id, wine({ year: 2018, region: undefined, grapes: [{ grape: 'Cabernet Sauvignon', percent: 100 }], type: 'white' }), NOW);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.bottlings).toHaveLength(1);
    expect(r.data.bottlings[0]).toMatchObject({ type: 'white' });
    expect(r.data.bottlings[0]?.region).toBeUndefined();
    expect(r.data.bottlings[0]?.grapes).toEqual([{ grape: 'Cabernet Sauvignon', percent: 100 }]);
  });

  it('moves a single vintage when the producer or bottling name changes, and prunes what is left empty', () => {
    const a = add(emptyData(), { producer: 'Chateau Typo', year: 2018 }, { quantity: 6 });
    const r = updateWine(a.data, a.id, wine({ producer: 'Château Correct', year: 2018 }), NOW);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.producers.map((p) => p.name)).toEqual(['Château Correct']);
    expect(r.data.vintages).toHaveLength(1);
    expect(r.data.purchases).toHaveLength(1);
    expect(stockOf(r.data, a.id)).toBe(6);
  });

  it('merges into an existing bottling when moving', () => {
    let { data, id } = add(emptyData(), { bottling: 'Second Vin', year: 2018 }, { quantity: 1 });
    ({ data } = add(data, { bottling: 'Grand Vin', year: 2019 }, { quantity: 1 }));
    const r = updateWine(data, id, wine({ bottling: 'Grand Vin', year: 2018 }), NOW);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.bottlings).toHaveLength(1);
    expect(r.data.vintages).toHaveLength(2);
  });

  it('refuses to create a duplicate of another vintage', () => {
    let { data, id } = add(emptyData(), { year: 2018 }, { quantity: 1 });
    ({ data } = add(data, { year: 2019 }, { quantity: 1 }));
    const r = updateWine(data, id, wine({ year: 2019 }), NOW);
    expect(r.ok).toBe(false);
  });

  it('fails cleanly for an unknown wine', () => {
    expect(updateWine(emptyData(), 'nope', wine(), NOW).ok).toBe(false);
  });
});

describe('deleteWine', () => {
  it('removes the wine, its ledger and any bottling/producer left empty', () => {
    let { data, id } = add(emptyData(), { year: 2018 }, { quantity: 6 });
    data = drink(data, id, 2);
    const other = add(data, { year: 2019 }, { quantity: 1 });
    const afterOne = deleteWine(other.data, id);
    expect(afterOne.vintages).toHaveLength(1);
    expect(afterOne.purchases).toHaveLength(1);
    expect(afterOne.consumptions).toHaveLength(0);
    expect(afterOne.bottlings).toHaveLength(1);
    const afterAll = deleteWine(afterOne, other.id);
    expect(afterAll.producers).toHaveLength(0);
    expect(afterAll.bottlings).toHaveLength(0);
  });
});

describe('purchases', () => {
  it('adds, edits and removes purchases', () => {
    const { data, id } = add(emptyData(), {}, { quantity: 6, unitPrice: 50 });
    const added = addPurchase(data, id, { quantity: 2, unitPrice: 55, date: '2025-01-01' });
    if (!added.ok) throw new Error(added.error);
    expect(stockOf(added.data, id)).toBe(8);
    const pid = added.data.purchases[1]!.id;
    const edited = updatePurchase(added.data, pid, { quantity: 4, unitPrice: 56 });
    if (!edited.ok) throw new Error(edited.error);
    expect(stockOf(edited.data, id)).toBe(10);
    const removed = deletePurchase(edited.data, pid);
    if (!removed.ok) throw new Error(removed.error);
    expect(stockOf(removed.data, id)).toBe(6);
  });

  it('will not let stock go negative by editing or deleting a purchase that bottles were drunk from', () => {
    let { data, id } = add(emptyData(), {}, { quantity: 6 });
    data = drink(data, id, 5);
    const pid = data.purchases[0]!.id;
    expect(updatePurchase(data, pid, { quantity: 4 }).ok).toBe(false);
    expect(updatePurchase(data, pid, { quantity: 5 }).ok).toBe(true);
    expect(deletePurchase(data, pid).ok).toBe(false);
  });

  it('validates prices, quantities and dates', () => {
    const { data, id } = add(emptyData(), {}, { quantity: 1 });
    expect(addPurchase(data, id, { quantity: 1.5 }).ok).toBe(false);
    expect(addPurchase(data, id, { quantity: 1, unitPrice: -1 }).ok).toBe(false);
    expect(addPurchase(data, id, { quantity: 1, date: '2024-02-30' }).ok).toBe(false);
    expect(addPurchase(data, id, { quantity: 1, date: '2024' }).ok).toBe(true);
    expect(addPurchase(data, 'missing', { quantity: 1 }).ok).toBe(false);
  });
});

describe('consumption', () => {
  it('reduces stock and can be undone', () => {
    const { data, id } = add(emptyData(), {}, { quantity: 3 });
    const r = addConsumption(data, id, { date: '2026-03-01', quantity: 2, reason: 'drunk', notes: '  lovely ' });
    if (!r.ok) throw new Error(r.error);
    expect(stockOf(r.data, id)).toBe(1);
    expect(r.data.consumptions[0]?.notes).toBe('lovely');
    expect(stockOf(deleteConsumption(r.data, r.consumptionId), id)).toBe(3);
  });

  it('cannot take out more bottles than are left', () => {
    const { data, id } = add(emptyData(), {}, { quantity: 2 });
    expect(addConsumption(data, id, { date: '2026-03-01', quantity: 3, reason: 'drunk' }).ok).toBe(false);
    expect(addConsumption(data, id, { date: '2026-03-01', quantity: 0, reason: 'drunk' }).ok).toBe(false);
    expect(addConsumption(data, id, { date: 'yesterday', quantity: 1, reason: 'drunk' }).ok).toBe(false);
  });
});

describe('settings and sample data', () => {
  it('clamps settings', () => {
    const d = emptyData();
    expect(updateSettings(d, { drinkSoonYears: 99 }).settings.drinkSoonYears).toBe(5);
    expect(updateSettings(d, { drinkSoonYears: -3 }).settings.drinkSoonYears).toBe(0);
    expect(updateSettings(d, { currency: 'nonsense' }).settings.currency).toBe('EUR');
    expect(updateSettings(d, { currency: 'USD' }).settings.currency).toBe('USD');
  });

  it('removes only the demo wines', () => {
    let data = buildSampleData(emptyData());
    expect(hasSampleData(data)).toBe(true);
    const mine = add(data, { producer: 'My Own Producer', bottling: 'Cuvée', year: 2020 }, { quantity: 4 });
    // A real wine filed under a demo bottling must survive removal of the demo data.
    const underSample = add(mine.data, { producer: 'Château Belle-Rive', bottling: 'Grand Cru Classé', year: 2022 }, { quantity: 2 });
    data = removeSampleData(underSample.data);
    expect(hasSampleData(data)).toBe(false);
    expect(data.vintages).toHaveLength(2);
    expect(stockOf(data, mine.id)).toBe(4);
    expect(stockOf(data, underSample.id)).toBe(2);
    expect(data.producers.map((p) => p.name).sort()).toEqual(['Château Belle-Rive', 'My Own Producer']);
  });
});
