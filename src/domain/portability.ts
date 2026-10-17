import type { CellarData, Colour, GrapeShare, Location, WineStyle } from './types';
import {
  BOTTLE_SIZES,
  BOX_MATERIALS,
  COLOURS,
  COLOUR_LABEL,
  DEFAULT_DIVISION_CAPACITY,
  LOCATION_KINDS,
  RATING_MAX,
  RATING_MIN,
  REMOVAL_REASONS,
  REVIEW_SOURCES,
  SCHEMA_VERSION,
  STANDARD_BOTTLE_ML,
  WINE_STYLES,
  defaultSettings,
} from './types';
import { addWine, findLocation, safeUrl, type PlacementInput, type PurchaseInput, type WineInput } from './actions';
import { parseCsvRows, toCsv } from './csv';
import { cleanText, isValidDate, newId, normalizeText, pad2 } from './text';
import { validateWindow } from './window';
import { buildRows } from './inventory';
import { STATUS_LABEL } from './window';

// ---- JSON backup -----------------------------------------------------------

export const BACKUP_APP = 'cellar-book';

export function serializeBackup(data: CellarData, now: Date = new Date()): string {
  return JSON.stringify({ app: BACKUP_APP, exportedAt: now.toISOString(), ...data }, null, 2);
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const optStr = (v: unknown) => v === undefined || isStr(v);
const optNum = (v: unknown) => v === undefined || isNum(v);
const oneOf = (list: readonly string[], v: unknown): v is string => isStr(v) && list.includes(v);

class Invalid extends Error {}

function expect(cond: boolean, message: string): asserts cond {
  if (!cond) throw new Invalid(message);
}

/**
 * Brings an older document up to the current version. Never throws on odd input (the validator
 * that follows reports problems); only transforms what it recognises.
 *
 * v1 → v2: the single wine "type" became colour + still/sparkling (+ sweet/fortified), and the
 * free-text vintage "location" became a real storage place holding that vintage's bottles.
 * Nothing is guessed: a v1 "sparkling" wine has no colour afterwards, because v1 never recorded it.
 */
export function migrateToCurrent(raw: unknown): unknown {
  if (!isObj(raw) || raw.schema !== 1) return raw;
  const arr = (k: string): Json[] => (Array.isArray(raw[k]) ? (raw[k] as unknown[]).filter(isObj) : []);

  const bottlings = arr('bottlings').map((b) => {
    const { type, ...rest } = b;
    const next: Json = { ...rest, sparkling: false };
    if (type === 'red' || type === 'white' || type === 'rose' || type === 'orange') next.colour = type;
    else if (type === 'sparkling') next.sparkling = true;
    else if (type === 'sweet') next.style = 'sweet';
    else if (type === 'fortified') next.style = 'fortified';
    return next;
  });

  const stock = new Map<string, number>();
  for (const p of arr('purchases')) if (isStr(p.vintageId) && isNum(p.quantity)) stock.set(p.vintageId, (stock.get(p.vintageId) ?? 0) + p.quantity);
  for (const c of arr('consumptions')) if (isStr(c.vintageId) && isNum(c.quantity)) stock.set(c.vintageId, (stock.get(c.vintageId) ?? 0) - c.quantity);

  const locations: Json[] = [];
  const byName = new Map<string, string>();
  const placements: Json[] = [];
  const vintages = arr('vintages').map((v) => {
    const { location, ...rest } = v;
    const name = isStr(location) ? location.trim() : '';
    const here = isStr(v.id) ? Math.max(0, stock.get(v.id) ?? 0) : 0;
    if (name) {
      const key = normalizeText(name);
      let id = byName.get(key);
      if (!id) {
        id = newId();
        byName.set(key, id);
        locations.push({ id, name, kind: 'other' });
      }
      if (here > 0) placements.push({ id: newId(), vintageId: v.id, locationId: id, quantity: here });
    }
    return rest;
  });

  const settings = isObj(raw.settings) ? raw.settings : {};
  return {
    ...raw,
    schema: 2,
    groups: [],
    bottlings,
    vintages,
    locations,
    placements,
    reviews: [],
    settings: { ...settings, divisionCapacity: DEFAULT_DIVISION_CAPACITY, customImpressions: [] },
  };
}

/** Validates the shape and the references of a cellar document. Never mutates or repairs it. */
export function validateData(input: unknown): CellarData {
  const raw = migrateToCurrent(input);
  expect(isObj(raw), 'This is not a Cellar Book file.');
  expect(isNum(raw.schema), 'This file has no version number, so it is not a Cellar Book backup.');
  expect(raw.schema <= SCHEMA_VERSION, 'This backup was made by a newer version of Cellar Book. Update the app and try again.');
  expect(raw.schema === SCHEMA_VERSION, `Unsupported backup version ${raw.schema}.`);
  for (const k of ['groups', 'producers', 'bottlings', 'vintages', 'purchases', 'consumptions', 'locations', 'placements', 'reviews'] as const) {
    expect(Array.isArray(raw[k]), `The backup is missing its "${k}" list.`);
  }
  const arr = (k: string) => raw[k] as unknown[];

  const groupIds = new Set<string>();
  arr('groups').forEach((g, i) => {
    expect(isObj(g) && isStr(g.id) && isStr(g.name), `groups[${i}] is malformed.`);
    expect(!groupIds.has(g.id), `groups[${i}] repeats an id.`);
    groupIds.add(g.id);
  });

  const producerIds = new Set<string>();
  arr('producers').forEach((p, i) => {
    expect(isObj(p) && isStr(p.id) && isStr(p.name) && optStr(p.groupId), `producers[${i}] is malformed.`);
    expect(p.groupId === undefined || groupIds.has(p.groupId as string), `producers[${i}] refers to an owner group that is not in the file.`);
    expect(!producerIds.has(p.id), `producers[${i}] repeats an id.`);
    producerIds.add(p.id);
  });

  const bottlingIds = new Set<string>();
  arr('bottlings').forEach((b, i) => {
    expect(isObj(b) && isStr(b.id) && isStr(b.producerId) && isStr(b.name), `bottlings[${i}] is malformed.`);
    expect(b.colour === undefined || oneOf(COLOURS, b.colour), `bottlings[${i}] has an unknown colour.`);
    expect(typeof b.sparkling === 'boolean', `bottlings[${i}] does not say whether it is sparkling.`);
    expect(b.style === undefined || oneOf(WINE_STYLES, b.style), `bottlings[${i}] has an unknown style.`);
    expect(optStr(b.country) && optStr(b.region) && optStr(b.appellation), `bottlings[${i}] has a malformed place name.`);
    expect(Array.isArray(b.grapes) && b.grapes.every((g) => isObj(g) && isStr(g.grape) && optNum(g.percent)), `bottlings[${i}] has malformed grapes.`);
    expect(producerIds.has(b.producerId), `bottlings[${i}] refers to a producer that is not in the file.`);
    expect(!bottlingIds.has(b.id), `bottlings[${i}] repeats an id.`);
    bottlingIds.add(b.id);
  });

  const vintageIds = new Set<string>();
  arr('vintages').forEach((v, i) => {
    expect(isObj(v) && isStr(v.id) && isStr(v.bottlingId), `vintages[${i}] is malformed.`);
    expect(v.year === null || (isNum(v.year) && Number.isInteger(v.year) && v.year >= 1800 && v.year <= 2200), `vintages[${i}] has a malformed year.`);
    expect(isNum(v.sizeMl) && Number.isInteger(v.sizeMl) && v.sizeMl >= 50 && v.sizeMl <= 30000, `vintages[${i}] has a malformed bottle size.`);
    expect(optNum(v.drinkFrom) && optNum(v.drinkTo) && optNum(v.peakFrom) && optNum(v.peakTo), `vintages[${i}] has a malformed drinking window.`);
    expect(
      Object.keys(validateWindow({ drinkFrom: v.drinkFrom as number | undefined, drinkTo: v.drinkTo as number | undefined, peakFrom: v.peakFrom as number | undefined, peakTo: v.peakTo as number | undefined })).length === 0,
      `vintages[${i}] has an impossible drinking window.`,
    );
    expect(optStr(v.notes), `vintages[${i}] has malformed text.`);
    expect(
      v.images === undefined || (isObj(v.images) && optStr(v.images.front) && optStr(v.images.back)),
      `vintages[${i}] has malformed label photos.`,
    );
    expect(bottlingIds.has(v.bottlingId), `vintages[${i}] refers to a bottling that is not in the file.`);
    expect(!vintageIds.has(v.id), `vintages[${i}] repeats an id.`);
    vintageIds.add(v.id);
  });

  const stock = new Map<string, number>();
  arr('purchases').forEach((p, i) => {
    expect(isObj(p) && isStr(p.id) && isStr(p.vintageId) && isNum(p.quantity), `purchases[${i}] is malformed.`);
    expect(Number.isInteger(p.quantity) && p.quantity >= 1, `purchases[${i}] has a quantity that is not a whole number of bottles.`);
    expect(p.date === undefined || (isStr(p.date) && isValidDate(p.date)), `purchases[${i}] has a malformed date.`);
    expect(optNum(p.unitPrice) && optStr(p.merchant) && optStr(p.notes), `purchases[${i}] has a malformed price or text.`);
    expect(p.unitPrice === undefined || (p.unitPrice as number) >= 0, `purchases[${i}] has a negative price.`);
    expect(vintageIds.has(p.vintageId), `purchases[${i}] refers to a wine that is not in the file.`);
    stock.set(p.vintageId, (stock.get(p.vintageId) ?? 0) + p.quantity);
  });

  arr('consumptions').forEach((c, i) => {
    expect(isObj(c) && isStr(c.id) && isStr(c.vintageId) && isNum(c.quantity) && isStr(c.date), `consumptions[${i}] is malformed.`);
    expect(Number.isInteger(c.quantity) && c.quantity >= 1, `consumptions[${i}] has a quantity that is not a whole number of bottles.`);
    expect(isValidDate(c.date) && c.date.length === 10, `consumptions[${i}] has a malformed date.`);
    expect(oneOf(REMOVAL_REASONS, c.reason), `consumptions[${i}] has an unknown reason.`);
    expect(optStr(c.notes) && optStr(c.locationId), `consumptions[${i}] has malformed notes.`);
    expect(
      c.rating === undefined || (isNum(c.rating) && c.rating >= RATING_MIN && c.rating <= RATING_MAX),
      `consumptions[${i}] has a rating outside ${RATING_MIN}–${RATING_MAX}.`,
    );
    expect(c.impressions === undefined || (Array.isArray(c.impressions) && c.impressions.every(isStr)), `consumptions[${i}] has malformed impressions.`);
    expect(vintageIds.has(c.vintageId), `consumptions[${i}] refers to a wine that is not in the file.`);
    stock.set(c.vintageId, (stock.get(c.vintageId) ?? 0) - c.quantity);
  });

  for (const [vid, left] of stock) expect(left >= 0, `The backup takes more bottles out of a wine than were ever bought (${vid}).`);

  const locationIds = new Map<string, number | undefined>();
  arr('locations').forEach((l, i) => {
    expect(isObj(l) && isStr(l.id) && isStr(l.name), `locations[${i}] is malformed.`);
    expect(oneOf(LOCATION_KINDS, l.kind), `locations[${i}] has an unknown kind.`);
    expect(l.capacity === undefined || (isNum(l.capacity) && l.capacity >= 1), `locations[${i}] has a malformed capacity.`);
    expect(l.material === undefined || oneOf(BOX_MATERIALS, l.material), `locations[${i}] has an unknown material.`);
    expect(!locationIds.has(l.id), `locations[${i}] repeats an id.`);
    locationIds.set(l.id, l.capacity as number | undefined);
  });

  const placedByVintage = new Map<string, number>();
  const usedByLocation = new Map<string, number>();
  const pairs = new Set<string>();
  arr('placements').forEach((p, i) => {
    expect(isObj(p) && isStr(p.id) && isStr(p.vintageId) && isStr(p.locationId) && isNum(p.quantity), `placements[${i}] is malformed.`);
    expect(Number.isInteger(p.quantity) && p.quantity >= 1, `placements[${i}] has a malformed quantity.`);
    expect(vintageIds.has(p.vintageId), `placements[${i}] refers to a wine that is not in the file.`);
    expect(locationIds.has(p.locationId), `placements[${i}] refers to a storage place that is not in the file.`);
    const pair = `${p.vintageId}|${p.locationId}`;
    expect(!pairs.has(pair), `placements[${i}] repeats a wine in the same place.`);
    pairs.add(pair);
    placedByVintage.set(p.vintageId, (placedByVintage.get(p.vintageId) ?? 0) + p.quantity);
    usedByLocation.set(p.locationId, (usedByLocation.get(p.locationId) ?? 0) + p.quantity);
  });
  for (const [vid, placed] of placedByVintage) {
    expect(placed <= Math.max(0, stock.get(vid) ?? 0), 'The backup places more bottles of a wine in the cellar than it owns.');
  }
  for (const [lid, used] of usedByLocation) {
    const cap = locationIds.get(lid);
    expect(cap === undefined || used <= cap, 'The backup puts more bottles in a storage place than it can hold.');
  }

  arr('reviews').forEach((r, i) => {
    expect(isObj(r) && isStr(r.id) && isStr(r.vintageId), `reviews[${i}] is malformed.`);
    expect(oneOf(REVIEW_SOURCES, r.source), `reviews[${i}] has an unknown source.`);
    expect(optStr(r.sourceName) && optStr(r.reviewer) && optStr(r.text) && optStr(r.date), `reviews[${i}] has malformed text.`);
    expect(optNum(r.score) && optNum(r.scale) && optNum(r.drinkFrom) && optNum(r.drinkTo), `reviews[${i}] has a malformed score or window.`);
    expect(
      (r.score === undefined || ((r.score as number) >= 0 && (r.scale === undefined || (r.scale as number) > 0 && (r.score as number) <= (r.scale as number)))),
      `reviews[${i}] has a score outside its scale.`,
    );
    expect(r.url === undefined || (isStr(r.url) && safeUrl(r.url) !== undefined), `reviews[${i}] has a link that is not a web address.`);
    expect(vintageIds.has(r.vintageId), `reviews[${i}] refers to a wine that is not in the file.`);
  });

  const s = isObj(raw.settings) ? raw.settings : {};
  const meta = isObj(raw.meta) ? raw.meta : {};
  const defaults = defaultSettings();
  return {
    schema: SCHEMA_VERSION,
    groups: raw.groups as CellarData['groups'],
    producers: raw.producers as CellarData['producers'],
    bottlings: raw.bottlings as CellarData['bottlings'],
    vintages: raw.vintages as CellarData['vintages'],
    purchases: raw.purchases as CellarData['purchases'],
    consumptions: raw.consumptions as CellarData['consumptions'],
    locations: raw.locations as CellarData['locations'],
    placements: raw.placements as CellarData['placements'],
    reviews: raw.reviews as CellarData['reviews'],
    settings: {
      currency: isStr(s.currency) && /^[A-Z]{3}$/.test(s.currency) ? s.currency : defaults.currency,
      drinkSoonYears: isNum(s.drinkSoonYears) ? Math.min(5, Math.max(0, Math.round(s.drinkSoonYears))) : defaults.drinkSoonYears,
      divisionCapacity: isNum(s.divisionCapacity) ? Math.min(1000, Math.max(1, Math.round(s.divisionCapacity))) : defaults.divisionCapacity,
      customImpressions: Array.isArray(s.customImpressions) ? s.customImpressions.filter(isStr) : [],
    },
    meta: isStr(meta.lastBackupAt) ? { lastBackupAt: meta.lastBackupAt } : {},
  };
}

export type ParseResult = { ok: true; data: CellarData } | { ok: false; error: string };

export function parseBackup(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This file is not valid JSON, so it can’t be a Cellar Book backup.' };
  }
  try {
    return { ok: true, data: validateData(raw) };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.message };
    throw e;
  }
}

// ---- CSV export ------------------------------------------------------------

export const CSV_COLUMNS = [
  'producer',
  'group',
  'bottling',
  'vintage',
  'colour',
  'sparkling',
  'style',
  'size_ml',
  'country',
  'region',
  'appellation',
  'varieties',
  'bottles',
  'avg_price_paid',
  'total_spent',
  'first_purchase',
  'last_purchase',
  'drink_from',
  'drink_to',
  'peak_from',
  'peak_to',
  'window_status',
  'locations',
  'my_rating',
  'notes',
] as const;

export function formatGrapes(grapes: GrapeShare[]): string {
  return grapes.map((g) => (g.percent !== undefined ? `${g.grape} ${g.percent}%` : g.grape)).join('; ');
}

/** "Division 12: 6; Division 13: 3". */
export function formatPlacements(placements: { location: Location; quantity: number }[]): string {
  return placements.map((p) => `${p.location.name}: ${p.quantity}`).join('; ');
}

/** The wines currently in the cellar, one row each — for spreadsheets, not for backup. */
export function exportInventoryCsv(data: CellarData, delimiter = ',', now: Date = new Date()): string {
  const rows = buildRows(data, now).filter((r) => r.bottles > 0);
  rows.sort((a, b) => a.producer.name.localeCompare(b.producer.name) || a.bottling.name.localeCompare(b.bottling.name) || (b.vintage.year ?? 0) - (a.vintage.year ?? 0));
  const body = rows.map((r) => [
    r.producer.name,
    r.group?.name,
    r.bottling.name,
    r.vintage.year === null ? 'NV' : r.vintage.year,
    r.bottling.colour ? COLOUR_LABEL[r.bottling.colour] : '',
    r.bottling.sparkling ? 'yes' : 'no',
    r.bottling.style,
    r.vintage.sizeMl,
    r.bottling.country,
    r.bottling.region,
    r.bottling.appellation,
    formatGrapes(r.bottling.grapes),
    r.bottles,
    r.avgPrice === null ? '' : Number(r.avgPrice.toFixed(2)),
    r.pricedBottles > 0 ? Number(r.spent.toFixed(2)) : '',
    r.firstPurchase,
    r.lastPurchase,
    r.vintage.drinkFrom,
    r.vintage.drinkTo,
    r.vintage.peakFrom,
    r.vintage.peakTo,
    STATUS_LABEL[r.status],
    formatPlacements(r.placements),
    r.rating === null ? '' : Number(r.rating.toFixed(1)),
    r.vintage.notes,
  ]);
  return toCsv([[...CSV_COLUMNS], ...body], delimiter);
}

// ---- CSV import ------------------------------------------------------------

type Field =
  | 'producer'
  | 'group'
  | 'bottling'
  | 'vintage'
  | 'colour'
  | 'sparkling'
  | 'style'
  | 'type'
  | 'size'
  | 'country'
  | 'region'
  | 'appellation'
  | 'grapes'
  | 'bottles'
  | 'price'
  | 'date'
  | 'merchant'
  | 'drinkFrom'
  | 'drinkTo'
  | 'peakFrom'
  | 'peakTo'
  | 'locations'
  | 'notes';

/** Header spellings we recognise, compared after stripping everything but letters and digits. */
const HEADER_ALIASES: Record<Field, string[]> = {
  producer: ['producer', 'winery', 'domaine', 'estate', 'chateau', 'maker', 'producteur'],
  group: ['group', 'ownergroup', 'owner', 'family', 'parent', 'parentcompany', 'company', 'wineryowner', 'wineryfamily'],
  bottling: ['bottling', 'cuvee', 'wine', 'winename', 'label', 'name', 'wines'],
  vintage: ['vintage', 'year', 'millesime'],
  colour: ['colour', 'color', 'winecolour', 'winecolor', 'couleur'],
  sparkling: ['sparkling', 'fizz', 'effervescence', 'bubbles', 'stillorsparkling', 'stillsparkling'],
  style: ['style'],
  type: ['type', 'winetype', 'kind'],
  size: ['sizeml', 'size', 'bottlesize', 'format', 'volume'],
  country: ['country', 'pays'],
  region: ['region'],
  appellation: ['appellation', 'aoc', 'doc', 'docg', 'denomination', 'aop'],
  grapes: ['varieties', 'variety', 'grapes', 'grape', 'varietals', 'varietal', 'blend', 'cepage', 'cepages', 'grapevarieties'],
  bottles: ['bottles', 'quantity', 'qty', 'count', 'stock', 'instock', 'bottlesinstock', 'nbottles', 'numberofbottles'],
  price: ['price', 'unitprice', 'priceperbottle', 'avgpricepaid', 'avgprice', 'paid', 'cost', 'pricepaid'],
  date: ['purchasedate', 'date', 'bought', 'boughton', 'dateofpurchase', 'lastpurchase', 'purchased'],
  merchant: ['merchant', 'shop', 'supplier', 'vendor', 'source', 'seller', 'boughtfrom'],
  drinkFrom: ['drinkfrom', 'from', 'windowfrom', 'drinkingfrom', 'startdrinking', 'drinkafter', 'drinkingwindowfrom'],
  drinkTo: ['drinkto', 'to', 'until', 'windowto', 'drinkby', 'drinkingto', 'enddrinking', 'drinkbefore', 'drinkingwindowto'],
  peakFrom: ['peakfrom', 'peakstart'],
  peakTo: ['peakto', 'peakend'],
  locations: ['locations', 'location', 'rack', 'position', 'cellarlocation', 'bin', 'shelf', 'division', 'storage', 'slot'],
  notes: ['notes', 'note', 'comments', 'comment'],
};

const COLOUR_ALIASES: Record<string, Colour> = {
  red: 'red', rouge: 'red', rosso: 'red', tinto: 'red', rot: 'red', rouges: 'red', ερυθρο: 'red', κοκκινο: 'red',
  white: 'white', blanc: 'white', bianco: 'white', blanco: 'white', weiss: 'white', blancs: 'white', λευκο: 'white',
  rose: 'rose', pink: 'rose', rosato: 'rose', rosado: 'rose', ροζε: 'rose',
  orange: 'orange', amber: 'orange', skincontact: 'orange', πορτοκαλι: 'orange',
};

const SPARKLING_WORDS = new Set(['sparkling', 'champagne', 'cava', 'prosecco', 'spumante', 'cremant', 'fizz', 'sekt', 'bubbly', 'franciacorta', 'petnat', 'cap', 'mousseux', 'frizzante', 'αφρωδης', 'αφρωδες']);
const STILL_WORDS = new Set(['still', 'quiet', 'tranquille', 'stille', 'tranquillo', 'dry']);

const key = (s: string) => normalizeText(s).replace(/[^\p{L}\p{N}]/gu, '');

const own = <T,>(map: Record<string, T>, k: string): T | undefined => (Object.hasOwn(map, k) ? map[k] : undefined);

export function parseColour(s: string): Colour | null {
  return own(COLOUR_ALIASES, key(s)) ?? null;
}

/** true = sparkling, false = still, null = not understood. */
export function parseFizz(s: string): boolean | null {
  const k = key(s);
  if (SPARKLING_WORDS.has(k) || ['yes', 'y', 'true', '1', 'oui', 'ναι'].includes(k)) return true;
  if (STILL_WORDS.has(k) || ['no', 'n', 'false', '0', 'non', 'οχι'].includes(k)) return false;
  return null;
}

export function parseStyle(s: string): WineStyle | null {
  const k = key(s);
  if (['sweet', 'dessert', 'sauternes', 'botrytis', 'moelleux', 'liquoroso', 'γλυκο'].includes(k)) return 'sweet';
  if (['fortified', 'port', 'sherry', 'madeira', 'marsala', 'porto', 'muté', 'mute'].includes(k)) return 'fortified';
  return null;
}

/**
 * The old single "Type" column ("Red", "Champagne", "Port"…) read as colour, still/sparkling and
 * style at once. Only what the word actually says is returned.
 */
export function parseWineType(s: string): { colour?: Colour; sparkling?: boolean; style?: WineStyle } | null {
  const colour = parseColour(s);
  const fizz = parseFizz(s);
  const style = parseStyle(s);
  if (colour === null && fizz === null && style === null) return null;
  return { ...(colour ? { colour } : {}), ...(fizz === true ? { sparkling: true } : {}), ...(style ? { style } : {}) };
}

/**
 * Understands "12", "12.50", "12,50", "1.234,56", "1,234.56", "1.500" and "€12,50".
 * A dot or comma followed by exactly three digits is a thousands separator ("1.500" and "1,500"
 * are both fifteen hundred, as in a spreadsheet kept in Greek or German). Anything else after a
 * single separator is a decimal part. The one exception is a leading zero: "0.750" is three quarters.
 */
export function parseNumber(s: string): number | null {
  let t = s.replace(/[^\d.,-]/g, '');
  if (!t || !/\d/.test(t)) return null;
  const lastDot = t.lastIndexOf('.');
  const lastComma = t.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? '.' : ',';
    const thousands = decimal === '.' ? ',' : '.';
    t = t.split(thousands).join('').replace(decimal, '.');
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? ',' : '.';
    const groups = new RegExp(`^-?[1-9]\\d{0,2}(\\${sep}\\d{3})+$`);
    t = groups.test(t) ? t.split(sep).join('') : t.replace(sep, '.');
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Accepts ISO dates, `dd/mm/yyyy` (day first — the European reading), `mm/yyyy` and bare years.
 * Returns `YYYY-MM-DD`, `YYYY-MM` or `YYYY`, or null if it can't be read.
 */
export function parseDateLoose(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(t);
  if (m) return finishDate(m[1] as string, m[2] as string, m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t);
  if (m) return finishDate(m[3] as string, m[2] as string, m[1]);
  m = /^(\d{4})[-/.](\d{1,2})$/.exec(t);
  if (m) return finishDate(m[1] as string, m[2] as string);
  m = /^(\d{1,2})[-/.](\d{4})$/.exec(t);
  if (m) return finishDate(m[2] as string, m[1] as string);
  m = /^(\d{4})$/.exec(t);
  if (m) return finishDate(m[1] as string);
  return null;
}

function finishDate(y: string, mo?: string, d?: string): string | null {
  const out = d !== undefined ? `${y}-${pad2(Number(mo))}-${pad2(Number(d))}` : mo !== undefined ? `${y}-${pad2(Number(mo))}` : y;
  return isValidDate(out) ? out : null;
}

export function parseSize(s: string): number | null {
  const t = normalizeText(s).replace(/\s+/g, '');
  const names: Record<string, number> = { piccolo: 187, half: 375, demi: 375, standard: 750, magnum: 1500, doublemagnum: 3000, jeroboam: 3000, rehoboam: 4500, imperial: 6000 };
  const named = own(names, t);
  if (named !== undefined) return named;
  const m = /^(\d+(?:[.,]\d+)?)(ml|cl|l|lt|litre|liter)?$/.exec(t);
  if (!m) return null;
  const n = Number((m[1] as string).replace(',', '.'));
  const unit = m[2];
  if (unit === 'ml') return n;
  if (unit === 'cl') return n * 10;
  if (unit) return n * 1000;
  // Bare numbers: 0.75 / 1.5 are litres, 75 is centilitres, 750 is millilitres.
  if (n < 20) return n * 1000;
  if (n < 400 && BOTTLE_SIZES.some((b) => b.ml === n * 10)) return n * 10;
  return n;
}

export function parseGrapes(s: string): GrapeShare[] {
  // A comma is a separator, except inside brackets or as a decimal comma between digits ("Merlot 12,5%").
  const parts = s.split(/[;|/]|,(?!\d)(?![^(]*\))/).map((p) => p.trim()).filter(Boolean);
  return parts.map((part) => {
    const m = /^(.*?)[\s:–-]*(\d+(?:[.,]\d+)?)\s*%$/.exec(part) ?? /^(.*?)\s*[:(]\s*(\d+(?:[.,]\d+)?)\s*%?\)?$/.exec(part);
    if (m && m[1]?.trim()) return { grape: m[1].trim(), percent: Number((m[2] as string).replace(',', '.')) };
    return { grape: part };
  });
}

/**
 * "Division 12: 6; Division 13: 3", "12: 6; 13: 3", "12" or "Wooden box A".
 * A bare number means "Division N"; a name with no count takes every bottle of the row.
 */
export function parseLocations(s: string): { name: string; quantity?: number }[] {
  return s
    .split(/[;|]/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((part) => {
      const m = /^(.*?)\s*[:=×x]\s*(\d+)$/.exec(part);
      const rawName = (m ? (m[1] as string) : part).trim();
      const name = /^\d+$/.test(rawName) ? `Division ${rawName}` : rawName;
      return m ? { name, quantity: Number(m[2]) } : { name };
    });
}

function inferLocation(name: string, capacity: number): Omit<Location, 'id'> {
  if (/^division\s+\S+$/i.test(name)) return { name, kind: 'division', capacity };
  if (/box|crate|carton|case|wood|cardboard|κιβ/i.test(name)) {
    return { name, kind: 'box', material: /carton|cardboard|case/i.test(name) ? 'carton' : /wood|crate/i.test(name) ? 'wooden' : undefined };
  }
  return { name, kind: 'other' };
}

export interface CsvImportReport {
  data: CellarData;
  /** Spreadsheet rows that became (or were added to) a wine. */
  imported: number;
  /** Rows that matched a wine already in the cellar (or earlier in the file). */
  merged: number;
  bottles: number;
  warnings: string[];
  errors: { row: number; message: string }[];
  /** Columns we recognised, so the user can see what was understood. */
  recognised: string[];
  ignored: string[];
}

const FIELD_LABEL: Record<Field, string> = {
  producer: 'Producer', group: 'Owner group', bottling: 'Bottling', vintage: 'Vintage', colour: 'Colour', sparkling: 'Sparkling', style: 'Style', type: 'Type',
  size: 'Size', country: 'Country', region: 'Region', appellation: 'Appellation', grapes: 'Varieties', bottles: 'Bottles', price: 'Price',
  date: 'Purchase date', merchant: 'Merchant', drinkFrom: 'Drink from', drinkTo: 'Drink to', peakFrom: 'Peak from', peakTo: 'Peak to',
  locations: 'Storage places', notes: 'Notes',
};

export function importInventoryCsv(data: CellarData, text: string, now: Date = new Date()): CsvImportReport {
  const table = parseCsvRows(text);
  const report: CsvImportReport = { data, imported: 0, merged: 0, bottles: 0, warnings: [], errors: [], recognised: [], ignored: [] };
  const header = table[0]?.cells;
  if (!header) {
    report.errors.push({ row: 0, message: 'The file is empty.' });
    return report;
  }

  const columnOf = new Map<Field, number>();
  header.forEach((h, idx) => {
    const k = key(h);
    const field = (Object.keys(HEADER_ALIASES) as Field[]).find((f) => HEADER_ALIASES[f].includes(k) && !columnOf.has(f));
    if (field) {
      columnOf.set(field, idx);
      report.recognised.push(`${h.trim()} → ${FIELD_LABEL[field]}`);
    } else if (h.trim()) report.ignored.push(h.trim());
  });

  if (!columnOf.has('producer') || !columnOf.has('bottling')) {
    report.errors.push({
      row: table[0]?.line ?? 1,
      message: 'The first row must name the columns, and at least “Producer” and “Bottling” (or “Wine”/“Cuvée”) are required.',
    });
    return report;
  }
  if (!columnOf.has('bottles')) report.warnings.push('No “Bottles” column found, so every row was counted as 1 bottle.');
  if (!columnOf.has('colour') && !columnOf.has('type')) report.warnings.push('No “Colour” column found: colours were left blank. You can set the colour on each wine afterwards.');

  const cell = (row: string[], f: Field): string => {
    const idx = columnOf.get(f);
    const raw = idx === undefined ? '' : (row[idx] ?? '').trim();
    // Our own export prefixes text that looks like a spreadsheet formula with an apostrophe; take it off again.
    return /^'[=+\-@]/.test(raw) ? raw.slice(1) : raw;
  };
  if (!columnOf.has('vintage')) report.warnings.push('No “Vintage” column found, so every wine was imported as non-vintage (NV).');
  let blankVintages = 0;

  let current = data;
  let unknownColours = 0;
  let placementProblems = 0;
  let placedBottles = 0;
  for (let r = 1; r < table.length; r++) {
    const { cells: row, line } = table[r] as { cells: string[]; line: number };
    const fail = (message: string) => report.errors.push({ row: line, message });

    const producer = cell(row, 'producer');
    const bottling = cell(row, 'bottling');
    if (!producer) { fail('Missing producer.'); continue; }
    if (!bottling) { fail('Missing bottling / wine name.'); continue; }

    const vintageText = cell(row, 'vintage');
    let year: number | null = null;
    if (!vintageText && columnOf.has('vintage')) blankVintages++;
    if (vintageText && !/^(nv|n\.?v\.?|non[- ]?vintage|n\/v)$/i.test(vintageText)) {
      const y = Number(vintageText);
      if (!Number.isInteger(y)) { fail(`Vintage “${vintageText}” is not a year (use a year, or NV).`); continue; }
      year = y;
    }

    // Colour, still/sparkling and style can come from their own columns or from a combined "Type".
    let colour: Colour | undefined;
    let sparkling: boolean | undefined;
    let style: WineStyle | undefined;
    const typeText = cell(row, 'type');
    if (typeText) {
      const t = parseWineType(typeText);
      if (t) ({ colour, sparkling, style } = t);
      else unknownColours++;
    }
    const colourText = cell(row, 'colour');
    if (colourText) {
      const c = parseColour(colourText);
      if (c) colour = c;
      else unknownColours++;
    }
    const sparklingText = cell(row, 'sparkling');
    if (sparklingText) {
      const f = parseFizz(sparklingText);
      if (f !== null) sparkling = f;
    }
    const styleText = cell(row, 'style');
    if (styleText) {
      const f = parseFizz(styleText);
      if (f === true) sparkling = true;
      else if (f === false) sparkling = sparkling ?? false;
      const st = parseStyle(styleText);
      if (st) style = st;
      const c = parseColour(styleText);
      if (c && !colour) colour = c;
    }

    let sizeMl = STANDARD_BOTTLE_ML;
    const sizeText = cell(row, 'size');
    if (sizeText) {
      const s = parseSize(sizeText);
      if (s === null) { fail(`Bottle size “${sizeText}” was not understood.`); continue; }
      sizeMl = Math.round(s);
    }

    let quantity = 1;
    const qText = cell(row, 'bottles');
    if (columnOf.has('bottles')) {
      const q = parseNumber(qText);
      if (q === null || !Number.isInteger(q) || q < 0) { fail(`Bottle count “${qText}” is not a whole number.`); continue; }
      quantity = q;
    }

    const yearField = (f: Field): number | undefined | 'bad' => {
      const t = cell(row, f);
      if (!t) return undefined;
      const n = parseNumber(t);
      return n === null || !Number.isInteger(n) ? 'bad' : n;
    };
    const drinkFrom = yearField('drinkFrom');
    const drinkTo = yearField('drinkTo');
    const peakFrom = yearField('peakFrom');
    const peakTo = yearField('peakTo');
    if ([drinkFrom, drinkTo, peakFrom, peakTo].includes('bad')) { fail('A drinking-window year is not a whole number.'); continue; }

    const priceText = cell(row, 'price');
    let unitPrice: number | undefined;
    if (priceText) {
      const p = parseNumber(priceText);
      if (p === null || p < 0) { fail(`Price “${priceText}” was not understood.`); continue; }
      unitPrice = p;
    }

    const dateText = cell(row, 'date');
    let date: string | undefined;
    if (dateText) {
      const d = parseDateLoose(dateText);
      if (d === null) { fail(`Purchase date “${dateText}” was not understood (use YYYY-MM-DD or DD/MM/YYYY).`); continue; }
      date = d;
    }

    // Storage places: create any that don't exist yet, then assign bottles to them.
    const wanted = quantity > 0 ? parseLocations(cell(row, 'locations')) : [];
    let withLocations = current;
    const plan: PlacementInput[] = [];
    let left = quantity;
    for (const w of wanted) {
      let loc = findLocation(withLocations, w.name);
      if (!loc) {
        loc = { id: newId(), ...inferLocation(w.name, withLocations.settings.divisionCapacity) };
        withLocations = { ...withLocations, locations: [...withLocations.locations, loc] };
      }
      const q = Math.min(w.quantity ?? left, left);
      if (q > 0) {
        plan.push({ locationId: loc.id, quantity: q });
        left -= q;
      }
    }

    const input: WineInput = {
      producer,
      group: cleanText(cell(row, 'group')),
      bottling,
      colour,
      sparkling,
      style,
      country: cleanText(cell(row, 'country')),
      region: cleanText(cell(row, 'region')),
      appellation: cleanText(cell(row, 'appellation')),
      grapes: parseGrapes(cell(row, 'grapes')),
      year,
      sizeMl,
      drinkFrom: drinkFrom as number | undefined,
      drinkTo: drinkTo as number | undefined,
      peakFrom: peakFrom as number | undefined,
      peakTo: peakTo as number | undefined,
      windowSource: 'manual',
      notes: cleanText(cell(row, 'notes')),
    };
    const purchase: PurchaseInput | undefined =
      quantity > 0 ? { quantity, unitPrice, date, merchant: cleanText(cell(row, 'merchant')) } : undefined;

    let result = addWine(withLocations, input, purchase, now, plan);
    if (!result.ok && plan.length) {
      // The wine itself is fine; it's the storage assignment that didn't fit (for example a full division).
      placementProblems++;
      report.warnings.push(`Row ${line}: ${result.fieldErrors?.placements ?? result.error} — imported without a storage place.`);
      result = addWine(current, input, purchase, now);
    } else if (result.ok) {
      placedBottles += plan.reduce((n, p) => n + p.quantity, 0);
    }
    if (!result.ok) { fail(result.error); continue; }
    current = result.data;
    report.imported++;
    report.bottles += quantity;
    if (result.merged) report.merged++;
  }

  if (blankVintages > 0) report.warnings.push(`${blankVintages} row${blankVintages === 1 ? ' has' : 's have'} no vintage and ${blankVintages === 1 ? 'was' : 'were'} imported as non-vintage (NV). Write “NV” in the column if that is right.`);
  if (unknownColours > 0) report.warnings.push(`${unknownColours} row${unknownColours === 1 ? ' has' : 's have'} a colour that wasn’t recognised and was left blank.`);
  if (report.imported > 0 && columnOf.has('drinkFrom') === false && columnOf.has('drinkTo') === false) {
    report.warnings.push('No drinking-window columns found. Open a wine to set its window, or use the “estimate” buttons.');
  }
  if (placedBottles > 0 && placementProblems === 0) report.warnings.push(`${placedBottles} bottle${placedBottles === 1 ? ' was' : 's were'} given a storage place.`);
  report.data = current;
  return report;
}
