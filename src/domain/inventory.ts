import type { Bottling, CellarData, Colour, Consumption, Group, Location, Producer, Purchase, Vintage } from './types';
import { COLOUR_LABEL } from './types';
import { bottlingKindLabel, compareText, formatYear, normalizeText, sizeBadge, yearOfDate } from './text';
import { impressionLabel } from './impressions';
import { STATUS_ORDER, windowOf, windowStatus, type WindowStatus } from './window';

export interface RowPlacement {
  location: Location;
  quantity: number;
}

/** One vintage with everything derived from the purchase/consumption ledger. */
export interface WineRow {
  vintage: Vintage;
  bottling: Bottling;
  producer: Producer;
  /** The family or company that owns the producer, if recorded. */
  group: Group | undefined;
  /** Bottles currently in the cellar. */
  bottles: number;
  purchased: number;
  consumed: number;
  /** Money spent on purchases whose price is known. */
  spent: number;
  /** Bottles bought at a known price. */
  pricedBottles: number;
  /** Average price paid per bottle, or null when no price was ever recorded. */
  avgPrice: number | null;
  firstPurchase: string | null;
  lastPurchase: string | null;
  /** Status as of now. Only meaningful while `bottles > 0`. */
  status: WindowStatus;
  /** Where the bottles are, biggest holding first. */
  placements: RowPlacement[];
  /** Bottles in stock that have not been given a place yet. */
  unplaced: number;
  /** Average of your 1–20 ratings for this wine, or null if you have not rated it. */
  rating: number | null;
  ratingCount: number;
  hasPhoto: boolean;
}

export function buildRows(data: CellarData, now: Date = new Date()): WineRow[] {
  const groups = new Map(data.groups.map((g) => [g.id, g]));
  const producers = new Map(data.producers.map((p) => [p.id, p]));
  const bottlings = new Map(data.bottlings.map((b) => [b.id, b]));
  const locations = new Map(data.locations.map((l) => [l.id, l]));
  const year = now.getFullYear();

  interface Acc {
    purchased: number;
    consumed: number;
    spent: number;
    priced: number;
    first: string | null;
    last: string | null;
    ratingSum: number;
    ratings: number;
    placed: number;
    where: RowPlacement[];
  }
  const acc = new Map<string, Acc>();
  const blank = (): Acc => ({ purchased: 0, consumed: 0, spent: 0, priced: 0, first: null, last: null, ratingSum: 0, ratings: 0, placed: 0, where: [] });
  const get = (id: string): Acc => {
    let a = acc.get(id);
    if (!a) {
      a = blank();
      acc.set(id, a);
    }
    return a;
  };

  for (const p of data.purchases) {
    const a = get(p.vintageId);
    a.purchased += p.quantity;
    if (p.unitPrice !== undefined) {
      a.spent += p.unitPrice * p.quantity;
      a.priced += p.quantity;
    }
    if (p.date) {
      if (a.first === null || p.date < a.first) a.first = p.date;
      if (a.last === null || p.date > a.last) a.last = p.date;
    }
  }
  for (const c of data.consumptions) {
    const a = get(c.vintageId);
    a.consumed += c.quantity;
    if (c.rating !== undefined) {
      a.ratingSum += c.rating;
      a.ratings += 1;
    }
  }
  for (const p of data.placements) {
    const loc = locations.get(p.locationId);
    if (!loc) continue;
    const a = get(p.vintageId);
    a.placed += p.quantity;
    a.where.push({ location: loc, quantity: p.quantity });
  }

  const rows: WineRow[] = [];
  for (const vintage of data.vintages) {
    const bottling = bottlings.get(vintage.bottlingId);
    const producer = bottling ? producers.get(bottling.producerId) : undefined;
    if (!bottling || !producer) continue;
    const a = acc.get(vintage.id) ?? blank();
    const bottles = Math.max(0, a.purchased - a.consumed);
    rows.push({
      vintage,
      bottling,
      producer,
      group: producer.groupId ? groups.get(producer.groupId) : undefined,
      bottles,
      purchased: a.purchased,
      consumed: a.consumed,
      spent: a.spent,
      pricedBottles: a.priced,
      avgPrice: a.priced > 0 ? a.spent / a.priced : null,
      firstPurchase: a.first,
      lastPurchase: a.last,
      status: windowStatus(windowOf(vintage), year, data.settings.drinkSoonYears),
      placements: a.where.sort((x, y) => y.quantity - x.quantity || compareText(x.location.name, y.location.name)),
      unplaced: Math.max(0, bottles - a.placed),
      rating: a.ratings > 0 ? a.ratingSum / a.ratings : null,
      ratingCount: a.ratings,
      hasPhoto: !!(vintage.images?.front || vintage.images?.back),
    });
  }
  return rows;
}

/** "Château X Grand Vin 2018", with the bottle size when it isn't a standard 75 cl ("… 2018 (Magnum)"). */
export function wineTitle(row: Pick<WineRow, 'producer' | 'bottling' | 'vintage'>): string {
  const size = sizeBadge(row.vintage.sizeMl);
  return `${row.producer.name} ${row.bottling.name} ${formatYear(row.vintage.year)}${size ? ` (${size})` : ''}`;
}

/** Newest vintage first, non-vintage last. */
function compareVintages(a: WineRow, b: WineRow): number {
  const ay = a.vintage.year;
  const by = b.vintage.year;
  if (ay === by) return a.vintage.sizeMl - b.vintage.sizeMl;
  if (ay === null) return 1;
  if (by === null) return -1;
  return by - ay;
}

export interface BottlingGroup {
  bottling: Bottling;
  rows: WineRow[];
  bottles: number;
}
export interface ProducerGroup {
  producer: Producer;
  group: Group | undefined;
  bottlings: BottlingGroup[];
  bottles: number;
  vintages: number;
}

/** Producer → bottling → vintage tree, with bottle counts rolled up at each level. */
export function groupByProducer(rows: WineRow[]): ProducerGroup[] {
  const producers = new Map<string, { producer: Producer; group: Group | undefined; bottlings: Map<string, BottlingGroup> }>();
  for (const row of rows) {
    let p = producers.get(row.producer.id);
    if (!p) {
      p = { producer: row.producer, group: row.group, bottlings: new Map() };
      producers.set(row.producer.id, p);
    }
    let b = p.bottlings.get(row.bottling.id);
    if (!b) {
      b = { bottling: row.bottling, rows: [], bottles: 0 };
      p.bottlings.set(row.bottling.id, b);
    }
    b.rows.push(row);
    b.bottles += row.bottles;
  }
  return [...producers.values()]
    .map(({ producer, group, bottlings }) => {
      const list = [...bottlings.values()].sort((a, b) => compareText(a.bottling.name, b.bottling.name));
      list.forEach((g) => g.rows.sort(compareVintages));
      return {
        producer,
        group,
        bottlings: list,
        bottles: list.reduce((n, g) => n + g.bottles, 0),
        vintages: list.reduce((n, g) => n + g.rows.length, 0),
      };
    })
    .sort((a, b) => compareText(a.producer.name, b.producer.name));
}

export interface OwnerGroup {
  /** `undefined` collects the wineries that have no owner group recorded. */
  group: Group | undefined;
  producers: ProducerGroup[];
  bottles: number;
  vintages: number;
}

/** Owner family/company → winery → bottling → vintage. Wineries without a group come last. */
export function groupByOwner(rows: WineRow[]): OwnerGroup[] {
  const byOwner = new Map<string, ProducerGroup[]>();
  for (const pg of groupByProducer(rows)) {
    const key = pg.group?.id ?? '';
    byOwner.set(key, [...(byOwner.get(key) ?? []), pg]);
  }
  return [...byOwner.entries()]
    .map(([, producers]) => ({
      group: producers[0]?.group,
      producers,
      bottles: producers.reduce((n, p) => n + p.bottles, 0),
      vintages: producers.reduce((n, p) => n + p.vintages, 0),
    }))
    .sort((a, b) => (a.group === undefined ? 1 : b.group === undefined ? -1 : compareText(a.group.name, b.group.name)));
}

export interface RowFilter {
  query?: string;
  colour?: Colour | '';
  /** `still` / `sparkling`, or empty for both. */
  fizz?: 'still' | 'sparkling' | '';
  status?: WindowStatus | '';
  country?: string;
  /** An owner group id, or {@link NOT_SET} for wines with none. */
  group?: string;
  /** Only wines without a label photo. */
  noPhoto?: boolean;
  /** Only wines with bottles in this place. */
  locationId?: string;
  /** Keep wines with no bottles left (the drinking history). */
  includeFinished?: boolean;
}

// Rows are rebuilt whenever the data changes, so a per-row cache can never go stale.
const haystacks = new WeakMap<WineRow, string>();

function haystack(row: WineRow): string {
  let h = haystacks.get(row);
  if (h === undefined) {
    const { bottling: b, vintage: v, producer: p } = row;
    h = normalizeText(
      [
        p.name,
        row.group?.name,
        b.name,
        formatYear(v.year),
        b.region,
        b.country,
        b.appellation,
        bottlingKindLabel(b),
        ...row.placements.map((x) => x.location.name),
        ...b.grapes.map((g) => g.grape),
        ...(b.barcodes ?? []),
      ]
        .filter(Boolean)
        .join(' '),
    );
    haystacks.set(row, h);
  }
  return h;
}

/**
 * Every vintage of the bottlings that carry this barcode, most recent year first (non-vintage last).
 * Finished wines are included: scanning a bottle you have none left of should still say what it is.
 */
export function rowsForBarcode(rows: WineRow[], code: string): WineRow[] {
  return rows
    .filter((r) => (r.bottling.barcodes ?? []).includes(code))
    .sort((a, b) => (b.vintage.year ?? -1) - (a.vintage.year ?? -1) || b.vintage.sizeMl - a.vintage.sizeMl);
}

export function filterRows(rows: WineRow[], f: RowFilter): WineRow[] {
  const tokens = f.query ? normalizeText(f.query).split(' ').filter(Boolean) : [];
  return rows.filter((row) => {
    if (!f.includeFinished && row.bottles === 0) return false;
    if (f.colour && row.bottling.colour !== f.colour) return false;
    if (f.fizz === 'sparkling' && !row.bottling.sparkling) return false;
    if (f.fizz === 'still' && row.bottling.sparkling) return false;
    if (f.status && row.status !== f.status) return false;
    if (f.country !== undefined && f.country !== '' && (row.bottling.country ?? '') !== (f.country === NOT_SET ? '' : f.country)) return false;
    if (f.group !== undefined && f.group !== '' && (row.group?.id ?? NOT_SET) !== f.group) return false;
    if (f.noPhoto && row.hasPhoto) return false;
    if (f.locationId && !row.placements.some((p) => p.location.id === f.locationId)) return false;
    if (tokens.length) {
      const h = haystack(row);
      if (!tokens.every((t) => h.includes(t))) return false;
    }
    return true;
  });
}

/** Sentinel used in the country and group filters for wines with none recorded. */
export const NOT_SET = '__not_set__';

export interface Count {
  key: string;
  label: string;
  bottles: number;
}

function countBy(rows: WineRow[], keyOf: (r: WineRow) => string, labelOf: (key: string) => string): Count[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (r.bottles === 0) continue;
    const k = keyOf(r);
    m.set(k, (m.get(k) ?? 0) + r.bottles);
  }
  return [...m.entries()]
    .map(([key, bottles]) => ({ key, label: labelOf(key), bottles }))
    .sort((a, b) => b.bottles - a.bottles || compareText(a.label, b.label));
}

export interface CellarStats {
  bottles: number;
  wines: number;
  producers: number;
  /** Cost of the bottles in stock, valued at the average price paid for each wine. */
  costOfStock: number;
  /** Bottles in stock that the cost figure covers (price known). */
  pricedBottles: number;
  unpricedBottles: number;
  /** Bottles in stock that have no storage place yet. */
  unplacedBottles: number;
  /** Bottles in stock without a label photo. */
  noPhotoWines: number;
  byStatus: Record<WindowStatus, number>;
  byColour: Count[];
  byFizz: Count[];
  byCountry: Count[];
  byGroup: Count[];
}

export function computeStats(rows: WineRow[]): CellarStats {
  const stock = rows.filter((r) => r.bottles > 0);
  const byStatus = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<WindowStatus, number>;
  let bottles = 0;
  let cost = 0;
  let priced = 0;
  let unplaced = 0;
  for (const r of stock) {
    bottles += r.bottles;
    byStatus[r.status] += r.bottles;
    unplaced += r.unplaced;
    if (r.avgPrice !== null) {
      // Value only the bottles that were bought at a known price: 2 priced + 3 unpriced bought,
      // all 5 in stock, is 2 bottles' worth of cost, not 5.
      const known = Math.min(r.bottles, r.pricedBottles);
      cost += r.avgPrice * known;
      priced += known;
    }
  }
  return {
    bottles,
    wines: stock.length,
    producers: new Set(stock.map((r) => r.producer.id)).size,
    costOfStock: cost,
    pricedBottles: priced,
    unpricedBottles: bottles - priced,
    unplacedBottles: unplaced,
    noPhotoWines: stock.filter((r) => !r.hasPhoto).length,
    byStatus,
    byColour: countBy(stock, (r) => r.bottling.colour ?? NOT_SET, (k) => (k === NOT_SET ? 'Not set' : COLOUR_LABEL[k as Colour])),
    byFizz: countBy(stock, (r) => (r.bottling.sparkling ? 'sparkling' : 'still'), (k) => (k === 'sparkling' ? 'Sparkling' : 'Still')),
    byCountry: countBy(stock, (r) => r.bottling.country ?? NOT_SET, (k) => (k === NOT_SET ? 'Not set' : k)),
    byGroup: countBy(stock, (r) => r.group?.id ?? NOT_SET, (k) => (k === NOT_SET ? 'No owner group' : (stock.find((r) => r.group?.id === k)?.group?.name ?? k))),
  };
}

export interface ForecastYear {
  year: number;
  counts: Record<WindowStatus, number>;
}

/**
 * How the cellar matures if nothing is opened: per calendar year, how many
 * bottles are still waiting, ready, at peak, closing soon or past their window.
 */
export function forecastByYear(rows: WineRow[], startYear: number, years: number, soonYears: number): ForecastYear[] {
  const out: ForecastYear[] = [];
  for (let i = 0; i < years; i++) {
    const year = startYear + i;
    const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<WindowStatus, number>;
    for (const r of rows) {
      if (r.bottles === 0) continue;
      counts[windowStatus(windowOf(r.vintage), year, soonYears)] += r.bottles;
    }
    out.push({ year, counts });
  }
  return out;
}

export interface PurchaseEntry {
  purchase: Purchase;
  vintage: Vintage;
  bottling: Bottling;
  producer: Producer;
}

/** Every purchase joined to its wine, newest first; undated purchases last. */
export function purchaseEntries(data: CellarData): PurchaseEntry[] {
  const vintages = new Map(data.vintages.map((v) => [v.id, v]));
  const bottlings = new Map(data.bottlings.map((b) => [b.id, b]));
  const producers = new Map(data.producers.map((p) => [p.id, p]));
  const out: PurchaseEntry[] = [];
  for (const purchase of data.purchases) {
    const vintage = vintages.get(purchase.vintageId);
    const bottling = vintage ? bottlings.get(vintage.bottlingId) : undefined;
    const producer = bottling ? producers.get(bottling.producerId) : undefined;
    if (vintage && bottling && producer) out.push({ purchase, vintage, bottling, producer });
  }
  return out.sort((a, b) => {
    const ad = a.purchase.date ?? '';
    const bd = b.purchase.date ?? '';
    if (ad === bd) return compareText(a.producer.name, b.producer.name);
    if (!ad) return 1;
    if (!bd) return -1;
    return bd.localeCompare(ad);
  });
}

export interface YearBucket {
  /** `null` groups purchases with no date. */
  year: number | null;
  bottles: number;
  spent: number;
  pricedBottles: number;
  purchases: number;
}

export function purchasesByYear(entries: PurchaseEntry[]): YearBucket[] {
  const m = new Map<number | null, YearBucket>();
  for (const { purchase: p } of entries) {
    const year = p.date ? yearOfDate(p.date) : null;
    let b = m.get(year);
    if (!b) {
      b = { year, bottles: 0, spent: 0, pricedBottles: 0, purchases: 0 };
      m.set(year, b);
    }
    b.bottles += p.quantity;
    b.purchases += 1;
    if (p.unitPrice !== undefined) {
      b.spent += p.unitPrice * p.quantity;
      b.pricedBottles += p.quantity;
    }
  }
  return [...m.values()].sort((a, b) => (a.year === null ? 1 : b.year === null ? -1 : b.year - a.year));
}

export function stockOf(data: CellarData, vintageId: string): number {
  let n = 0;
  for (const p of data.purchases) if (p.vintageId === vintageId) n += p.quantity;
  for (const c of data.consumptions) if (c.vintageId === vintageId) n -= c.quantity;
  return Math.max(0, n);
}

export function purchasedOf(purchases: Purchase[], vintageId: string): number {
  return purchases.filter((p) => p.vintageId === vintageId).reduce((n, p) => n + p.quantity, 0);
}

export function consumedOf(consumptions: Consumption[], vintageId: string): number {
  return consumptions.filter((c) => c.vintageId === vintageId).reduce((n, c) => n + c.quantity, 0);
}

/** Bottles of this wine that have been given a storage place. */
export function placedOf(data: CellarData, vintageId: string): number {
  let n = 0;
  for (const p of data.placements) if (p.vintageId === vintageId) n += p.quantity;
  return n;
}

/** Bottles currently in one place. */
export function occupancyOf(data: CellarData, locationId: string): number {
  let n = 0;
  for (const p of data.placements) if (p.locationId === locationId) n += p.quantity;
  return n;
}

export interface LocationFill {
  location: Location;
  used: number;
  /** `Infinity` when the place has no capacity limit. */
  free: number;
  /** 0–1, or 0 when there is no limit. */
  fill: number;
  full: boolean;
}

/** Every place with how full it is, in natural order (Division 2 before Division 10). */
export function locationFills(data: CellarData): LocationFill[] {
  const used = new Map<string, number>();
  for (const p of data.placements) used.set(p.locationId, (used.get(p.locationId) ?? 0) + p.quantity);
  const kindOrder = { division: 0, other: 1, box: 2 } as const;
  return [...data.locations]
    .sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
    .map((location) => {
      const u = used.get(location.id) ?? 0;
      const cap = location.capacity;
      return {
        location,
        used: u,
        free: cap === undefined ? Number.POSITIVE_INFINITY : Math.max(0, cap - u),
        fill: cap === undefined ? 0 : Math.min(1, u / cap),
        full: cap !== undefined && u >= cap,
      };
    });
}

export interface TastingEntry {
  consumption: Consumption;
  /** Readable impressions (table words and your own). */
  impressions: string[];
  location: Location | undefined;
}

/** A wine's drinking history, newest first. */
export function tastingEntries(data: CellarData, vintageId: string): TastingEntry[] {
  const locations = new Map(data.locations.map((l) => [l.id, l]));
  return data.consumptions
    .filter((c) => c.vintageId === vintageId)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((consumption) => ({
      consumption,
      impressions: (consumption.impressions ?? []).map(impressionLabel),
      location: consumption.locationId ? locations.get(consumption.locationId) : undefined,
    }));
}
