import type {
  Bottling,
  CellarData,
  Consumption,
  GrapeShare,
  Producer,
  Purchase,
  RemovalReason,
  Settings,
  Vintage,
  WindowSource,
  WineType,
} from './types';
import { REMOVAL_REASONS, WINE_TYPES } from './types';
import { cleanText, isValidDate, newId, normalizeText } from './text';
import { consumedOf, purchasedOf, stockOf } from './inventory';
import { hasWindow, validateWindow, type DrinkWindow } from './window';

export type FieldErrors = Record<string, string>;

export type Result<T> = ({ ok: true } & T) | { ok: false; error: string; fieldErrors?: FieldErrors };

function fail(error: string, fieldErrors?: FieldErrors): { ok: false; error: string; fieldErrors?: FieldErrors } {
  return fieldErrors ? { ok: false, error, fieldErrors } : { ok: false, error };
}

export interface WineInput extends DrinkWindow {
  producer: string;
  bottling: string;
  type: WineType;
  country?: string;
  region?: string;
  appellation?: string;
  grapes: GrapeShare[];
  /** `null` for non-vintage. */
  year: number | null;
  sizeMl: number;
  windowSource?: WindowSource;
  location?: string;
  notes?: string;
}

export interface PurchaseInput {
  date?: string;
  quantity: number;
  unitPrice?: number;
  merchant?: string;
  notes?: string;
}

export interface ConsumptionInput {
  date: string;
  quantity: number;
  reason: RemovalReason;
  notes?: string;
}

const MAX_BOTTLES = 100_000;

/** Drops keys whose value is undefined so stored JSON stays tidy. */
function compact<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

function cleanGrapes(grapes: GrapeShare[]): GrapeShare[] {
  const seen = new Set<string>();
  const out: GrapeShare[] = [];
  for (const g of grapes) {
    const name = cleanText(g.grape);
    if (!name) continue;
    const key = normalizeText(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(g.percent === undefined || Number.isNaN(g.percent) ? { grape: name } : { grape: name, percent: g.percent });
  }
  return out;
}

export function validateWineInput(input: WineInput, now: Date = new Date()): FieldErrors {
  const e: FieldErrors = {};
  if (!cleanText(input.producer)) e.producer = 'Enter the producer';
  if (!cleanText(input.bottling)) e.bottling = 'Enter the bottling / cuvée name';
  if (!WINE_TYPES.includes(input.type)) e.type = 'Choose a type';
  if (input.year !== null) {
    if (!Number.isInteger(input.year) || input.year < 1800 || input.year > now.getFullYear() + 1) e.year = `Enter a year between 1800 and ${now.getFullYear() + 1}, or tick non-vintage`;
  }
  if (!Number.isFinite(input.sizeMl) || input.sizeMl < 50 || input.sizeMl > 30000) e.sizeMl = 'Enter a bottle size in ml';
  Object.assign(e, validateWindow(input));
  for (const g of input.grapes) {
    if (g.percent !== undefined && (!Number.isFinite(g.percent) || g.percent <= 0 || g.percent > 100)) {
      e.grapes = 'Percentages must be between 1 and 100';
      break;
    }
  }
  const total = input.grapes.reduce((n, g) => n + (g.percent ?? 0), 0);
  if (!e.grapes && total > 100.0001) e.grapes = 'The percentages add up to more than 100';
  return e;
}

export function validatePurchaseInput(p: PurchaseInput): FieldErrors {
  const e: FieldErrors = {};
  if (!Number.isInteger(p.quantity) || p.quantity < 1 || p.quantity > MAX_BOTTLES) e.quantity = 'Enter a whole number of bottles (1 or more)';
  if (p.unitPrice !== undefined && (!Number.isFinite(p.unitPrice) || p.unitPrice < 0)) e.unitPrice = 'Enter a price of 0 or more';
  if (p.date !== undefined && !isValidDate(p.date)) e.date = 'Use YYYY-MM-DD (or just YYYY-MM or YYYY)';
  return e;
}

function firstError(e: FieldErrors): string {
  return Object.values(e)[0] ?? 'Invalid input';
}

// ---- lookups ---------------------------------------------------------------

export function findProducer(data: CellarData, name: string): Producer | undefined {
  const n = normalizeText(name);
  return data.producers.find((p) => normalizeText(p.name) === n);
}

export function findBottling(data: CellarData, producerId: string, name: string): Bottling | undefined {
  const n = normalizeText(name);
  return data.bottlings.find((b) => b.producerId === producerId && normalizeText(b.name) === n);
}

export function findVintage(data: CellarData, bottlingId: string, year: number | null, sizeMl: number): Vintage | undefined {
  return data.vintages.find((v) => v.bottlingId === bottlingId && v.year === year && v.sizeMl === sizeMl);
}

type BottlingAttrs = Pick<Bottling, 'type' | 'country' | 'region' | 'appellation' | 'grapes'>;

function bottlingAttrs(input: WineInput): BottlingAttrs {
  return {
    type: input.type,
    country: cleanText(input.country),
    region: cleanText(input.region),
    appellation: cleanText(input.appellation),
    grapes: cleanGrapes(input.grapes),
  };
}

/** Blank fields in the input never wipe what is already known about a bottling. */
function mergeBottling(existing: Bottling, a: BottlingAttrs): Bottling {
  return compact({
    ...existing,
    type: a.type,
    country: a.country ?? existing.country,
    region: a.region ?? existing.region,
    appellation: a.appellation ?? existing.appellation,
    grapes: a.grapes.length ? a.grapes : existing.grapes,
  });
}

function vintageAttrs(input: WineInput) {
  const window = {
    drinkFrom: input.drinkFrom,
    drinkTo: input.drinkTo,
    peakFrom: input.peakFrom,
    peakTo: input.peakTo,
  };
  return {
    year: input.year,
    sizeMl: input.sizeMl,
    ...window,
    windowSource: Object.values(window).some((y) => y !== undefined) ? (input.windowSource ?? 'manual') : undefined,
    location: cleanText(input.location),
    notes: cleanText(input.notes),
  };
}

function makePurchase(vintageId: string, p: PurchaseInput): Purchase {
  return compact({
    id: newId(),
    vintageId,
    date: cleanText(p.date),
    quantity: p.quantity,
    unitPrice: p.unitPrice,
    merchant: cleanText(p.merchant),
    notes: cleanText(p.notes),
  });
}

/** Remove anything left dangling, and bottlings/producers with nothing under them. */
export function prune(data: CellarData): CellarData {
  const bottlingIds = new Set(data.bottlings.map((b) => b.id));
  const vintages = data.vintages.filter((v) => bottlingIds.has(v.bottlingId));
  const usedBottlings = new Set(vintages.map((v) => v.bottlingId));
  const producerIds = new Set(data.producers.map((p) => p.id));
  const bottlings = data.bottlings.filter((b) => usedBottlings.has(b.id) && producerIds.has(b.producerId));
  const keptBottlings = new Set(bottlings.map((b) => b.id));
  const usedProducers = new Set(bottlings.map((b) => b.producerId));
  const keptVintages = vintages.filter((v) => keptBottlings.has(v.bottlingId));
  const keptVintageIds = new Set(keptVintages.map((v) => v.id));
  return {
    ...data,
    producers: data.producers.filter((p) => usedProducers.has(p.id)),
    bottlings,
    vintages: keptVintages,
    purchases: data.purchases.filter((p) => keptVintageIds.has(p.vintageId)),
    consumptions: data.consumptions.filter((c) => keptVintageIds.has(c.vintageId)),
  };
}

// ---- wines -----------------------------------------------------------------

export interface AddWineOutcome {
  data: CellarData;
  vintageId: string;
  /** True when the vintage already existed and the bottles were added to it. */
  merged: boolean;
}

/**
 * Adds a wine and, optionally, the purchase of its first bottles. Producers,
 * bottlings and vintages are matched case- and accent-insensitively, so typing
 * "chateau margaux" never creates a second Château Margaux.
 */
export function addWine(data: CellarData, input: WineInput, purchase?: PurchaseInput, now: Date = new Date()): Result<AddWineOutcome> {
  const fieldErrors = validateWineInput(input, now);
  if (purchase) Object.assign(fieldErrors, prefixKeys('purchase.', validatePurchaseInput(purchase)));
  if (Object.keys(fieldErrors).length) return fail(firstError(fieldErrors), fieldErrors);

  let { producers, bottlings, vintages, purchases } = data;
  const producerName = cleanText(input.producer) as string;
  const bottlingName = cleanText(input.bottling) as string;

  let producer = findProducer(data, producerName);
  if (!producer) {
    producer = { id: newId(), name: producerName };
    producers = [...producers, producer];
  }

  const attrs = bottlingAttrs(input);
  const existingBottling = findBottling(data, producer.id, bottlingName);
  let bottling: Bottling;
  if (existingBottling) {
    bottling = mergeBottling(existingBottling, attrs);
    bottlings = bottlings.map((b) => (b.id === bottling.id ? bottling : b));
  } else {
    bottling = compact({ id: newId(), producerId: producer.id, name: bottlingName, ...attrs });
    bottlings = [...bottlings, bottling];
  }

  const va = vintageAttrs(input);
  const existingVintage = findVintage({ ...data, bottlings, vintages }, bottling.id, input.year, input.sizeMl);
  let vintage: Vintage;
  const merged = existingVintage !== undefined;
  if (existingVintage) {
    // The wine is already known: only fill in what's missing, never overwrite.
    const missingWindow = !hasWindow(existingVintage) && hasWindow(input);
    vintage = compact({
      ...existingVintage,
      ...(missingWindow
        ? { drinkFrom: va.drinkFrom, drinkTo: va.drinkTo, peakFrom: va.peakFrom, peakTo: va.peakTo, windowSource: va.windowSource }
        : {}),
      location: existingVintage.location ?? va.location,
      notes: existingVintage.notes ?? va.notes,
    });
    vintages = vintages.map((v) => (v.id === vintage.id ? vintage : v));
  } else {
    vintage = compact({ id: newId(), bottlingId: bottling.id, ...va });
    vintages = [...vintages, vintage];
  }

  if (purchase) purchases = [...purchases, makePurchase(vintage.id, purchase)];

  return { ok: true, data: { ...data, producers, bottlings, vintages, purchases }, vintageId: vintage.id, merged };
}

function prefixKeys(prefix: string, e: FieldErrors): FieldErrors {
  return Object.fromEntries(Object.entries(e).map(([k, v]) => [prefix + k, v]));
}

/**
 * Edits a wine. Producer, bottling, type, region and grapes are shared by every
 * vintage of a bottling, so changing them on a vintage whose producer/bottling
 * *name* is unchanged updates the whole bottling; changing the name moves just
 * this vintage to the (found or new) bottling.
 */
export function updateWine(data: CellarData, vintageId: string, input: WineInput, now: Date = new Date()): Result<{ data: CellarData }> {
  const fieldErrors = validateWineInput(input, now);
  if (Object.keys(fieldErrors).length) return fail(firstError(fieldErrors), fieldErrors);

  const vintage = data.vintages.find((v) => v.id === vintageId);
  const currentBottling = vintage && data.bottlings.find((b) => b.id === vintage.bottlingId);
  const currentProducer = currentBottling && data.producers.find((p) => p.id === currentBottling.producerId);
  if (!vintage || !currentBottling || !currentProducer) return fail('That wine no longer exists');

  const producerName = cleanText(input.producer) as string;
  const bottlingName = cleanText(input.bottling) as string;
  const attrs = bottlingAttrs(input);

  let producers = data.producers;
  let bottlings = data.bottlings;
  let targetBottlingId: string;

  const sameProducer = normalizeText(producerName) === normalizeText(currentProducer.name);
  const sameBottling = normalizeText(bottlingName) === normalizeText(currentBottling.name);

  if (sameProducer && sameBottling) {
    producers = producers.map((p) => (p.id === currentProducer.id ? { ...p, name: producerName } : p));
    bottlings = bottlings.map((b) => (b.id === currentBottling.id ? compact({ ...b, name: bottlingName, ...attrs }) : b));
    targetBottlingId = currentBottling.id;
  } else {
    let producer = findProducer(data, producerName);
    if (!producer) {
      producer = { id: newId(), name: producerName };
      producers = [...producers, producer];
    }
    const existing = findBottling(data, producer.id, bottlingName);
    if (existing) {
      bottlings = bottlings.map((b) => (b.id === existing.id ? mergeBottling(existing, attrs) : b));
      targetBottlingId = existing.id;
    } else {
      const created: Bottling = compact({ id: newId(), producerId: producer.id, name: bottlingName, ...attrs });
      bottlings = [...bottlings, created];
      targetBottlingId = created.id;
    }
  }

  const clash = data.vintages.find((v) => v.id !== vintageId && v.bottlingId === targetBottlingId && v.year === input.year && v.sizeMl === input.sizeMl);
  if (clash) {
    const msg = 'You already have this exact wine, vintage and size. Edit that entry or delete it first.';
    return fail(msg, { year: msg });
  }

  const va = vintageAttrs(input);
  const updated: Vintage = compact({ id: vintage.id, bottlingId: targetBottlingId, ...va });
  const vintages = data.vintages.map((v) => (v.id === vintageId ? updated : v));
  return { ok: true, data: prune({ ...data, producers, bottlings, vintages }) };
}

export function deleteWine(data: CellarData, vintageId: string): CellarData {
  return prune({ ...data, vintages: data.vintages.filter((v) => v.id !== vintageId) });
}

// ---- purchases -------------------------------------------------------------

export function addPurchase(data: CellarData, vintageId: string, input: PurchaseInput): Result<{ data: CellarData }> {
  const e = validatePurchaseInput(input);
  if (Object.keys(e).length) return fail(firstError(e), e);
  if (!data.vintages.some((v) => v.id === vintageId)) return fail('That wine no longer exists');
  return { ok: true, data: { ...data, purchases: [...data.purchases, makePurchase(vintageId, input)] } };
}

export function updatePurchase(data: CellarData, purchaseId: string, input: PurchaseInput): Result<{ data: CellarData }> {
  const e = validatePurchaseInput(input);
  if (Object.keys(e).length) return fail(firstError(e), e);
  const old = data.purchases.find((p) => p.id === purchaseId);
  if (!old) return fail('That purchase no longer exists');
  const newTotal = purchasedOf(data.purchases, old.vintageId) - old.quantity + input.quantity;
  const consumed = consumedOf(data.consumptions, old.vintageId);
  if (newTotal < consumed) {
    const msg = `${consumed} bottle${consumed === 1 ? ' has' : 's have'} already been taken out of this wine, so it can't drop below that`;
    return fail(msg, { quantity: msg });
  }
  const next: Purchase = { ...makePurchase(old.vintageId, input), id: old.id };
  return { ok: true, data: { ...data, purchases: data.purchases.map((p) => (p.id === purchaseId ? next : p)) } };
}

export function deletePurchase(data: CellarData, purchaseId: string): Result<{ data: CellarData }> {
  const old = data.purchases.find((p) => p.id === purchaseId);
  if (!old) return fail('That purchase no longer exists');
  const remaining = purchasedOf(data.purchases, old.vintageId) - old.quantity;
  const consumed = consumedOf(data.consumptions, old.vintageId);
  if (remaining < consumed) {
    return fail(`Can't remove this purchase: ${consumed} bottle${consumed === 1 ? ' has' : 's have'} already been taken out of this wine. Undo those first.`);
  }
  return { ok: true, data: { ...data, purchases: data.purchases.filter((p) => p.id !== purchaseId) } };
}

// ---- consumption -----------------------------------------------------------

export function addConsumption(data: CellarData, vintageId: string, input: ConsumptionInput): Result<{ data: CellarData; consumptionId: string }> {
  const e: FieldErrors = {};
  const stock = stockOf(data, vintageId);
  if (!Number.isInteger(input.quantity) || input.quantity < 1) e.quantity = 'Enter a whole number of bottles';
  else if (input.quantity > stock) e.quantity = stock === 0 ? 'There are no bottles left' : `Only ${stock} bottle${stock === 1 ? '' : 's'} left`;
  if (!isValidDate(input.date) || input.date.length !== 10) e.date = 'Enter a date';
  if (!REMOVAL_REASONS.includes(input.reason)) e.reason = 'Choose a reason';
  if (Object.keys(e).length) return fail(firstError(e), e);
  const c: Consumption = compact({
    id: newId(),
    vintageId,
    date: input.date,
    quantity: input.quantity,
    reason: input.reason,
    notes: cleanText(input.notes),
  });
  return { ok: true, data: { ...data, consumptions: [...data.consumptions, c] }, consumptionId: c.id };
}

export function deleteConsumption(data: CellarData, consumptionId: string): CellarData {
  return { ...data, consumptions: data.consumptions.filter((c) => c.id !== consumptionId) };
}

// ---- settings & meta -------------------------------------------------------

export function updateSettings(data: CellarData, patch: Partial<Settings>): CellarData {
  const next = { ...data.settings, ...patch };
  if (!/^[A-Z]{3}$/.test(next.currency)) next.currency = data.settings.currency;
  next.drinkSoonYears = Math.min(5, Math.max(0, Math.round(Number.isFinite(next.drinkSoonYears) ? next.drinkSoonYears : 1)));
  return { ...data, settings: next };
}

export function markBackedUp(data: CellarData, whenIso: string): CellarData {
  return { ...data, meta: { ...data.meta, lastBackupAt: whenIso } };
}

export const SAMPLE_PREFIX = 'sample-';

export function hasSampleData(data: CellarData): boolean {
  return data.vintages.some((v) => v.id.startsWith(SAMPLE_PREFIX));
}

/**
 * Removes the demo wines and their ledger. Only demo *vintages* are deleted: a
 * wine you added yourself under a demo bottling keeps that bottling and producer alive.
 */
export function removeSampleData(data: CellarData): CellarData {
  return prune({ ...data, vintages: data.vintages.filter((v) => !v.id.startsWith(SAMPLE_PREFIX)) });
}
