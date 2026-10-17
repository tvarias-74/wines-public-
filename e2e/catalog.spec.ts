import { addWineViaForm, expect, loadSample, test } from './fixtures';

test('add a wine, merge a duplicate, drink and undo — and it all survives a reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();

  // ---- add from scratch, with varieties and an estimated window ----
  await page.getByRole('link', { name: 'Add your first wine' }).click();
  await page.getByLabel('Winery', { exact: true }).fill('Château Margaux');
  await page.getByLabel('Owner family or company').fill('Mentzelopoulos');
  await page.getByLabel('Bottling / cuvée').fill('Grand Vin');
  await page.getByRole('group', { name: 'Colour' }).getByRole('button', { name: 'Red', exact: true }).click();
  await page.getByLabel('Vintage', { exact: true }).fill('2015');
  await page.getByLabel('Country').fill('France');
  await page.getByLabel('Region').fill('Bordeaux');
  await page.getByLabel('Appellation').fill('Margaux');
  await page.getByRole('button', { name: 'Add a variety' }).click();
  await page.getByLabel('Grape 1', { exact: true }).fill('Cabernet Sauvignon');
  await page.getByLabel('Percentage for grape 1').fill('87');
  await page.getByRole('button', { name: 'Add a variety' }).click();
  await page.getByLabel('Grape 2', { exact: true }).fill('Merlot');
  await page.getByLabel('Percentage for grape 2').fill('13');
  await page.getByLabel('Bottles', { exact: true }).fill('6');
  await page.getByLabel(/Price per bottle/).fill('412,50'); // decimal comma is understood
  await page.getByLabel('Bought from').fill('Berry Bros');
  await page.getByRole('button', { name: /Age-worthy/ }).click();
  await expect(page.getByLabel('Drink from')).toHaveValue('2025');
  await expect(page.getByLabel('Drink until')).toHaveValue('2045');
  await expect(page.getByLabel('Peak from (optional)')).toHaveValue('2030');
  await page.getByRole('button', { name: 'Add to cellar' }).click();

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Grand Vin 2015');
  await expect(page.locator('.stock .hero-value')).toHaveText('6');
  await expect(page.locator('.window-years')).toHaveText('2025–2045');
  await expect(page.locator('.window-note')).toContainText('estimate');
  await expect(page.locator('.facts')).toContainText('Cabernet Sauvignon 87%, Merlot 13%');
  await expect(page.locator('.facts')).toContainText('Mentzelopoulos');
  await expect(page.locator('.facts')).toContainText('Red');
  await expect(page.locator('.facts')).not.toContainText('Sparkling');
  await expect(page.locator('.ledger').first()).toContainText('6 bottles');
  await expect(page.locator('.ledger').first()).toContainText(/412[.,]50 each/);
  const detailUrl = page.url();

  // ---- the same wine typed differently must merge, and reuse the known varieties ----
  await page.goto('/#/wine/new');
  await page.getByLabel('Winery', { exact: true }).fill('chateau MARGAUX');
  await page.getByLabel('Bottling / cuvée').fill('grand vin');
  await page.getByLabel('Vintage', { exact: true }).fill('2015');
  await expect(page.locator('.notice-info')).toContainText('already have');
  await expect(page.getByLabel('Grape 1', { exact: true })).toHaveValue('Cabernet Sauvignon');
  await page.getByLabel('Bottles', { exact: true }).fill('3');
  await page.getByLabel(/Price per bottle/).fill('450');
  await page.getByRole('button', { name: 'Add bottles' }).click();
  await expect(page.locator('.detail-grid')).toBeVisible();
  expect(page.url()).toBe(detailUrl);
  await expect(page.locator('.stock .hero-value')).toHaveText('9');
  await expect(page.locator('.toast', { hasText: 'Already in your cellar' })).toBeVisible();

  // ---- drink two, then undo ----
  await page.getByRole('button', { name: 'Drink a bottle' }).click();
  await page.getByRole('button', { name: 'One more' }).click();
  await page.getByLabel('Notes (optional)').fill('Perfumed and silky');
  await page.getByRole('button', { name: 'Confirm' }).click();
  const enjoyed = page.locator('.toast', { hasText: 'Enjoyed' });
  await expect(enjoyed).toContainText(/Enjoyed 2 bottles .* 7 left/);
  await expect(page.locator('.stock .hero-value')).toHaveText('7');
  await enjoyed.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.stock .hero-value')).toHaveText('9');

  // ---- reload: the data is still there ----
  await page.waitForTimeout(600); // the save is debounced by a quarter second
  await page.reload();
  await expect(page.locator('.stock .hero-value')).toHaveText('9');

  // ---- dashboard maths: 6 × 412.50 + 3 × 450 = 3,825 ----
  await page.goto('/#/');
  await expect(page.locator('.hero-value')).toHaveText('9');
  await expect(page.locator('.kpis')).toContainText(/3,825/);
});

test('saving an empty form explains what is missing and focuses the first problem', async ({ page }) => {
  await page.goto('/#/wine/new');
  await page.getByRole('button', { name: 'Add to cellar' }).click();
  const errors = page.locator('.field-error');
  await expect(errors.filter({ hasText: /winery|producer/i })).toBeVisible();
  await expect(errors.filter({ hasText: /bottling/i })).toBeVisible();
  await expect(errors.filter({ hasText: /colour/i })).toBeVisible();
  await expect(errors.filter({ hasText: /year/i })).toBeVisible();
  await expect(page.getByLabel('Winery', { exact: true })).toBeFocused();
});

test('non-vintage wines and zero-bottle entries are accepted', async ({ page }) => {
  await page.goto('/#/wine/new');
  await page.getByLabel('Winery', { exact: true }).fill('Maison Test');
  await page.getByLabel('Bottling / cuvée').fill('Brut');
  await page.getByRole('group', { name: 'Colour' }).getByRole('button', { name: 'White', exact: true }).click();
  await page.getByRole('group', { name: 'Still or sparkling' }).getByRole('button', { name: 'Sparkling' }).click();
  await page.getByLabel(/Non-vintage/).check();
  await page.getByLabel('Bottles', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Add to cellar' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Brut NV');
  await expect(page.locator('.facts')).toContainText('White sparkling');
  await expect(page.locator('.stock .hero-value')).toHaveText('0');
  await expect(page.getByRole('button', { name: 'Drink a bottle' })).toBeDisabled();
});

test('estimates are marked "est." until a year is edited by hand', async ({ page }) => {
  await loadSample(page);
  await page.goto('/#/cellar?q=Riesling 2022');
  await page.locator('.wine-row-main').first().click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Riesling Spätlese 2022');
  await expect(page.locator('main')).toContainText('No drinking window yet');
  await page.getByRole('link', { name: 'Set window' }).first().click();

  // a reversed window is rejected, and the message points at the field
  await page.getByLabel('Drink from').fill('2030');
  await page.getByLabel('Drink until').fill('2025');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('.field-error')).toContainText(/before the start/);

  await page.getByRole('button', { name: /Structured/ }).click();
  await expect(page.getByLabel('Drink from')).toHaveValue('2027');
  await expect(page.getByLabel('Drink until')).toHaveValue('2037');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('.window-years')).toHaveText('2027–2037');

  await page.goto('/#/cellar?q=Riesling 2022');
  await expect(page.locator('.wine-row')).toContainText('2027–2037 est.');
  await page.locator('.wine-row-main').first().click();
  await page.getByRole('link', { name: 'Edit' }).click();
  await page.getByLabel('Drink until').fill('2036');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.goto('/#/cellar?q=Riesling 2022');
  await expect(page.locator('.wine-row')).toContainText('2027–2036');
  await expect(page.locator('.wine-row')).not.toContainText('est.');
});

test('adding a second vintage reuses the bottling, so varieties are entered once', async ({ page }) => {
  await addWineViaForm(page, { producer: 'Domaine Un', bottling: 'Cuvée Deux', year: '2019', bottles: '2' });
  await page.goto('/#/wine/new');
  await page.getByLabel('Winery', { exact: true }).fill('Domaine Un');
  await page.getByLabel('Bottling / cuvée').fill('Cuvée Deux');
  await expect(page.locator('main')).toContainText('You already have this bottling');
  await page.getByLabel('Vintage', { exact: true }).fill('2020');
  await page.getByLabel('Bottles', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'Add to cellar' }).click();
  await expect(page.locator('main')).toContainText('Other vintages of Cuvée Deux');
  await page.goto('/#/cellar');
  await expect(page.locator('.producer')).toHaveCount(1);
  await expect(page.locator('.producer-head')).toContainText('6 bottles');
  await expect(page.locator('.wine-row')).toHaveCount(2);
});
