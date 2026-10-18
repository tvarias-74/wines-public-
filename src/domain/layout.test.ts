import { describe, expect, it } from 'vitest';
import {
  addConsumption, addPurchase, addWine, createDivisions, deleteConsumption, deleteLocation, deletePurchase, deleteWine, moveBottles,
  placeBottles, prune, removeSampleData, suggestPlacement, unplaceBottles, updateLocation, updatePurchase,
} from './actions';
import { buildRows, computeStats, filterRows, locationFills, occupancyOf, placedOf, stockOf } from './inventory';
import { buildSampleData } from './sample';
import { add, drink, emptyData, locId, NOW, place, wine, withDivisions, withLocation } from './helpers.test-util';

describe('createDivisions', () => {
  it('makes numbered divisions of the right size and skips ones that exist', () => {
    const first = createDivisions(emptyData(), { from: 1, to: 50, capacity: 15 });
    if (!first.ok) throw new Error(first.error);
    expect(first.created).toBe(50);
    expect(first.data.locations[0]).toMatchObject({ name: 'Division 1', kind: 'division', capacity: 15 });
    const again = createDivisions(first.data, { from: 45, to: 55, capacity: 15 });
    if (!again.ok) throw new Error(again.error);
    expect(again.created).toBe(5); // 51–55 only
    expect(again.data.locations).toHaveLength(55);
  });
  it('refuses nonsense ranges and capacities', () => {
    expect(createDivisions(emptyData(), { from: 0, to: 5, capacity: 15 }).ok).toBe(false);
    expect(createDivisions(emptyData(), { from: 5, to: 2, capacity: 15 }).ok).toBe(false);
    expect(createDivisions(emptyData(), { from: 1, to: 9999, capacity: 15 }).ok).toBe(false);
    expect(createDivisions(emptyData(), { from: 1, to: 5, capacity: 0 }).ok).toBe(false);
  });
});

describe('placing bottles', () => {
  it('places bottles you own, up to what is not placed yet', () => {
    let { data, id } = add(withDivisions(emptyData()), {}, { quantity: 6 });
    data = place(data, id, 'Division 1', 4);
    expect(placedOf(data, id)).toBe(4);
    expect(placeBottles(data, id, locId(data, 'Division 2'), 3).ok).toBe(false); // only 2 left to place
    data = place(data, id, 'Division 2', 2);
    expect(placedOf(data, id)).toBe(6);
    const r = placeBottles(data, id, locId(data, 'Division 3'), 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/already have a place/);
  });

  it('merges repeat placements into one row per wine and place', () => {
    let { data, id } = add(withDivisions(emptyData()), {}, { quantity: 6 });
    data = place(place(data, id, 'Division 1', 2), id, 'Division 1', 3);
    expect(data.placements).toHaveLength(1);
    expect(data.placements[0]?.quantity).toBe(5);
  });

  it('never exceeds a division’s capacity, and says how much room is left', () => {
    let { data, id } = add(withDivisions(emptyData(), 2, 15), {}, { quantity: 20 });
    data = place(data, id, 'Division 1', 12);
    const r = placeBottles(data, id, locId(data, 'Division 1'), 4);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/room for 3 more/);
    expect(occupancyOf(data, locId(data, 'Division 1'))).toBe(12);
  });

  it('fills a division to exactly its capacity, and no further', () => {
    let { data, id } = add(withDivisions(emptyData(), 1, 15), {}, { quantity: 16 });
    data = place(data, id, 'Division 1', 15);
    expect(locationFills(data)[0]).toMatchObject({ used: 15, free: 0, full: true, fill: 1 });
    expect(placeBottles(data, id, locId(data, 'Division 1'), 1).ok).toBe(false);
  });

  it('floor boxes with no capacity hold anything', () => {
    let { data, id } = add(emptyData(), {}, { quantity: 40 });
    const box = withLocation(data, { name: 'Big wooden box', kind: 'box', material: 'wooden' });
    data = placeBottles(box.data, id, box.id, 40).ok ? (placeBottles(box.data, id, box.id, 40) as { data: typeof data }).data : box.data;
    expect(placedOf(data, id)).toBe(40);
    expect(locationFills(data)[0]).toMatchObject({ free: Number.POSITIVE_INFINITY, full: false });
  });

  it('rejects unknown wines and places, and non-whole numbers', () => {
    const { data, id } = add(withDivisions(emptyData()), {}, { quantity: 2 });
    expect(placeBottles(data, 'nope', locId(data, 'Division 1'), 1).ok).toBe(false);
    expect(placeBottles(data, id, 'nope', 1).ok).toBe(false);
    expect(placeBottles(data, id, locId(data, 'Division 1'), 1.5).ok).toBe(false);
    expect(placeBottles(data, id, locId(data, 'Division 1'), 0).ok).toBe(false);
  });
});

describe('moving and unplacing', () => {
  it('moves some or all of the bottles, respecting capacity at the destination', () => {
    let { data, id } = add(withDivisions(emptyData(), 3, 15), {}, { quantity: 10 });
    data = place(data, id, 'Division 1', 10);
    const moved = moveBottles(data, id, locId(data, 'Division 1'), locId(data, 'Division 2'), 4);
    if (!moved.ok) throw new Error(moved.error);
    expect(moved.data.placements.map((p) => p.quantity).sort()).toEqual([4, 6]);
    const all = moveBottles(moved.data, id, locId(data, 'Division 2'), locId(data, 'Division 1'), 4);
    if (!all.ok) throw new Error(all.error);
    expect(all.data.placements).toHaveLength(1); // the emptied row disappears
    expect(placedOf(all.data, id)).toBe(10);
  });
  it('refuses to overfill the destination or move what is not there', () => {
    let { data, id } = add(withDivisions(emptyData(), 2, 5), {}, { quantity: 8 });
    data = place(place(data, id, 'Division 1', 5), id, 'Division 2', 3);
    expect(moveBottles(data, id, locId(data, 'Division 2'), locId(data, 'Division 1'), 1).ok).toBe(false); // D1 is full
    expect(moveBottles(data, id, locId(data, 'Division 2'), locId(data, 'Division 2'), 1).ok).toBe(false);
    expect(moveBottles(data, id, locId(data, 'Division 2'), locId(data, 'Division 1'), 9).ok).toBe(false);
  });
  it('unplacing keeps the bottles but forgets where they are', () => {
    let { data, id } = add(withDivisions(emptyData()), {}, { quantity: 5 });
    data = place(data, id, 'Division 1', 5);
    const r = unplaceBottles(data, id, locId(data, 'Division 1'), 2);
    if (!r.ok) throw new Error(r.error);
    expect(stockOf(r.data, id)).toBe(5);
    expect(placedOf(r.data, id)).toBe(3);
    expect(buildRows(r.data, NOW)[0]).toMatchObject({ bottles: 5, unplaced: 2 });
    expect(unplaceBottles(r.data, id, locId(data, 'Division 1'), 4).ok).toBe(false);
  });
});

describe('editing and deleting places', () => {
  it('will not shrink a place below what it holds, rename onto another, or delete it while it holds bottles', () => {
    let { data, id } = add(withDivisions(emptyData(), 2, 15), {}, { quantity: 8 });
    data = place(data, id, 'Division 1', 8);
    const d1 = locId(data, 'Division 1');
    expect(updateLocation(data, d1, { name: 'Division 1', kind: 'division', capacity: 6 }).ok).toBe(false);
    expect(updateLocation(data, d1, { name: 'Division 2', kind: 'division', capacity: 15 }).ok).toBe(false);
    expect(updateLocation(data, d1, { name: 'Division 1', kind: 'division', capacity: 8 }).ok).toBe(true);
    expect(deleteLocation(data, d1).ok).toBe(false);
    expect(deleteLocation(data, locId(data, 'Division 2')).ok).toBe(true);
  });
  it('keeps box material only on boxes', () => {
    const a = withLocation(emptyData(), { name: 'Crate', kind: 'box', material: 'carton' });
    expect(a.data.locations[0]).toMatchObject({ material: 'carton' });
    const b = withLocation(emptyData(), { name: 'Rack', kind: 'division', material: 'wooden', capacity: 15 });
    expect(b.data.locations[0]).not.toHaveProperty('material');
  });
});

describe('adding a wine with a place for its bottles', () => {
  it('places the new bottles in one step', () => {
    const base = withDivisions(emptyData(), 3, 15);
    const r = addWine(base, wine(), { quantity: 12 }, NOW, [{ locationId: locId(base, 'Division 2'), quantity: 12 }]);
    if (!r.ok) throw new Error(r.error);
    expect(placedOf(r.data, r.vintageId)).toBe(12);
    expect(buildRows(r.data, NOW)[0]?.placements[0]?.location.name).toBe('Division 2');
  });
  it('is all-or-nothing: a division that cannot hold them fails the whole add', () => {
    const base = withDivisions(emptyData(), 1, 6);
    const r = addWine(base, wine(), { quantity: 10 }, NOW, [{ locationId: locId(base, 'Division 1'), quantity: 10 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors?.placements).toMatch(/room for 6 more/);
    expect(base.vintages).toHaveLength(0); // the input is untouched
  });
  it('cannot place more bottles than are being added', () => {
    const base = withDivisions(emptyData(), 1);
    expect(addWine(base, wine(), { quantity: 2 }, NOW, [{ locationId: locId(base, 'Division 1'), quantity: 3 }]).ok).toBe(false);
    expect(addWine(base, wine(), undefined, NOW, [{ locationId: locId(base, 'Division 1'), quantity: 1 }]).ok).toBe(false);
  });
  it('adding more bottles to an existing wine can place just the new ones', () => {
    let { data, id } = add(withDivisions(emptyData(), 2), {}, { quantity: 3 });
    data = place(data, id, 'Division 1', 3);
    const r = addPurchase(data, id, { quantity: 4 }, [{ locationId: locId(data, 'Division 1'), quantity: 4 }]);
    if (!r.ok) throw new Error(r.error);
    expect(placedOf(r.data, id)).toBe(7);
  });
});

describe('bottles placed can never outnumber bottles owned', () => {
  it('blocks deleting or shrinking a purchase while its bottles are assigned to places', () => {
    let { data, id } = add(withDivisions(emptyData()), {}, { quantity: 6 });
    data = place(data, id, 'Division 1', 6);
    const pid = data.purchases[0]!.id;
    const del = deletePurchase(data, pid);
    expect(del.ok).toBe(false);
    if (!del.ok) expect(del.error).toMatch(/assigned to storage locations/);
    expect(updatePurchase(data, pid, { quantity: 4 }).ok).toBe(false);
    expect(updatePurchase(data, pid, { quantity: 8 }).ok).toBe(true);
    // free the bottles first and it goes through
    const freed = unplaceBottles(data, id, locId(data, 'Division 1'), 6);
    if (!freed.ok) throw new Error(freed.error);
    expect(deletePurchase(freed.data, pid).ok).toBe(true);
  });
});

describe('taking bottles out of a place', () => {
  it('reduces that place and records where they came from', () => {
    let { data, id } = add(withDivisions(emptyData()), {}, { quantity: 6 });
    data = place(place(data, id, 'Division 1', 4), id, 'Division 2', 2);
    const r = addConsumption(data, id, { date: '2026-03-01', quantity: 3, reason: 'drunk', locationId: locId(data, 'Division 1') });
    if (!r.ok) throw new Error(r.error);
    expect(occupancyOf(r.data, locId(data, 'Division 1'))).toBe(1);
    expect(occupancyOf(r.data, locId(data, 'Division 2'))).toBe(2);
    expect(r.data.consumptions[0]?.locationId).toBe(locId(data, 'Division 1'));
    expect(stockOf(r.data, id)).toBe(3);
    expect(placedOf(r.data, id)).toBe(3);
  });
  it('removes the placement row when its last bottle goes', () => {
    let { data, id } = add(withDivisions(emptyData()), {}, { quantity: 2 });
    data = place(data, id, 'Division 1', 2);
    const r = addConsumption(data, id, { date: '2026-03-01', quantity: 2, reason: 'drunk', locationId: locId(data, 'Division 1') });
    if (!r.ok) throw new Error(r.error);
    expect(r.data.placements).toHaveLength(0);
  });
  it('insists on a source when every bottle is placed, and rejects one that has too few', () => {
    let { data, id } = add(withDivisions(emptyData()), {}, { quantity: 6 });
    data = place(place(data, id, 'Division 1', 4), id, 'Division 2', 2);
    const none = addConsumption(data, id, { date: '2026-03-01', quantity: 1, reason: 'drunk' });
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.fieldErrors?.locationId).toMatch(/where/i);
    const tooMany = addConsumption(data, id, { date: '2026-03-01', quantity: 3, reason: 'drunk', locationId: locId(data, 'Division 2') });
    expect(tooMany.ok).toBe(false);
    const wrongPlace = addConsumption(withDivisions(data, 3), id, { date: '2026-03-01', quantity: 1, reason: 'drunk', locationId: locId(withDivisions(data, 3), 'Division 3') });
    expect(wrongPlace.ok).toBe(false);
  });
  it('needs no source for bottles that were never given a place', () => {
    let { data, id } = add(withDivisions(emptyData()), {}, { quantity: 6 });
    data = place(data, id, 'Division 1', 4); // 2 unplaced
    expect(addConsumption(data, id, { date: '2026-03-01', quantity: 2, reason: 'drunk' }).ok).toBe(true);
    expect(addConsumption(data, id, { date: '2026-03-01', quantity: 3, reason: 'drunk' }).ok).toBe(false);
  });
  it('wines that were never placed behave exactly as before', () => {
    const { data, id } = add(withDivisions(emptyData()), {}, { quantity: 3 });
    expect(drink(data, id, 3).consumptions).toHaveLength(1);
  });
  it('undo puts the bottles back where they were', () => {
    let { data, id } = add(withDivisions(emptyData()), {}, { quantity: 6 });
    data = place(data, id, 'Division 1', 6);
    const r = addConsumption(data, id, { date: '2026-03-01', quantity: 2, reason: 'drunk', locationId: locId(data, 'Division 1') });
    if (!r.ok) throw new Error(r.error);
    const undone = deleteConsumption(r.data, r.consumptionId);
    expect(occupancyOf(undone, locId(data, 'Division 1'))).toBe(6);
    expect(stockOf(undone, id)).toBe(6);
  });
  it('undo never overfills: if the place has since filled up, the bottles come back unplaced', () => {
    let { data, id } = add(withDivisions(emptyData(), 1, 4), {}, { quantity: 4 });
    data = place(data, id, 'Division 1', 4);
    const r = addConsumption(data, id, { date: '2026-03-01', quantity: 2, reason: 'drunk', locationId: locId(data, 'Division 1') });
    if (!r.ok) throw new Error(r.error);
    // another wine takes the space that opened up
    const other = add(r.data, { producer: 'Other', bottling: 'Wine', year: 2020 }, { quantity: 2 });
    const filled = place(other.data, other.id, 'Division 1', 2);
    const undone = deleteConsumption(filled, r.consumptionId);
    expect(occupancyOf(undone, locId(data, 'Division 1'))).toBe(4); // still within capacity
    expect(stockOf(undone, id)).toBe(4);
    expect(buildRows(undone, NOW).find((x) => x.vintage.id === id)?.unplaced).toBe(2);
  });
  it('undo tolerates a place that has since been deleted', () => {
    let { data, id } = add(withDivisions(emptyData(), 2), {}, { quantity: 2 });
    data = place(data, id, 'Division 1', 2);
    const r = addConsumption(data, id, { date: '2026-03-01', quantity: 2, reason: 'drunk', locationId: locId(data, 'Division 1') });
    if (!r.ok) throw new Error(r.error);
    const del = deleteLocation(r.data, locId(data, 'Division 1'));
    if (!del.ok) throw new Error(del.error);
    const undone = deleteConsumption(del.data, r.consumptionId);
    expect(stockOf(undone, id)).toBe(2);
    expect(placedOf(undone, id)).toBe(0);
  });
});

describe('suggestPlacement', () => {
  it('keeps a wine together: same vintage first, even if another division is emptier', () => {
    let { data, id } = add(withDivisions(emptyData(), 4, 15), {}, { quantity: 6 });
    data = place(data, id, 'Division 3', 6);
    const s = suggestPlacement(data, id, 4);
    expect(s.leftover).toBe(0);
    expect(s.plan).toEqual([{ locationId: locId(data, 'Division 3'), quantity: 4 }]);
  });
  it('spills into the next place when the preferred one is nearly full', () => {
    let { data, id } = add(withDivisions(emptyData(), 4, 15), {}, { quantity: 13 });
    data = place(data, id, 'Division 2', 13);
    const s = suggestPlacement(data, id, 5);
    expect(s.plan[0]).toEqual({ locationId: locId(data, 'Division 2'), quantity: 2 });
    expect(s.plan.reduce((n, p) => n + p.quantity, 0)).toBe(5);
    expect(s.leftover).toBe(0);
  });
  it('prefers other vintages of the same bottling, then the same producer, over an empty division', () => {
    let { data, id } = add(withDivisions(emptyData(), 5, 15), { year: 2018 }, { quantity: 3 });
    data = place(data, id, 'Division 4', 3);
    const sibling = add(data, { year: 2019 }, { quantity: 2 });
    expect(suggestPlacement(sibling.data, sibling.id, 2).plan).toEqual([{ locationId: locId(data, 'Division 4'), quantity: 2 }]);
    const sameProducer = add(sibling.data, { bottling: 'Second Vin', year: 2019 }, { quantity: 2 });
    expect(suggestPlacement(sameProducer.data, sameProducer.id, 2).plan[0]?.locationId).toBe(locId(data, 'Division 4'));
  });
  it('for a new wine, picks the tidiest division that fits everything (best fit)', () => {
    let { data, id } = add(withDivisions(emptyData(), 3, 15), { producer: 'A' }, { quantity: 10 });
    data = place(data, id, 'Division 1', 10); // 5 free
    const other = add(data, { producer: 'B', bottling: 'Z' }, { quantity: 4 });
    // 4 fits in Division 1 (5 free) — tightest — rather than an empty one
    expect(suggestPlacement(other.data, other.id, 4).plan).toEqual([{ locationId: locId(data, 'Division 1'), quantity: 4 }]);
  });
  it('splits across places when nothing fits it all, and reports what cannot fit', () => {
    let { data } = add(withDivisions(emptyData(), 2, 5), {}, { quantity: 1 });
    const big = suggestPlacement(data, null, 8);
    expect(big.plan.reduce((n, p) => n + p.quantity, 0)).toBe(8 - big.leftover);
    expect(big.plan).toHaveLength(2);
    expect(big.leftover).toBe(0);
    const tooBig = suggestPlacement(data, null, 14);
    expect(tooBig.leftover).toBe(4);
    data = emptyData();
    expect(suggestPlacement(data, null, 3)).toEqual({ plan: [], leftover: 3 });
  });
  it('only suggests a floor box when the wine is already in one', () => {
    let { data, id } = add(withDivisions(emptyData(), 1, 15), {}, { quantity: 20 });
    const box = withLocation(data, { name: 'Wooden box', kind: 'box', material: 'wooden', capacity: 12 });
    data = box.data;
    expect(suggestPlacement(data, id, 20).plan.every((p) => p.locationId !== box.id)).toBe(true);
    data = place(data, id, 'Wooden box', 6);
    expect(suggestPlacement(data, id, 4).plan[0]?.locationId).toBe(box.id);
  });
  it('a plan it makes can always be applied', () => {
    let { data, id } = add(withDivisions(emptyData(), 5, 7), {}, { quantity: 30 });
    const { plan, leftover } = suggestPlacement(data, id, 30);
    expect(leftover).toBe(0);
    for (const p of plan) {
      const r = placeBottles(data, id, p.locationId, p.quantity);
      if (!r.ok) throw new Error(r.error);
      data = r.data;
    }
    expect(placedOf(data, id)).toBe(30);
  });
});

describe('the layout and the wines in it', () => {
  it('deleting a wine frees its places but keeps the places', () => {
    let { data, id } = add(withDivisions(emptyData(), 2), {}, { quantity: 3 });
    data = place(data, id, 'Division 1', 3);
    const after = deleteWine(data, id);
    expect(after.placements).toHaveLength(0);
    expect(after.locations).toHaveLength(2);
  });
  it('prune drops placements that point nowhere', () => {
    let { data, id } = add(withDivisions(emptyData(), 2), {}, { quantity: 3 });
    data = place(data, id, 'Division 1', 3);
    const dangling = { ...data, locations: data.locations.filter((l) => l.name !== 'Division 1') };
    expect(prune(dangling).placements).toHaveLength(0);
  });
  it('rows, filters and stats know where the bottles are and which have no place yet', () => {
    let a = add(withDivisions(emptyData(), 3), { producer: 'A', bottling: 'One' }, { quantity: 5 });
    let data = place(a.data, a.id, 'Division 2', 3);
    const b = add(data, { producer: 'B', bottling: 'Two' }, { quantity: 4 });
    data = place(b.data, b.id, 'Division 3', 4);
    const rows = buildRows(data, NOW);
    expect(rows.find((r) => r.vintage.id === a.id)).toMatchObject({ unplaced: 2 });
    expect(filterRows(rows, { locationId: locId(data, 'Division 3') }).map((r) => r.vintage.id)).toEqual([b.id]);
    expect(filterRows(rows, { query: 'division 3' }).map((r) => r.vintage.id)).toEqual([b.id]); // searchable by place
    expect(computeStats(rows).unplacedBottles).toBe(2);
  });
  it('lists places in natural order — Division 2 before Division 10 — with boxes last', () => {
    let data = withDivisions(emptyData(), 12, 15);
    data = withLocation(data, { name: 'Crate', kind: 'box', material: 'wooden' }).data;
    const names = locationFills(data).map((f) => f.location.name);
    expect(names.slice(0, 3)).toEqual(['Division 1', 'Division 2', 'Division 3']);
    expect(names.indexOf('Division 9')).toBeLessThan(names.indexOf('Division 10'));
    expect(names[names.length - 1]).toBe('Crate');
  });
});

describe('the demo cellar', () => {
  const data = buildSampleData(emptyData());
  it('is a 50-division cellar with floor boxes, and nothing is over capacity', () => {
    expect(data.locations.filter((l) => l.kind === 'division')).toHaveLength(50);
    expect(data.locations.filter((l) => l.kind === 'box').length).toBeGreaterThanOrEqual(2);
    for (const f of locationFills(data)) {
      if (f.location.capacity !== undefined) expect(f.used, f.location.name).toBeLessThanOrEqual(f.location.capacity);
    }
    expect(Math.max(...locationFills(data).filter((f) => f.location.kind === 'division').map((f) => f.used))).toBeLessThanOrEqual(15);
  });
  it('has every bottle placed', () => {
    for (const r of buildRows(data, NOW)) expect(r.unplaced, `${r.producer.name} ${r.bottling.name} ${r.vintage.year}`).toBe(0);
  });
  it('removes its places with the wines, but keeps places that hold your own bottles', () => {
    expect(removeSampleData(data).locations).toHaveLength(0);
    const mine = add(data, { producer: 'Mine', bottling: 'Own', year: 2020 }, { quantity: 2 });
    const kept = removeSampleData(place(mine.data, mine.id, 'Division 50', 2));
    expect(kept.locations.map((l) => l.name)).toEqual(['Division 50']);
    expect(placedOf(kept, mine.id)).toBe(2);
  });
});

describe('suggestPlacement for a vintage that does not exist yet', () => {
  it('keeps a new vintage of a known bottling next to its siblings', () => {
    let { data, id } = add(withDivisions(emptyData(), 6, 15), { year: 2018 }, { quantity: 4 });
    data = place(data, id, 'Division 5', 4);
    const bottlingId = data.vintages.find((v) => v.id === id)!.bottlingId;
    expect(suggestPlacement(data, null, 3, { bottlingId }).plan).toEqual([{ locationId: locId(data, 'Division 5'), quantity: 3 }]);
  });
  it('and falls back to the same winery when it is a new bottling', () => {
    let { data, id } = add(withDivisions(emptyData(), 6, 15), { year: 2018 }, { quantity: 4 });
    data = place(data, id, 'Division 4', 4);
    const bottling = data.bottlings.find((b) => b.id === data.vintages.find((v) => v.id === id)!.bottlingId)!;
    expect(suggestPlacement(data, null, 2, { producerId: bottling.producerId }).plan[0]?.locationId).toBe(locId(data, 'Division 4'));
  });
});
