import { addWineViaForm, eanPng, expect, loadSample, png, settle, test } from './fixtures';
import { FICTIF, OTHER, UNKNOWN, addFictif, mockLookups, openScanner, typeCode, wineRecord } from './scanning';

// ---- finding a bottle in your own cellar: no network ---------------------------------------------------------------

test('a bottle you have is found by its barcode, with every vintage of it, and you can drink or add from there', async ({ page }) => {
  const seen = await mockLookups(page, () => ({ status: 200, body: wineRecord }));
  await addFictif(page, '2019', '6');
  await addFictif(page, '2020', '3'); // the same bottling, another vintage: the barcode is shared

  await openScanner(page);
  await typeCode(page, FICTIF);
  const result = page.locator('.scan-result');
  await expect(result).toContainText('In your cellar');
  await expect(result).toContainText('Château Fictif · Grande Réserve');
  await expect(result.locator('.scan-vintage')).toHaveCount(2);
  await expect(result.locator('.scan-vintage').first()).toContainText('2020'); // newest first
  await expect(result.locator('.scan-vintage').first()).toContainText('3 bottles');
  expect(seen).toEqual([]); // finding it in your own cellar never touches the network

  // drink one of the 2019s straight from the scan
  await result.locator('.scan-vintage', { hasText: '2019' }).getByRole('button', { name: /Drink a bottle/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.locator('.toast', { hasText: 'Enjoyed 1 bottle' })).toBeVisible();
  await expect(result.locator('.scan-vintage', { hasText: '2019' })).toContainText('5 bottles'); // back to the result, updated

  // restock the 2020s: the wine's page opens with "add bottles" ready
  await result.locator('.scan-vintage', { hasText: '2020' }).getByRole('link', { name: /Add bottles/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page).toHaveURL(/#\/wine\/[^?]+$/); // the one-shot parameter is gone from the address
});

test('a different vintage of a bottle you have starts the form from that bottling', async ({ page }) => {
  await addFictif(page, '2019');
  await openScanner(page);
  await typeCode(page, FICTIF);
  await page.getByRole('link', { name: 'A different vintage' }).click();
  await expect(page.getByLabel('Winery', { exact: true })).toHaveValue('Château Fictif');
  await expect(page.getByLabel('Bottling / cuvée')).toHaveValue('Grande Réserve');
  await expect(page.locator('main')).toContainText('You already have this bottling');
  await page.getByLabel('Vintage', { exact: true }).fill('2021');
  await page.getByRole('button', { name: 'Add to cellar' }).click();
  await expect(page.locator('.detail-grid')).toBeVisible();
  await page.goto(`/#/cellar?q=${FICTIF}`); // and the barcode finds all three in the search box
  await expect(page.locator('.producer-head')).toContainText('Château Fictif');
});

test('opening the scanner does not put the cursor in the number box (a phone would raise its keyboard over the camera)', async ({ page }) => {
  await openScanner(page);
  await expect(page.getByLabel('Or type the number under the bars')).not.toBeFocused();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Close' })).toBeFocused();
});

test('a mistyped number says what is wrong, instead of searching for it', async ({ page }) => {
  await openScanner(page);
  const entry = page.getByLabel('Or type the number under the bars');
  await entry.fill(FICTIF.slice(0, -1) + ((Number(FICTIF.at(-1)) + 1) % 10));
  await page.getByRole('button', { name: 'Find it' }).click();
  await expect(page.getByRole('alert')).toContainText('last digit');
  await entry.fill('12345');
  await page.getByRole('button', { name: 'Find it' }).click();
  await expect(page.getByRole('alert')).toContainText('13 digits');
  await entry.fill('');
  await page.getByRole('button', { name: 'Find it' }).click();
  await expect(page.getByRole('alert')).toContainText('Enter the number');
  await expect(page.locator('.scan-result')).toHaveCount(0);
});

// ---- a bottle you don't have: the network only when asked -------------------------------------------------------------

test('an unknown barcode is not looked up until you say so, then fills the add form from the database', async ({ page }) => {
  const seen = await mockLookups(page, () => ({ status: 200, body: wineRecord }));
  await openScanner(page);
  await typeCode(page, UNKNOWN);
  await expect(page.locator('.scan-result')).toContainText('Not in your cellar yet');
  await expect(page.locator('.scan-ask')).toContainText('Only the barcode number is sent');
  await page.waitForTimeout(400);
  expect(seen).toEqual([]); // asked, not told

  await page.getByRole('button', { name: 'Look it up', exact: true }).click();
  const product = page.locator('.scan-product');
  await expect(product).toContainText('Château Fictif Grande Réserve 2019');
  await expect(product).toContainText('Open Food Facts');
  await expect(product).toContainText('check it against the label');
  expect(seen).toEqual([UNKNOWN]);

  await page.getByRole('button', { name: 'Add this wine' }).click();
  await expect(page.getByLabel('Winery', { exact: true })).toHaveValue('Château Fictif');
  await expect(page.getByLabel('Bottling / cuvée')).toHaveValue('Grande Réserve');
  await expect(page.getByLabel('Vintage', { exact: true })).toHaveValue('2019');
  await expect(page.getByRole('group', { name: 'Colour' }).getByRole('button', { name: 'Red', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Barcode (optional)')).toHaveValue(UNKNOWN);

  // you can correct anything, and save: the barcode goes with it, so next time the cellar knows the bottle
  await page.getByLabel('Bottling / cuvée').fill('Grande Réserve Spéciale');
  await page.getByRole('button', { name: 'Add to cellar' }).click();
  await expect(page.locator('.detail-grid')).toBeVisible();
  await openScanner(page);
  await typeCode(page, UNKNOWN);
  await expect(page.locator('.scan-result')).toContainText('In your cellar');
  await expect(page.locator('.scan-result')).toContainText('Grande Réserve Spéciale');
  expect(seen).toEqual([UNKNOWN]); // still just the one request
});

test('a bottle the database does not list can be added by hand, and is remembered from then on', async ({ page }) => {
  await mockLookups(page, () => ({ status: 200, body: { code: UNKNOWN, status: 0, status_verbose: 'product not found' } }));
  await openScanner(page);
  await typeCode(page, UNKNOWN);
  await page.getByRole('button', { name: 'Look it up', exact: true }).click();
  await expect(page.locator('.scan-status')).toContainText('doesn’t list this bottle');
  await page.getByRole('button', { name: 'Add it as a new wine' }).click();
  await expect(page.getByLabel('Barcode (optional)')).toHaveValue(UNKNOWN);
  await expect(page.getByLabel('Winery', { exact: true })).toHaveValue('');
});

test('a lookup that cannot be made is explained and does not get in the way', async ({ page }) => {
  await mockLookups(page, () => 'fail');
  await openScanner(page);
  await typeCode(page, UNKNOWN);
  await page.getByRole('button', { name: 'Look it up', exact: true }).click();
  await expect(page.locator('.scan-status')).toContainText('could not be reached');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add it as a new wine' })).toBeVisible();
});

test('something that is not a wine is shown as what it is, and not offered as one', async ({ page }) => {
  await mockLookups(page, () => ({ status: 200, body: { status: 1, product: { product_name: 'Hennessy Very Special Cognac', brands: 'Hennessy', quantity: '0.7l', categories_tags: ['en:beverages', 'en:distilled-beverages', 'en:liqueurs'] } } }));
  await openScanner(page);
  await typeCode(page, UNKNOWN);
  await page.getByRole('button', { name: 'Look it up', exact: true }).click();
  await expect(page.locator('.scan-product')).toContainText('Hennessy Very Special Cognac');
  await expect(page.locator('.scan-product')).toContainText('doesn’t look like a wine');
  await expect(page.getByRole('button', { name: 'Add this wine' })).toHaveCount(0);
});

test('lookups can be made automatic in Settings, and switched off again', async ({ page }) => {
  const seen = await mockLookups(page, () => ({ status: 200, body: wineRecord }));
  await page.goto('/#/settings');
  const auto = page.getByLabel(/without asking each time/);
  await expect(auto).not.toBeChecked();
  await auto.check();

  await openScanner(page);
  await typeCode(page, UNKNOWN);
  await expect(page.locator('.scan-product')).toContainText('Château Fictif Grande Réserve 2019'); // no button pressed
  expect(seen).toEqual([UNKNOWN]);

  await page.goto('/#/settings');
  await expect(auto).toBeChecked(); // remembered
  await auto.uncheck();
  await openScanner(page);
  await typeCode(page, OTHER);
  await expect(page.locator('.scan-ask')).toBeVisible();
  expect(seen).toEqual([UNKNOWN]);
});

test('the "do this automatically" box in the result turns it on', async ({ page }) => {
  const seen = await mockLookups(page, () => ({ status: 200, body: wineRecord }));
  await openScanner(page);
  await typeCode(page, UNKNOWN);
  await page.getByLabel('Do this automatically from now on').click(); // the box goes away as the lookup starts, so no "is it ticked" check
  await expect(page.locator('.scan-product')).toBeVisible(); // ticking it also does this one
  expect(seen).toEqual([UNKNOWN]);
  await page.getByRole('button', { name: 'Scan another' }).click();
  await typeCode(page, OTHER);
  await expect(page.locator('.scan-product')).toBeVisible();
  expect(seen).toEqual([UNKNOWN, OTHER]);
});

// ---- teaching the cellar a bottle ------------------------------------------------------------------------------------------

test('a barcode can be attached to a wine you already have, and is recognised straight away', async ({ page }) => {
  await mockLookups(page, () => ({ status: 200, body: { status: 0 } }));
  await addWineViaForm(page, { producer: 'Domaine Ancien', bottling: 'Vieille Cuvée', year: '2016', bottles: '4' });
  await openScanner(page);
  await typeCode(page, OTHER);
  await page.getByRole('button', { name: /already have/ }).click();
  await page.getByPlaceholder('Search your wines…').fill('vieille');
  await page.getByRole('button', { name: 'This one' }).click();
  await expect(page.locator('.toast', { hasText: 'Barcode saved on Domaine Ancien · Vieille Cuvée' })).toBeVisible();
  await expect(page.locator('.scan-result')).toContainText('In your cellar');
  await expect(page.locator('.scan-vintage')).toContainText('2016');
  await expect(page.locator('.scan-vintage')).toContainText('4 bottles');
});

test('a wine’s page shows its barcodes, lets you add one by typing, and take one off with Undo', async ({ page }) => {
  await addWineViaForm(page, { producer: 'Domaine Page', bottling: 'Fiche', year: '2018', bottles: '2' });
  const facts = page.locator('.facts');
  await expect(facts).toContainText('None yet');

  await facts.getByRole('button', { name: 'Scan or type one' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Read a barcode');
  await dialog.getByLabel('Or type the number under the bars').fill(`${OTHER.slice(0, 1)} ${OTHER.slice(1, 7)} ${OTHER.slice(7)}`);
  await dialog.getByRole('button', { name: 'Use this number' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(facts.getByRole('list', { name: 'Barcodes' })).toContainText(`${OTHER[0]} ${OTHER.slice(1, 7)} ${OTHER.slice(7)}`);

  await facts.getByRole('button', { name: /Remove barcode/ }).click();
  const toast = page.locator('.toast', { hasText: 'Barcode removed' });
  await expect(facts).toContainText('None yet');
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(facts.getByRole('list', { name: 'Barcodes' })).toBeVisible();
  await settle(page);
});

test('on the add form, a scanned barcode that you already know fills in the winery and name', async ({ page }) => {
  await addFictif(page, '2019');
  await page.goto('/#/wine/new');
  await page.getByRole('button', { name: 'Scan', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Or type the number under the bars').fill(FICTIF);
  await page.getByRole('dialog').getByRole('button', { name: 'Use this number' }).click();
  await expect(page.getByLabel('Barcode (optional)')).toHaveValue(FICTIF);
  await expect(page.getByLabel('Winery', { exact: true })).toHaveValue('Château Fictif');
  await expect(page.getByLabel('Bottling / cuvée')).toHaveValue('Grande Réserve');
  await expect(page.locator('main')).toContainText('You already have this bottle');
});

test('on the add form, typing a new barcode offers a lookup that fills only what is blank', async ({ page }) => {
  const seen = await mockLookups(page, () => ({ status: 200, body: wineRecord }));
  await page.goto('/#/wine/new');
  await page.getByLabel('Winery', { exact: true }).fill('My Own Winery Name'); // typed already: must not be overwritten
  await page.getByLabel('Barcode (optional)').fill(UNKNOWN);
  await page.getByLabel('Barcode (optional)').blur();
  expect(seen).toEqual([]);
  await page.getByRole('button', { name: /Look it up on Open Food Facts/ }).click();
  await expect(page.locator('main')).toContainText('Filled in what was blank');
  await expect(page.getByLabel('Winery', { exact: true })).toHaveValue('My Own Winery Name');
  await expect(page.getByLabel('Bottling / cuvée')).toHaveValue('Grande Réserve');
  await expect(page.getByLabel('Vintage', { exact: true })).toHaveValue('2019');
  expect(seen).toEqual([UNKNOWN]);
});

test('an invalid barcode on the form is flagged, and blocks saving until fixed', async ({ page }) => {
  await page.goto('/#/wine/new');
  await page.getByLabel('Winery', { exact: true }).fill('Bad Code Estate');
  await page.getByLabel('Bottling / cuvée').fill('Typo');
  await page.getByRole('group', { name: 'Colour' }).getByRole('button', { name: 'Red', exact: true }).click();
  await page.getByLabel('Vintage', { exact: true }).fill('2020');
  await page.getByLabel('Barcode (optional)').fill('1234567890123');
  await expect(page.locator('#barcode-help')).toContainText('last digit');
  await page.getByRole('button', { name: 'Add to cellar' }).click();
  await expect(page).toHaveURL(/wine\/new/);
  await expect(page.getByLabel('Barcode (optional)')).toBeFocused();
  await page.getByLabel('Barcode (optional)').fill(FICTIF);
  await page.getByRole('button', { name: 'Add to cellar' }).click();
  await expect(page.locator('.detail-grid')).toBeVisible();
});

// ---- reading the bars: a picture, and a live camera ------------------------------------------------------------------------

test('a photo of the barcode is read by the app’s own reader, loaded from the app and not from a CDN', async ({ page }) => {
  const outside: string[] = [];
  const wasm: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('http://localhost')) outside.push(r.url());
    if (r.url().endsWith('.wasm')) wasm.push(r.url());
  });
  await addFictif(page, '2019');
  await openScanner(page);
  await page.getByRole('dialog').locator('input[type=file]').setInputFiles(eanPng(FICTIF));
  await expect(page.locator('.scan-result')).toContainText('In your cellar', { timeout: 20_000 });
  expect(wasm.length).toBeGreaterThan(0); // the reader's engine was needed here (this browser has no built-in one)...
  expect(outside).toEqual([]); // ...and came with the app, so scanning works offline
  await expect(page.locator('.scan-code')).toContainText(`${FICTIF[0]} ${FICTIF.slice(1, 7)} ${FICTIF.slice(7)}`);
});

test('if the reader cannot be loaded, the picture path says so (not "unreadable"), and works again once it can', async ({ page }) => {
  await addFictif(page, '2019');
  await page.route('**/*.wasm', (route) => route.abort('connectionfailed'));
  await openScanner(page);
  const file = page.getByRole('dialog').locator('input[type=file]');
  await file.setInputFiles(eanPng(FICTIF));
  await expect(page.getByRole('alert')).toContainText('reader couldn’t be loaded', { timeout: 20_000 });
  await typeCode(page, OTHER); // typing never needed the reader
  await expect(page.locator('.scan-result')).toContainText('Not in your cellar yet');

  await page.unroute('**/*.wasm');
  await page.getByRole('button', { name: 'Scan another' }).click();
  await page.getByRole('dialog').locator('input[type=file]').setInputFiles(eanPng(FICTIF));
  await expect(page.locator('.scan-result')).toContainText('In your cellar', { timeout: 20_000 });
});

test('a picture with no barcode in it says so, and the dialog stays usable', async ({ page }) => {
  await openScanner(page);
  // a real picture, with no bars in it
  await page.getByRole('dialog').locator('input[type=file]').setInputFiles(png('plain.png'));
  await expect(page.getByRole('alert')).toContainText('No barcode could be read', { timeout: 20_000 });
  await typeCode(page, UNKNOWN);
  await expect(page.locator('.scan-result')).toBeVisible();
});

test('the sample cellar has no barcodes, so a scan of anything in it is "not in your cellar"', async ({ page }) => {
  await loadSample(page);
  await page.goto('/#/cellar');
  await page.getByRole('button', { name: 'Scan bottle' }).click();
  await typeCode(page, FICTIF);
  await expect(page.locator('.scan-result')).toContainText('Not in your cellar yet');
  await expect(page.getByRole('button', { name: /already have/ })).toBeVisible(); // there are wines to attach it to
});
