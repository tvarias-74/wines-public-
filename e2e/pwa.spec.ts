import { expect, test } from './fixtures';

const BASE = 'http://localhost:4180/wines-public-/';

test.use({ serviceWorkers: 'allow', baseURL: BASE });

test('installs from a sub-path, and works offline — including edits', async ({ page, context }) => {
  const failed: string[] = [];
  page.on('response', (r) => r.status() >= 400 && !/favicon/.test(r.url()) && failed.push(`${r.status()} ${r.url()}`));

  await page.goto(BASE);
  await expect(page.locator('.welcome')).toBeVisible();
  await expect(page).toHaveTitle('Cellar Book');

  // the service worker is scoped to the sub-path, not the domain
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toBe(BASE);

  // a valid, installable manifest, with icons that really exist
  const manifestUrl = await page.evaluate(() => (document.querySelector('link[rel=manifest]') as HTMLLinkElement).href);
  const manifest = await page.evaluate(async (u) => (await fetch(u)).json(), manifestUrl);
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
  expect(new URL(manifest.start_url, manifestUrl).href).toBe(BASE);
  for (const icon of manifest.icons) {
    expect(await page.evaluate(async (u) => (await fetch(new URL(u, location.href))).status, icon.src)).toBe(200);
  }

  // load some data, then let the page become controlled by the service worker
  await page.getByRole('button', { name: 'Explore with sample wines' }).click();
  await expect(page.locator('.hero-value')).toBeVisible();
  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);

  await context.setOffline(true);
  await page.goto(BASE + '#/purchases');
  await page.reload();
  await expect(page.locator('.chart')).toBeVisible();
  expect(await page.locator('.purchase-list li').count()).toBeGreaterThan(5);

  // editing works with no network, and survives coming back online
  await page.goto(BASE + '#/wine/new');
  await page.getByLabel('Producer').fill('Offline Estate');
  await page.getByLabel('Bottling / cuvée').fill('Airplane Red');
  await page.getByLabel('Vintage', { exact: true }).fill('2021');
  await page.getByRole('button', { name: 'Add to cellar' }).click();
  await expect(page.locator('.detail-grid')).toBeVisible();
  await page.waitForTimeout(600);
  await context.setOffline(false);
  await page.reload();
  await page.goto(BASE + '#/cellar?q=Offline Estate');
  await expect(page.locator('.wine-row')).toHaveCount(1);

  expect(failed).toEqual([]);
});
