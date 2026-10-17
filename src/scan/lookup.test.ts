import { describe, expect, it } from 'vitest';
import { lookupBarcode, parseProduct, parseQuantity } from './lookup';

const CODE = '3017620422003';

describe('bottle sizes from the way people write them', () => {
  it('reads cl, ml and litres, with a dot or a comma', () => {
    expect(parseQuantity('75 cl')).toBe(750);
    expect(parseQuantity('75cl e')).toBe(750);
    expect(parseQuantity('750 ml')).toBe(750);
    expect(parseQuantity('0,75 L')).toBe(750);
    expect(parseQuantity('0.75l')).toBe(750);
    expect(parseQuantity('1.5 L')).toBe(1500);
    expect(parseQuantity('1500ml')).toBe(1500);
    expect(parseQuantity('37.5 cl')).toBe(375);
  });
  it('gives nothing for a multipack, a missing size or nonsense', () => {
    expect(parseQuantity('6 x 75 cl')).toBeUndefined();
    expect(parseQuantity('6×0,75l')).toBeUndefined();
    expect(parseQuantity('')).toBeUndefined();
    expect(parseQuantity(undefined)).toBeUndefined();
    expect(parseQuantity('a bottle')).toBeUndefined();
    expect(parseQuantity('5 ml')).toBeUndefined(); // not a wine bottle
  });
});

describe('turning a database record into a suggestion', () => {
  it('reads a typical French red: winery, bottling, year, size, colour, origin', () => {
    const p = parseProduct(CODE, {
      product_name: 'Château Test Grand Vin 2018',
      brands: 'Château Test, Maison Test',
      quantity: '75 cl',
      categories_tags: ['en:beverages', 'en:alcoholic-beverages', 'en:wines', 'en:red-wines', 'en:french-wines'],
      origins_tags: ['en:france'],
      countries_tags: ['en:france', 'en:belgium'],
      image_front_small_url: 'https://images.openfoodfacts.org/images/products/301/762/042/2003/front_en.4.200.jpg',
    });
    expect(p).toMatchObject({ code: CODE, winery: 'Château Test', bottling: 'Grand Vin', year: 2018, sizeMl: 750, colour: 'red', country: 'France', isWine: true });
    expect(p?.sparkling).toBeUndefined();
    expect(p?.imageUrl).toMatch(/^https:/);
  });

  it('reads a champagne as sparkling, and a rosé as rosé', () => {
    const champagne = parseProduct(CODE, { product_name: 'Moët & Chandon Brut Impérial', brands: 'Moët & Chandon', quantity: '0.75 l', categories_tags: ['en:wines', 'en:sparkling-wines', 'en:champagnes'], countries_tags: ['en:france'] });
    expect(champagne).toMatchObject({ winery: 'Moët & Chandon', bottling: 'Brut Impérial', sizeMl: 750, sparkling: true, isWine: true, country: 'France' });
    const rose = parseProduct(CODE, { product_name: 'Domaine X Rosé 2022', brands: 'Domaine X', categories_tags: ['en:wines', 'en:rose-wines'] });
    expect(rose).toMatchObject({ colour: 'rose', year: 2022 });
  });

  it('recognises fortified and sweet wines, and orange wines', () => {
    expect(parseProduct(CODE, { product_name: 'Quinta Tawny Port', brands: 'Quinta', categories_tags: ['en:wines', 'en:fortified-wines', 'en:ports'] })?.style).toBe('fortified');
    expect(parseProduct(CODE, { product_name: 'Sauternes', categories_tags: ['en:wines', 'en:sweet-wines'] })?.style).toBe('sweet');
    expect(parseProduct(CODE, { product_name: 'Skin Contact', categories_tags: ['en:wines', 'en:orange-wines'] })?.colour).toBe('orange');
  });

  it('does not guess a vintage when the title names two years, nor a country from a long list of shops', () => {
    const p = parseProduct(CODE, { product_name: 'Cuvée 2019 (selection 2021)', brands: 'X', categories_tags: ['en:wines'], countries_tags: ['en:france', 'en:germany', 'en:belgium'] });
    expect(p?.year).toBeUndefined();
    expect(p?.country).toBeUndefined();
    // …but a wine sold in exactly one country, with no origin given, is taken to be from there
    expect(parseProduct(CODE, { product_name: 'Vino', categories_tags: ['en:wines'], countries_tags: ['en:italy'] })?.country).toBe('Italy');
  });

  it('shows a spirit or a water as what it is, but not as a wine (this is a real record)', () => {
    const p = parseProduct('3245990250203', {
      brands: 'Hennessy',
      categories_tags: ['en:beverages-and-beverages-preparations', 'en:beverages', 'en:alcoholic-beverages', 'en:distilled-beverages', 'en:hard-liquors', 'en:eaux-de-vie', 'en:liqueurs'],
      countries_tags: ['en:australia', 'en:belgium', 'en:croatia', 'en:france', 'en:germany'],
      product_name: 'Hennessy Very Special Cognac',
      quantity: '0.7l',
    });
    expect(p).toMatchObject({ title: 'Hennessy Very Special Cognac', winery: 'Hennessy', sizeMl: 700, isWine: false });
    expect(parseProduct('3268840001008', { brands: 'Cristaline', product_name: 'CRISTALINE Eau De Source 0.5L', categories_tags: ['en:beverages', 'en:waters', 'en:spring-waters'], quantity: '500 ml' })?.isWine).toBe(false);
  });

  it('copes with records that have next to nothing, and ignores unsafe image links', () => {
    expect(parseProduct(CODE, {})).toBeNull();
    expect(parseProduct(CODE, null)).toBeNull();
    expect(parseProduct(CODE, { product_name: '   ' })).toBeNull();
    const bare = parseProduct(CODE, { product_name: 'Mystery', image_front_small_url: 'javascript:alert(1)' });
    expect(bare).toMatchObject({ title: 'Mystery', bottling: 'Mystery', isWine: false });
    expect(bare?.imageUrl).toBeUndefined();
    expect(parseProduct(CODE, { product_name: 'Mystery', image_front_small_url: 'http://insecure.example/x.jpg' })?.imageUrl).toBeUndefined();
  });
});

describe('asking the database', () => {
  const reply = (status: number, body: unknown) => (async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })) as unknown as typeof fetch;

  it('sends only the barcode, with no cookies and no referrer, and returns a found product', async () => {
    let seen: { url: string; init?: RequestInit } | undefined;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ status: 1, product: { product_name: 'Test Wine 2020', brands: 'Test', categories_tags: ['en:wines'] } }));
    }) as unknown as typeof fetch;
    const r = await lookupBarcode(CODE, fetchImpl);
    expect(r.kind).toBe('found');
    expect(seen?.url).toContain(`/api/v2/product/${CODE}.json`);
    expect(seen?.url).not.toMatch(/cellar|stock|price/i);
    expect(seen?.init?.credentials).toBe('omit');
    expect(seen?.init?.referrerPolicy).toBe('no-referrer');
  });

  it('tells "not listed" from "could not ask"', async () => {
    expect((await lookupBarcode(CODE, reply(200, { status: 0, status_verbose: 'product not found' }))).kind).toBe('not-found');
    expect((await lookupBarcode(CODE, reply(404, { status: 0 }))).kind).toBe('not-found');
    expect(await lookupBarcode(CODE, reply(200, { status: 1, product: {} }))).toEqual({ kind: 'not-found' }); // listed, but with nothing usable
    expect(await lookupBarcode(CODE, reply(503, '<html>busy</html>'))).toEqual({ kind: 'failed', reason: 'busy' });
    expect(await lookupBarcode(CODE, reply(429, ''))).toEqual({ kind: 'failed', reason: 'busy' });
    expect(await lookupBarcode(CODE, reply(200, 'not json'))).toEqual({ kind: 'failed', reason: 'error' });
    expect(await lookupBarcode(CODE, reply(400, {}))).toEqual({ kind: 'failed', reason: 'error' });
    const broken = (async () => {
      throw new TypeError('network down');
    }) as unknown as typeof fetch;
    expect((await lookupBarcode(CODE, broken)).kind).toBe('failed');
  });
});
