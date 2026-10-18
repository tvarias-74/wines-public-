import type { Page } from '@playwright/test';
import { addWineViaForm, expect, settle, test } from './fixtures';

/**
 * Storage going wrong. IndexedDB is made to fail on demand from inside the page, so these tests
 * check what the user is told, and — above all — that nothing already saved is ever overwritten.
 */

declare global {
  interface Window {
    __idbBroken?: boolean;
  }
}

/** Makes `indexedDB.open` throw while `window.__idbBroken` is true. Must run before the app starts. */
async function breakableIndexedDb(page: Page, brokenAtStart: boolean) {
  await page.addInitScript((broken) => {
    window.__idbBroken = broken;
    const original = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (...args: Parameters<IDBFactory['open']>) {
      if (window.__idbBroken) throw new DOMException('Blocked by the test', 'SecurityError');
      return original.apply(this, args);
    };
  }, brokenAtStart);
}

const setBroken = (page: Page, broken: boolean) => page.evaluate((b) => (window.__idbBroken = b), broken);

test('when the browser refuses storage, nothing is guessed: retry works, and nothing was saved over', async ({ page }) => {
  await breakableIndexedDb(page, true);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('can’t open its storage');
  await expect(page.locator('.welcome')).toHaveCount(0); // not an empty cellar

  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('can’t open its storage'); // still blocked

  await setBroken(page, false);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('.welcome')).toBeVisible();
});

test('"continue without saving" lets you look around, says nothing is kept, and writes nothing', async ({ page }) => {
  await breakableIndexedDb(page, true);
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue without saving' }).click();
  await expect(page.locator('.banner-warn')).toContainText('Nothing you do here is being saved');

  await addWineViaForm(page, { producer: 'Ghost Estate', bottling: 'Not Saved', year: '2020', bottles: '1' });
  await settle(page);
  expect(await page.evaluate(() => localStorage.getItem('cellar-book:data'))).toBeNull();

  // after a reload it is gone (storage is still blocked) — and the screen says why, instead of showing an empty cellar
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('can’t open its storage');
});

test('if only the fallback store works, saving continues there and the user is told', async ({ page }) => {
  await breakableIndexedDb(page, false);
  await page.goto('/');
  await expect(page.locator('.welcome')).toBeVisible();

  await setBroken(page, true); // from now on, IndexedDB fails
  await addWineViaForm(page, { producer: 'Fallback Estate', bottling: 'Small Store', year: '2020', bottles: '2' });
  await expect(page.locator('.banner-warn')).toContainText('can’t be saved normally');
  await settle(page);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('cellar-book:data') ?? 'null'));
  expect(saved?.data?.vintages).toHaveLength(1);

  // IndexedDB comes back: the newer fallback copy wins on load, so nothing is lost
  await setBroken(page, false);
  await page.reload();
  await page.goto('/#/cellar?view=wines');
  await expect(page.locator('.wine-row')).toHaveCount(1);
  await expect(page.locator('main')).toContainText('Small Store');
});

test('a tab that missed another tab’s save does not overwrite it, and offers both ways forward', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.locator('.welcome')).toBeVisible();

  // a second tab that cannot hear about saves (no BroadcastChannel), as a sleeping or frozen tab wouldn't
  const stale = await context.newPage();
  await stale.clock.setFixedTime(new Date('2026-10-17T12:00:00'));
  await stale.addInitScript(() => Object.defineProperty(window, 'BroadcastChannel', { value: undefined, configurable: true }));
  await stale.goto('/');
  await expect(stale.locator('.welcome')).toBeVisible();

  await addWineViaForm(page, { producer: 'First Tab Estate', bottling: 'Saved First', year: '2020', bottles: '1' });
  await settle(page);

  // the stale tab now tries to save a different wine
  await addWineViaForm(stale, { producer: 'Second Tab Estate', bottling: 'Never Saved', year: '2021', bottles: '1' });
  const banner = stale.locator('.banner-warn');
  await expect(banner).toContainText('changed in another tab or window');
  await expect(banner).toContainText('not');

  // storage still holds only the first tab's wine
  const names = await stale.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const open = indexedDB.open('cellar-book');
        open.onsuccess = () => {
          const get = open.result.transaction('kv').objectStore('kv').get('cellar');
          get.onsuccess = () => resolve((get.result.data.producers as { name: string }[]).map((p) => p.name));
        };
      }),
  );
  expect(names).toEqual(['First Tab Estate']);

  // "Download my version" keeps the stale tab's work; "Load the latest" brings in the other tab's
  const [download] = await Promise.all([stale.waitForEvent('download'), stale.getByRole('button', { name: 'Download my version' }).click()]);
  expect(download.suggestedFilename()).toContain('my-version');
  await banner.getByRole('button', { name: 'Load the latest' }).click();
  await expect(stale.locator('.banner-warn')).toHaveCount(0);
  await stale.goto('/#/cellar?view=wines');
  await expect(stale.locator('.wine-row')).toHaveCount(1);
  await expect(stale.locator('main')).toContainText('Saved First');
  await expect(stale.locator('main')).not.toContainText('Never Saved');
});

test('data saved by an older version of the app (no revision number) still opens', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.welcome')).toBeVisible();
  const v1 = {
    schema: 1,
    producers: [{ id: 'p', name: 'Legacy Estate' }],
    bottlings: [{ id: 'b', producerId: 'p', name: 'Old Red', type: 'red', grapes: [] }],
    vintages: [{ id: 'v', bottlingId: 'b', year: 2015, sizeMl: 750 }],
    purchases: [{ id: 'x', vintageId: 'v', date: '2019-05-05', quantity: 4, createdAt: '2019-05-05T00:00:00Z' }],
    consumptions: [],
    settings: { currency: 'EUR', drinkSoonYears: 1 },
    meta: {},
  };
  await page.evaluate(
    (doc) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('cellar-book');
        open.onsuccess = () => {
          const tx = open.result.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(doc, 'cellar'); // the bare document, as the first version stored it
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        open.onerror = () => reject(open.error);
      }),
    v1,
  );
  await page.reload();
  await expect(page.locator('.hero-value')).toHaveText('4');
  await page.goto('/#/cellar?view=wines');
  await expect(page.locator('main')).toContainText('Old Red');
});
