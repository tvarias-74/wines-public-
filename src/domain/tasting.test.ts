import { describe, expect, it } from 'vitest';
import { addConsumption, addCustomImpression, deleteConsumption, updateConsumption, validateTasting } from './actions';
import { IMPRESSION_CATEGORIES, impressionLabel, isKnownImpression } from './impressions';
import { buildRows, tastingEntries } from './inventory';
import { add, drink, emptyData, NOW, place, withDivisions } from './helpers.test-util';

const base = { date: '2026-03-01', reason: 'drunk' as const };

describe('rating', () => {
  it('accepts 1 to 20 in half points', () => {
    for (const r of [1, 1.5, 10, 17, 17.5, 20]) expect(validateTasting({ rating: r }), String(r)).toEqual({});
  });
  it('rejects anything else', () => {
    for (const r of [0, 0.5, 20.5, 21, 17.3, -4, Number.NaN, Number.POSITIVE_INFINITY]) expect(validateTasting({ rating: r }).rating, String(r)).toBeDefined();
  });
  it('is optional', () => {
    const { data, id } = add(emptyData(), {}, { quantity: 2 });
    const r = addConsumption(data, id, { ...base, quantity: 1 });
    expect(r.ok && r.data.consumptions[0]).not.toHaveProperty('rating');
  });
});

describe('impressions', () => {
  it('the table has unique ids and every label is readable', () => {
    const ids = IMPRESSION_CATEGORIES.flatMap((c) => c.items.map((i) => i.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(IMPRESSION_CATEGORIES.map((c) => c.id)).toEqual(['fruit', 'floral-herbal', 'spice', 'oak-age', 'earth-mineral', 'structure', 'verdict']);
    for (const id of ids) expect(impressionLabel(id).length).toBeGreaterThan(1);
  });
  it('knows built-in words and your own, and nothing else', () => {
    expect(isKnownImpression('cherry')).toBe(true);
    expect(isKnownImpression('c:Smoked paprika')).toBe(true);
    expect(isKnownImpression('c:')).toBe(false);
    expect(isKnownImpression('made-up')).toBe(false);
  });
  it('labels degrade gracefully instead of vanishing', () => {
    expect(impressionLabel('green-apple')).toBe('Green apple');
    expect(impressionLabel('c:Smoked paprika')).toBe('Smoked paprika');
    expect(impressionLabel('retired-word')).toBe('retired word');
  });
  it('are stored once each, trimmed, with custom words kept as typed', () => {
    const { data, id } = add(emptyData(), {}, { quantity: 2 });
    const r = addConsumption(data, id, { ...base, quantity: 1, impressions: ['cherry', 'cherry', 'c:  Smoked paprika ', 'c:smoked paprika', 'silky'] });
    if (!r.ok) throw new Error(r.error);
    expect(r.data.consumptions[0]?.impressions).toEqual(['cherry', 'c:Smoked paprika', 'silky']);
  });
  it('rejects ids that are not in the table', () => {
    const { data, id } = add(emptyData(), {}, { quantity: 2 });
    expect(addConsumption(data, id, { ...base, quantity: 1, impressions: ['nonsense'] }).ok).toBe(false);
  });
  it('your own words can be added to the table once', () => {
    let data = addCustomImpression(emptyData(), '  Smoked paprika ');
    data = addCustomImpression(data, 'smoked PAPRIKA');
    data = addCustomImpression(data, '   ');
    expect(data.settings.customImpressions).toEqual(['Smoked paprika']);
  });
});

describe('a tasting record', () => {
  it('keeps the rating, words and free note together with the bottles taken out', () => {
    const { data, id } = add(emptyData(), {}, { quantity: 6 });
    const r = addConsumption(data, id, { ...base, quantity: 2, rating: 18.5, impressions: ['cherry', 'at-peak'], notes: '  Lovely  ' });
    if (!r.ok) throw new Error(r.error);
    expect(r.data.consumptions[0]).toMatchObject({ quantity: 2, rating: 18.5, impressions: ['cherry', 'at-peak'], notes: 'Lovely' });
  });
  it('an invalid rating stops the bottles leaving the cellar', () => {
    const { data, id } = add(emptyData(), {}, { quantity: 6 });
    const r = addConsumption(data, id, { ...base, quantity: 2, rating: 25 });
    expect(r.ok).toBe(false);
    expect(data.consumptions).toHaveLength(0);
  });
  it('can be added to later without touching the stock or where the bottles came from', () => {
    let { data, id } = add(withDivisions(emptyData()), {}, { quantity: 4 });
    data = place(data, id, 'Division 1', 4);
    const taken = addConsumption(data, id, { ...base, quantity: 2, locationId: data.locations[0]!.id });
    if (!taken.ok) throw new Error(taken.error);
    const edited = updateConsumption(taken.data, taken.consumptionId, { date: '2026-03-02', reason: 'gifted', rating: 17, impressions: ['silky'], notes: 'Thought about it overnight' });
    if (!edited.ok) throw new Error(edited.error);
    const c = edited.data.consumptions[0]!;
    expect(c).toMatchObject({ quantity: 2, locationId: data.locations[0]!.id, date: '2026-03-02', reason: 'gifted', rating: 17, impressions: ['silky'] });
    expect(edited.data.placements).toEqual(taken.data.placements);
  });
  it('editing can clear the rating and the words', () => {
    const { data, id } = add(emptyData(), {}, { quantity: 2 });
    const r = addConsumption(data, id, { ...base, quantity: 1, rating: 15, impressions: ['cherry'] });
    if (!r.ok) throw new Error(r.error);
    const cleared = updateConsumption(r.data, r.consumptionId, { date: base.date, reason: 'drunk' });
    if (!cleared.ok) throw new Error(cleared.error);
    expect(cleared.data.consumptions[0]).not.toHaveProperty('rating');
    expect(cleared.data.consumptions[0]).not.toHaveProperty('impressions');
  });
  it('editing validates, and an unknown record is reported', () => {
    const { data, id } = add(emptyData(), {}, { quantity: 2 });
    const r = addConsumption(data, id, { ...base, quantity: 1 });
    if (!r.ok) throw new Error(r.error);
    expect(updateConsumption(r.data, r.consumptionId, { date: 'soon', reason: 'drunk' }).ok).toBe(false);
    expect(updateConsumption(r.data, r.consumptionId, { date: base.date, reason: 'drunk', rating: 0 }).ok).toBe(false);
    expect(updateConsumption(r.data, 'nope', { date: base.date, reason: 'drunk' }).ok).toBe(false);
  });
  it('undoing a record takes its tasting with it', () => {
    const { data, id } = add(emptyData(), {}, { quantity: 2 });
    const r = addConsumption(data, id, { ...base, quantity: 1, rating: 16 });
    if (!r.ok) throw new Error(r.error);
    expect(deleteConsumption(r.data, r.consumptionId).consumptions).toHaveLength(0);
  });
});

describe('what the rest of the app sees', () => {
  it('a wine’s rating is the average of your ratings, ignoring tastings you did not rate', () => {
    let { data, id } = add(emptyData(), {}, { quantity: 6 });
    data = drink(data, id, 1); // unrated
    for (const rating of [18, 17]) {
      const r = addConsumption(data, id, { ...base, quantity: 1, rating });
      if (!r.ok) throw new Error(r.error);
      data = r.data;
    }
    expect(buildRows(data, NOW)[0]).toMatchObject({ rating: 17.5, ratingCount: 2 });
  });
  it('an unrated wine has no rating at all', () => {
    const { data } = add(emptyData(), {}, { quantity: 1 });
    expect(buildRows(data, NOW)[0]).toMatchObject({ rating: null, ratingCount: 0 });
  });
  it('the history lists newest first with readable words and the place the bottles came from', () => {
    let { data, id } = add(withDivisions(emptyData()), {}, { quantity: 6 });
    data = place(data, id, 'Division 2', 6);
    const loc = data.locations.find((l) => l.name === 'Division 2')!.id;
    for (const [date, impressions] of [['2025-01-01', ['cherry']], ['2026-02-02', ['c:Smoked paprika', 'too-young']]] as const) {
      const r = addConsumption(data, id, { date, reason: 'drunk', quantity: 1, locationId: loc, impressions: [...impressions] });
      if (!r.ok) throw new Error(r.error);
      data = r.data;
    }
    const history = tastingEntries(data, id);
    expect(history.map((h) => h.consumption.date)).toEqual(['2026-02-02', '2025-01-01']);
    expect(history[0]?.impressions).toEqual(['Smoked paprika', 'Too young']);
    expect(history[0]?.location?.name).toBe('Division 2');
  });
});
