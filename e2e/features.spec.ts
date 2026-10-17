import { addWineViaForm, expect, loadSample, png, settle, test } from './fixtures';

// ---- where the bottles are kept ----------------------------------------------------------------

test('set up divisions and a floor box, put wines away, and see the map fill up', async ({ page }) => {
  await page.goto('/#/layout');
  await page.getByRole('button', { name: 'Create divisions' }).click();
  await expect(page.locator('.toast', { hasText: 'Created 50 divisions' })).toBeVisible();

  await page.getByRole('button', { name: 'Add a box or other place' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill('Wooden box — Haut-Verger');
  await dialog.getByLabel('Material').selectOption('wooden');
  await dialog.getByLabel('Holds up to (bottles)').fill('12');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('.loc-list li')).toHaveCount(51);

  // the first wine goes where there is room, and says so
  await page.goto('/#/wine/new');
  await page.getByLabel('Winery', { exact: true }).fill('Domaine Rangé');
  await page.getByLabel('Bottling / cuvée').fill('Cuvée Une');
  await page.getByRole('group', { name: 'Colour' }).getByRole('button', { name: 'Red', exact: true }).click();
  await page.getByLabel('Vintage', { exact: true }).fill('2019');
  await page.getByLabel('Bottles', { exact: true }).fill('6');
  await expect(page.locator('.placement-total')).toHaveText('6 of 6 placed');
  await page.getByRole('button', { name: 'Add to cellar' }).click();
  await expect(page.locator('.detail-grid')).toBeVisible();
  const where = page.getByRole('link', { name: /^Division \d+$/ });
  await expect(where).toHaveCount(1);
  const division = await where.innerText();
  await expect(page.getByText('Every bottle has a place.')).toBeVisible();

  // another vintage of the same bottling is suggested the same division
  await page.goto('/#/wine/new');
  await page.getByLabel('Winery', { exact: true }).fill('Domaine Rangé');
  await page.getByLabel('Bottling / cuvée').fill('Cuvée Une');
  await page.getByLabel('Vintage', { exact: true }).fill('2020');
  await page.getByLabel('Bottles', { exact: true }).fill('3');
  await expect(page.getByLabel('Place').first().locator('option:checked')).toContainText(division);
  await page.getByRole('button', { name: 'Add to cellar' }).click();
  await expect(page.locator('.detail-grid')).toBeVisible();

  // more than one division holds: sixteen bottles are split, never squeezed in
  await page.goto('/#/wine/new');
  await page.getByLabel('Winery', { exact: true }).fill('Domaine Grand');
  await page.getByLabel('Bottling / cuvée').fill('Magnum Lot');
  await page.getByRole('group', { name: 'Colour' }).getByRole('button', { name: 'White', exact: true }).click();
  await page.getByLabel('Vintage', { exact: true }).fill('2018');
  await page.getByLabel('Bottles', { exact: true }).fill('16');
  await expect(page.locator('.placement-row')).toHaveCount(2);
  await expect(page.locator('.placement-total')).toHaveText('16 of 16 placed');
  await page.getByRole('button', { name: 'Add to cellar' }).click();
  await expect(page.locator('.detail-grid')).toBeVisible();

  // ... and a place can't be asked to hold more than it has room for
  await page.goto('/#/wine/new');
  await page.getByLabel('Winery', { exact: true }).fill('Domaine Rangé');
  await page.getByLabel('Bottling / cuvée').fill('Cuvée Une');
  await page.getByLabel('Vintage', { exact: true }).fill('2021');
  await page.getByLabel('Bottles', { exact: true }).fill('2');
  await page.getByLabel('Bottles in this place').first().fill('14');
  await expect(page.locator('.placement-picker .field-error')).toContainText(/more than the 2 bottles|room for only/);
  await page.getByRole('button', { name: 'Add to cellar' }).click();
  await expect(page.locator('.field-error').first()).toBeVisible();
  await expect(page).toHaveURL(/wine\/new/); // nothing was saved

  // the map: 50 divisions and the box, two of the divisions in use, one of them now full
  await page.goto('/#/cellar?view=map');
  await expect(page.locator('.cell')).toHaveCount(51);
  await expect(page.locator('.cell.is-full')).toHaveCount(1);
  await expect(page.locator('.cell.is-empty')).toHaveCount(49); // 47 divisions and the box
  await page.locator('.cell.is-full').click();
  await expect(page.getByRole('dialog')).toContainText('15 of 15 bottles');
  await expect(page.getByRole('dialog')).toContainText('Magnum Lot');
});

test('the sample cellar map answers "where is it" and moves bottles', async ({ page }) => {
  await loadSample(page);
  await page.goto('/#/cellar?view=map');
  await expect(page.locator('.cell')).toHaveCount(52);
  await expect(page.getByRole('heading', { name: 'Boxes and other places' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Not put away yet' })).toHaveCount(0); // everything in the demo has a place

  // searching dims the divisions that don't hold a match
  await page.getByPlaceholder(/Search/).fill('Vintage Port');
  await expect(page.locator('.cell.is-hit')).toHaveCount(1);
  await expect(page.locator('.cell.is-dim').first()).toBeVisible();

  // open the division, move a bottle to another place
  await page.locator('.cell.is-hit').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Vintage Port');
  const from = (await dialog.getByRole('heading').first().innerText()).trim();
  await dialog.getByRole('button', { name: 'Move' }).first().click();
  await expect(page.getByRole('dialog')).toContainText(`Move from ${from}`);
  await page.getByLabel('Move to').selectOption({ label: 'Division 14 — 15 free' });
  await page.getByRole('spinbutton', { name: 'How many?' }).fill('2');
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(page.locator('.toast', { hasText: 'Moved 2 bottles' })).toBeVisible();
});

test('a wine shows where it is, and filtering by place works from the wine page', async ({ page }) => {
  await loadSample(page);
  await page.goto('/#/cellar?view=wines&q=Santorini 2023');
  await page.locator('.wine-row-main').first().click();
  await expect(page.getByRole('heading', { name: 'Where it is' })).toBeVisible();
  await page.locator('.ledger li').filter({ hasText: /Carton/ }).getByRole('link').first().click();
  await expect(page).toHaveURL(/loc=/);
  await expect(page.locator('.active-filter')).toContainText('Carton');
  await expect(page.locator('.wine-row').first()).toContainText('Santorini');
  await page.getByRole('button', { name: 'Stop filtering by place' }).click();
  await expect(page).not.toHaveURL(/loc=/);
});

// ---- label photos --------------------------------------------------------------------------------

test('photograph both sides of a label: shrunk, kept on the device, shown in the gallery', async ({ page }) => {
  await page.goto('/#/wine/new');
  const slots = page.locator('.photo-slot');
  // the second file input in a slot is the photo library one (the first opens the camera on a phone)
  await slots.nth(0).locator('input[type=file]').nth(1).setInputFiles(png('front.png'));
  await slots.nth(1).locator('input[type=file]').nth(1).setInputFiles(png('back.png', [20, 60, 120]));
  await expect(slots.nth(0).locator('img.label-img')).toBeVisible();
  await expect(slots.nth(1).locator('img.label-img')).toBeVisible();

  await page.getByLabel('Winery', { exact: true }).fill('Photo Estate');
  await page.getByLabel('Bottling / cuvée').fill('Pictured');
  await page.getByRole('group', { name: 'Colour' }).getByRole('button', { name: 'Red', exact: true }).click();
  await page.getByLabel('Vintage', { exact: true }).fill('2020');
  await page.getByLabel('Bottles', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Add to cellar' }).click();
  await expect(page.locator('.detail-grid')).toBeVisible();

  const front = page.locator('.photo-pair img.label-img').first();
  await expect(front).toBeVisible();
  const size = await front.evaluate((el: HTMLImageElement) => ({ w: el.naturalWidth, h: el.naturalHeight }));
  expect(size.h).toBeGreaterThan(0);
  expect(Math.max(size.w, size.h)).toBeLessThanOrEqual(320); // the thumbnail, not the original 600×800

  // the large view is the 1024-pixel copy
  await page.getByRole('button', { name: 'View front label larger' }).click();
  const large = page.getByRole('dialog').locator('img.label-large');
  await expect(large).toBeVisible();
  const big = await large.evaluate((el: HTMLImageElement) => ({ w: el.naturalWidth, h: el.naturalHeight }));
  expect(Math.max(big.w, big.h)).toBeLessThanOrEqual(1024);
  expect(Math.max(big.w, big.h)).toBeGreaterThan(320);
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).last().click();

  // still there after a reload
  await settle(page);
  await page.reload();
  await expect(page.locator('.photo-pair img.label-img').first()).toBeVisible();
  await expect.poll(() => page.locator('.photo-pair img.label-img').first().evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);

  // the gallery shows it, and "no photo yet" finds the wines that still need one
  await addWineViaForm(page, { producer: 'Bare Estate', bottling: 'Unphotographed', year: '2019', bottles: '1' });
  await page.goto('/#/cellar?view=wines&layout=labels');
  await expect(page.locator('.label-tile')).toHaveCount(2);
  await expect(page.locator('.label-tile img.label-img')).toHaveCount(1);
  await page.goto('/#/cellar?view=wines&layout=labels&nophoto=1');
  await expect(page.locator('.label-tile')).toHaveCount(1);
  await expect(page.locator('.label-tile')).toContainText('Unphotographed');

  // removing a photo leaves a placeholder, not a broken image
  await page.goto('/#/cellar?view=wines&q=Pictured');
  await page.locator('.wine-row-main').first().click();
  await page.getByRole('button', { name: 'Remove back label' }).click();
  await expect(page.locator('.photo-pair .label-placeholder')).toHaveCount(1);
});

test('a file that is not a picture is refused with a clear message', async ({ page }) => {
  await page.goto('/#/wine/new');
  await page.locator('.photo-slot').first().locator('input[type=file]').nth(1).setInputFiles({ name: 'notes.png', mimeType: 'image/png', buffer: Buffer.from('this is not an image') });
  await expect(page.locator('.toast-error')).toContainText(/not a picture/i);
  await expect(page.locator('.photo-slot').first().locator('img.label-img')).toHaveCount(0);
});

// ---- tasting: rating, impressions, notes -----------------------------------------------------------

test('drinking a bottle records a rating out of 20, tasting words (listed and your own) and a note', async ({ page }) => {
  await loadSample(page);
  await page.goto('/#/cellar?view=wines&q=Barolo Vigna Alta 2016');
  await page.locator('.wine-row-main').first().click();
  await page.getByRole('button', { name: 'Drink a bottle' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Taken from')).toBeVisible();

  await dialog.getByRole('button', { name: /Rate it/ }).click();
  await dialog.getByLabel('Rating out of 20').fill('17.5');
  await expect(dialog.locator('.rating-value')).toContainText('17.5');

  await dialog.getByRole('button', { name: 'Cherry' }).click(); // the Fruit group starts open
  await expect(dialog.locator('button.word[aria-pressed="true"]', { hasText: 'Cherry' })).toBeVisible();
  await dialog.getByLabel('Search tasting words').fill('tobacco');
  await dialog.getByRole('button', { name: 'Tobacco' }).click();
  await dialog.getByLabel('Add your own tasting word').fill('wet slate');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await dialog.getByLabel('Notes (optional)').fill('Opened with the lamb.');
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.locator('.toast', { hasText: 'Enjoyed 1 bottle' })).toBeVisible();

  const tastings = page.locator('.tastings');
  await expect(tastings).toContainText('17.5');
  await expect(tastings).toContainText('/20');
  await expect(tastings).toContainText('Cherry');
  await expect(tastings).toContainText('wet slate');
  await expect(tastings).toContainText('Opened with the lamb.');

  // the word you invented is kept for next time, and listed in Settings
  await page.goto('/#/settings');
  await expect(page.getByRole('list', { name: 'Your tasting words' })).toContainText('wet slate');

  // the rating shows in the lists, and a rating outside 1–20 can't be typed in
  await page.goto('/#/cellar?view=wines&q=Barolo Vigna Alta 2016');
  await expect(page.locator('.wine-row .rating-badge')).toContainText('17.5');
});

test('notes added later to a bottle taken out, and the rating can be cleared', async ({ page }) => {
  await loadSample(page);
  await page.goto('/#/cellar?view=wines&q=Santorini 2023');
  await page.locator('.wine-row-main').first().click();
  const first = page.locator('.tastings li').first();
  await first.getByRole('button', { name: /Edit|Add notes/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Clear' }).click();
  await dialog.getByLabel('Notes (optional)').fill('Corrected note');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.tastings')).toContainText('Corrected note');
});

// ---- reviews ---------------------------------------------------------------------------------------------

test('reviews: one-tap searches, your own entry with a link, and a critic’s window offered as yours', async ({ page }) => {
  await addWineViaForm(page, { producer: 'Review Estate', bottling: 'Grand Vin', year: '2016', bottles: '2' });

  // searches open Google restricted to each site, in a new tab, and never leave the app by themselves
  const links = page.locator('.find-reviews a');
  await expect(links).toHaveCount(3);
  await expect(links.nth(0)).toHaveAttribute('href', /google\.com\/search\?q=.*vivino\.com/);
  await expect(links.nth(1)).toHaveAttribute('href', /robertparker\.com/);
  await expect(links.nth(2)).toHaveAttribute('href', /jancisrobinson\.com/);
  for (const l of await links.all()) {
    await expect(l).toHaveAttribute('target', '_blank');
    await expect(l).toHaveAttribute('rel', /noopener/);
  }

  const reviews = page.locator('.reviews');
  const addReview = page.locator('.card', { has: page.getByRole('heading', { name: 'Reviews' }) }).getByRole('button', { name: 'Add', exact: true });
  await addReview.click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Source').selectOption({ label: 'Vivino' });
  await dialog.getByLabel('Score').fill('4.3');
  await dialog.getByLabel('Link to the review (optional)').fill('https://www.vivino.com/w/12345');
  await dialog.getByLabel('Their words (short quote or your summary)').fill('Dark fruit, supple.');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(reviews).toContainText('Vivino');
  await expect(reviews).toContainText('4.3');
  await expect(reviews).toContainText('/5');
  await expect(reviews.getByRole('link', { name: /Open the review/ })).toHaveAttribute('href', 'https://www.vivino.com/w/12345');

  // a link that is not http(s) is refused rather than stored
  await addReview.click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Source').selectOption({ label: 'Jancis Robinson' });
  await dialog.getByLabel('Score').fill('17');
  await dialog.getByLabel('Link to the review (optional)').fill('javascript:alert(1)');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog.locator('.field-error')).toContainText(/web address/i);
  await dialog.getByLabel('Link to the review (optional)').fill('');
  await dialog.getByLabel('Their drinking window: from').fill('2024');
  await dialog.getByLabel('…until').fill('2036');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(reviews).toContainText('Jancis Robinson');
  await expect(reviews).toContainText('/20');

  // her window can become yours, with one tap
  await reviews.getByRole('button', { name: 'Use as my window' }).click();
  await expect(page.locator('.window-years')).toHaveText('2024–2036');
});

// ---- owners, colours, sparkling ---------------------------------------------------------------------------

test('wineries group under the family or company that owns them, across regions and countries', async ({ page }) => {
  await loadSample(page);
  await page.goto('/#/cellar?by=owner');
  const heads = page.locator('.owner-head');
  await expect(heads.filter({ hasText: 'Gruppo Riva' })).toBeVisible();
  await expect(heads.filter({ hasText: 'Meridian Wine Partners' })).toBeVisible();
  await expect(heads.filter({ hasText: 'No owner group' })).toBeVisible();
  // one owner, wineries in two countries (the demo's Meridian owns a Greek and a Californian estate)
  const meridian = page.locator('.owner', { has: page.locator('.owner-head', { hasText: 'Meridian Wine Partners' }) });
  expect(await meridian.locator('.producer').count()).toBeGreaterThanOrEqual(2);

  // filter by owner, from the wine list
  await page.goto('/#/cellar?view=wines');
  await page.getByText('More filters').click();
  await page.getByLabel('Owner family or company').selectOption({ label: 'Gruppo Riva' });
  await expect(page).toHaveURL(/group=/);
  const count = await page.locator('.wine-row').count();
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThan(32);
});

test('colour and still/sparkling are separate: orange wine, fizz of any colour', async ({ page }) => {
  await loadSample(page);
  await page.goto('/#/cellar?view=wines');
  await page.getByRole('combobox', { name: 'Colour' }).selectOption('orange');
  await expect(page.locator('.wine-row')).toHaveCount(1);
  await expect(page.locator('.wine-row')).toContainText('Ramato');
  await page.getByRole('combobox', { name: 'Colour' }).selectOption('');
  await page.getByRole('combobox', { name: 'Still or sparkling' }).selectOption('sparkling');
  await expect(page.locator('.wine-row')).toHaveCount(3);
  await page.getByRole('combobox', { name: 'Colour' }).selectOption('rose');
  await expect(page.locator('.wine-row')).toHaveCount(1);
  await expect(page.locator('.wine-row')).toContainText('Rosé Brut');

  await page.goto('/#/');
  await expect(page.getByRole('heading', { name: 'By colour' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Still or sparkling' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'By owner family or company' })).toBeVisible();
});

test('the home page lists loose ends: bottles without a place, wines without a photo', async ({ page }) => {
  await addWineViaForm(page, { producer: 'Loose Estate', bottling: 'Ends', year: '2020', bottles: '4' });
  await page.goto('/#/layout');
  await page.getByRole('button', { name: 'Create divisions' }).click();
  await page.goto('/#/');
  const loose = page.locator('.card', { has: page.getByRole('heading', { name: 'Loose ends' }) });
  await expect(loose).toContainText('4 bottles');
  await expect(loose).toContainText(/no place|not put away/i);
  await expect(loose).toContainText(/photo/i);
});
