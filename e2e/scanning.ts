/** Shared by the barcode specs: some bottles, a pretend Open Food Facts, and the steps for scanning one. */
import type { Page } from '@playwright/test';
import { ean13, expect } from './fixtures';

export const FICTIF = ean13('376000123001'); // a bottle the cellar will know
export const UNKNOWN = ean13('376000999001'); // one it won't
export const OTHER = ean13('376000555001');

export const OFF_URL = '**/world.openfoodfacts.org/api/v2/product/**';
export const wineRecord = {
  status: 1,
  product: {
    product_name: 'Château Fictif Grande Réserve 2019',
    brands: 'Château Fictif',
    quantity: '75 cl',
    categories_tags: ['en:wines', 'en:red-wines'],
    origins_tags: ['en:france'],
    countries_tags: ['en:france'],
  },
};

/** Answers the database lookups, and counts them, so a test can say exactly when the network was used. */
export async function mockLookups(page: Page, reply: (code: string) => { status: number; body: unknown } | 'fail') {
  const seen: string[] = [];
  await page.route(OFF_URL, async (route) => {
    const code = /product\/(\d+)\.json/.exec(route.request().url())?.[1] ?? '';
    seen.push(code);
    const r = reply(code);
    if (r === 'fail') return route.abort('connectionfailed');
    return route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.body) });
  });
  return seen;
}

export const openScanner = async (page: Page) => {
  await page.goto('/#/cellar');
  await page.getByRole('button', { name: 'Scan bottle' }).click();
  await expect(page.getByRole('dialog')).toContainText('Scan a bottle');
};

export const typeCode = async (page: Page, code: string) => {
  await page.getByLabel('Or type the number under the bars').fill(code);
  await page.getByRole('button', { name: 'Find it' }).click();
};

/** A wine with a known barcode: the first thing most of these tests need. */
export async function addFictif(page: Page, year = '2019', bottles = '6') {
  await page.goto('/#/wine/new');
  await page.getByLabel('Winery', { exact: true }).fill('Château Fictif');
  await page.getByLabel('Bottling / cuvée').fill('Grande Réserve');
  const red = page.getByRole('group', { name: 'Colour' }).getByRole('button', { name: 'Red', exact: true });
  if (await red.isEnabled()) await red.click(); // a bottling you already have brings its colour, locked
  await page.getByLabel('Vintage', { exact: true }).fill(year);
  await page.getByLabel('Bottles', { exact: true }).fill(bottles);
  await page.getByLabel('Barcode (optional)').fill(FICTIF);
  await page.getByRole('button', { name: /Add (to cellar|bottles)/ }).click();
  await expect(page.locator('.detail-grid')).toBeVisible();
}

