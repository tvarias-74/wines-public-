import { describe, expect, it } from 'vitest';
import { prefillFromProduct, prefillFromSearch, prefillToSearch, type Prefill } from './prefill';
import { parseProduct } from './lookup';

describe('what a scan hands to the add form', () => {
  it('survives the trip through the address', () => {
    const p: Prefill = { barcode: '3017620422003', winery: 'Château Test', bottling: 'Grand Vin', year: 2018, sizeMl: 750, colour: 'red', sparkling: true, style: 'sweet', country: 'France' };
    expect(prefillFromSearch(new URLSearchParams(prefillToSearch(p)))).toEqual(p);
  });

  it('is built from a database suggestion, leaving out what is unknown', () => {
    const guess = parseProduct('3017620422003', { product_name: 'Château Test Grand Vin 2018', brands: 'Château Test', quantity: '75 cl', categories_tags: ['en:wines', 'en:red-wines'] });
    expect(prefillFromProduct(guess!)).toEqual({ barcode: '3017620422003', winery: 'Château Test', bottling: 'Grand Vin', year: 2018, sizeMl: 750, colour: 'red' });
  });

  it('does not trust a link: bad barcodes, colours, years and sizes are dropped, long text is cut', () => {
    const q = new URLSearchParams({ barcode: '1234', colour: 'purple', year: '20x1', sizeMl: '-5', style: 'weird', winery: ' '.repeat(5), bottling: 'x'.repeat(500), sparkling: 'yes' });
    const p = prefillFromSearch(q);
    expect(p).toEqual({ bottling: 'x'.repeat(200) });
    expect(prefillFromSearch(new URLSearchParams('year=1500&sizeMl=5')).year).toBeUndefined();
  });
});
