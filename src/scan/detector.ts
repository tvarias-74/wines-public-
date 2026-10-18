import { normalizeBarcode } from '../domain/barcode';

/**
 * Reads barcodes from a camera frame or a picture. The browser's own `BarcodeDetector` is used where
 * it exists (Chrome on Android, for one: fast and free); everywhere else, including iPhones, a small
 * ZXing build is loaded on first use. Its engine file ships with the app, so scanning works offline.
 * Only the bar formats found on a bottle are asked for.
 */

type Format = 'ean_13' | 'ean_8' | 'upc_a';
const FORMATS: Format[] = ['ean_13', 'ean_8', 'upc_a'];

interface Detected {
  rawValue: string;
  format: string;
}
interface NativeDetector {
  detect(source: ImageBitmapSource): Promise<Detected[]>;
}
interface NativeDetectorClass {
  new (options?: { formats?: string[] }): NativeDetector;
  getSupportedFormats?(): Promise<string[]>;
}

export interface Detector {
  /** Valid, canonical barcodes found in the picture (usually none or one). */
  detect(source: ImageBitmapSource): Promise<string[]>;
  /** Which engine is in use, for the tests and for diagnosing a phone that won't scan. */
  engine: 'browser' | 'zxing';
}

const wrap = (inner: NativeDetector, engine: Detector['engine']): Detector => ({
  engine,
  async detect(source) {
    const found = await inner.detect(source);
    const codes: string[] = [];
    for (const f of found) {
      if (!FORMATS.includes(f.format as Format)) continue;
      const code = normalizeBarcode(f.rawValue);
      if (code && !codes.includes(code)) codes.push(code);
    }
    return codes;
  },
});

async function zxingDetector(): Promise<Detector> {
  const [{ BarcodeDetector, prepareZXingModule }, wasm] = await Promise.all([import('barcode-detector/ponyfill'), import('zxing-wasm/reader/zxing_reader.wasm?url')]);
  const wasmUrl = wasm.default;
  // Serve the engine from this app (and so from its offline cache) rather than from a CDN.
  // `fireImmediately` loads the engine now, so a file that can't be fetched fails here (as "the reader couldn't be loaded")
  // and not later, in the middle of reading a picture.
  await prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) }, fireImmediately: true });
  return wrap(new BarcodeDetector({ formats: FORMATS }) as unknown as NativeDetector, 'zxing');
}

async function nativeDetector(): Promise<Detector | null> {
  const Native = (globalThis as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector;
  if (!Native) return null;
  try {
    const supported = (await Native.getSupportedFormats?.()) ?? [];
    if (!FORMATS.some((f) => supported.includes(f))) return null;
    return wrap(new Native({ formats: FORMATS.filter((f) => supported.includes(f)) }), 'browser');
  } catch {
    return null;
  }
}

/** The reader itself couldn't be loaded (blocked, or never cached and offline), as opposed to a picture it couldn't read. */
export class ReaderUnavailable extends Error {
  constructor() {
    super('The barcode reader could not be loaded.');
    this.name = 'ReaderUnavailable';
  }
}

let cached: Promise<Detector> | null = null;

/** The detector, created once. Safe to call early (for instance when the scanner opens) to start loading. */
export function loadDetector(): Promise<Detector> {
  cached ??= (async () => (await nativeDetector()) ?? (await zxingDetector()))().catch(() => {
    cached = null; // try again next time rather than remember a failure (a flaky connection, a blocked file)
    throw new ReaderUnavailable();
  });
  return cached;
}

/** Barcodes in a photo the person chose (a picture of the back label, or a screenshot). */
export async function detectInFile(file: Blob): Promise<string[]> {
  const detector = await loadDetector();
  const bitmap = await createImageBitmap(file);
  try {
    return await detector.detect(bitmap);
  } finally {
    bitmap.close();
  }
}
