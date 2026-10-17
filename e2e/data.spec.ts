import { readFileSync } from 'node:fs';
import { addWineViaForm, expect, loadSample, test } from './fixtures';

test('backup with photos → delete everything → restore brings the cellar and its labels back', async ({ page }) => {
  await loadSample(page);
  const before = await page.locator('.hero-value').innerText();
  await page.goto('/#/settings');
  await expect(page.getByLabel(/Include label photos/)).toBeChecked();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backup' }).click()]);
  expect(download.suggestedFilename()).toBe('cellar-book-backup-2026-10-17.zip');
  const file = await download.path();
  const bytes = readFileSync(file);
  expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK'); // a real ZIP
  expect(bytes.includes(Buffer.from('cellar.json'))).toBe(true);
  expect(bytes.includes(Buffer.from('images/'))).toBe(true);

  await page.getByRole('button', { name: 'Delete all my data' }).click();
  await page.getByRole('button', { name: 'Delete everything' }).click();
  await page.goto('/#/');
  await expect(page.locator('.welcome')).toBeVisible();

  await page.goto('/#/settings');
  await page.locator('input[type=file]').first().setInputFiles(file);
  await expect(page.getByRole('dialog')).toContainText('label photo');
  await page.getByRole('button', { name: 'Replace my cellar' }).click();
  await page.goto('/#/');
  await expect(page.locator('.hero-value')).toHaveText(before);

  // the pictures really came back
  await page.goto('/#/cellar?view=wines&layout=labels');
  const img = page.locator('img.label-img').first();
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
});

test('a backup without photos is plain JSON that holds the whole cellar', async ({ page }) => {
  await loadSample(page);
  await page.goto('/#/settings');
  await page.getByLabel(/Include label photos/).uncheck();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backup' }).click()]);
  expect(download.suggestedFilename()).toBe('cellar-book-backup-2026-10-17.json');
  const file = await download.path();
  const json = JSON.parse(readFileSync(file, 'utf8'));
  expect(json.app).toBe('cellar-book');
  expect(json.schema).toBe(2);
  expect(json.vintages.length).toBe(32);
  expect(json.locations.length).toBe(52);
  expect(json.vintages.every((v: { images?: unknown }) => v.images === undefined)).toBe(true); // no references to pictures that aren't in the file

  await page.getByRole('button', { name: 'Delete all my data' }).click();
  await page.getByRole('button', { name: 'Delete everything' }).click();
  await page.locator('input[type=file]').first().setInputFiles(file);
  await page.getByRole('button', { name: 'Replace my cellar' }).click();
  await page.goto('/#/');
  await expect(page.locator('.hero-value')).toHaveText('199');
});

test('an old (version 1) backup is upgraded without inventing anything', async ({ page }) => {
  const v1 = {
    app: 'cellar-book',
    schema: 1,
    producers: [{ id: 'p1', name: 'Old Estate' }],
    bottlings: [
      { id: 'b1', producerId: 'p1', name: 'Reserve', type: 'sparkling', grapes: [] },
      { id: 'b2', producerId: 'p1', name: 'Estate Red', type: 'red', grapes: [] },
    ],
    vintages: [
      { id: 'v1', bottlingId: 'b1', year: 2012, sizeMl: 750, location: 'Rack 3' },
      { id: 'v2', bottlingId: 'b2', year: 2016, sizeMl: 750 },
    ],
    purchases: [
      { id: 'a', vintageId: 'v1', date: '2020-01-01', quantity: 6, createdAt: '2020-01-01T00:00:00Z' },
      { id: 'b', vintageId: 'v2', date: '2020-01-01', quantity: 3, createdAt: '2020-01-01T00:00:00Z' },
    ],
    consumptions: [],
    settings: { currency: 'EUR', drinkSoonYears: 1 },
    meta: {},
  };
  await page.goto('/#/settings');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'old.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(v1)) });
  await page.getByRole('button', { name: 'Replace my cellar' }).click();
  await page.goto('/#/');
  await expect(page.locator('.hero-value')).toHaveText('9');
  // the sparkling wine has no colour (a v1 "sparkling" never said which), and the old location text became a place
  await page.goto('/#/cellar?view=wines&q=Reserve');
  await page.locator('.wine-row-main').first().click();
  await expect(page.locator('.facts')).toContainText('Sparkling');
  await expect(page.locator('.facts')).not.toContainText(/\bRed\b/);
  await expect(page.locator('main')).toContainText('Rack 3');
});

test('the backup reminder appears for real data and goes away after a backup', async ({ page }) => {
  await addWineViaForm(page, { producer: 'Reminder Estate', bottling: 'Test', year: '2020' });
  await page.goto('/#/');
  await expect(page.locator('.banner-warn')).toContainText('lives only on this device');
  await page.getByRole('link', { name: 'Back up now' }).click();
  await expect(page.locator('#backup')).toBeInViewport();
  await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backup' }).click()]);
  await page.goto('/#/');
  await expect(page.locator('.banner-warn')).toHaveCount(0);
});

test('restoring something that is not a backup is refused and changes nothing', async ({ page }) => {
  await loadSample(page);
  const before = await page.locator('.hero-value').innerText();
  await page.goto('/#/settings');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'oops.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":"world"}') });
  await expect(page.locator('.toast-error')).toContainText(/Cellar Book|version/i);
  await page.goto('/#/');
  await expect(page.locator('.hero-value')).toHaveText(before);
});

test('CSV import shows what will be skipped, then imports the rest', async ({ page }) => {
  await page.goto('/#/settings');
  const csv =
    'Producer;Wine;Vintage;Colour;Bottles;Price;Purchase date;Drink from;Drink to\n' +
    'Château Alpha;Grand Vin;2018;Rouge;6;"52,50";05/03/2021;2024;2035\n' +
    ';Nameless;2019;red;1;;;;\n' +
    'Zeta;Riesling;2020;white;3;18;2023;;\n';
  await page.locator('input[type=file]').nth(1).setInputFiles({ name: 'my wines.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  const preview = page.locator('.csv-preview');
  await expect(preview).toContainText('Ready to import 2 rows — 9 bottles');
  await expect(preview).toContainText('1 row will be skipped');
  await expect(preview).toContainText('Row 3: Missing producer');
  await page.getByRole('button', { name: 'Import 2 rows' }).click();

  await page.goto('/#/');
  await expect(page.locator('.hero-value')).toHaveText('9');
  await page.goto('/#/purchases?year=2023'); // the year-only purchase date was kept as a year
  await expect(page.locator('.purchase-list')).toContainText('Zeta Riesling 2020');
});

test('a CSV exported from the app can be imported again', async ({ page }) => {
  await loadSample(page);
  await page.goto('/#/settings');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Export wines in stock/ }).click()]);
  const file = await download.path();
  await page.getByRole('button', { name: 'Delete all my data' }).click();
  await page.getByRole('button', { name: 'Delete everything' }).click();
  await page.locator('input[type=file]').nth(1).setInputFiles(file);
  await expect(page.locator('.csv-preview')).toContainText('Ready to import');
  await page.getByRole('button', { name: /^Import \d+ rows?$/ }).click();
  await page.goto('/#/');
  await expect(page.locator('.hero-value')).toHaveText('199');
});

test('two tabs stay in step', async ({ page, context }) => {
  await page.goto('/#/cellar');
  const other = await context.newPage();
  await other.clock.setFixedTime(new Date('2026-10-17T12:00:00'));
  await other.goto('/#/cellar');
  await addWineViaForm(page, { producer: 'Tab Test Winery', bottling: 'Sync', year: '2020' });
  await expect(other.getByText('Tab Test Winery')).toBeVisible({ timeout: 5000 });
});

test('unreadable stored data is kept, offered for download, and never overwritten', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.welcome')).toBeVisible();
  const garbage = { schema: 1, producers: 'oops' };
  await page.evaluate(
    (g) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('cellar-book');
        open.onsuccess = () => {
          const tx = open.result.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(g, 'cellar');
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        open.onerror = () => reject(open.error);
      }),
    garbage,
  );
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('couldn’t be read');
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.locator('.corrupt')).toBeVisible();
  const stored = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open('cellar-book');
        open.onsuccess = () => {
          const get = open.result.transaction('kv').objectStore('kv').get('cellar');
          get.onsuccess = () => resolve(get.result);
        };
      }),
  );
  expect(stored).toEqual(garbage);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download the unreadable data/ }).click()]);
  expect(JSON.parse(readFileSync(await download.path(), 'utf8'))).toEqual(garbage);
});
