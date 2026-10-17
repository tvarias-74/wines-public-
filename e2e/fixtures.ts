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

// ---- barcodes: a real EAN-13, drawn as a picture and as a camera feed ----------------------------------------

/** The 13-digit barcode for 12 digits: the check digit is added. */
export function ean13(body12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(body12[i]) * (i % 2 === 0 ? 1 : 3);
  return `${body12}${(10 - (sum % 10)) % 10}`;
}

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const R = L.map((c) => [...c].map((b) => (b === '0' ? '1' : '0')).join(''));
const G = R.map((c) => [...c].reverse().join(''));
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/** The bars of an EAN-13 as modules: '1' dark, '0' light (guards, six digits, centre, six digits, guard). */
function eanModules(code: string): string {
  const parity = PARITY[Number(code[0])] as string;
  let out = '101';
  for (let i = 0; i < 6; i++) out += (parity[i] === 'L' ? L : G)[Number(code[i + 1])];
  out += '01010';
  for (let i = 0; i < 6; i++) out += R[Number(code[i + 7])];
  return `${out}101`;
}

/** 8-bit grey pixels of the barcode centred on a white page, with the quiet zones a scanner needs. */
function eanGrey(code: string, width: number, height: number, module: number, barHeight: number): Uint8Array {
  const modules = eanModules(code);
  const page = new Uint8Array(width * height).fill(255);
  const left = Math.floor((width - modules.length * module) / 2);
  const top = Math.floor((height - barHeight) / 2);
  for (let y = top; y < top + barHeight; y++) {
    for (let m = 0; m < modules.length; m++) {
      if (modules[m] === '1') for (let x = 0; x < module; x++) page[y * width + left + m * module + x] = 0;
    }
  }
  return page;
}

/** A PNG of the barcode: what a photo of a back label would show, minus the bottle. */
export function eanPng(code: string, name = 'barcode.png') {
  const width = 480;
  const height = 240;
  const grey = eanGrey(code, width, height, 4, 150);
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0;
    Buffer.from(grey.subarray(y * width, (y + 1) * width)).copy(raw, y * (width + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 0; // greyscale
  const buffer = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return { name, mimeType: 'image/png', buffer };
}

/** A camera feed (YUV4MPEG2) that shows the barcode, for Chromium's fake camera. */
export function eanY4m(code: string, frames = 8): Buffer {
  const width = 640;
  const height = 480;
  const grey = eanGrey(code, width, height, 5, 220);
  const y = Buffer.from(grey.map((v) => (v === 0 ? 16 : 235)));
  const chroma = Buffer.alloc((width / 2) * (height / 2), 128);
  const header = Buffer.from(`YUV4MPEG2 W${width} H${height} F15:1 Ip A1:1 C420jpeg\n`);
  const frame = Buffer.concat([Buffer.from('FRAME\n'), y, chroma, chroma]);
  return Buffer.concat([header, ...Array.from({ length: frames }, () => frame)]);
}
