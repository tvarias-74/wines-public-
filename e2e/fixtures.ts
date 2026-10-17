import { expect, test as base, type Page } from '@playwright/test';

/** Every test sees the same "today", so statuses, windows and "this year" figures are reproducible. */
export const TODAY = new Date('2026-10-17T12:00:00');

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.clock.setFixedTime(TODAY);
    await use(page);
  },
});

export { expect };

export async function loadSample(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore with sample wines' }).click();
  await expect(page.locator('.hero-value')).toBeVisible();
}

export async function addWineViaForm(page: Page, wine: { producer: string; bottling: string; year: string; bottles?: string; price?: string }) {
  await page.goto('/#/wine/new');
  await page.getByLabel('Producer').fill(wine.producer);
  await page.getByLabel('Bottling / cuvée').fill(wine.bottling);
  await page.getByLabel('Vintage', { exact: true }).fill(wine.year);
  if (wine.bottles) await page.getByLabel('Bottles', { exact: true }).fill(wine.bottles);
  if (wine.price) await page.getByLabel(/Price per bottle/).fill(wine.price);
  await page.getByRole('button', { name: /Add (to cellar|bottles)/ }).click();
  await expect(page.locator('.detail-grid')).toBeVisible();
}
