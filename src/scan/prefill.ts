import { normalizeBarcode } from '../domain/barcode';
import { COLOURS, WINE_STYLES, type Colour, type WineStyle } from '../domain/types';
import type { ProductGuess } from './lookup';

/**
 * What a scan hands to the add-a-wine form. It travels in the address (`#/wine/new?winery=…`), so it
 * survives a reload and needs no shared state, and it is checked on the way in: the form never
 * trusts a link any more than it trusts typing.
 */
export interface Prefill {
  barcode?: string;
  winery?: string;
  bottling?: string;
  /** Start from this bottling you already have (its winery and name are filled in, and locked, by the form). */
  bottlingId?: string;
  year?: number;
  sizeMl?: number;
  colour?: Colour;
  sparkling?: boolean;
  style?: WineStyle;
  country?: string;
}

export function prefillFromProduct(p: ProductGuess): Prefill {
  const out: Prefill = { barcode: p.code };
  if (p.winery) out.winery = p.winery;
  if (p.bottling) out.bottling = p.bottling;
  if (p.year !== undefined) out.year = p.year;
  if (p.sizeMl !== undefined) out.sizeMl = p.sizeMl;
  if (p.colour) out.colour = p.colour;
  if (p.sparkling) out.sparkling = true;
  if (p.style) out.style = p.style;
  if (p.country) out.country = p.country;
  return out;
}

export function prefillToSearch(p: Prefill): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined || v === '') continue;
    q.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
  }
  return q.toString();
}

const text = (v: string | null): string | undefined => {
  const t = v?.trim().slice(0, 200);
  return t ? t : undefined;
};

export function prefillFromSearch(q: URLSearchParams): Prefill {
  const out: Prefill = {};
  const barcode = normalizeBarcode(q.get('barcode') ?? '');
  if (barcode) out.barcode = barcode;
  const winery = text(q.get('winery'));
  if (winery) out.winery = winery;
  const bottling = text(q.get('bottling'));
  if (bottling) out.bottling = bottling;
  const bottlingId = text(q.get('bottlingId'));
  if (bottlingId) out.bottlingId = bottlingId;
  const year = Number(q.get('year'));
  if (/^\d{4}$/.test(q.get('year') ?? '') && year >= 1800 && year <= 2200) out.year = year;
  const size = Number(q.get('sizeMl'));
  if (/^\d+$/.test(q.get('sizeMl') ?? '') && size >= 50 && size <= 30000) out.sizeMl = size;
  const colour = q.get('colour');
  if (colour && (COLOURS as readonly string[]).includes(colour)) out.colour = colour as Colour;
  if (q.get('sparkling') === '1') out.sparkling = true;
  const style = q.get('style');
  if (style && (WINE_STYLES as readonly string[]).includes(style)) out.style = style as WineStyle;
  const country = text(q.get('country'));
  if (country) out.country = country;
  return out;
}
