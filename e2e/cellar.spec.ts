import { expect, loadSample, test } from './fixtures';

test('a purchase that bottles were drunk from cannot be removed', async ({ page }) => {
  await loadSample(page);
  await page.goto('/#/cellar?q=Santorini 2023'); // bought 12, 3 drunk
  await page.locator('.wine-row-main').first().click();
  await page.getByRole('button', { name: 'Remove purchase' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove purchase' }).click();
  await expect(page.locator('.toast-error')).toContainText(/already been taken out/);
  await expect(page.locator('.stock .hero-value')).toHaveText('9');
});

test('deleting a wine asks first and removes it with its history', async ({ page }) => {
  await loadSample(page);
  await page.goto('/#/cellar?q=Vintage Port');
  await page.locator('.wine-row-main').first().click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('dialog')).toContainText('1 purchase');
  await page.getByRole('button', { name: 'Delete wine' }).click();
  await expect(page).toHaveURL(/#\/cellar/);
  await page.goto('/#/cellar?q=Quinta');
  await expect(page.locator('main')).toContainText('No wines match');
});

test('search ignores case and accents; filter chips and the URL stay in step', async ({ page }) => {
  await loadSample(page);
  await page.goto('/#/cellar?view=wines');
  await page.getByPlaceholder(/Search/).fill('chateau belle rive');
  await expect(page.locator('.wine-row')).toHaveCount(3);
  await page.getByPlaceholder(/Search/).fill('');
  await page.getByRole('button', { name: 'Drink soon' }).first().click();
  await expect(page).toHaveURL(/status=soon/);
  await expect(page.locator('.wine-row')).toHaveCount(4);
  for (const badge of await page.locator('.wine-row .badge').allInnerTexts()) expect(badge).toMatch(/Drink soon/);

  // a dashboard legend entry deep-links into the matching filter
  await page.goto('/#/');
  await page.getByRole('link', { name: /Past its window/ }).first().click();
  await expect(page).toHaveURL(/status=past/);
});

test('typing in the search box and tapping a chip straight away keeps both', async ({ page }) => {
  // Regression: the delayed search update used to rebuild the URL from stale parameters
  // and silently undo a filter chosen in the meantime.
  await loadSample(page);
  await page.goto('/#/cellar?view=wines');
  await page.getByPlaceholder(/Search/).fill('kyma');
  await page.getByRole('button', { name: 'Drink soon' }).first().click();
  await expect(page).toHaveURL(/q=kyma/);
  await expect(page).toHaveURL(/status=soon/);
  await expect(page.locator('.wine-row')).toHaveCount(1);
  await page.getByPlaceholder(/Search/).fill('');
  await expect(page).not.toHaveURL(/q=/);
  await expect(page).toHaveURL(/status=soon/);
});

test('the timeline shows every wine with a window, and lists those without one', async ({ page }) => {
  await loadSample(page);
  await page.goto('/#/cellar?view=timeline');
  await expect(page.locator('.tl-row').first()).toContainText('Riesling Spätlese 2015'); // past: first in line
  await expect(page.locator('.track-now').first()).toBeVisible();
  await expect(page.getByText('No drinking window set')).toBeVisible();
  await expect(page.locator('main')).toContainText('Riesling Spätlese 2022');
});

test('long lists load a page at a time', async ({ page }) => {
  await loadSample(page);
  await page.goto('/#/purchases');
  // the sample has 33 purchases, under the page size: nothing to expand
  await expect(page.getByRole('button', { name: /Show more/ })).toHaveCount(0);
});

test('chart tooltips sit beside the column, inside the chart, and follow keyboard focus', async ({ page }) => {
  await loadSample(page);
  await page.goto('/#/purchases');
  await page.locator('.chart-col').nth(8).hover();
  const tip = page.locator('.tooltip');
  await expect(tip).toBeVisible();
  const t = (await tip.boundingBox())!;
  const viz = (await page.locator('.viz').first().boundingBox())!;
  const head = (await page.locator('.card-head').first().boundingBox())!;
  expect(t.x).toBeGreaterThanOrEqual(viz.x - 1);
  expect(t.x + t.width).toBeLessThanOrEqual(viz.x + viz.width + 1);
  expect(t.y).toBeGreaterThanOrEqual(head.y + head.height - 1);
  await expect(tip).toContainText(/bottles/i);

  await page.mouse.move(0, 0);
  await page.locator('.chart-col').nth(3).focus();
  await expect(page.locator('.tooltip')).toContainText('20');
});

test('the table twin carries the same numbers as the chart', async ({ page }) => {
  await loadSample(page);
  await page.getByText('View as table').first().click();
  const table = page.locator('.twin table').first();
  await expect(table.locator('thead')).toContainText('Not ready yet');
  await expect(table.locator('tbody tr')).toHaveCount(10);
});

test('settings: currency changes every price in the app', async ({ page }) => {
  await loadSample(page);
  await page.goto('/#/settings');
  await page.getByLabel('Currency').selectOption('USD');
  await page.goto('/#/');
  await expect(page.locator('.kpis')).toContainText('$');
  await expect(page.locator('.kpis')).not.toContainText('€');
});

test('the drink-soon threshold is adjustable', async ({ page }) => {
  await loadSample(page);
  const soonCount = async () => Number((await page.locator('.legend-grid li', { hasText: 'Drink soon' }).locator('.legend-count').innerText()).replace(/\D/g, ''));
  const before = await soonCount();
  await page.goto('/#/settings');
  await page.getByLabel(/“Drink soon” means/).selectOption('3');
  await page.goto('/#/');
  expect(await soonCount()).toBeGreaterThan(before);
});
