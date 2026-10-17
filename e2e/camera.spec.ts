import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eanY4m, expect, test } from './fixtures';
import { FICTIF, addFictif, openScanner } from './scanning';

// Chromium's fake camera plays a video file: here, a picture of the barcode, so the live scanning path
// (camera, reader, decision) is exercised for real. These options can only be set for the whole file.
const dir = mkdtempSync(join(tmpdir(), 'cellar-camera-'));
const feed = join(dir, 'bottle.y4m');
writeFileSync(feed, eanY4m(FICTIF));
test.use({
  permissions: ['camera'],
  launchOptions: {
    executablePath: process.env.PW_CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${feed}`],
  },
});

test('the live camera reads the barcode by itself and finds the wine', async ({ page }) => {
  await addFictif(page, '2019');
  await openScanner(page);
  await expect(page.locator('.scan-result')).toContainText('In your cellar', { timeout: 25_000 });
  await expect(page.locator('.scan-vintage')).toContainText('2019');
});

test('closing the scanner switches the camera off', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __tracks: MediaStreamTrack[] };
    w.__tracks = [];
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => {
      const s = await original(c);
      w.__tracks.push(...s.getTracks());
      return s;
    };
  });
  await openScanner(page);
  await expect(page.locator('.scanner video')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks.filter((t) => t.readyState === 'live').length)).toBeGreaterThan(0);
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks.filter((t) => t.readyState === 'live').length)).toBe(0);
});
