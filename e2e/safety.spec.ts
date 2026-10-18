import type { Page } from '@playwright/test';
import { addWineViaForm, expect, loadSample, png, settle, test } from './fixtures';

/** How many pictures the device holds (the photo store, apart from the cellar document). */
const imageCount = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('cellar-book');
        open.onsuccess = () => {
          const count = open.result.transaction('images').objectStore('images').count();
          count.onsuccess = () => resolve(count.result);
          count.onerror = () => reject(count.error);
        };
        open.onerror = () => reject(open.error);
      }),
  );

async function addPhotoWine(page: Page, name: string) {
  await page.goto('/#/wine/new');
  const slots = page.locator('.photo-slot');
  await slots.nth(0).locator('input[type=file]').nth(1).setInputFiles(png('front.png'));
  await slots.nth(1).locator('input[type=file]').nth(1).setInputFiles(png('back.png', [20, 60, 120]));
  await expect(slots.nth(1).locator('img.label-img')).toBeVisible();
  await page.getByLabel('Winery', { exact: true }).fill(name);
  await page.getByLabel('Bottling / cuvée').fill('Pictured');
  await page.getByRole('group', { name: 'Colour' }).getByRole('button', { name: 'Red', exact: true }).click();
  await page.getByLabel('Vintage', { exact: true }).fill('2020');
  await page.getByLabel('Bottles', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Add to cellar' }).click();
  await expect(page.locator('.detail-grid')).toBeVisible();
}

// ---- leaving a half-filled form -------------------------------------------------------------------

test('leaving a half-filled form asks first; an untouched one just closes', async ({ page }) => {
  await page.goto('/#/wine/new');
  await page.locator('.sidebar').getByRole('link', { name: 'Cellar', exact: true }).click();
  await expect(page).toHaveURL(/#\/cellar/); // nothing typed, nothing to ask

  await page.goto('/#/wine/new');
  await page.getByLabel('Winery', { exact: true }).fill('Typed Estate');
  await page.locator('.sidebar').getByRole('link', { name: 'Cellar', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Leave without saving?');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(/wine\/new/);
  await expect(page.getByLabel('Winery', { exact: true })).toHaveValue('Typed Estate'); // still there

  await page.locator('.sidebar').getByRole('link', { name: 'Cellar', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Leave' }).click();
  await expect(page).toHaveURL(/#\/cellar/);
});

test('photos taken in a form that is abandoned are not kept', async ({ page }) => {
  await page.goto('/#/wine/new');
  await page.locator('.photo-slot').first().locator('input[type=file]').nth(1).setInputFiles(png());
  await expect(page.locator('.photo-slot').first().locator('img.label-img')).toBeVisible();
  expect(await imageCount(page)).toBe(1);
  await page.locator('.sidebar').getByRole('link', { name: 'Cellar', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('including the photos you just took');
  await page.getByRole('dialog').getByRole('button', { name: 'Leave' }).click();
  await expect.poll(() => imageCount(page)).toBe(0);
});

// ---- pictures are never lost to an ordinary action ------------------------------------------------------

test('removing a label photo can be taken back, and the picture is not deleted from the device', async ({ page }) => {
  await addPhotoWine(page, 'Undo Estate');
  await settle(page);
  expect(await imageCount(page)).toBe(2);

  await page.getByRole('button', { name: 'Remove back label' }).click();
  await expect(page.locator('.photo-pair .label-placeholder')).toHaveCount(1);
  const toast = page.locator('.toast', { hasText: 'Back label removed' });
  await expect(toast).toBeVisible();
  expect(await imageCount(page)).toBe(2); // still on the device

  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.photo-pair .label-placeholder')).toHaveCount(0);
  await expect(page.locator('.photo-pair img.label-img')).toHaveCount(2);
});

test('deleting everything deletes the pictures too, once the empty cellar is saved', async ({ page }) => {
  await loadSample(page);
  await settle(page);
  expect(await imageCount(page)).toBeGreaterThan(30);
  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'Delete all my data' }).click();
  await page.getByRole('button', { name: 'Delete everything' }).click();
  await expect(page.locator('.toast', { hasText: 'Your cellar was cleared' })).toBeVisible();
  expect(await imageCount(page)).toBe(0);
});

test('a photo for a side the existing vintage already has is set aside with a message, not silently lost', async ({ page }) => {
  await addPhotoWine(page, 'Twice Estate');
  await settle(page);
  await page.goto('/#/wine/new');
  await page.getByLabel('Winery', { exact: true }).fill('Twice Estate');
  await page.getByLabel('Bottling / cuvée').fill('Pictured');
  await page.getByLabel('Vintage', { exact: true }).fill('2020');
  // the slot now shows the picture the wine already has, and can't be changed from here
  await expect(page.getByRole('button', { name: 'Choose photo…' })).toHaveCount(0);
  await expect(page.locator('.photo-slot img.label-img')).toHaveCount(2);
});

// ---- the sample cellar can't corrupt the real one ----------------------------------------------------------

test('after a demo wine becomes yours, the demo is not offered again, and the cellar still opens', async ({ page }) => {
  await loadSample(page);
  await page.goto('/#/cellar?view=wines&q=Kyma 2024');
  await page.locator('.wine-row-main').first().click();
  await page.getByRole('button', { name: 'Drink a bottle' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();

  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'Remove sample wines' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove samples' }).click();
  await expect(page.getByText(/became yours/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add sample wines' })).toHaveCount(0);

  await settle(page);
  await page.reload();
  await page.goto('/#/cellar?view=wines');
  await expect(page.locator('.wine-row')).toHaveCount(1); // the wine you drank from is yours and stays
  await expect(page.locator('.corrupt')).toHaveCount(0);
});

// ---- the drinking window and the peak --------------------------------------------------------------------------

test('"Use as my window" keeps your peak when it still fits, and says when it has to clear it', async ({ page }) => {
  await page.goto('/#/wine/new');
  await page.getByLabel('Winery', { exact: true }).fill('Peak Estate');
  await page.getByLabel('Bottling / cuvée').fill('Keeps Its Peak');
  await page.getByRole('group', { name: 'Colour' }).getByRole('button', { name: 'Red', exact: true }).click();
  await page.getByLabel('Vintage', { exact: true }).fill('2015');
  await page.getByRole('button', { name: /Age-worthy/ }).click();
  await expect(page.getByLabel('Peak from (optional)')).toHaveValue('2030');
  await page.getByRole('button', { name: 'Add to cellar' }).click();
  await expect(page.locator('.window-years')).toHaveText('2025–2045');
  await expect(page.locator('.window-peak')).toContainText('2030');

  const addReview = page.locator('.card', { has: page.getByRole('heading', { name: 'Reviews' }) }).getByRole('button', { name: 'Add', exact: true });
  const critic = async (from: string, until: string) => {
    await addReview.click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Source').selectOption({ label: 'Jancis Robinson' });
    await dialog.getByLabel('Score').fill('17');
    await dialog.getByLabel('Their drinking window: from').fill(from);
    await dialog.getByLabel('…until').fill(until);
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  };

  // a window that contains the peak: the peak stays
  await critic('2026', '2050');
  await page.getByRole('button', { name: 'Use as my window' }).first().click();
  await expect(page.getByRole('dialog')).toContainText('stays');
  await page.getByRole('dialog').getByRole('button', { name: 'Use the critic’s window' }).click();
  await expect(page.locator('.window-years')).toHaveText('2026–2050');
  await expect(page.locator('.window-peak')).toContainText('2030');

  // one that doesn't: the peak is cleared, and the dialog and the toast say so
  await critic('2040', '2055');
  await page.getByRole('button', { name: 'Use as my window' }).last().click();
  await expect(page.getByRole('dialog')).toContainText('will be cleared');
  await page.getByRole('dialog').getByRole('button', { name: 'Use the critic’s window' }).click();
  await expect(page.locator('.toast', { hasText: 'peak was cleared' })).toBeVisible();
  await expect(page.locator('.window-years')).toHaveText('2040–2055');
  await expect(page.locator('.window-peak')).toHaveCount(0);
});

// ---- the add form -----------------------------------------------------------------------------------------------

test('after choosing a place, setting the bottles to 0 (to record a wine without any) still saves', async ({ page }) => {
  await page.goto('/#/layout');
  await page.getByRole('button', { name: 'Create divisions' }).click();
  await expect(page.locator('.toast', { hasText: 'Created 50 divisions' })).toBeVisible();

  await page.goto('/#/wine/new');
  await page.getByLabel('Winery', { exact: true }).fill('Zero Estate');
  await page.getByLabel('Bottling / cuvée').fill('Empty Rack');
  await page.getByRole('group', { name: 'Colour' }).getByRole('button', { name: 'Red', exact: true }).click();
  await page.getByLabel('Vintage', { exact: true }).fill('2019');
  await page.getByLabel('Bottles', { exact: true }).fill('4');
  await page.getByLabel('Place 1', { exact: true }).selectOption({ index: 3 }); // you chose a place yourself
  await page.getByLabel('Bottles', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Add to cellar' }).click();
  await expect(page.locator('.detail-grid')).toBeVisible();
  await expect(page.locator('.stock .hero-value')).toHaveText('0');
});

// ---- stored data from a newer version, and reaching things by keyboard ---------------------------------------------

test('data saved by a newer version is not called corrupt, and offers a way forward', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.welcome')).toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('cellar-book');
        open.onsuccess = () => {
          const tx = open.result.transaction('kv', 'readwrite');
          tx.objectStore('kv').put({ rev: 9, data: { schema: 99, producers: [] } }, 'cellar');
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        open.onerror = () => reject(open.error);
      }),
  );
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('newer version');
  await expect(page.getByRole('button', { name: 'Reload the page' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Restore from a backup file/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Download the unreadable data/ })).toBeVisible();
});

test('a new page is named in the tab title and takes keyboard focus; there is a way to skip the menu', async ({ page }) => {
  await loadSample(page);
  await page.locator('.sidebar').getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveTitle(/Settings · Cellar Book/);
  await expect(page.locator('#main')).toBeFocused();

  await page.locator('.sidebar').getByRole('link', { name: 'Purchases' }).click();
  await expect(page).toHaveTitle(/Purchases · Cellar Book/);

  // the skip link is the first thing a keyboard user reaches
  await page.goto('/#/cellar');
  await page.reload();
  await expect(page.locator('main')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
});

test('restoring reports success only once the cellar is safely saved', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __idbBroken: boolean }).__idbBroken = false;
    const original = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (...args: Parameters<IDBFactory['open']>) {
      if ((window as unknown as { __idbBroken: boolean }).__idbBroken) throw new DOMException('Blocked by the test', 'SecurityError');
      return original.apply(this, args);
    };
  });
  await addWineViaForm(page, { producer: 'Backup Estate', bottling: 'Safe', year: '2020', bottles: '2' });
  await page.goto('/#/settings');
  // (there are no photos in this cellar, so there is no "include photos" box to untick)
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backup' }).click()]);
  const file = await download.path();

  await page.locator('input[type=file]').first().setInputFiles(file);
  await expect(page.getByRole('dialog')).toContainText('Replace your cellar');

  // storage fails and the fallback fails too, after the file has been checked: the restore can't be saved, and must not claim it was
  await page.evaluate(() => ((window as unknown as { __idbBroken: boolean }).__idbBroken = true));
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    };
  });
  await page.getByRole('dialog').getByRole('button', { name: 'Replace my cellar' }).click();
  await expect(page.locator('.toast-error', { hasText: 'could not be saved' })).toBeVisible();
  await expect(page.locator('.toast', { hasText: /^Backup restored/ })).toHaveCount(0);
  await expect(page.locator('.banner-warn')).toContainText('can’t be saved normally');
});

test('if a screen crashes, the user is not left with a blank page: they can still download their cellar', async ({ page }) => {
  await loadSample(page);
  await settle(page);
  // make the number formatting used on the Purchases screen throw
  await page.evaluate(() => {
    Number.prototype.toLocaleString = () => {
      throw new Error('Test crash');
    };
    Intl.NumberFormat = function () {
      throw new Error('Test crash');
    } as unknown as typeof Intl.NumberFormat;
  });
  await page.goto('/#/purchases');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Something went wrong');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download my cellar' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^cellar-book-backup-.*\.json$/);
});
