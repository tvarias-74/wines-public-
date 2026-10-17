import type {
  Bottling,
  BoxMaterial,
  CellarData,
  Colour,
  Consumption,
  GrapeShare,
  Group,
  Location,
  LocationKind,
  Producer,
  Purchase,
  RemovalReason,
  Review,
  ReviewSource,
  Settings,
  Vintage,
  VintageImages,
  WindowSource,
  WineStyle,
} from './types';
import {
  BOX_MATERIALS,
  COLOURS,
  LOCATION_KINDS,
  RATING_MAX,
  RATING_MIN,
  RATING_STEP,
  REMOVAL_REASONS,
  REVIEW_SOURCES,
  REVIEW_SOURCE_SCALE,
  WINE_STYLES,
} from './types';
import { cleanText, isValidDate, newId, normalizeText } from './text';
import { consumedOf, occupancyOf, placedOf, purchasedOf, stockOf } from './inventory';
import { isCustomImpression, isKnownImpression } from './impressions';
import { hasWindow, validateWindow, type DrinkWindow } from './window';

export type FieldErrors = Record<string, string>;

export type Result<T> = ({ ok: true } & T) | { ok: false; error: string; fieldErrors?: FieldErrors };

function fail(error: string, fieldErrors?: FieldErrors): { ok: false; error: string; fieldErrors?: FieldErrors } {
  return fieldErrors ? { ok: false, error, fieldErrors } : { ok: false, error };
}

export interface WineInput extends DrinkWindow {
  producer: string;
  /** The family or company that owns the producer (optional). */
  group?: string;
  bottling: string;
  colour?: Colour;
  /** Left undefined when unknown: an existing bottling keeps its value, a new one is still. */
  sparkling?: boolean;
  style?: WineStyle;
  country?: string;
  region?: string;
  appellation?: string;
  grapes: GrapeShare[];
  /** `null` for non-vintage. */
  year: number | null;
  sizeMl: number;
  windowSource?: WindowSource;
  notes?: string;
  images?: VintageImages;
}

export interface PurchaseInput {
  date?: string;
  quantity: number;
  unitPrice?: number;
  merchant?: string;
  notes?: string;
}

export interface PlacementInput {
  locationId: string;
  quantity: number;
}

export interface ConsumptionInput {
  date: string;
  quantity: number;
  reason: RemovalReason;
  locationId?: string;
  notes?: string;
  rating?: number;
  impressions?: string[];
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

function cleanImages(images: VintageImages | undefined): VintageImages | undefined {
  if (!images) return undefined;
  const out = compact({ front: images.front || undefined, back: images.back || undefined });
  return out.front || out.back ? out : undefined;
}

export function validateWineInput(input: WineInput, now: Date = new Date()): FieldErrors {
  const e: FieldErrors = {};
  if (!cleanText(input.producer)) e.producer = 'Enter the producer';
  if (!cleanText(input.bottling)) e.bottling = 'Enter the bottling / cuvée name';
  if (input.colour !== undefined && !COLOURS.includes(input.colour)) e.colour = 'Choose a colour';
  if (input.style !== undefined && !WINE_STYLES.includes(input.style)) e.style = 'Unknown style';
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

function prefixKeys(prefix: string, e: FieldErrors): FieldErrors {
  return Object.fromEntries(Object.entries(e).map(([k, v]) => [prefix + k, v]));
}

// ---- lookups ---------------------------------------------------------------

export function findGroup(data: CellarData, name: string): Group | undefined {
  const n = normalizeText(name);
  return data.groups.find((g) => normalizeText(g.name) === n);
}

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

export function findLocation(data: CellarData, name: string): Location | undefined {
  const n = normalizeText(name);
  return data.locations.find((l) => normalizeText(l.name) === n);
}

type BottlingAttrs = Pick<Bottling, 'colour' | 'style' | 'country' | 'region' | 'appellation' | 'grapes'> & { sparkling: boolean | undefined };

function bottlingAttrs(input: WineInput): BottlingAttrs {
  return {
    colour: input.colour,
    sparkling: input.sparkling,
    style: input.style,
    country: cleanText(input.country),
    region: cleanText(input.region),
    appellation: cleanText(input.appellation),
    grapes: cleanGrapes(input.grapes),
  };
}

/**
 * A bottling you already know is never overwritten by a later entry (a new vintage, an import row,
 * a vintage moved under it): the input only fills in what is still blank. Changing a bottling's own
 * details is what editing one of its wines in place is for.
 */
function fillBottling(existing: Bottling, a: BottlingAttrs): Bottling {
  return compact({
    ...existing,
    colour: existing.colour ?? a.colour,
    style: existing.style ?? a.style,
    country: existing.country ?? a.country,
    region: existing.region ?? a.region,
    appellation: existing.appellation ?? a.appellation,
    grapes: existing.grapes.length ? existing.grapes : a.grapes,
  });
}

function newBottling(producerId: string, name: string, a: BottlingAttrs): Bottling {
  return compact({ id: newId(), producerId, name, ...a, sparkling: a.sparkling ?? false });
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
    images: cleanImages(input.images),
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

/**
 * Finds or creates the owner group. An existing group keeps its name, unless `rename` is set
 * (editing a wine in place, where fixing the spelling is the point).
 */
function ensureGroup(groups: Group[], name: string | undefined, rename = false): { group: Group | undefined; groups: Group[] } {
  const clean = cleanText(name);
  if (!clean) return { group: undefined, groups };
  const n = normalizeText(clean);
  const found = groups.find((g) => normalizeText(g.name) === n);
  if (found) return { group: found, groups: rename && found.name !== clean ? groups.map((g) => (g.id === found.id ? { ...g, name: clean } : g)) : groups };
  const created: Group = { id: newId(), name: clean };
  return { group: created, groups: [...groups, created] };
}

/**
 * Remove anything left dangling, and wines/producers/groups with nothing under them.
 * Locations are deliberately kept: the cellar layout exists independently of the wines in it.
 */
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
  const producers = data.producers.filter((p) => usedProducers.has(p.id));
  const usedGroups = new Set(producers.map((p) => p.groupId).filter((g): g is string => !!g));
  const locationIds = new Set(data.locations.map((l) => l.id));
  return {
    ...data,
    groups: data.groups.filter((g) => usedGroups.has(g.id)),
    producers,
    bottlings,
    vintages: keptVintages,
    purchases: data.purchases.filter((p) => keptVintageIds.has(p.vintageId)),
    consumptions: data.consumptions.filter((c) => keptVintageIds.has(c.vintageId)),
    placements: data.placements.filter((p) => keptVintageIds.has(p.vintageId) && locationIds.has(p.locationId) && p.quantity > 0),
    reviews: data.reviews.filter((r) => keptVintageIds.has(r.vintageId)),
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
 * Adds a wine and, optionally, the purchase of its first bottles and where they go. Producers,
 * bottlings and vintages are matched case- and accent-insensitively, so typing "chateau margaux"
 * never creates a second Château Margaux.
 */
export function addWine(
  data: CellarData,
  input: WineInput,
  purchase?: PurchaseInput,
  now: Date = new Date(),
  placements?: PlacementInput[],
): Result<AddWineOutcome> {
  const fieldErrors = validateWineInput(input, now);
  if (purchase) Object.assign(fieldErrors, prefixKeys('purchase.', validatePurchaseInput(purchase)));
  const toPlace = (placements ?? []).filter((p) => p.quantity > 0);
  if (toPlace.length && !purchase) fieldErrors.placements = 'There are no new bottles to place';
  else if (purchase && toPlace.reduce((n, p) => n + p.quantity, 0) > purchase.quantity) fieldErrors.placements = 'You are placing more bottles than you are adding';
  if (Object.keys(fieldErrors).length) return fail(firstError(fieldErrors), fieldErrors);

  let { producers, bottlings, vintages, purchases } = data;
  const producerName = cleanText(input.producer) as string;
  const bottlingName = cleanText(input.bottling) as string;

  const { group, groups } = ensureGroup(data.groups, input.group);
  let producer = findProducer(data, producerName);
  if (!producer) {
    producer = compact({ id: newId(), name: producerName, groupId: group?.id });
    producers = [...producers, producer];
  } else if (group && producer.groupId !== group.id) {
    const updated: Producer = { ...producer, groupId: group.id };
    producers = producers.map((p) => (p.id === updated.id ? updated : p));
    producer = updated;
  }

  const attrs = bottlingAttrs(input);
  const existingBottling = findBottling(data, producer.id, bottlingName);
  let bottling: Bottling;
  if (existingBottling) {
    bottling = fillBottling(existingBottling, attrs);
    bottlings = bottlings.map((b) => (b.id === bottling.id ? bottling : b));
  } else {
    bottling = newBottling(producer.id, bottlingName, attrs);
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
      images: cleanImages({ front: existingVintage.images?.front ?? va.images?.front, back: existingVintage.images?.back ?? va.images?.back }),
      notes: existingVintage.notes ?? va.notes,
    });
    vintages = vintages.map((v) => (v.id === vintage.id ? vintage : v));
  } else {
    vintage = compact({ id: newId(), bottlingId: bottling.id, ...va });
    vintages = [...vintages, vintage];
  }

  if (purchase) purchases = [...purchases, makePurchase(vintage.id, purchase)];

  let next: CellarData = { ...data, groups, producers, bottlings, vintages, purchases };
  for (const p of toPlace) {
    const placed = placeBottles(next, vintage.id, p.locationId, p.quantity);
    if (!placed.ok) return fail(placed.error, { placements: placed.error });
    next = placed.data;
  }
  return { ok: true, data: next, vintageId: vintage.id, merged };
}

/**
 * Edits a wine. Producer, bottling, colour, region and grapes are shared by every vintage of a
 * bottling, so changing them on a vintage whose producer/bottling *name* is unchanged updates the
 * whole bottling; changing the name moves just this vintage to the (found or new) bottling.
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
  const sameProducerName = normalizeText(producerName) === normalizeText(currentProducer.name);
  const { group, groups } = ensureGroup(data.groups, input.group, sameProducerName);

  let producers = data.producers;
  let bottlings = data.bottlings;
  let targetBottlingId: string;

  const sameProducer = normalizeText(producerName) === normalizeText(currentProducer.name);
  const sameBottling = normalizeText(bottlingName) === normalizeText(currentBottling.name);

  if (sameProducer && sameBottling) {
    // Editing in place: a blank group means "no group".
    producers = producers.map((p) => (p.id === currentProducer.id ? compact({ ...p, name: producerName, groupId: group?.id }) : p));
    bottlings = bottlings.map((b) =>
      b.id === currentBottling.id ? compact({ ...b, name: bottlingName, ...attrs, sparkling: attrs.sparkling ?? b.sparkling }) : b,
    );
    targetBottlingId = currentBottling.id;
  } else {
    let producer = findProducer(data, producerName);
    if (!producer) {
      producer = compact({ id: newId(), name: producerName, groupId: group?.id });
      producers = [...producers, producer];
    } else if ((group && producer.groupId !== group.id) || (sameProducer && producer.name !== producerName)) {
      // Same winery with a different capitalisation, or a group being assigned.
      const updated: Producer = compact({ ...producer, name: sameProducer ? producerName : producer.name, groupId: group?.id ?? producer.groupId });
      producers = producers.map((p) => (p.id === updated.id ? updated : p));
      producer = updated;
    }
    const existing = findBottling(data, producer.id, bottlingName);
    if (existing) {
      bottlings = bottlings.map((b) => (b.id === existing.id ? fillBottling(existing, attrs) : b));
      targetBottlingId = existing.id;
    } else {
      const created = newBottling(producer.id, bottlingName, attrs);
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
  return { ok: true, data: prune({ ...data, groups, producers, bottlings, vintages }) };
}

export function deleteWine(data: CellarData, vintageId: string): CellarData {
  return prune({ ...data, vintages: data.vintages.filter((v) => v.id !== vintageId) });
}

/** Sets a vintage's drinking window directly (for example, from a critic's review). */
export function setVintageWindow(data: CellarData, vintageId: string, w: DrinkWindow, source: WindowSource = 'manual'): Result<{ data: CellarData }> {
  const errors = validateWindow(w);
  if (Object.keys(errors).length) return fail(firstError(errors as FieldErrors), errors as FieldErrors);
  if (!hasWindow(w)) return fail('Enter at least one year');
  if (!data.vintages.some((v) => v.id === vintageId)) return fail('That wine no longer exists');
  return {
    ok: true,
    data: {
      ...data,
      vintages: data.vintages.map((v) => (v.id === vintageId ? compact({ ...v, drinkFrom: w.drinkFrom, drinkTo: w.drinkTo, peakFrom: w.peakFrom, peakTo: w.peakTo, windowSource: source }) : v)),
    },
  };
}

/** Attaches (or, with `undefined`, detaches) a label photo. The image bytes live in the image store. */
export function setVintageImage(data: CellarData, vintageId: string, side: 'front' | 'back', imageId: string | undefined): CellarData {
  return {
    ...data,
    vintages: data.vintages.map((v) => {
      if (v.id !== vintageId) return v;
      const images = cleanImages({ ...v.images, [side]: imageId });
      const { images: _old, ...rest } = v;
      return images ? { ...rest, images } : rest;
    }),
  };
}

/** Every image id the cellar refers to, for cleaning up photos nobody uses any more. */
export function referencedImageIds(data: CellarData): Set<string> {
  const ids = new Set<string>();
  for (const v of data.vintages) {
    if (v.images?.front) ids.add(v.images.front);
    if (v.images?.back) ids.add(v.images.back);
  }
  return ids;
}

// ---- purchases -------------------------------------------------------------

/** Placed bottles can never outnumber the bottles you own. */
function placementConflict(data: CellarData, vintageId: string, newStock: number): string | null {
  const placed = placedOf(data, vintageId);
  if (placed <= newStock) return null;
  const excess = placed - newStock;
  return `${excess} bottle${excess === 1 ? ' is' : 's are'} assigned to storage locations. Take ${excess === 1 ? 'it' : 'them'} out of their locations first.`;
}

export function addPurchase(data: CellarData, vintageId: string, input: PurchaseInput, placements?: PlacementInput[]): Result<{ data: CellarData }> {
  const e = validatePurchaseInput(input);
  if (Object.keys(e).length) return fail(firstError(e), e);
  if (!data.vintages.some((v) => v.id === vintageId)) return fail('That wine no longer exists');
  const toPlace = (placements ?? []).filter((x) => x.quantity > 0);
  if (toPlace.reduce((n, p) => n + p.quantity, 0) > input.quantity) return fail('You are placing more bottles than you are adding', { placements: 'You are placing more bottles than you are adding' });
  let next: CellarData = { ...data, purchases: [...data.purchases, makePurchase(vintageId, input)] };
  for (const p of toPlace) {
    const placed = placeBottles(next, vintageId, p.locationId, p.quantity);
    if (!placed.ok) return fail(placed.error, { placements: placed.error });
    next = placed.data;
  }
  return { ok: true, data: next };
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
  const conflict = placementConflict(data, old.vintageId, newTotal - consumed);
  if (conflict) return fail(conflict, { quantity: conflict });
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
  const conflict = placementConflict(data, old.vintageId, remaining - consumed);
  if (conflict) return fail(`Can't remove this purchase: ${conflict}`);
  return { ok: true, data: { ...data, purchases: data.purchases.filter((p) => p.id !== purchaseId) } };
}

// ---- consumption & tasting ---------------------------------------------------

export function validateTasting(t: { rating?: number; impressions?: string[] }): FieldErrors {
  const e: FieldErrors = {};
  if (t.rating !== undefined) {
    const steps = t.rating / RATING_STEP;
    if (!Number.isFinite(t.rating) || t.rating < RATING_MIN || t.rating > RATING_MAX || Math.abs(steps - Math.round(steps)) > 1e-9) {
      e.rating = `Rate from ${RATING_MIN} to ${RATING_MAX} (half points are fine)`;
    }
  }
  for (const id of t.impressions ?? []) {
    if (!isKnownImpression(id) || id.length > 80) {
      e.impressions = 'One of the impressions is not valid';
      break;
    }
  }
  return e;
}

function cleanImpressions(list: string[] | undefined): string[] | undefined {
  if (!list) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const id = isCustomImpression(raw) ? `c:${raw.slice(2).trim()}` : raw.trim();
    const key = normalizeText(id);
    if (!id || seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }
  return out.length ? out : undefined;
}

export function addConsumption(data: CellarData, vintageId: string, input: ConsumptionInput): Result<{ data: CellarData; consumptionId: string }> {
  const e: FieldErrors = {};
  const stock = stockOf(data, vintageId);
  if (!Number.isInteger(input.quantity) || input.quantity < 1) e.quantity = 'Enter a whole number of bottles';
  else if (input.quantity > stock) e.quantity = stock === 0 ? 'There are no bottles left' : `Only ${stock} bottle${stock === 1 ? '' : 's'} left`;
  if (!isValidDate(input.date) || input.date.length !== 10) e.date = 'Enter a date';
  if (!REMOVAL_REASONS.includes(input.reason)) e.reason = 'Choose a reason';
  Object.assign(e, validateTasting(input));

  // Where the bottles came from, if the cellar layout is in use for this wine.
  let placements = data.placements;
  if (!e.quantity) {
    const mine = data.placements.filter((p) => p.vintageId === vintageId);
    if (input.locationId) {
      const at = mine.find((p) => p.locationId === input.locationId);
      const name = data.locations.find((l) => l.id === input.locationId)?.name ?? 'That location';
      if (!at) e.locationId = `None of these bottles are in ${name}`;
      else if (at.quantity < input.quantity) e.locationId = `${name} only holds ${at.quantity} of them`;
      else placements = data.placements.map((p) => (p.id === at.id ? { ...p, quantity: p.quantity - input.quantity } : p)).filter((p) => p.quantity > 0);
    } else if (mine.length && stock - placedOf(data, vintageId) < input.quantity) {
      e.locationId = 'Choose where the bottles were taken from';
    }
  }
  if (Object.keys(e).length) return fail(firstError(e), e);

  const c: Consumption = compact({
    id: newId(),
    vintageId,
    date: input.date,
    quantity: input.quantity,
    reason: input.reason,
    locationId: input.locationId,
    notes: cleanText(input.notes),
    rating: input.rating,
    impressions: cleanImpressions(input.impressions),
  });
  return { ok: true, data: { ...data, placements, consumptions: [...data.consumptions, c] }, consumptionId: c.id };
}

/** Adds or edits the tasting side of a record. The number of bottles and where they came from are fixed. */
export function updateConsumption(
  data: CellarData,
  consumptionId: string,
  patch: { date: string; reason: RemovalReason; notes?: string; rating?: number; impressions?: string[] },
): Result<{ data: CellarData }> {
  const old = data.consumptions.find((c) => c.id === consumptionId);
  if (!old) return fail('That record no longer exists');
  const e: FieldErrors = {};
  if (!isValidDate(patch.date) || patch.date.length !== 10) e.date = 'Enter a date';
  if (!REMOVAL_REASONS.includes(patch.reason)) e.reason = 'Choose a reason';
  Object.assign(e, validateTasting(patch));
  if (Object.keys(e).length) return fail(firstError(e), e);
  const next: Consumption = compact({
    id: old.id,
    vintageId: old.vintageId,
    quantity: old.quantity,
    locationId: old.locationId,
    date: patch.date,
    reason: patch.reason,
    notes: cleanText(patch.notes),
    rating: patch.rating,
    impressions: cleanImpressions(patch.impressions),
  });
  return { ok: true, data: { ...data, consumptions: data.consumptions.map((c) => (c.id === consumptionId ? next : c)) } };
}

/** Undo: the bottles come back, to the place they left if there is still room there. */
export function deleteConsumption(data: CellarData, consumptionId: string): CellarData {
  const c = data.consumptions.find((x) => x.id === consumptionId);
  if (!c) return data;
  let placements = data.placements;
  const loc = c.locationId ? data.locations.find((l) => l.id === c.locationId) : undefined;
  if (loc) {
    const free = loc.capacity === undefined ? Number.POSITIVE_INFINITY : loc.capacity - occupancyOf(data, loc.id);
    if (free >= c.quantity) {
      const at = placements.find((p) => p.vintageId === c.vintageId && p.locationId === loc.id);
      placements = at
        ? placements.map((p) => (p.id === at.id ? { ...p, quantity: p.quantity + c.quantity } : p))
        : [...placements, { id: newId(), vintageId: c.vintageId, locationId: loc.id, quantity: c.quantity }];
    }
  }
  return { ...data, placements, consumptions: data.consumptions.filter((x) => x.id !== consumptionId) };
}

// ---- cellar layout: locations and placements -----------------------------------

export interface LocationInput {
  name: string;
  kind: LocationKind;
  capacity?: number;
  material?: BoxMaterial;
}

function validateLocation(data: CellarData, input: LocationInput, selfId?: string): FieldErrors {
  const e: FieldErrors = {};
  const name = cleanText(input.name);
  if (!name) e.name = 'Give it a name';
  else if (data.locations.some((l) => l.id !== selfId && normalizeText(l.name) === normalizeText(name))) e.name = 'You already have a place with that name';
  if (!LOCATION_KINDS.includes(input.kind)) e.kind = 'Choose a kind';
  if (input.capacity !== undefined && (!Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 10_000)) e.capacity = 'Enter a whole number of bottles, or leave it empty for no limit';
  if (input.material !== undefined && !BOX_MATERIALS.includes(input.material)) e.material = 'Unknown material';
  return e;
}

function makeLocation(id: string, input: LocationInput): Location {
  return compact({
    id,
    name: cleanText(input.name) as string,
    kind: input.kind,
    capacity: input.capacity,
    material: input.kind === 'box' ? input.material : undefined,
  });
}

export function addLocation(data: CellarData, input: LocationInput): Result<{ data: CellarData; locationId: string }> {
  const e = validateLocation(data, input);
  if (Object.keys(e).length) return fail(firstError(e), e);
  const loc = makeLocation(newId(), input);
  return { ok: true, data: { ...data, locations: [...data.locations, loc] }, locationId: loc.id };
}

export function updateLocation(data: CellarData, locationId: string, input: LocationInput): Result<{ data: CellarData }> {
  const old = data.locations.find((l) => l.id === locationId);
  if (!old) return fail('That place no longer exists');
  const e = validateLocation(data, input, locationId);
  const used = occupancyOf(data, locationId);
  if (!e.capacity && input.capacity !== undefined && input.capacity < used) e.capacity = `It holds ${used} bottles right now, so it can't be smaller than that`;
  if (Object.keys(e).length) return fail(firstError(e), e);
  return { ok: true, data: { ...data, locations: data.locations.map((l) => (l.id === locationId ? makeLocation(locationId, input) : l)) } };
}

export function deleteLocation(data: CellarData, locationId: string): Result<{ data: CellarData }> {
  const loc = data.locations.find((l) => l.id === locationId);
  if (!loc) return fail('That place no longer exists');
  const used = occupancyOf(data, locationId);
  if (used > 0) return fail(`${loc.name} still holds ${used} bottle${used === 1 ? '' : 's'}. Move ${used === 1 ? 'it' : 'them'} elsewhere first.`);
  return { ok: true, data: { ...data, locations: data.locations.filter((l) => l.id !== locationId) } };
}

/** Creates numbered divisions in one go, skipping names that already exist. */
export function createDivisions(
  data: CellarData,
  opts: { from: number; to: number; capacity: number; prefix?: string },
): Result<{ data: CellarData; created: number }> {
  const { from, to, capacity } = opts;
  const prefix = opts.prefix ?? 'Division ';
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) return fail('Enter a valid range, like 1 to 50');
  if (to - from + 1 > 500) return fail('That is more than 500 divisions at once');
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10_000) return fail('Enter how many bottles each division holds');
  const existing = new Set(data.locations.map((l) => normalizeText(l.name)));
  const added: Location[] = [];
  for (let n = from; n <= to; n++) {
    const name = `${prefix}${n}`;
    if (existing.has(normalizeText(name))) continue;
    added.push({ id: newId(), name, kind: 'division', capacity });
  }
  return { ok: true, data: { ...data, locations: [...data.locations, ...added] }, created: added.length };
}

export function placeBottles(data: CellarData, vintageId: string, locationId: string, quantity: number): Result<{ data: CellarData }> {
  const loc = data.locations.find((l) => l.id === locationId);
  if (!loc) return fail('That place no longer exists');
  if (!data.vintages.some((v) => v.id === vintageId)) return fail('That wine no longer exists');
  if (!Number.isInteger(quantity) || quantity < 1) return fail('Enter a whole number of bottles');
  const unplaced = stockOf(data, vintageId) - placedOf(data, vintageId);
  if (quantity > unplaced) {
    return fail(unplaced <= 0 ? 'All the bottles of this wine already have a place' : `Only ${unplaced} bottle${unplaced === 1 ? '' : 's'} of this wine ${unplaced === 1 ? 'has' : 'have'} no place yet`);
  }
  if (loc.capacity !== undefined) {
    const free = loc.capacity - occupancyOf(data, locationId);
    if (quantity > free) return fail(`${loc.name} has room for ${Math.max(0, free)} more (it holds ${loc.capacity})`);
  }
  const at = data.placements.find((p) => p.vintageId === vintageId && p.locationId === locationId);
  const placements = at
    ? data.placements.map((p) => (p.id === at.id ? { ...p, quantity: p.quantity + quantity } : p))
    : [...data.placements, { id: newId(), vintageId, locationId, quantity }];
  return { ok: true, data: { ...data, placements } };
}

export function moveBottles(data: CellarData, vintageId: string, fromId: string, toId: string, quantity: number): Result<{ data: CellarData }> {
  if (fromId === toId) return fail('Choose a different place to move them to');
  const from = data.placements.find((p) => p.vintageId === vintageId && p.locationId === fromId);
  const to = data.locations.find((l) => l.id === toId);
  if (!from) return fail('Those bottles are not there');
  if (!to) return fail('That place no longer exists');
  if (!Number.isInteger(quantity) || quantity < 1) return fail('Enter a whole number of bottles');
  if (quantity > from.quantity) return fail(`Only ${from.quantity} bottle${from.quantity === 1 ? ' is' : 's are'} there`);
  if (to.capacity !== undefined) {
    const free = to.capacity - occupancyOf(data, toId);
    if (quantity > free) return fail(`${to.name} has room for ${Math.max(0, free)} more (it holds ${to.capacity})`);
  }
  const dest = data.placements.find((p) => p.vintageId === vintageId && p.locationId === toId);
  let placements = data.placements.map((p) => (p.id === from.id ? { ...p, quantity: p.quantity - quantity } : p));
  placements = dest
    ? placements.map((p) => (p.id === dest.id ? { ...p, quantity: p.quantity + quantity } : p))
    : [...placements, { id: newId(), vintageId, locationId: toId, quantity }];
  return { ok: true, data: { ...data, placements: placements.filter((p) => p.quantity > 0) } };
}

/** Takes bottles out of a location without drinking them: they become "not placed yet". */
export function unplaceBottles(data: CellarData, vintageId: string, locationId: string, quantity: number): Result<{ data: CellarData }> {
  const at = data.placements.find((p) => p.vintageId === vintageId && p.locationId === locationId);
  if (!at) return fail('Those bottles are not there');
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > at.quantity) return fail(`Enter a number from 1 to ${at.quantity}`);
  return { ok: true, data: { ...data, placements: data.placements.map((p) => (p.id === at.id ? { ...p, quantity: p.quantity - quantity } : p)).filter((p) => p.quantity > 0) } };
}

export interface PlacementSuggestion {
  plan: PlacementInput[];
  /** Bottles that fit nowhere. */
  leftover: number;
}

/**
 * Proposes where new bottles could go. Keeps a wine together: first the places that already hold
 * this vintage, then other vintages of the bottling, then the same producer; after that the
 * tidiest division that fits them all, and only then the largest gaps. Floor boxes are only
 * suggested when the wine is already in one.
 */
export function suggestPlacement(
  data: CellarData,
  vintageId: string | null,
  quantity: number,
  /** For a vintage that doesn't exist yet: the bottling or winery it will belong to. */
  hint: { bottlingId?: string; producerId?: string } = {},
): PlacementSuggestion {
  const vintage = vintageId ? data.vintages.find((v) => v.id === vintageId) : undefined;
  const bottlingId = (vintage && vintage.bottlingId) || hint.bottlingId;
  const bottling = bottlingId ? data.bottlings.find((b) => b.id === bottlingId) : undefined;
  const producerId = bottling?.producerId ?? hint.producerId;
  const sameVintage = new Set<string>();
  const sameBottling = new Set<string>();
  const sameProducer = new Set<string>();
  if (bottlingId || producerId) {
    const byVintage = new Map(data.vintages.map((v) => [v.id, v]));
    const byBottling = new Map(data.bottlings.map((b) => [b.id, b]));
    for (const p of data.placements) {
      const v = byVintage.get(p.vintageId);
      const b = v && byBottling.get(v.bottlingId);
      if (!v || !b) continue;
      if (vintage && v.id === vintage.id) sameVintage.add(p.locationId);
      else if (b.id === bottlingId) sameBottling.add(p.locationId);
      else if (b.producerId === producerId) sameProducer.add(p.locationId);
    }
  }
  const free = (l: Location) => (l.capacity === undefined ? Number.POSITIVE_INFINITY : Math.max(0, l.capacity - occupancyOf(data, l.id)));
  const plan: PlacementInput[] = [];
  const used = new Set<string>();
  let remaining = quantity;
  const take = (l: Location) => {
    const n = Math.min(remaining, free(l));
    if (n > 0) {
      plan.push({ locationId: l.id, quantity: n });
      remaining -= n;
    }
    used.add(l.id);
  };
  const natural = (a: Location, b: Location) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

  for (const tier of [sameVintage, sameBottling, sameProducer]) {
    for (const l of data.locations.filter((x) => tier.has(x.id) && !used.has(x.id)).sort(natural)) {
      if (remaining <= 0) break;
      take(l);
    }
  }
  const open = data.locations.filter((l) => !used.has(l.id) && l.kind !== 'box' && free(l) > 0);
  while (remaining > 0) {
    const fits = open.filter((l) => !used.has(l.id) && free(l) >= remaining).sort((a, b) => free(a) - free(b) || natural(a, b));
    const pick = fits[0] ?? open.filter((l) => !used.has(l.id)).sort((a, b) => free(b) - free(a) || natural(a, b))[0];
    if (!pick) break;
    take(pick);
  }
  return { plan, leftover: remaining };
}

// ---- reviews -----------------------------------------------------------------

export interface ReviewInput {
  source: ReviewSource;
  sourceName?: string;
  score?: number;
  scale?: number;
  reviewer?: string;
  text?: string;
  date?: string;
  url?: string;
  drinkFrom?: number;
  drinkTo?: number;
}

/** Only web links are kept: anything else (javascript:, data:, file:) could run or leak when clicked. */
export function safeUrl(raw: string | undefined): string | undefined {
  const t = cleanText(raw);
  if (!t) return undefined;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : undefined;
  } catch {
    return undefined;
  }
}

export function validateReviewInput(r: ReviewInput): FieldErrors {
  const e: FieldErrors = {};
  if (!REVIEW_SOURCES.includes(r.source)) e.source = 'Choose a source';
  if (r.source === 'other' && !cleanText(r.sourceName)) e.sourceName = 'Who wrote it?';
  const scale = r.scale ?? REVIEW_SOURCE_SCALE[r.source] ?? 100;
  if (r.scale !== undefined && (!Number.isFinite(r.scale) || r.scale <= 0 || r.scale > 1000)) e.scale = 'Enter the top of the scale, like 100 or 20';
  if (r.score !== undefined && (!Number.isFinite(r.score) || r.score < 0 || (!e.scale && r.score > scale))) e.score = `Enter a score from 0 to ${scale}`;
  if (r.url !== undefined && cleanText(r.url) && !safeUrl(r.url)) e.url = 'Enter a web address (starting with http or https)';
  if (r.date !== undefined && cleanText(r.date) && !isValidDate(r.date)) e.date = 'Use YYYY-MM-DD (or just YYYY-MM or YYYY)';
  const w = validateWindow({ drinkFrom: r.drinkFrom, drinkTo: r.drinkTo });
  if (w.drinkFrom) e.drinkFrom = w.drinkFrom;
  if (w.drinkTo) e.drinkTo = w.drinkTo;
  if (!e.score && !cleanText(r.text) && r.score === undefined && !cleanText(r.url)) e.score = 'Add a score, a note or a link';
  return e;
}

function makeReview(id: string, vintageId: string, r: ReviewInput): Review {
  return compact({
    id,
    vintageId,
    source: r.source,
    sourceName: r.source === 'other' ? cleanText(r.sourceName) : undefined,
    score: r.score,
    scale: r.score !== undefined ? (r.scale ?? REVIEW_SOURCE_SCALE[r.source]) : undefined,
    reviewer: cleanText(r.reviewer),
    text: cleanText(r.text),
    date: cleanText(r.date),
    url: safeUrl(r.url),
    drinkFrom: r.drinkFrom,
    drinkTo: r.drinkTo,
  });
}

export function addReview(data: CellarData, vintageId: string, input: ReviewInput): Result<{ data: CellarData; reviewId: string }> {
  if (!data.vintages.some((v) => v.id === vintageId)) return fail('That wine no longer exists');
  const e = validateReviewInput(input);
  if (Object.keys(e).length) return fail(firstError(e), e);
  const review = makeReview(newId(), vintageId, input);
  return { ok: true, data: { ...data, reviews: [...data.reviews, review] }, reviewId: review.id };
}

export function updateReview(data: CellarData, reviewId: string, input: ReviewInput): Result<{ data: CellarData }> {
  const old = data.reviews.find((r) => r.id === reviewId);
  if (!old) return fail('That review no longer exists');
  const e = validateReviewInput(input);
  if (Object.keys(e).length) return fail(firstError(e), e);
  return { ok: true, data: { ...data, reviews: data.reviews.map((r) => (r.id === reviewId ? makeReview(reviewId, old.vintageId, input) : r)) } };
}

export function deleteReview(data: CellarData, reviewId: string): CellarData {
  return { ...data, reviews: data.reviews.filter((r) => r.id !== reviewId) };
}

// ---- settings & meta -------------------------------------------------------

export function updateSettings(data: CellarData, patch: Partial<Settings>): CellarData {
  const next = { ...data.settings, ...patch };
  if (!/^[A-Z]{3}$/.test(next.currency)) next.currency = data.settings.currency;
  next.drinkSoonYears = Math.min(5, Math.max(0, Math.round(Number.isFinite(next.drinkSoonYears) ? next.drinkSoonYears : 1)));
  next.divisionCapacity = Math.min(1000, Math.max(1, Math.round(Number.isFinite(next.divisionCapacity) ? next.divisionCapacity : 15)));
  return { ...data, settings: next };
}

/** Adds a tasting word of your own to the table. */
export function addCustomImpression(data: CellarData, label: string): CellarData {
  const clean = cleanText(label)?.slice(0, 60);
  if (!clean) return data;
  if (data.settings.customImpressions.some((x) => normalizeText(x) === normalizeText(clean))) return data;
  return { ...data, settings: { ...data.settings, customImpressions: [...data.settings.customImpressions, clean] } };
}

/** Takes a word off the suggestion list. Tastings that already use it keep it. */
export function removeCustomImpression(data: CellarData, label: string): CellarData {
  const key = normalizeText(label);
  const next = data.settings.customImpressions.filter((x) => normalizeText(x) !== key);
  return next.length === data.settings.customImpressions.length ? data : { ...data, settings: { ...data.settings, customImpressions: next } };
}

export function markBackedUp(data: CellarData, whenIso: string): CellarData {
  return { ...data, meta: { ...data.meta, lastBackupAt: whenIso } };
}

export const SAMPLE_PREFIX = 'sample-';

const isSampleId = (id: string) => id.startsWith(SAMPLE_PREFIX);

/** A demo wine you have since bought more of, drunk, or reviewed is yours now. */
function userTouched(data: CellarData, vintageId: string): boolean {
  return (
    data.purchases.some((p) => p.vintageId === vintageId && !isSampleId(p.id)) ||
    data.consumptions.some((c) => c.vintageId === vintageId && !isSampleId(c.id)) ||
    data.reviews.some((r) => r.vintageId === vintageId && !isSampleId(r.id))
  );
}

/** Wines that are still pure demo data. */
function isDemoVintage(data: CellarData, v: Vintage): boolean {
  return isSampleId(v.id) && !userTouched(data, v.id);
}

export function hasSampleData(data: CellarData): boolean {
  return data.vintages.some((v) => isDemoVintage(data, v));
}

/**
 * Removes the demo wines and their ledger. Only demo *vintages* are deleted: a wine you added
 * yourself under a demo bottling keeps that bottling and producer alive. Demo storage places
 * go too, unless you have put your own bottles in them.
 */
export function removeSampleData(data: CellarData): CellarData {
  const pruned = prune({ ...data, vintages: data.vintages.filter((v) => !isDemoVintage(data, v)) });
  const occupied = new Set(pruned.placements.map((p) => p.locationId));
  return { ...pruned, locations: pruned.locations.filter((l) => !isSampleId(l.id) || occupied.has(l.id)) };
}

const BACKUP_REMINDER_DAYS = 30;

/** True when there is real data and it has not been backed up recently. */
export function needsBackup(data: CellarData, now: Date = new Date()): boolean {
  const own = data.vintages.some((v) => !isDemoVintage(data, v));
  if (!own) return false;
  const last = data.meta.lastBackupAt ? Date.parse(data.meta.lastBackupAt) : NaN;
  if (Number.isNaN(last)) return true;
  return now.getTime() - last > BACKUP_REMINDER_DAYS * 86_400_000;
}
