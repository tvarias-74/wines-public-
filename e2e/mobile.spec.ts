import type { Page } from '@playwright/test';
import { addWineViaForm, expect, loadSample, test } from './fixtures';

const ROUTES = ['/#/', '/#/cellar', '/#/cellar?view=wines', '/#/cellar?view=timeline', '/#/purchases', '/#/settings', '/#/wine/new'];

// Mobile emulation lets the browser zoom out to fit wide content, which hides overflow from
// scrollWidth. A fixed-width desktop-style viewport measures it honestly.
test.describe('layout at phone widths', () => {
  test.use({ isMobile: false, hasTouch: false });

  const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

  test('the overflow check itself can fail (canary)', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/');
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await page.evaluate(() => {
      const wide = document.createElement('div');
      wide.style.cssText = 'width:480px;height:10px';
      document.querySelector('main')!.appendChild(wide);
    });
    expect(await overflow(page)).toBeGreaterThan(100);
  });

  for (const width of [320, 360, 390]) {
    test(`no page scrolls sideways at ${width}px wide`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      const visitAll = async (when: string) => {
        for (const route of ROUTES) {
          await page.goto(route);
          await expect(page.locator('main')).toBeVisible();
          await page.waitForTimeout(150);
          expect(await overflow(page), `${when}: ${route} overflows by ${await overflow(page)}px`).toBeLessThanOrEqual(0);
        }
      };
      await visitAll('empty cellar');
      await loadSample(page);
      await visitAll('with sample wines');
      await page.goto('/#/cellar?view=wines');
      await page.locator('.wine-row-main').first().click();
      await expect(page.locator('.detail-grid')).toBeVisible();
      expect(await overflow(page)).toBeLessThanOrEqual(0);
    });
  }
});

test('the bottom tab bar navigates, and Add is one tap away', async ({ page }) => {
  await loadSample(page);
  const bar = page.locator('.tabbar');
  await expect(bar).toBeVisible();
  await bar.getByRole('link', { name: 'Cellar' }).click();
  await expect(page).toHaveURL(/#\/cellar/);
  await bar.getByRole('link', { name: 'Purchases' }).click();
  await expect(page).toHaveURL(/#\/purchases/);
  await bar.getByRole('link', { name: 'Add wine' }).click();
  await expect(page.getByRole('heading', { name: 'Add a wine' })).toBeVisible();
});

test('adding and drinking a bottle works on a phone', async ({ page }) => {
  await addWineViaForm(page, { producer: 'Phone Estate', bottling: 'Pocket Red', year: '2020', bottles: '3', price: '25' });
  await expect(page.locator('.stock .hero-value')).toHaveText('3');
  await page.getByRole('button', { name: 'Drink a bottle' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.locator('.stock .hero-value')).toHaveText('2');
});

test('touch targets are at least 36px tall', async ({ page }) => {
  await loadSample(page);
  await page.goto('/#/cellar?view=wines');
  const small = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('button, a.btn, .chip-btn, select, input:not([type=checkbox])')]
      .filter((el) => el.offsetParent !== null)
      .map((el) => ({ name: (el.getAttribute('aria-label') ?? el.textContent ?? el.className).trim().slice(0, 40), h: el.getBoundingClientRect().height }))
      .filter((x) => x.h < 36),
  );
  expect(small).toEqual([]);
});
