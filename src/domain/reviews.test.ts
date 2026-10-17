import { describe, expect, it } from 'vitest';
import { addReview, deleteReview, deleteWine, safeUrl, updateReview, validateReviewInput } from './actions';
import { REVIEW_SOURCE_SCALE } from './types';
import { add, emptyData } from './helpers.test-util';

const wineData = () => add(emptyData(), {}, { quantity: 3 });

describe('safeUrl', () => {
  it('keeps web links and adds https to bare domains', () => {
    expect(safeUrl('https://www.vivino.com/wines/1')).toBe('https://www.vivino.com/wines/1');
    expect(safeUrl('http://example.com/a?b=c')).toBe('http://example.com/a?b=c');
    expect(safeUrl('www.jancisrobinson.com/articles/x')).toBe('https://www.jancisrobinson.com/articles/x');
    expect(safeUrl('  vivino.com  ')).toBe('https://vivino.com/');
  });
  it('drops anything that could run code or read local files when clicked', () => {
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd', 'vbscript:x', 'ftp://x.org/a', '', '   ', 'http://']) {
      expect(safeUrl(bad), bad).toBeUndefined();
    }
  });
});

describe('reviews', () => {
  it('each source defaults to its own scale', () => {
    expect(REVIEW_SOURCE_SCALE).toMatchObject({ vivino: 5, parker: 100, robinson: 20 });
  });

  it('records a score on the source’s scale, plus the critic’s own words and link', () => {
    const { data, id } = wineData();
    const r = addReview(data, id, { source: 'robinson', score: 17.5, reviewer: 'Jancis Robinson', text: 'Elegant.', date: '2024-05', url: 'jancisrobinson.com/x', drinkFrom: 2026, drinkTo: 2034 });
    if (!r.ok) throw new Error(r.error);
    expect(r.data.reviews[0]).toMatchObject({ source: 'robinson', score: 17.5, scale: 20, url: 'https://jancisrobinson.com/x', drinkFrom: 2026, drinkTo: 2034 });
  });

  it('accepts a typical Parker, Vivino and Jancis score, and rejects ones above the scale', () => {
    expect(validateReviewInput({ source: 'parker', score: 95 })).toEqual({});
    expect(validateReviewInput({ source: 'vivino', score: 4.3 })).toEqual({});
    expect(validateReviewInput({ source: 'robinson', score: 17 })).toEqual({});
    expect(validateReviewInput({ source: 'vivino', score: 4.8 })).toEqual({});
    expect(validateReviewInput({ source: 'vivino', score: 95 }).score).toBeDefined(); // a 100-point score on a 5-star scale
    expect(validateReviewInput({ source: 'robinson', score: 95 }).score).toBeDefined();
    expect(validateReviewInput({ source: 'parker', score: -1 }).score).toBeDefined();
  });

  it('"other" sources name who wrote it and say what their scale is', () => {
    expect(validateReviewInput({ source: 'other', score: 90 }).sourceName).toBeDefined();
    expect(validateReviewInput({ source: 'other', sourceName: 'Decanter', score: 18, scale: 20 })).toEqual({});
    expect(validateReviewInput({ source: 'other', sourceName: 'Decanter', score: 21, scale: 20 }).score).toBeDefined();
    expect(validateReviewInput({ source: 'other', sourceName: 'Decanter', score: 5, scale: 0 }).scale).toBeDefined();
  });

  it('needs something to record, and a sane link, date and window', () => {
    expect(validateReviewInput({ source: 'parker' }).score).toBeDefined();
    expect(validateReviewInput({ source: 'parker', text: 'Great' })).toEqual({});
    expect(validateReviewInput({ source: 'parker', url: 'https://x.org' })).toEqual({});
    expect(validateReviewInput({ source: 'parker', score: 90, url: 'javascript:alert(1)' }).url).toBeDefined();
    expect(validateReviewInput({ source: 'parker', score: 90, date: '2024-13' }).date).toBeDefined();
    expect(validateReviewInput({ source: 'parker', score: 90, drinkFrom: 2035, drinkTo: 2030 }).drinkTo).toBeDefined();
  });

  it('a bad link never reaches storage', () => {
    const { data, id } = wineData();
    const r = addReview(data, id, { source: 'parker', score: 90, url: 'javascript:alert(1)' });
    expect(r.ok).toBe(false);
    expect(data.reviews).toHaveLength(0);
  });

  it('the scale is only kept alongside a score', () => {
    const { data, id } = wineData();
    const r = addReview(data, id, { source: 'parker', text: 'Words only' });
    if (!r.ok) throw new Error(r.error);
    expect(r.data.reviews[0]).not.toHaveProperty('scale');
    expect(r.data.reviews[0]).not.toHaveProperty('score');
  });

  it('can be edited and deleted, and goes with the wine', () => {
    const { data, id } = wineData();
    const r = addReview(data, id, { source: 'vivino', score: 4.1 });
    if (!r.ok) throw new Error(r.error);
    const edited = updateReview(r.data, r.reviewId, { source: 'vivino', score: 4.4, text: 'Revised' });
    if (!edited.ok) throw new Error(edited.error);
    expect(edited.data.reviews[0]).toMatchObject({ score: 4.4, text: 'Revised' });
    expect(updateReview(r.data, r.reviewId, { source: 'vivino', score: 9 }).ok).toBe(false);
    expect(updateReview(r.data, 'nope', { source: 'vivino', score: 4 }).ok).toBe(false);
    expect(deleteReview(edited.data, r.reviewId).reviews).toHaveLength(0);
    expect(deleteWine(edited.data, id).reviews).toHaveLength(0);
  });

  it('refuses a review for a wine that is not there', () => {
    expect(addReview(emptyData(), 'nope', { source: 'vivino', score: 4 }).ok).toBe(false);
  });
});

import { setVintageWindow } from './actions';
import { buildRows } from './inventory';
import { NOW } from './helpers.test-util';

describe('using a critic’s drinking window', () => {
  it('sets the wine’s window and marks it as chosen by you, not estimated', () => {
    const { data, id } = add(emptyData(), { drinkFrom: 2020, drinkTo: 2025, windowSource: 'estimate' }, { quantity: 2 });
    const r = setVintageWindow(data, id, { drinkFrom: 2026, drinkTo: 2034, peakFrom: 2028, peakTo: 2031 });
    if (!r.ok) throw new Error(r.error);
    expect(r.data.vintages[0]).toMatchObject({ drinkFrom: 2026, drinkTo: 2034, peakFrom: 2028, peakTo: 2031, windowSource: 'manual' });
    expect(buildRows(r.data, NOW)[0]?.status).toBe('ready');
  });
  it('clears an old peak when the new window has none', () => {
    const { data, id } = add(emptyData(), { drinkFrom: 2020, drinkTo: 2030, peakFrom: 2024, peakTo: 2026 }, { quantity: 1 });
    const r = setVintageWindow(data, id, { drinkFrom: 2027, drinkTo: 2035 });
    if (!r.ok) throw new Error(r.error);
    expect(r.data.vintages[0]).not.toHaveProperty('peakFrom');
  });
  it('refuses an impossible window, an empty one, or an unknown wine', () => {
    const { data, id } = add(emptyData(), {}, { quantity: 1 });
    expect(setVintageWindow(data, id, { drinkFrom: 2035, drinkTo: 2030 }).ok).toBe(false);
    expect(setVintageWindow(data, id, {}).ok).toBe(false);
    expect(setVintageWindow(data, 'nope', { drinkFrom: 2030 }).ok).toBe(false);
  });
});
