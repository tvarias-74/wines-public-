import { describe, expect, it } from 'vitest';
import { addWine, deleteWine, findGroup, updateWine } from './actions';
import { buildRows, computeStats, filterRows, groupByOwner, NOT_SET } from './inventory';
import { add, emptyData, NOW, wine } from './helpers.test-util';

describe('owner groups', () => {
  it('one family can own wineries in different regions and countries', () => {
    let { data } = add(emptyData(), { producer: 'Marchesi Antinori', group: 'Antinori', country: 'Italy', region: 'Tuscany', bottling: 'Tignanello' }, { quantity: 6 });
    ({ data } = add(data, { producer: 'Tormaresca', group: 'antinori', country: 'Italy', region: 'Puglia', bottling: 'Torcicoda' }, { quantity: 3 }));
    ({ data } = add(data, { producer: 'Col Solare', group: 'ANTINORI', country: 'USA', region: 'Washington', bottling: 'Col Solare' }, { quantity: 2 }));
    expect(data.groups).toHaveLength(1);
    expect(data.groups[0]?.name).toBe('Antinori');
    expect(new Set(data.producers.map((p) => p.groupId)).size).toBe(1);
    const owners = groupByOwner(buildRows(data, NOW));
    expect(owners).toHaveLength(1);
    expect(owners[0]).toMatchObject({ bottles: 11, vintages: 3 });
    expect(owners[0]?.producers.map((p) => p.producer.name)).toEqual(['Col Solare', 'Marchesi Antinori', 'Tormaresca']);
  });

  it('wineries with no owner group come last, under their own heading', () => {
    let { data } = add(emptyData(), { producer: 'Independent Estate', bottling: 'A' }, { quantity: 1 });
    ({ data } = add(data, { producer: 'Karamolegos', group: 'Karamolegos family', bottling: 'Santorini' }, { quantity: 1 }));
    ({ data } = add(data, { producer: 'Zeta Estate', group: 'Alpha Holdings', bottling: 'B' }, { quantity: 1 }));
    const owners = groupByOwner(buildRows(data, NOW));
    expect(owners.map((o) => o.group?.name)).toEqual(['Alpha Holdings', 'Karamolegos family', undefined]);
  });

  it('typing a group for a winery you already have assigns it, and a blank leaves it alone', () => {
    let { data } = add(emptyData(), { producer: 'Estate', bottling: 'One', year: 2018 }, { quantity: 1 });
    expect(data.groups).toHaveLength(0);
    ({ data } = add(data, { producer: 'Estate', bottling: 'One', year: 2019, group: 'The Family' }, { quantity: 1 }));
    expect(data.producers[0]?.groupId).toBe(data.groups[0]?.id);
    ({ data } = add(data, { producer: 'Estate', bottling: 'One', year: 2020, group: '' }, { quantity: 1 }));
    expect(data.producers[0]?.groupId).toBe(data.groups[0]?.id); // adding a wine without one doesn't strip it
  });

  it('editing a wine can change or clear its winery’s group, and an unused group disappears', () => {
    let { data, id } = add(emptyData(), { producer: 'Estate', bottling: 'One', group: 'The Family' }, { quantity: 2 });
    let r = updateWine(data, id, wine({ producer: 'Estate', bottling: 'One', group: 'Another Family' }), NOW);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.groups.map((g) => g.name)).toEqual(['Another Family']);
    r = updateWine(r.data, id, wine({ producer: 'Estate', bottling: 'One', group: '' }), NOW);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.groups).toHaveLength(0);
    expect(r.data.producers[0]).not.toHaveProperty('groupId');
    expect(findGroup(r.data, 'The Family')).toBeUndefined();
  });

  it('a group is shared by every wine of its wineries and survives while any remains', () => {
    let a = add(emptyData(), { producer: 'Estate A', group: 'Family', bottling: 'X' }, { quantity: 1 });
    const b = add(a.data, { producer: 'Estate B', group: 'Family', bottling: 'Y' }, { quantity: 1 });
    expect(deleteWine(b.data, a.id).groups).toHaveLength(1);
    expect(deleteWine(deleteWine(b.data, a.id), b.id).groups).toHaveLength(0);
  });

  it('moving a vintage to another winery keeps that winery’s own group', () => {
    let { data, id } = add(emptyData(), { producer: 'Old Estate', bottling: 'X', year: 2018, group: 'Old Family' }, { quantity: 1 });
    ({ data } = add(data, { producer: 'New Estate', bottling: 'X', year: 2017, group: 'New Family' }, { quantity: 1 }));
    const r = updateWine(data, id, wine({ producer: 'New Estate', bottling: 'X', year: 2018, group: '' }), NOW);
    if (!r.ok) throw new Error(r.error);
    expect(findGroup(r.data, 'New Family')).toBeDefined();
    expect(r.data.producers.find((p) => p.name === 'New Estate')?.groupId).toBe(findGroup(r.data, 'New Family')?.id);
    expect(findGroup(r.data, 'Old Family')).toBeUndefined(); // nothing left under it
  });

  it('rows, search, filter and stats all know the group', () => {
    let { data } = add(emptyData(), { producer: 'Marchesi Antinori', group: 'Antinori', bottling: 'Tignanello', country: 'Italy' }, { quantity: 6 });
    ({ data } = add(data, { producer: 'Karamolegos', group: 'Karamolegos family', bottling: 'Santorini', country: 'Greece' }, { quantity: 3 }));
    ({ data } = add(data, { producer: 'Independent', bottling: 'Solo' }, { quantity: 2 }));
    const rows = buildRows(data, NOW);
    const antinori = data.groups.find((g) => g.name === 'Antinori')!.id;
    expect(filterRows(rows, { query: 'antinori' })).toHaveLength(1);
    expect(filterRows(rows, { query: 'karamolegos' })).toHaveLength(1);
    expect(filterRows(rows, { group: antinori }).map((r) => r.producer.name)).toEqual(['Marchesi Antinori']);
    expect(filterRows(rows, { group: NOT_SET }).map((r) => r.producer.name)).toEqual(['Independent']);
    expect(computeStats(rows).byGroup).toEqual([
      { key: antinori, label: 'Antinori', bottles: 6 },
      { key: data.groups.find((g) => g.name === 'Karamolegos family')!.id, label: 'Karamolegos family', bottles: 3 },
      { key: NOT_SET, label: 'No owner group', bottles: 2 },
    ]);
  });

  it('does not create a group for blank or whitespace input', () => {
    const r = addWine(emptyData(), wine({ group: '   ' }), { quantity: 1 }, NOW);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.groups).toHaveLength(0);
  });
});
