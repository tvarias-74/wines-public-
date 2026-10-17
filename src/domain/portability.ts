import type { CellarData, GrapeShare, WineType } from './types';
import { BOTTLE_SIZES, REMOVAL_REASONS, SCHEMA_VERSION, STANDARD_BOTTLE_ML, WINE_TYPES, WINE_TYPE_LABEL } from './types';
import { addWine, type PurchaseInput, type WineInput } from './actions';
import { parseCsv, toCsv } from './csv';
import { cleanText, isValidDate, normalizeText, pad2 } from './text';
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

class Invalid extends Error {}

function expect(cond: boolean, message: string): asserts cond {
  if (!cond) throw new Invalid(message);
}

/** Validates the shape and the references of a cellar document. Never mutates or repairs it. */
export function validateData(raw: unknown): CellarData {
  expect(isObj(raw), 'This is not a Cellar Book file.');
  expect(isNum(raw.schema), 'This file has no version number, so it is not a Cellar Book backup.');
  expect(raw.schema <= SCHEMA_VERSION, 'This backup was made by a newer version of Cellar Book. Update the app and try again.');
  expect(raw.schema === SCHEMA_VERSION, `Unsupported backup version ${raw.schema}.`);
  for (const k of ['producers', 'bottlings', 'vintages', 'purchases', 'consumptions'] as const) {
    expect(Array.isArray(raw[k]), `The backup is missing its "${k}" list.`);
  }
  const arr = (k: string) => raw[k] as unknown[];

  const producerIds = new Set<string>();
  arr('producers').forEach((p, i) => {
    expect(isObj(p) && isStr(p.id) && isStr(p.name), `producers[${i}] is malformed.`);
    expect(!producerIds.has(p.id), `producers[${i}] repeats an id.`);
    producerIds.add(p.id);
  });

  const bottlingIds = new Set<string>();
  arr('bottlings').forEach((b, i) => {
    expect(isObj(b) && isStr(b.id) && isStr(b.producerId) && isStr(b.name), `bottlings[${i}] is malformed.`);
    expect(isStr(b.type) && (WINE_TYPES as readonly string[]).includes(b.type), `bottlings[${i}] has an unknown wine type.`);
    expect(optStr(b.country) && optStr(b.region) && optStr(b.appellation), `bottlings[${i}] has a malformed place name.`);
    expect(Array.isArray(b.grapes) && b.grapes.every((g) => isObj(g) && isStr(g.grape) && optNum(g.percent)), `bottlings[${i}] has malformed grapes.`);
    expect(producerIds.has(b.producerId), `bottlings[${i}] refers to a producer that is not in the file.`);
    expect(!bottlingIds.has(b.id), `bottlings[${i}] repeats an id.`);
    bottlingIds.add(b.id);
  });

  const vintageIds = new Set<string>();
  arr('vintages').forEach((v, i) => {
    expect(isObj(v) && isStr(v.id) && isStr(v.bottlingId), `vintages[${i}] is malformed.`);
    expect(v.year === null || isNum(v.year), `vintages[${i}] has a malformed year.`);
    expect(isNum(v.sizeMl), `vintages[${i}] has a malformed bottle size.`);
    expect(optNum(v.drinkFrom) && optNum(v.drinkTo) && optNum(v.peakFrom) && optNum(v.peakTo), `vintages[${i}] has a malformed drinking window.`);
    expect(optStr(v.location) && optStr(v.notes), `vintages[${i}] has malformed text.`);
    expect(bottlingIds.has(v.bottlingId), `vintages[${i}] refers to a bottling that is not in the file.`);
    expect(!vintageIds.has(v.id), `vintages[${i}] repeats an id.`);
    vintageIds.add(v.id);
  });

  arr('purchases').forEach((p, i) => {
    expect(isObj(p) && isStr(p.id) && isStr(p.vintageId) && isNum(p.quantity), `purchases[${i}] is malformed.`);
    expect(p.date === undefined || (isStr(p.date) && isValidDate(p.date)), `purchases[${i}] has a malformed date.`);
    expect(optNum(p.unitPrice) && optStr(p.merchant) && optStr(p.notes), `purchases[${i}] has a malformed price or text.`);
    expect(vintageIds.has(p.vintageId), `purchases[${i}] refers to a wine that is not in the file.`);
  });

  arr('consumptions').forEach((c, i) => {
    expect(isObj(c) && isStr(c.id) && isStr(c.vintageId) && isNum(c.quantity) && isStr(c.date), `consumptions[${i}] is malformed.`);
    expect(isStr(c.reason) && (REMOVAL_REASONS as readonly string[]).includes(c.reason), `consumptions[${i}] has an unknown reason.`);
    expect(optStr(c.notes), `consumptions[${i}] has malformed notes.`);
    expect(vintageIds.has(c.vintageId), `consumptions[${i}] refers to a wine that is not in the file.`);
  });

  const s = isObj(raw.settings) ? raw.settings : {};
  const meta = isObj(raw.meta) ? raw.meta : {};
  return {
    schema: SCHEMA_VERSION,
    producers: raw.producers as CellarData['producers'],
    bottlings: raw.bottlings as CellarData['bottlings'],
    vintages: raw.vintages as CellarData['vintages'],
    purchases: raw.purchases as CellarData['purchases'],
    consumptions: raw.consumptions as CellarData['consumptions'],
    settings: {
      currency: isStr(s.currency) && /^[A-Z]{3}$/.test(s.currency) ? s.currency : 'EUR',
      drinkSoonYears: isNum(s.drinkSoonYears) ? s.drinkSoonYears : 1,
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
  'bottling',
  'vintage',
  'type',
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
  'location',
  'notes',
] as const;

export function formatGrapes(grapes: GrapeShare[]): string {
  return grapes.map((g) => (g.percent !== undefined ? `${g.grape} ${g.percent}%` : g.grape)).join('; ');
}

/** The wines currently in the cellar, one row each — for spreadsheets, not for backup. */
export function exportInventoryCsv(data: CellarData, delimiter = ',', now: Date = new Date()): string {
  const rows = buildRows(data, now).filter((r) => r.bottles > 0);
  rows.sort((a, b) => a.producer.name.localeCompare(b.producer.name) || a.bottling.name.localeCompare(b.bottling.name) || (b.vintage.year ?? 0) - (a.vintage.year ?? 0));
  const body = rows.map((r) => [
    r.producer.name,
    r.bottling.name,
    r.vintage.year === null ? 'NV' : r.vintage.year,
    r.bottling.type,
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
    r.vintage.location,
    r.vintage.notes,
  ]);
  return toCsv([[...CSV_COLUMNS], ...body], delimiter);
}

// ---- CSV import ------------------------------------------------------------

type Field =
  | 'producer'
  | 'bottling'
  | 'vintage'
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
  | 'location'
  | 'notes';

/** Header spellings we recognise, compared after stripping everything but letters and digits. */
const HEADER_ALIASES: Record<Field, string[]> = {
  producer: ['producer', 'winery', 'domaine', 'estate', 'chateau', 'maker', 'producteur'],
  bottling: ['bottling', 'cuvee', 'wine', 'winename', 'label', 'name', 'wines'],
  vintage: ['vintage', 'year', 'millesime'],
  type: ['type', 'color', 'colour', 'style', 'winetype'],
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
  location: ['location', 'rack', 'position', 'cellarlocation', 'bin', 'shelf'],
  notes: ['notes', 'note', 'comments', 'comment'],
};

const TYPE_ALIASES: Record<string, WineType> = {
  red: 'red', rouge: 'red', rosso: 'red', tinto: 'red', rot: 'red',
  white: 'white', blanc: 'white', bianco: 'white', blanco: 'white', weiss: 'white',
  rose: 'rose', pink: 'rose', rosato: 'rose', rosado: 'rose',
  orange: 'orange', amber: 'orange', skincontact: 'orange',
  sparkling: 'sparkling', champagne: 'sparkling', cava: 'sparkling', prosecco: 'sparkling', spumante: 'sparkling', cremant: 'sparkling', fizz: 'sparkling', sekt: 'sparkling', bubbly: 'sparkling',
  sweet: 'sweet', dessert: 'sweet', sauternes: 'sweet', botrytis: 'sweet',
  fortified: 'fortified', port: 'fortified', sherry: 'fortified', madeira: 'fortified', marsala: 'fortified',
  other: 'other',
};

export function parseWineType(s: string): WineType | null {
  const key = normalizeText(s).replace(/[^a-z]/g, '');
  const hit = TYPE_ALIASES[key];
  if (hit) return hit;
  return (WINE_TYPES as readonly string[]).includes(key) ? (key as WineType) : null;
}

/** Understands "12", "12.50", "12,50", "1.234,56", "1,234.56" and "€12,50". */
export function parseNumber(s: string): number | null {
  let t = s.replace(/[^\d.,-]/g, '');
  if (!t || !/\d/.test(t)) return null;
  const lastDot = t.lastIndexOf('.');
  const lastComma = t.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? '.' : ',';
    const thousands = decimal === '.' ? ',' : '.';
    t = t.split(thousands).join('').replace(decimal, '.');
  } else if (lastComma >= 0) {
    // "1,234" is a thousand; "12,5" and "12,50" are decimals.
    t = /^-?\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.');
  } else if (lastDot >= 0 && /^-?\d{1,3}(\.\d{3})+$/.test(t) && t.indexOf('.') !== lastDot) {
    t = t.replace(/\./g, '');
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
  if (t in names) return names[t] as number;
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
  const parts = s.split(/[;|/]|,(?![^(]*\))/).map((p) => p.trim()).filter(Boolean);
  return parts.map((part) => {
    const m = /^(.*?)[\s:–-]*(\d+(?:[.,]\d+)?)\s*%$/.exec(part) ?? /^(.*?)\s*[:(]\s*(\d+(?:[.,]\d+)?)\s*%?\)?$/.exec(part);
    if (m && m[1]?.trim()) return { grape: m[1].trim(), percent: Number((m[2] as string).replace(',', '.')) };
    return { grape: part };
  });
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
  producer: 'Producer', bottling: 'Bottling', vintage: 'Vintage', type: 'Type', size: 'Size', country: 'Country', region: 'Region',
  appellation: 'Appellation', grapes: 'Varieties', bottles: 'Bottles', price: 'Price', date: 'Purchase date', merchant: 'Merchant',
  drinkFrom: 'Drink from', drinkTo: 'Drink to', peakFrom: 'Peak from', peakTo: 'Peak to', location: 'Location', notes: 'Notes',
};

export function importInventoryCsv(data: CellarData, text: string, now: Date = new Date()): CsvImportReport {
  const table = parseCsv(text);
  const report: CsvImportReport = { data, imported: 0, merged: 0, bottles: 0, warnings: [], errors: [], recognised: [], ignored: [] };
  const header = table[0];
  if (!header) {
    report.errors.push({ row: 0, message: 'The file is empty.' });
    return report;
  }

  const columnOf = new Map<Field, number>();
  header.forEach((h, idx) => {
    const key = normalizeText(h).replace(/[^a-z0-9]/g, '');
    const field = (Object.keys(HEADER_ALIASES) as Field[]).find((f) => HEADER_ALIASES[f].includes(key) && !columnOf.has(f));
    if (field) {
      columnOf.set(field, idx);
      report.recognised.push(`${h.trim()} → ${FIELD_LABEL[field]}`);
    } else if (h.trim()) report.ignored.push(h.trim());
  });

  if (!columnOf.has('producer') || !columnOf.has('bottling')) {
    report.errors.push({
      row: 1,
      message: 'The first row must name the columns, and at least “Producer” and “Bottling” (or “Wine”/“Cuvée”) are required.',
    });
    return report;
  }
  if (!columnOf.has('bottles')) report.warnings.push('No “Bottles” column found, so every row was counted as 1 bottle.');
  if (!columnOf.has('type')) report.warnings.push('No “Type” column found: wines were imported as type “Other”. You can set the type on each wine afterwards.');

  const cell = (row: string[], f: Field): string => {
    const idx = columnOf.get(f);
    return idx === undefined ? '' : (row[idx] ?? '').trim();
  };

  let current = data;
  let unknownTypes = 0;
  for (let r = 1; r < table.length; r++) {
    const row = table[r] as string[];
    const line = r + 1;
    const fail = (message: string) => report.errors.push({ row: line, message });

    const producer = cell(row, 'producer');
    const bottling = cell(row, 'bottling');
    if (!producer) { fail('Missing producer.'); continue; }
    if (!bottling) { fail('Missing bottling / wine name.'); continue; }

    const vintageText = cell(row, 'vintage');
    let year: number | null = null;
    if (vintageText && !/^(nv|n\.?v\.?|non[- ]?vintage|n\/v)$/i.test(vintageText)) {
      const y = Number(vintageText);
      if (!Number.isInteger(y)) { fail(`Vintage “${vintageText}” is not a year (use a year, or NV).`); continue; }
      year = y;
    }

    let type: WineType = 'other';
    const typeText = cell(row, 'type');
    if (typeText) {
      const t = parseWineType(typeText);
      if (t) type = t;
      else unknownTypes++;
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

    const country = cleanText(cell(row, 'country'));
    const input: WineInput = {
      producer,
      bottling,
      type,
      country,
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
      location: cleanText(cell(row, 'location')),
      notes: cleanText(cell(row, 'notes')),
    };
    const purchase: PurchaseInput | undefined =
      quantity > 0 ? { quantity, unitPrice, date, merchant: cleanText(cell(row, 'merchant')) } : undefined;

    const result = addWine(current, input, purchase, now);
    if (!result.ok) { fail(result.error); continue; }
    current = result.data;
    report.imported++;
    report.bottles += quantity;
    if (result.merged) report.merged++;
  }

  if (unknownTypes > 0) report.warnings.push(`${unknownTypes} row${unknownTypes === 1 ? ' has' : 's have'} a wine type that wasn’t recognised and was imported as “${WINE_TYPE_LABEL.other}”.`);
  if (report.imported > 0 && columnOf.has('drinkFrom') === false && columnOf.has('drinkTo') === false) {
    report.warnings.push('No drinking-window columns found. Open a wine to set its window, or use the “estimate” buttons.');
  }
  report.data = current;
  return report;
}

