import type { Colour, WineStyle } from '../domain/types';

/**
 * Looks a barcode up in Open Food Facts, a free, community-kept product database (open data, no key,
 * no account). Wines are only patchily covered there: many bottles are simply not listed, and what is
 * listed was typed in by volunteers. So the result is only ever a *suggestion* for the add form, to be
 * checked against the label, and a wine that isn't found is not an error.
 *
 * Privacy: the only thing sent is the barcode number (no cookies, no referrer), and only when the person
 * asks for the lookup (or has chosen to have it done automatically).
 */

export const LOOKUP_SOURCE = 'Open Food Facts';
const ENDPOINT = 'https://world.openfoodfacts.org/api/v2/product/';
const FIELDS = ['product_name', 'product_name_en', 'generic_name', 'brands', 'quantity', 'categories_tags', 'categories', 'origins_tags', 'countries_tags', 'image_front_small_url'];
const TIMEOUT_MS = 8000;

export interface ProductGuess {
  code: string;
  /** What the database calls it, exactly. */
  title: string;
  /** Best guess at the winery (the database's "brand"). */
  winery?: string;
  /** The title with the winery and the year taken out, as a starting point for the bottling name. */
  bottling?: string;
  year?: number;
  sizeMl?: number;
  colour?: Colour;
  sparkling?: boolean;
  style?: WineStyle;
  country?: string;
  imageUrl?: string;
  /** False when the entry is clearly something else (water, a spirit): shown, but not offered as a wine. */
  isWine: boolean;
}

export type LookupResult =
  | { kind: 'found'; product: ProductGuess }
  | { kind: 'not-found' }
  | { kind: 'failed'; reason: 'offline' | 'busy' | 'error' };

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const tags = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((t) => t.toLowerCase()) : []);

/** "75 cl", "0,75 l", "750ml e": the volume in ml, or undefined (also for multipacks like "6 x 75 cl"). */
export function parseQuantity(quantity: string | undefined): number | undefined {
  if (!quantity || /\d\s*[x×]\s*\d/i.test(quantity)) return undefined;
  const m = /(\d+(?:[.,]\d+)?)\s*(ml|cl|l|lt|litre|liter)s?\b/i.exec(quantity);
  if (!m) return undefined;
  const n = Number((m[1] as string).replace(',', '.'));
  const unit = (m[2] as string).toLowerCase();
  const ml = Math.round(unit === 'ml' ? n : unit === 'cl' ? n * 10 : n * 1000);
  return ml >= 50 && ml <= 30000 ? ml : undefined;
}

const has = (all: string[], ...needles: RegExp[]) => all.some((t) => needles.some((n) => n.test(t)));

const COUNTRIES: Record<string, string> = {
  france: 'France', italy: 'Italy', italie: 'Italy', italia: 'Italy', spain: 'Spain', espagne: 'Spain', espana: 'Spain', portugal: 'Portugal', germany: 'Germany', allemagne: 'Germany',
  austria: 'Austria', greece: 'Greece', grece: 'Greece', switzerland: 'Switzerland', suisse: 'Switzerland', hungary: 'Hungary', romania: 'Romania', 'united-states': 'USA', 'united-kingdom': 'United Kingdom',
  australia: 'Australia', 'new-zealand': 'New Zealand', chile: 'Chile', argentina: 'Argentina', 'south-africa': 'South Africa', lebanon: 'Lebanon', georgia: 'Georgia', slovenia: 'Slovenia',
  croatia: 'Croatia', bulgaria: 'Bulgaria', cyprus: 'Cyprus', canada: 'Canada', uruguay: 'Uruguay', brazil: 'Brazil', israel: 'Israel', morocco: 'Morocco', moldova: 'Moldova',
};

function countryOf(origins: string[], sold: string[]): string | undefined {
  // Where it is *made* (origins) is what a wine's country means; where it is *sold* is only used when it names exactly one.
  const pick = (list: string[]) => {
    const named = [...new Set(list.map((t) => COUNTRIES[t.replace(/^[a-z]{2}:/, '')]).filter((c): c is string => !!c))];
    return named.length === 1 ? named[0] : undefined;
  };
  return pick(origins) ?? (sold.length === 1 ? pick(sold) : undefined);
}

/** Turns an Open Food Facts product record into a suggestion. Defensive: any field may be missing or odd. */
export function parseProduct(code: string, record: unknown): ProductGuess | null {
  if (typeof record !== 'object' || record === null) return null;
  const p = record as Record<string, unknown>;
  const title = str(p.product_name) ?? str(p.product_name_en) ?? str(p.generic_name);
  if (!title) return null;

  const cats = [...tags(p.categories_tags), ...(str(p.categories) ?? '').toLowerCase().split(',').map((c) => c.trim())];
  const words = `${title} ${cats.join(' ')}`.toLowerCase();

  const sparkling = has(cats, /sparkling|champagne|cremant|prosecco|cava\b|sekt|spumante|mousseux|petillant|frizzante|franciacorta|lambrusco|pet-?nat/) || /\b(champagne|prosecco|cava|cr[ée]mant|spumante|sekt|brut)\b/.test(words) || undefined;
  const style: WineStyle | undefined = has(cats, /fortified|\bports?\b|sherry|madeira|marsala|muscat-de|vins?-doux-naturels|vins?-de-liqueur/) ? 'fortified' : has(cats, /sweet-wine|dessert-wine|late-harvest|vins?-liquoreux|sauternes|moelleux/) ? 'sweet' : undefined;
  let colour: Colour | undefined;
  if (has(cats, /orange-wine/)) colour = 'orange';
  else if (has(cats, /ros[eé]-wine|vins?-ros[eé]s?|rosado|rosato|\bros[eé]s?\b/) || /\bros[eé]\b/.test(words)) colour = 'rose';
  else if (has(cats, /red-wine|vins?-rouges?|vino-tinto|vini-rossi|rotwein/) || /\b(rouge|rosso|tinto)\b/.test(words)) colour = 'red';
  else if (has(cats, /white-wine|vins?-blancs?|vino-blanco|vini-bianchi|weisswein|blanc-de-blancs|blanc-de-noirs/) || /\b(blanc|bianco|blanco)\b/.test(words)) colour = 'white';

  const isWine = has(cats, /\bwines?\b|-wines?\b|champagne|vins?\b|vino|prosecco|cava\b|cremant|sekt|spumante|\bports?\b|sherry|madeira|marsala/) || /\b(wine|vin|vino|champagne|prosecco|cava|chateau|château|domaine)\b/i.test(title);

  const winery = str(p.brands)?.split(',')[0]?.trim() || undefined;
  const years = [...title.matchAll(/\b(19\d{2}|20\d{2})\b/g)].map((m) => Number(m[1]));
  const year = new Set(years).size === 1 ? years[0] : undefined;
  let bottling = title;
  if (winery && bottling.toLowerCase().startsWith(winery.toLowerCase())) bottling = bottling.slice(winery.length);
  if (year !== undefined) bottling = bottling.replace(new RegExp(`\\b${year}\\b`), '');
  bottling = bottling.replace(/\s{2,}/g, ' ').replace(/^[\s\-–,·:]+|[\s\-–,·:]+$/g, '');

  return {
    code,
    title,
    winery,
    bottling: bottling || undefined,
    year,
    sizeMl: parseQuantity(str(p.quantity)),
    colour,
    sparkling,
    style,
    country: countryOf(tags(p.origins_tags), tags(p.countries_tags)),
    imageUrl: /^https:\/\//.test(str(p.image_front_small_url) ?? '') ? str(p.image_front_small_url) : undefined,
    isWine,
  };
}

/** Asks Open Food Facts about one barcode. Never throws: every outcome is a {@link LookupResult}. */
export async function lookupBarcode(code: string, fetchImpl: typeof fetch = fetch): Promise<LookupResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${ENDPOINT}${encodeURIComponent(code)}.json?fields=${FIELDS.join(',')}`, {
      signal: controller.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { accept: 'application/json' },
    });
    if (res.status === 404) return { kind: 'not-found' };
    if (res.status === 429 || res.status >= 500) return { kind: 'failed', reason: 'busy' };
    if (!res.ok) return { kind: 'failed', reason: 'error' };
    const body: unknown = await res.json().catch(() => null);
    if (typeof body !== 'object' || body === null) return { kind: 'failed', reason: 'error' };
    const status = (body as { status?: unknown }).status;
    if (status === 0 || status === 'failure') return { kind: 'not-found' };
    const product = parseProduct(code, (body as { product?: unknown }).product);
    return product ? { kind: 'found', product } : { kind: 'not-found' };
  } catch {
    return { kind: 'failed', reason: typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'error' };
  } finally {
    clearTimeout(timer);
  }
}
