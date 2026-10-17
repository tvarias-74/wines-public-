import { deflateSync } from 'node:zlib';
import { expect, test as base, type Page } from '@playwright/test';

/** Every test sees the same "today", so statuses, windows and "this year" figures are reproducible. */
export const TODAY = new Date('2026-10-17T12:00:00');

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.clock.setFixedTime(TODAY);
    await use(page);
  },
});

export { expect };

export async function loadSample(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore with sample wines' }).click();
  await expect(page.locator('.hero-value')).toBeVisible();
}

export interface WineInput {
  producer: string;
  bottling: string;
  year: string;
  bottles?: string;
  price?: string;
  colour?: 'Red' | 'Rosé' | 'White' | 'Orange';
}

export async function addWineViaForm(page: Page, wine: WineInput) {
  await page.goto('/#/wine/new');
  await page.getByLabel('Winery', { exact: true }).fill(wine.producer);
  await page.getByLabel('Bottling / cuvée').fill(wine.bottling);
  await page.getByRole('group', { name: 'Colour' }).getByRole('button', { name: wine.colour ?? 'Red', exact: true }).click();
  await page.getByLabel('Vintage', { exact: true }).fill(wine.year);
  if (wine.bottles) await page.getByLabel('Bottles', { exact: true }).fill(wine.bottles);
  if (wine.price) await page.getByLabel(/Price per bottle/).fill(wine.price);
  await page.getByRole('button', { name: /Add (to cellar|bottles)/ }).click();
  await expect(page.locator('.detail-grid')).toBeVisible();
}

/** Waits out the quarter-second save delay so a reload sees the change. */
export const settle = (page: Page) => page.waitForTimeout(600);

// ---- a real picture, made in memory, for the photo tests -------------------------------------

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = (crcTable[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** A solid-colour PNG. Big enough to be shrunk, small enough to be quick. */
export function makePng(width = 600, height = 800, rgb: [number, number, number] = [122, 31, 61]): Buffer {
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export const png = (name = 'label.png', rgb?: [number, number, number]) => ({ name, mimeType: 'image/png', buffer: makePng(600, 800, rgb) });
