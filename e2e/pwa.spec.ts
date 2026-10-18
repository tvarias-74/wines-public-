import { readFileSync, writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { ean13, eanPng, expect, settle, test } from './fixtures';

const BASE = 'http://localhost:4180/wines-public-/';

test.use({ serviceWorkers: 'allow', baseURL: BASE });
// The update tests change the served service worker file, so nothing in this file may run beside them.
test.describe.configure({ mode: 'serial' });

test('installs from a sub-path, and works offline — including edits', async ({ page, context }) => {
  const failed: string[] = [];
  page.on('response', (r) => r.status() >= 400 && !/favicon/.test(r.url()) && failed.push(`${r.status()} ${r.url()}`));

  await page.goto(BASE);
  await expect(page.locator('.welcome')).toBeVisible();
  await expect(page).toHaveTitle(/Cellar Book/);

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
  await page.getByLabel('Winery', { exact: true }).fill('Offline Estate');
  await page.getByLabel('Bottling / cuvée').fill('Airplane Red');
  await page.getByRole('group', { name: 'Colour' }).getByRole('button', { name: 'Red', exact: true }).click();
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

// ---- updates: a new version waits for the user ---------------------------------------------------------

const SW_FILE = 'dist/sw.js';
const MARK = '\n// new version ';

/** The build's own service worker, with anything an earlier (or crashed) run appended taken off again. */
const pristineSw = () => readFileSync(SW_FILE, 'utf8').split(MARK)[0] as string;

/** Serves "a new version": the service worker file changes by a byte-different comment, nothing else. */
async function publishNewVersion<T>(page: Page, body: () => Promise<T>): Promise<T> {
  const original = pristineSw();
  try {
    writeFileSync(SW_FILE, `${original}${MARK}${Date.now()}\n`);
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration?.update();
    });
    return await body();
  } finally {
    writeFileSync(SW_FILE, original);
  }
}

async function installedWithSample(page: Page) {
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Explore with sample wines' }).click();
  await expect(page.locator('.hero-value')).toBeVisible();
  await settle(page);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await expect(page.locator('.hero-value')).toHaveText('199');
}

test('a new version is offered, never forced, and "Later" leaves the page as it is', async ({ page }) => {
  await installedWithSample(page);
  await page.goto(BASE + '#/wine/new');
  await page.getByLabel('Winery', { exact: true }).fill('Half Filled Estate');
  await page.evaluate(() => ((window as unknown as { __stillHere?: boolean }).__stillHere = true));

  await publishNewVersion(page, async () => {
    const banner = page.locator('.banner', { hasText: 'A new version of Cellar Book is ready' });
    await expect(banner).toBeVisible({ timeout: 20_000 });
    // it did not reload under the half-filled form
    expect(await page.evaluate(() => (window as unknown as { __stillHere?: boolean }).__stillHere)).toBe(true);
    await expect(page.getByLabel('Winery', { exact: true })).toHaveValue('Half Filled Estate');
    await banner.getByRole('button', { name: 'Later' }).click();
    await expect(banner).toHaveCount(0);
  });
});

test('"Update now" installs the new version and the cellar is exactly as it was', async ({ page }) => {
  await installedWithSample(page);
  await page.goto(BASE + '#/');
  await page.evaluate(() => ((window as unknown as { __stillHere?: boolean }).__stillHere = true));

  await publishNewVersion(page, async () => {
    const banner = page.locator('.banner', { hasText: 'A new version of Cellar Book is ready' });
    await expect(banner).toBeVisible({ timeout: 20_000 });
    await banner.getByRole('button', { name: 'Update now' }).click();
    // the page reloaded (our marker is gone) and the cellar came back with it
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __stillHere?: boolean }).__stillHere).catch(() => 'navigating'), { timeout: 20_000 })
      .toBeUndefined();
    await expect(page.locator('.hero-value')).toHaveText('199');
    await expect(page.locator('.banner', { hasText: 'A new version of Cellar Book is ready' })).toHaveCount(0);
  });
});

// ---- scanning in a cellar with no signal ------------------------------------------------------------------------------

test('a barcode is read and found with no network at all: the reader comes from the offline cache', async ({ page, context }) => {
  const code = ean13('376000424001');
  await page.goto(BASE);
  await page.getByRole('link', { name: 'Add your first wine' }).click();
  await page.getByLabel('Winery', { exact: true }).fill('Offline Scanner Estate');
  await page.getByLabel('Bottling / cuvée').fill('Sans Signal');
  await page.getByRole('group', { name: 'Colour' }).getByRole('button', { name: 'Red', exact: true }).click();
  await page.getByLabel('Vintage', { exact: true }).fill('2020');
  await page.getByLabel('Barcode (optional)').fill(code);
  await page.getByRole('button', { name: 'Add to cellar' }).click();
  await expect(page.locator('.detail-grid')).toBeVisible();
  await settle(page);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);

  await context.setOffline(true);
  await page.goto(BASE + '#/cellar');
  await page.reload();
  await page.getByRole('button', { name: 'Scan bottle' }).click();
  await page.getByRole('dialog').locator('input[type=file]').setInputFiles(eanPng(code));
  await expect(page.locator('.scan-result')).toContainText('In your cellar', { timeout: 25_000 });
  await expect(page.locator('.scan-result')).toContainText('Offline Scanner Estate');
  await context.setOffline(false);
});
